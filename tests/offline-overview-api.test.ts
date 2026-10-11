/// <reference types="bun" />
import { beforeEach, describe, expect, mock, test } from "bun:test";

// GET /api/offline/overview (T094): solo managers y VIEWER; el OPERATOR recibe 403 sin consultar nada.
let tables: Record<string, unknown[]>;
let queried: string[];
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => {
      queried.push(table);
      const chain: any = new Proxy({}, {
        get: (_target, prop) => {
          if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: tables[table] ?? [], error: null, count: (tables[table] ?? []).length });
          if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
          return () => chain;
        },
      });
      return chain;
    },
  }),
}));

const { GET } = await import("../src/pages/api/offline/overview");

const call = (role: string | null) =>
  Promise.resolve(GET({
    request: new Request("http://localhost:4321/api/offline/overview"),
    cookies: {},
    locals: role ? { auth: { user: { id: "u1" }, profile: { id: "u1", full_name: "Persona", role, job_title: null, active: true } } } : {},
  } as never));

beforeEach(() => {
  queried = [];
  tables = {
    production_report_overview: [{
      id: "r1", folio: "RPT-1", status: "SUBMITTED", report_date: "2026-10-10", production_order: "OP-1", creator_full_name: "Op Uno",
      approver_full_name: null, approved_at: null, is_off_shift: false, created_at: "2026-10-10T10:00:00Z", machine: { id: "m1", code: "M-01", name: "Env" },
      report_stop_events: [{ id: "s1", started_at: "2026-10-10T10:00:00Z", ended_at: "2026-10-10T10:10:00Z", cancelled_at: null, description: null, stop_category: { name: "Aseo" } }],
      report_change_events: [{ id: "c1", occurred_at: "2026-10-10T10:20:00Z", description: "x", change_type: { name: "Producto" } }],
    }],
    production_reports: [],
  };
});

describe("GET /api/offline/overview", () => {
  test("401 sin sesión; 403 para OPERATOR sin consultar la base de datos", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("OPERATOR")).status).toBe(403);
    expect(queried).toHaveLength(0);
  });

  test("ROOT, ADMINISTRATOR y VIEWER reciben KPI, reportes y la hora de descarga, sin cache", async () => {
    for (const role of ["ROOT", "ADMINISTRATOR", "VIEWER"]) {
      const response = await call(role);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const body = await response.json();
      expect(body.kpis).toMatchObject({ DRAFT: expect.any(Number), SUBMITTED: expect.any(Number), CLOSED: expect.any(Number), CANCELLED: expect.any(Number), ACTIVE_STOP: expect.any(Number) });
      expect(body.reports).toHaveLength(1);
      expect(body.reports[0]).toMatchObject({ id: "r1", folio: "RPT-1", status: "SUBMITTED", operator: "Op Uno", stops_count: 1 });
      expect(body.reports[0].changes[0]).toMatchObject({ type: "Producto" });
      expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false);
      expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
      expect(JSON.stringify(body)).not.toMatch(/password|token|secret/i);
    }
  });
});
