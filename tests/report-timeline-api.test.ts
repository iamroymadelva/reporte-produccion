/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Role = "ROOT" | "ADMINISTRATOR" | "VIEWER" | "OPERATOR";
type Call = { table: string; method: string; args: unknown[] };

let calls: Call[] = [];
let tables: Record<string, { data: unknown; error: unknown }> = {};

function chain(table: string): any {
  const proxy: any = new Proxy({}, {
    get(_target, method: string) {
      if (method === "then") {
        return (resolve: (value: unknown) => void) => resolve(tables[table] ?? { data: [], error: null });
      }
      return (...args: unknown[]) => {
        calls.push({ table, method, args });
        if (method === "maybeSingle" || method === "single") return Promise.resolve(tables[table] ?? { data: null, error: null });
        return proxy;
      };
    },
  });
  return proxy;
}

mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({ from: (table: string) => chain(table) }),
  createSupabaseAdminClient: () => { throw new Error("createSupabaseAdminClient no debe usarse en esta ruta"); },
}));

const { GET } = await import("../src/pages/api/reports/[id]/timeline");

const REPORT_ID = "11111111-1111-1111-1111-111111111111";
const call = (role: Role | null, id: string | undefined = REPORT_ID, userId = "u1") =>
  Promise.resolve(GET({
    request: new Request(`http://localhost:4321/api/reports/${id}/timeline`),
    cookies: {},
    params: { id },
    locals: role ? { auth: { user: { id: userId }, profile: { role } } } : {},
  } as any));

beforeEach(() => {
  calls = [];
  tables = {
    production_reports: { data: { id: REPORT_ID, folio: "RPT-1", status: "DRAFT", created_by: "author" }, error: null },
    report_stop_events: { data: [{ id: "s1" }], error: null },
    report_change_events: { data: [{ id: "c1" }], error: null },
    report_audit_log: { data: [{ id: 1, action: "INSERT" }, { id: 2, action: "UPDATE" }], error: null },
  };
});

describe("GET /api/reports/[id]/timeline", () => {
  test("sin sesión devuelve 401 y no consulta nada", async () => {
    const response = await call(null);
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test("responde con Cache-Control private, no-store", async () => {
    const response = await call("VIEWER");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await call(null)).headers.get("Cache-Control")).toBe("private, no-store");
  });

  test.each(["VIEWER", "ADMINISTRATOR", "ROOT"] as Role[])("%s recibe reporte, paradas, cambios y auditoría ascendente", async (role) => {
    const response = await call(role);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["audit", "changes", "report", "stops"]);
    expect(body.audit.map((row: { id: number }) => row.id)).toEqual([1, 2]);
    const orders = calls.filter((c) => c.table === "report_audit_log" && c.method === "order");
    expect(orders[0].args).toEqual(["changed_at", { ascending: true }]);
    expect(orders[1].args).toEqual(["id", { ascending: true }]);
  });

  test("un VIEWER ve la auditoría de un reporte en cualquier estado", async () => {
    for (const status of ["DRAFT", "SUBMITTED", "CLOSED", "CANCELLED"]) {
      tables.production_reports = { data: { id: REPORT_ID, status, created_by: "author" }, error: null };
      const body = await (await call("VIEWER")).json();
      expect(body.report.status).toBe(status);
      expect(body.audit).toHaveLength(2);
    }
  });

  test("el OPERATOR autor recibe reporte, paradas y cambios, pero nunca la auditoría", async () => {
    const response = await call("OPERATOR", REPORT_ID, "author");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("audit");
    expect(body.stops).toHaveLength(1);
    expect(body.changes).toHaveLength(1);
    expect(calls.some((c) => c.table === "report_audit_log")).toBe(false);
  });

  test("un OPERATOR que no es el autor recibe 403 sin datos", async () => {
    const response = await call("OPERATOR", REPORT_ID, "someone-else");
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("report");
    expect(calls.some((c) => c.table === "report_audit_log")).toBe(false);
  });

  test("reporte inexistente (o invisible por RLS) o id inválido devuelve 404", async () => {
    tables.production_reports = { data: null, error: null };
    expect((await call("VIEWER")).status).toBe(404);
    expect((await call("VIEWER", "no-es-uuid")).status).toBe(404);
  });

  test("un error de base de datos devuelve 500 sin filtrar detalles", async () => {
    tables.report_audit_log = { data: null, error: { message: "secreto interno" } };
    const response = await call("VIEWER");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secreto");
  });
});
