/// <reference types="bun" />
import { beforeEach, describe, expect, mock, test } from "bun:test";

// POST /api/offline/login-audit (FR-006c): cualquier usuario autenticado; el actor sale de la sesión (record_offline_login).
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
let rpcResult: unknown;
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return { data: rpcResult, error: null }; },
  }),
}));
const { POST } = await import("../src/pages/api/offline/login-audit");

const OP = "f3000000-0000-4000-8000-000000000001";
const call = (role: string | null, body: unknown) =>
  Promise.resolve(POST({
    request: new Request("http://localhost:4321/api/offline/login-audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
    cookies: {},
    locals: role ? { auth: { user: { id: "u1" }, profile: { id: "u1", role, active: true } } } : {},
  } as never));

beforeEach(() => { rpcCalls = []; rpcResult = { status: "applied" }; });

describe("POST /api/offline/login-audit", () => {
  test("401 sin sesión y 400 con cuerpo inválido, sin llamar a la RPC", async () => {
    expect((await call(null, { operationId: OP, startedAt: new Date().toISOString() })).status).toBe(401);
    expect((await call("VIEWER", "no es json")).status).toBe(400);
    expect((await call("VIEWER", { operationId: "x", startedAt: new Date().toISOString() })).status).toBe(400);
    expect((await call("VIEWER", { operationId: OP, startedAt: "ayer" })).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  test("cualquier rol llama a record_offline_login con el operationId y la hora (sin userId del cliente)", async () => {
    for (const role of ["OPERATOR", "VIEWER", "ADMINISTRATOR", "ROOT"]) {
      rpcCalls.length = 0;
      const response = await call(role, { operationId: OP, startedAt: "2026-10-10T10:00:00Z", userId: "otro" });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(rpcCalls).toEqual([{ name: "record_offline_login", args: { p_operation_id: OP, p_started_at: "2026-10-10T10:00:00.000Z" } }]);
    }
  });

  test("duplicate es 200; los rechazos se traducen a 403, 422 y 429", async () => {
    rpcResult = { status: "duplicate" };
    expect((await (await call("VIEWER", { operationId: OP, startedAt: "2026-10-10T10:00:00Z" })).json()).status).toBe("duplicate");
    for (const [code, status] of [["FORBIDDEN", 403], ["VALIDATION", 422], ["RATE_LIMITED", 429]] as const) {
      rpcResult = { status: "rejected", code, message: "x" };
      expect((await call("VIEWER", { operationId: OP, startedAt: "2026-10-10T10:00:00Z" })).status).toBe(status);
    }
  });
});
