/// <reference types="bun" />

import { describe, expect, mock, test } from "bun:test";

// Capturamos la selección que la ruta pide a PostgREST para comprobar que no incluye la bandera.
const selections: string[] = [];
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: () => {
      const chain: any = new Proxy({}, {
        get: (_target, prop) => {
          if (prop === "select") return (columns: string) => { selections.push(columns); return chain; };
          if (prop === "single") return () => Promise.resolve({ data: { id: "c1", description: "x" }, error: null });
          if (prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
          return () => chain;
        },
      });
      return chain;
    },
  }),
}));

const { POST } = await import("../src/pages/api/reports/[id]/changes");
const { stripClockSkewFromReport, withoutClockSkew } = await import("../src/lib/clock-skew");

describe("«Reloj desfasado» solo para ROOT", () => {
  test("POST /api/reports/[id]/changes no pide ni devuelve clock_skew_review", async () => {
    const response = await POST({
      request: new Request("http://localhost/api/reports/r/changes", {
        method: "POST",
        body: JSON.stringify({ change_type_id: "5f2b7c1e-4b0e-4c1a-9a53-1f2f6f2a0a11", description: "Cambio de lote" }),
      }),
      cookies: {},
      params: { id: "r1" },
      locals: { auth: { user: { id: "u1" }, profile: { role: "OPERATOR" } } },
    } as never);
    expect(response.status).toBe(201);
    expect(selections.length).toBeGreaterThan(0);
    for (const columns of selections) expect(columns).not.toContain("clock_skew_review");
    expect(JSON.stringify(await response.json())).not.toContain("clock_skew_review");
  });

  test("withoutClockSkew y stripClockSkewFromReport quitan la bandera y conservan el resto", () => {
    expect(withoutClockSkew({ id: "a", clock_skew_review: true, captured_offline: false })).toEqual({ id: "a", captured_offline: false });
    const report: Record<string, unknown> = stripClockSkewFromReport({
      id: "r", report_stop_events: [{ id: "s", clock_skew_review: true }], report_change_events: [{ id: "c", clock_skew_review: false }],
    });
    expect(report).toEqual({ id: "r", report_stop_events: [{ id: "s" }], report_change_events: [{ id: "c" }] });
    expect(stripClockSkewFromReport(null)).toBeNull();
  });
});
