/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

// Cliente simulado: cada tabla devuelve sus filas.
let tables: Record<string, unknown[]>;
let queried: string[];
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => {
      queried.push(table);
      const chain: any = new Proxy({}, {
        get: (_target, prop) => {
          if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
          if (prop === "single" || prop === "maybeSingle") {
            return () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
          }
          return () => chain;
        },
      });
      return chain;
    },
  }),
}));

const { GET } = await import("../src/pages/api/offline/snapshot");

const call = (role: string | null) =>
  Promise.resolve(GET({
    request: new Request("http://localhost:4321/api/offline/snapshot"),
    cookies: {},
    locals: role ? { auth: { user: { id: "u1" }, profile: { id: "u1", full_name: "Op Uno", role, job_title: null, active: true } } } : {},
  } as never));

beforeEach(() => {
  queried = [];
  tables = {
    app_settings: [{ off_shift_grace: "02:00:00", offline_login_window: "7 days" }],
    shifts: [{ id: "s1", name: "Día", start_time: "06:00:00", end_time: "14:00:00" }],
    operator_machine_assignments: [{ id: "a1", machine_id: "m1", shift_id: "s1", valid_from: "2000-01-01", valid_to: null }],
    stop_categories: [{ id: "c1", code: "1", name: "Cuadre" }],
    change_types: [{ id: "t1", code: "LOTE", name: "Lote" }],
    clients: [{ id: "cl1", name: "Cliente" }],
    products: [{ id: "p1", name: "Producto" }],
    lines: [{ id: "l1", name: "Línea 1" }],
    dosifier_types: [{ id: "d1", name: "Dosificador" }],
    production_reports: [],
  };
});

describe("GET /api/offline/snapshot", () => {
  test("401 sin sesión; 403 si no es OPERATOR", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("VIEWER")).status).toBe(403);
    expect((await call("ADMINISTRATOR")).status).toBe(403);
    expect(queried).toHaveLength(0);
  });

  test("devuelve perfil, ajustes, turnos, asignaciones y catálogos activos", async () => {
    const response = await call("OPERATOR");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.profile).toMatchObject({ id: "u1", role: "OPERATOR" });
    expect(body.settings).toEqual({ offShiftGrace: "02:00:00", offlineLoginWindow: "7 days" });
    expect(body.shifts).toHaveLength(1);
    expect(body.assignments).toHaveLength(1);
    expect(Object.keys(body.catalogs).sort()).toEqual(["changeTypes", "clients", "dosifierTypes", "lines", "products", "stopCategories"]);
    expect(body.catalogs.stopCategories[0].id).toBe("c1");
    expect(body.activeReport).toBeNull();
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false);
  });

  test("incluye el reporte activo con paradas y cambios", async () => {
    tables.production_reports = [{ id: "r1", status: "DRAFT", report_stop_events: [{ id: "st1" }], report_change_events: [{ id: "ch1" }] }];
    const body = await (await call("OPERATOR")).json();
    expect(body.activeReport.id).toBe("r1");
    expect(body.activeReport.report_stop_events).toHaveLength(1);
    expect(body.activeReport.report_change_events).toHaveLength(1);
  });

  test("«Reloj desfasado» (clock_skew_review) nunca llega al Operario", async () => {
    tables.production_reports = [{
      id: "r1", status: "DRAFT",
      report_stop_events: [{ id: "st1", clock_skew_review: true, started_at: "2026-10-09T10:00:00Z" }],
      report_change_events: [{ id: "ch1", clock_skew_review: true, description: "Lote" }],
    }];
    const body = await (await call("OPERATOR")).json();
    expect(body.activeReport.report_stop_events[0]).toEqual({ id: "st1", started_at: "2026-10-09T10:00:00Z" });
    expect(body.activeReport.report_change_events[0]).toEqual({ id: "ch1", description: "Lote" });
    expect(JSON.stringify(body)).not.toContain("clock_skew_review");
  });
});

describe("GET /api/offline/snapshot · ubicación de la máquina", () => {
  test("entrega la ubicación de la máquina asignada en assignments[].machine", async () => {
    tables.operator_machine_assignments = [{
      id: "a1", machine_id: "m1", shift_id: "s1", valid_from: "2000-01-01", valid_to: null,
      machine: { id: "m1", code: "M-01", name: "Empacadora 1", active: true, location: "Planta 2, línea norte" },
    }];
    const body = await (await call("OPERATOR")).json();
    expect(body.assignments[0].machine.location).toBe("Planta 2, línea norte");
  });

  test("una máquina sin ubicación llega con location nula sin romper", async () => {
    tables.operator_machine_assignments = [{
      id: "a1", machine_id: "m1", shift_id: "s1", valid_from: "2000-01-01", valid_to: null,
      machine: { id: "m1", code: "M-01", name: "Empacadora 1", active: true, location: null },
    }];
    const body = await (await call("OPERATOR")).json();
    expect(body.assignments[0].machine.location ?? null).toBeNull();
  });

  test("la ruta selecciona la columna location de machines", async () => {
    const source = await Bun.file(new URL("../src/pages/api/offline/snapshot.ts", import.meta.url)).text();
    expect(source).toContain("machine:machines(id, code, name, active, location)");
  });
});
