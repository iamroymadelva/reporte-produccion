/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

// Cliente simulado: RPC registrada y consulta de paradas configurable.
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let rpcResult: { data: unknown; error: { code?: string; message?: string; details?: string } | null };
let currentStop: { id: string; stop_category_id: string | null } | null;
let updates: Array<Record<string, unknown>> = [];
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
    from: () => {
      const chain: any = new Proxy({}, {
        get: (_target, prop) => {
          if (prop === "update") return (values: Record<string, unknown>) => { updates.push(values); return chain; };
          if (prop === "maybeSingle") return () => Promise.resolve({ data: updates.length ? { id: "s1" } : currentStop, error: null });
          return () => chain;
        },
      });
      return chain;
    },
  }),
}));

const { POST: review } = await import("../src/pages/api/sync-quarantine/[id]/review");
const { POST: closeStop } = await import("../src/pages/api/reports/[id]/stops/[stopId]/close");
const { describeQuarantineItem } = await import("../src/lib/sync-quarantine");

const ITEM = "00000000-0000-4000-8000-000000000001";
const CATEGORY = "00000000-0000-4000-8000-000000000002";
const context = (role: string | null, params: Record<string, string>, body?: unknown) => ({
  request: new Request("http://localhost:4321/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  cookies: {},
  params,
  locals: role ? { auth: { user: { id: "u1" }, profile: { role } } } : {},
}) as never;

beforeEach(() => {
  rpcCalls = [];
  updates = [];
  rpcResult = { data: { status: "REVIEWED" }, error: null };
  currentStop = { id: "s1", stop_category_id: null };
});

describe("POST /api/sync-quarantine/[id]/review", () => {
  test("solo managers; el operario y el auditor reciben 403 sin llamar a la RPC", async () => {
    expect((await review(context(null, { id: ITEM }, {}))).status).toBe(401);
    expect((await review(context("OPERATOR", { id: ITEM }, {}))).status).toBe(403);
    expect((await review(context("VIEWER", { id: ITEM }, {}))).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  test("marcar revisado y aplicar con motivo llaman a review_quarantine", async () => {
    expect((await review(context("ADMINISTRATOR", { id: ITEM }, {}))).status).toBe(200);
    expect(rpcCalls[0]).toEqual({ name: "review_quarantine", args: { p_item_id: ITEM, p_apply: false, p_reason: null } });
    expect((await review(context("ROOT", { id: ITEM }, { apply: true, reason: "Verificado con el operario" }))).status).toBe(200);
    expect(rpcCalls[1].args).toEqual({ p_item_id: ITEM, p_apply: true, p_reason: "Verificado con el operario" });
  });

  test("aplicar exige un motivo de 5 caracteres y traduce los errores de la RPC", async () => {
    expect((await review(context("ROOT", { id: ITEM }, { apply: true, reason: "abc" }))).status).toBe(400);
    expect((await review(context("ROOT", { id: "no-uuid" }, {}))).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
    rpcResult = { data: null, error: { code: "P0008", message: "ALREADY_REVIEWED", details: "Este elemento ya fue revisado." } };
    const response = await review(context("ROOT", { id: ITEM }, {}));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ALREADY_REVIEWED");
    rpcResult = { data: null, error: { code: "P0005", message: "NOT_CORRECTABLE" } };
    expect((await review(context("ROOT", { id: ITEM }, { apply: true, reason: "Motivo válido" }))).status).toBe(409);
  });
});

describe("POST /api/reports/[id]/stops/[stopId]/close", () => {
  test("una parada sin categoría no se cierra sin stop_category_id (CATEGORY_REQUIRED)", async () => {
    const response = await closeStop(context("OPERATOR", { id: "r1", stopId: "s1" }, { ended_at: "2026-10-09T10:20:00-05:00" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("CATEGORY_REQUIRED");
    expect(updates).toHaveLength(0);
  });

  test("con stop_category_id cierra usando la hora del dispositivo", async () => {
    const response = await closeStop(context("OPERATOR", { id: "r1", stopId: "s1" },
      { ended_at: "2026-10-09T10:20:00-05:00", stop_category_id: CATEGORY }));
    expect(response.status).toBe(200);
    expect(updates[0]).toEqual({ ended_at: "2026-10-09T15:20:00.000Z", stop_category_id: CATEGORY });
  });

  test("una parada que ya tiene categoría se cierra sin enviarla", async () => {
    currentStop = { id: "s1", stop_category_id: CATEGORY };
    const response = await closeStop(context("OPERATOR", { id: "r1", stopId: "s1" }, { ended_at: "2026-10-09T10:20:00-05:00" }));
    expect(response.status).toBe(200);
    expect(updates[0]).toEqual({ ended_at: "2026-10-09T15:20:00.000Z" });
  });
});

describe("describeQuarantineItem", () => {
  test("resume la operación y solo es aplicable con el reporte enviado o cerrado", () => {
    const row = {
      id: "q1", reason: "REPORT_NOT_DRAFT", created_at: "2026-10-10T10:00:00Z",
      payload: { type: "ADD_CHANGE", capturedAt: "2026-10-09T10:00:00Z", payload: { description: "Cambio de lote", occurredAt: "2026-10-09T10:00:00Z" } },
    };
    expect(describeQuarantineItem(row, "SUBMITTED")).toMatchObject({ operationLabel: "Cambio registrado", applicable: true });
    expect(describeQuarantineItem(row, "CANCELLED").applicable).toBe(false);
    expect(describeQuarantineItem({ ...row, payload: { type: "SUBMIT_REPORT", payload: {} } }, "SUBMITTED").applicable).toBe(false);
  });
});
