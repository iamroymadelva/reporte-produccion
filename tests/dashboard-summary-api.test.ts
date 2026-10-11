/// <reference types="bun" />
import { beforeEach, describe, expect, mock, test } from "bun:test";

// GET /api/dashboard/summary (T100): 401 sin sesión, 403 para OPERATOR (sin consultar la base), 422 con rango inválido,
// 200 para ROOT/ADMINISTRATOR/VIEWER con KPI, máquinas en parada, fuera de turno, conflictos y operarios. Sin cache.
let tables: Record<string, unknown[]>;
let counts: Record<string, number>;
let queried: string[];
let failTable: string | null;
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => {
      queried.push(table);
      const filters: string[] = [];
      const chain: any = new Proxy({}, {
        get: (_target, prop) => {
          if (prop === "then") {
            return (resolve: (value: unknown) => void) => {
              const key = filters.includes("DRAFT") ? `${table}:DRAFT` : table;
              resolve({
                data: failTable === table ? null : tables[table] ?? [],
                error: failTable === table ? { message: "boom" } : null,
                count: counts[key] ?? counts[table] ?? (tables[table] ?? []).length,
              });
            };
          }
          return (...args: unknown[]) => { filters.push(...args.filter((a): a is string => typeof a === "string")); return chain; };
        },
      });
      return chain;
    },
  }),
}));

const { GET } = await import("../src/pages/api/dashboard/summary");

const call = (role: string | null, query = "") =>
  Promise.resolve(GET({
    request: new Request(`http://localhost:4321/api/dashboard/summary${query}`),
    url: new URL(`http://localhost:4321/api/dashboard/summary${query}`),
    cookies: {},
    locals: role ? { auth: { user: { id: "u1" }, profile: { id: "u1", full_name: "Persona", role, job_title: null, active: true } } } : {},
  } as never));

beforeEach(() => {
  queried = [];
  failTable = null;
  counts = {};
  tables = {
    production_report_overview: [{
      id: "r1", folio: "RPT-1", status: "DRAFT", report_date: "2026-10-10", production_order: "OP-1", creator_full_name: "Op Uno",
      approver_full_name: null, approved_at: null, is_off_shift: true, created_at: "2026-10-10T10:00:00Z", machine: { id: "m1", code: "M-01", name: "Env" },
      report_stop_events: [{ id: "s1", started_at: "2026-10-10T10:30:00Z", ended_at: null, cancelled_at: null }],
    }],
    production_reports: [],
    sync_quarantine: [],
    profiles: [{ id: "op1", full_name: "Op Uno" }],
  };
});

describe("GET /api/dashboard/summary", () => {
  test("401 sin sesión", async () => {
    const response = await call(null);
    expect(response.status).toBe(401);
    expect(queried).toHaveLength(0);
  });

  test("403 para OPERATOR sin consultar la base de datos", async () => {
    const response = await call("OPERATOR");
    expect(response.status).toBe(403);
    expect(queried).toHaveLength(0);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("ROOT, ADMINISTRATOR y VIEWER reciben el resumen sin cache", async () => {
    counts = { "production_reports:DRAFT": 4, production_reports: 2, sync_quarantine: 5 };
    for (const role of ["ROOT", "ADMINISTRATOR", "VIEWER"]) {
      const response = await call(role, "?from=2026-10-10&to=2026-10-10");
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const body = await response.json();
      expect(body.range).toEqual({ from: "2026-10-10", to: "2026-10-10" });
      expect(body.kpis).toMatchObject({ DRAFT: 4, SUBMITTED: 2, CLOSED: 2, CANCELLED: 2, ACTIVE_STOP: 2, OPEN_CONFLICTS: 5 });
      expect(body.machinesStopped[0]).toMatchObject({ reportId: "r1", folio: "RPT-1", operator: "Op Uno", since: "2026-10-10T10:30:00Z" });
      expect(body.offShiftReports[0]).toMatchObject({ reportId: "r1" });
      expect(body.recent[0]).toMatchObject({ id: "r1", status: "DRAFT", activeStop: true, isOffShift: true });
      expect(body.operators).toEqual([{ id: "op1", fullName: "Op Uno" }]);
      expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
      expect(JSON.stringify(body)).not.toMatch(/password|token|secret/i);
    }
  });

  test("sin parámetros usa hoy; un rango inválido responde 422 en español sin consultar", async () => {
    expect((await call("ROOT")).status).toBe(200);
    queried = [];
    for (const query of ["?from=2026-13-01", "?from=hoy", "?from=2026-10-10&to=2026-10-01", "?from=2026-02-30"]) {
      const response = await call("VIEWER", query);
      expect(response.status).toBe(422);
      expect((await response.json()).error).toContain("rango de fechas");
    }
    expect(queried).toHaveLength(0);
  });

  test("el rango se limita a 366 días: 366 es válido, 367 responde 422 sin consultar", async () => {
    expect((await call("ROOT", "?from=2025-10-10&to=2026-10-10")).status).toBe(200); // 366 días inclusive
    queried = [];
    for (const query of ["?from=2025-10-09&to=2026-10-10", "?from=2000-01-01&to=2026-10-10"]) {
      const response = await call("VIEWER", query);
      expect(response.status).toBe(422);
      expect((await response.json()).error).toContain("demasiado amplio");
    }
    expect(queried).toHaveLength(0);
  });

  test("un fallo de la base de datos responde 500 sin filtrar el detalle", async () => {
    failTable = "sync_quarantine";
    const response = await call("ROOT");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("boom");
  });
});
