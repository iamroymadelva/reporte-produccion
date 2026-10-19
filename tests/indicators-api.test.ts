/// <reference types="bun" />
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resolveIndicatorsRange } from "../src/lib/indicators";

// GET /api/indicadores (T004/T007/T012): 401 sin sesión, 403 para OPERATOR (sin llamar al RPC), 422 con rango inválido,
// 200 para ROOT/ADMINISTRATOR/VIEWER con el JSON del RPC más range.key y serverTime. Sin cache.
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
let rpcResult: { data: unknown; error: unknown };
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  }),
}));

const { GET } = await import("../src/pages/api/indicadores");

const call = (role: string | null, query = "") =>
  Promise.resolve(GET({
    request: new Request(`http://localhost:4321/api/indicadores${query}`),
    url: new URL(`http://localhost:4321/api/indicadores${query}`),
    cookies: {},
    locals: role ? { auth: { user: { id: "u1" }, profile: { id: "u1", full_name: "Persona", role, job_title: null, active: true } } } : {},
  } as never));

const rpcBody = {
  range: { from: "x", to: "y", days: 30 },
  cards: { reports: 2, approved: 1, approvedRatio: 0.5, avgApprovalSeconds: 3600, stopSeconds: 600 },
  daily: [{ date: "2026-10-19", seconds: 600 }],
  machines: [],
  categories: [],
};

beforeEach(() => {
  rpcCalls = [];
  rpcResult = { data: rpcBody, error: null };
});

describe("GET /api/indicadores", () => {
  test("200 devuelve el JSON del RPC más range.key y serverTime, sin cache", async () => {
    const response = await call("ROOT", "?rango=30d");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    const range = resolveIndicatorsRange("30d");
    expect(body.range).toEqual({ key: "30d", from: range.from, to: range.to, days: 30 });
    expect(body.cards).toEqual(rpcBody.cards);
    expect(body.daily).toEqual(rpcBody.daily);
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
  });

  test("el RPC recibe p_from/p_to calculados en el servidor por rango", async () => {
    for (const key of ["7d", "30d", "90d"] as const) {
      rpcCalls = [];
      const response = await call("ADMINISTRATOR", `?rango=${key}`);
      expect(response.status).toBe(200);
      const range = resolveIndicatorsRange(key);
      expect(rpcCalls).toEqual([{ fn: "indicators_summary", args: { p_from: range.from, p_to: range.to } }]);
      expect((await response.json()).range.days).toBe(range.days);
    }
  });

  test("error del RPC responde 500 genérico sin filtrar el detalle y sin cache", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const original = console.error;
    console.error = () => {};
    try {
      const response = await call("VIEWER", "?rango=7d");
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const text = JSON.stringify(await response.json());
      expect(text).toContain("No fue posible cargar los indicadores.");
      expect(text).not.toContain("boom");
    } finally {
      console.error = original;
    }
  });

  test("401 sin sesión", async () => {
    const response = await call(null, "?rango=30d");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpcCalls).toHaveLength(0);
  });

  test("403 para OPERATOR sin llamar al RPC", async () => {
    const response = await call("OPERATOR", "?rango=30d");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpcCalls).toHaveLength(0);
  });

  test("422 con rango ausente, inválido, de otra capitalización, con espacio o vacío", async () => {
    const queries = ["", "?rango=15d", "?rango=30D", "?rango=7d%20", "?rango="];
    for (const query of queries) {
      const response = await call("ROOT", query);
      expect(response.status).toBe(422);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect((await response.json()).error).toBe("El rango no es válido: usa 7d, 30d o 90d.");
    }
    expect(rpcCalls).toHaveLength(0);
  });

  test("200 para ROOT, ADMINISTRATOR y VIEWER", async () => {
    for (const role of ["ROOT", "ADMINISTRATOR", "VIEWER"]) {
      expect((await call(role, "?rango=90d")).status).toBe(200);
    }
    expect(rpcCalls).toHaveLength(3);
  });
});
