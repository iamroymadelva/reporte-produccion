/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Role = "ROOT" | "ADMINISTRATOR" | "VIEWER" | "OPERATOR";

// RPC simulada: registra las llamadas y devuelve el resultado configurado.
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcResult: { data: unknown; error: { code?: string; message?: string; details?: string } | null } = { data: { id: "r1" }, error: null };
let tableUpdates = 0;
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
    from: () => {
      tableUpdates += 1;
      const chain: any = new Proxy({}, { get: () => () => chain });
      return chain;
    },
  }),
}));

const { reportRpcFailure } = await import("../src/lib/report-rpc");
const { POST: approve } = await import("../src/pages/api/reports/[id]/approve");
const { POST: cancel } = await import("../src/pages/api/reports/[id]/cancel");
const { POST: correct } = await import("../src/pages/api/reports/[id]/correct");
const { PATCH: patchReport } = await import("../src/pages/api/reports/[id]");

const call = (handler: (context: any) => Response | Promise<Response>, role: Role | null, body?: unknown) =>
  Promise.resolve(handler({
    request: new Request("http://localhost:4321/api/reports/r1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    cookies: {},
    params: { id: "r1" },
    locals: role ? { auth: { user: { id: "u1" }, profile: { role } } } : {},
  }));

beforeEach(() => {
  rpcCalls = [];
  tableUpdates = 0;
  rpcResult = { data: { id: "r1" }, error: null };
});

describe("reportRpcFailure", () => {
  test("traduce los códigos estables a estados HTTP y mensajes en español", () => {
    expect(reportRpcFailure({ code: "42501", message: "No tienes permiso" })).toMatchObject({ status: 403 });
    expect(reportRpcFailure({ code: "P0001", message: "NOT_SUBMITTED" })).toMatchObject({ status: 409, code: "NOT_SUBMITTED" });
    expect(reportRpcFailure({ code: "P0002", message: "OPEN_CONFLICT" })).toMatchObject({ status: 409, code: "OPEN_CONFLICT" });
    expect(reportRpcFailure({ code: "P0003", message: "NOT_CANCELLABLE", details: "Solo borradores." })).toMatchObject({
      status: 409, code: "NOT_CANCELLABLE", error: "Solo borradores.",
    });
    expect(reportRpcFailure({ code: "P0005", message: "NOT_CORRECTABLE" })).toMatchObject({ status: 409, code: "NOT_CORRECTABLE" });
    expect(reportRpcFailure({ code: "P0007", message: "INVALID_STOPS" })).toMatchObject({ status: 409, code: "INVALID_STOPS" });
    expect(reportRpcFailure({ code: "P0006", message: "NOT_FOUND" })).toMatchObject({ status: 404 });
    expect(reportRpcFailure({ code: "22023", message: "Motivo demasiado corto" })).toEqual({
      status: 400, error: "Motivo demasiado corto", code: "INVALID",
    });
    // Un error de trigger (P0001 con texto propio) se conserva como 400.
    expect(reportRpcFailure({ code: "P0001", message: "Debes indicar el motivo de cancelación" })).toMatchObject({ status: 400 });
  });
});

describe("POST /api/reports/[id]/approve", () => {
  test("OPERATOR y VIEWER reciben 403 sin llamar a la RPC", async () => {
    expect((await call(approve, "OPERATOR")).status).toBe(403);
    expect((await call(approve, "VIEWER")).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  test("un manager llama a approve_report", async () => {
    const response = await call(approve, "ADMINISTRATOR");
    expect(response.status).toBe(200);
    expect(rpcCalls).toEqual([{ name: "approve_report", args: { p_report_id: "r1" } }]);
  });

  test("traduce NOT_SUBMITTED y OPEN_CONFLICT", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "NOT_SUBMITTED" } };
    expect((await call(approve, "ROOT")).status).toBe(409);
    rpcResult = { data: null, error: { code: "P0002", message: "OPEN_CONFLICT" } };
    const response = await call(approve, "ROOT");
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("OPEN_CONFLICT");
  });
});

describe("POST /api/reports/[id]/cancel", () => {
  test("VIEWER recibe 403; el motivo es obligatorio", async () => {
    expect((await call(cancel, "VIEWER", { reason: "x" })).status).toBe(403);
    expect((await call(cancel, "OPERATOR", { reason: "   " })).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  test("autor y manager usan cancel_report", async () => {
    expect((await call(cancel, "OPERATOR", { reason: "Error" })).status).toBe(200);
    expect((await call(cancel, "ADMINISTRATOR", { reason: "Fuera de turno" })).status).toBe(200);
    expect(rpcCalls.map((item) => item.name)).toEqual(["cancel_report", "cancel_report"]);
    expect(rpcCalls[1].args).toEqual({ p_report_id: "r1", p_reason: "Fuera de turno" });
  });

  test("NOT_CANCELLABLE responde 409", async () => {
    rpcResult = { data: null, error: { code: "P0003", message: "NOT_CANCELLABLE", details: "No se puede." } };
    const response = await call(cancel, "ADMINISTRATOR", { reason: "Motivo" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("No se puede.");
  });
});

describe("POST /api/reports/[id]/correct", () => {
  test("solo managers; motivo de al menos 5 caracteres; solo campos de la lista", async () => {
    expect((await call(correct, "OPERATOR", { patch: { lot: "X" }, reason: "Motivo válido" })).status).toBe(403);
    expect((await call(correct, "ADMINISTRATOR", { patch: { lot: "X" }, reason: "abc" })).status).toBe(400);
    const unknown = await call(correct, "ADMINISTRATOR", { patch: { status: "DRAFT" }, reason: "Motivo válido" });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain("status");
    expect((await call(correct, "ADMINISTRATOR", { patch: {}, reason: "Motivo válido" })).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  test("llama a correct_report con parche, listas y motivo", async () => {
    const response = await call(correct, "ROOT", {
      patch: { lot: "L2", observations: "" },
      stops: [{ id: "s1", description: "Ajuste" }],
      reason: "  Error de digitación ",
    });
    expect(response.status).toBe(200);
    expect(rpcCalls).toEqual([{
      name: "correct_report",
      args: {
        p_report_id: "r1",
        p_patch: { lot: "L2", observations: null },
        p_stops: [{ id: "s1", description: "Ajuste" }],
        p_changes: null,
        p_reason: "Error de digitación",
      },
    }]);
  });
});

describe("PATCH /api/reports/[id]", () => {
  const patch = (role: Role | null) => call(patchReport, role, { lot: "X" });

  test("los managers reciben 403 con el mensaje Usa Corregir con motivo", async () => {
    for (const role of ["ROOT", "ADMINISTRATOR"] as const) {
      const response = await patch(role);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("Usa Corregir con motivo");
    }
    expect(tableUpdates).toBe(0);
  });

  test("VIEWER recibe 403 y sin sesión 401", async () => {
    expect((await patch("VIEWER")).status).toBe(403);
    expect((await patch(null)).status).toBe(401);
    expect(tableUpdates).toBe(0);
  });
});
