/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Op = { operationId: string; userId: string; seq: number; type: string; payload: Record<string, unknown> };

// RPC simulada: apply_sync_operation devuelve un resultado por operación según `rpcImpl`.
let rpcCalls: Array<{ name: string; args: { op: Op } }> = [];
let rpcImpl: (op: Op) => { data: unknown; error: { code?: string; message?: string } | null };
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    rpc: async (name: string, args: { op: Op }) => {
      rpcCalls.push({ name, args });
      return rpcImpl(args.op);
    },
  }),
}));

const { POST } = await import("../src/pages/api/sync/batch");

const USER = "10000000-0000-4000-8000-000000000001";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const op = (n: number, type: string, payload: Record<string, unknown> = {}, extra: Partial<Op> = {}): Op => ({
  operationId: uuid(n), userId: USER, seq: n, type, payload, ...extra,
});

const call = (role: string | null, body: unknown, active = true) =>
  Promise.resolve(POST({
    request: new Request("http://localhost:4321/api/sync/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    cookies: {},
    locals: role ? { auth: { user: { id: USER }, profile: { role, active } } } : {},
  } as never));

beforeEach(() => {
  rpcCalls = [];
  rpcImpl = (o) => ({ data: { operationId: o.operationId, status: "applied" }, error: null });
});

describe("POST /api/sync/batch", () => {
  test("401 sin sesión y 403 si no es OPERATOR activo, sin llamar a la RPC", async () => {
    expect((await call(null, { operations: [op(1, "CREATE_REPORT")] })).status).toBe(401);
    expect((await call("VIEWER", { operations: [op(1, "CREATE_REPORT")] })).status).toBe(403);
    expect((await call("ADMINISTRATOR", { operations: [op(1, "CREATE_REPORT")] })).status).toBe(403);
    expect((await call("OPERATOR", { operations: [op(1, "CREATE_REPORT")] }, false)).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  test("valida la forma: 1 a 50 operaciones con campos obligatorios", async () => {
    expect((await call("OPERATOR", "no-json")).status).toBe(400);
    expect((await call("OPERATOR", { operations: [] })).status).toBe(400);
    expect((await call("OPERATOR", { operations: Array.from({ length: 51 }, (_, i) => op(i + 1, "ADD_CHANGE")) })).status).toBe(400);
    expect((await call("OPERATOR", { operations: [{ ...op(1, "CREATE_REPORT"), operationId: "nope" }] })).status).toBe(400);
    expect((await call("OPERATOR", { operations: [op(1, "BORRAR_TODO")] })).status).toBe(400);
    expect((await call("OPERATOR", { operations: [{ ...op(1, "CREATE_REPORT"), payload: null }] })).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
    expect((await call("OPERATOR", { operations: Array.from({ length: 50 }, (_, i) => op(i + 1, "ADD_CHANGE")) })).status).toBe(200);
  });

  test("seq entero es obligatorio y no puede repetirse", async () => {
    const { seq: _omit, ...withoutSeq } = op(1, "CREATE_REPORT");
    expect((await call("OPERATOR", { operations: [withoutSeq] })).status).toBe(400);
    expect((await call("OPERATOR", { operations: [{ ...op(1, "CREATE_REPORT"), seq: 1.5 }] })).status).toBe(400);
    expect((await call("OPERATOR", { operations: [{ ...op(1, "CREATE_REPORT"), seq: "1" }] })).status).toBe(400);
    expect((await call("OPERATOR", { operations: [op(1, "CREATE_REPORT"), { ...op(2, "START_STOP"), seq: 1 }] })).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  test("rechaza cuerpos de más de ~2 MB con 413 antes de procesar", async () => {
    const big = "x".repeat(2_100_000);
    expect((await call("OPERATOR", { operations: [op(1, "SAVE_REPORT_FIELDS", { fields: { observations: big } })] })).status).toBe(413);
    const declared = await Promise.resolve(POST({
      request: new Request("http://localhost:4321/api/sync/batch", {
        method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "5000000" }, body: "{}",
      }),
      cookies: {},
      locals: { auth: { user: { id: USER }, profile: { role: "OPERATOR", active: true } } },
    } as never));
    expect(declared.status).toBe(413);
    expect(rpcCalls).toHaveLength(0);
  });

  test("procesa en orden de seq, devuelve results y serverTime, sin caché", async () => {
    const response = await call("OPERATOR", { operations: [op(3, "SUBMIT_REPORT"), op(1, "CREATE_REPORT"), op(2, "START_STOP")] });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(rpcCalls.map((c) => c.name)).toEqual(["apply_sync_operation", "apply_sync_operation", "apply_sync_operation"]);
    expect(rpcCalls.map((c) => c.args.op.seq)).toEqual([1, 2, 3]);
    expect(body.results.map((r: { operationId: string }) => r.operationId)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
  });

  test("un CREATE_REPORT rechazado deja a sus dependientes en DEPENDENCY_FAILED sin llamar a la RPC", async () => {
    rpcImpl = (o) => o.type === "CREATE_REPORT" && o.payload.reportId === "r1"
      ? { data: { operationId: o.operationId, status: "rejected", code: "NO_ASSIGNMENT", message: "x" }, error: null }
      : { data: { operationId: o.operationId, status: "applied" }, error: null };
    const response = await call("OPERATOR", { operations: [
      op(1, "CREATE_REPORT", { reportId: "r1" }),
      op(2, "START_STOP", { reportId: "r1", stopId: "s1" }),
      op(3, "CLOSE_STOP", { stopId: "s1", reportId: "r1" }),
      op(4, "CREATE_REPORT", { reportId: "r2" }),
      op(5, "ADD_CHANGE", { reportId: "r2" }),
    ] });
    const { results } = await response.json();
    expect(results.map((r: { status: string }) => r.status)).toEqual(["rejected", "rejected", "rejected", "applied", "applied"]);
    expect(results[1]).toMatchObject({ operationId: uuid(2), code: "DEPENDENCY_FAILED" });
    expect(results[2]).toMatchObject({ operationId: uuid(3), code: "DEPENDENCY_FAILED" });
    expect(rpcCalls.map((c) => c.args.op.operationId)).toEqual([uuid(1), uuid(4), uuid(5)]);
  });

  test("una operación con userId ajeno se rechaza FORBIDDEN sin llegar a la RPC", async () => {
    const response = await call("OPERATOR", { operations: [op(1, "ADD_CHANGE", {}, { userId: "20000000-0000-4000-8000-000000000002" })] });
    const { results } = await response.json();
    expect(results[0]).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    expect(rpcCalls).toHaveLength(0);
  });

  test("subida parcial: si la RPC falla a mitad de lote se devuelven solo los resultados procesados", async () => {
    rpcImpl = (o) => o.seq === 3
      ? { data: null, error: { code: "08006", message: "connection" } }
      : { data: { operationId: o.operationId, status: "applied" }, error: null };
    const response = await call("OPERATOR", { operations: [op(1, "CREATE_REPORT"), op(2, "START_STOP"), op(3, "CLOSE_STOP"), op(4, "SUBMIT_REPORT")] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results.map((r: { operationId: string }) => r.operationId)).toEqual([uuid(1), uuid(2)]);
    expect(rpcCalls).toHaveLength(3);
  });

  test("si falla la primera operación responde 500 (nada confirmado)", async () => {
    rpcImpl = () => ({ data: null, error: { code: "08006", message: "connection" } });
    expect((await call("OPERATOR", { operations: [op(1, "CREATE_REPORT")] })).status).toBe(500);
  });
});
