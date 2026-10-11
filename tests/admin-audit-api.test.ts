/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";

type Role = "ROOT" | "ADMINISTRATOR" | "VIEWER" | "OPERATOR";
type Call = { table: string; method: string; args: unknown[] };

let calls: Call[] = [];
let results: Record<string, { data: unknown; error: unknown; count?: number }> = {};

function chain(table: string): any {
  const proxy: any = new Proxy({}, {
    get(_target, method: string) {
      if (method === "then") {
        return (resolve: (value: unknown) => void) => resolve(results[table] ?? { data: [], error: null, count: 0 });
      }
      return (...args: unknown[]) => {
        calls.push({ table, method, args });
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

const { GET } = await import("../src/pages/api/admin/audit");
const { parseAdminAuditFilters, describeAdminChanges, ADMIN_AUDIT_PAGE_SIZE } = await import("../src/lib/admin-audit");

const call = (role: Role | null, query = "") =>
  Promise.resolve(GET({
    request: new Request(`http://localhost:4321/api/admin/audit${query}`),
    cookies: {},
    locals: role ? { auth: { user: { id: "u1" }, profile: { role } } } : {},
  } as any));

const auditCalls = (method: string) => calls.filter((c) => c.table === "administrative_audit_log" && c.method === method);

beforeEach(() => {
  calls = [];
  results = {
    administrative_audit_log: { data: [{ id: 2, action: "UPDATE" }, { id: 1, action: "INSERT" }], error: null, count: 120 },
    profiles: { data: [{ id: "p1" }, { id: "p2" }], error: null },
  };
});

describe("GET /api/admin/audit", () => {
  test("sin sesión: 401; ADMINISTRATOR, VIEWER y OPERATOR: 403 sin consultar la tabla", async () => {
    expect((await call(null)).status).toBe(401);
    for (const role of ["ADMINISTRATOR", "VIEWER", "OPERATOR"] as Role[]) {
      const response = await call(role);
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(calls).toHaveLength(0);
  });

  test("ROOT recibe filas paginadas de 50 y el total de páginas", async () => {
    const response = await call("ROOT");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({ page: 1, pageSize: 50, total: 120, totalPages: 3 });
    expect(body.rows).toHaveLength(2);
    expect(auditCalls("range")[0].args).toEqual([0, 49]);
    expect(auditCalls("order")[0].args).toEqual(["performed_at", { ascending: false }]);
  });

  test("la página N pide el rango correspondiente", async () => {
    await call("ROOT", "?page=3");
    expect(auditCalls("range")[0].args).toEqual([2 * ADMIN_AUDIT_PAGE_SIZE, 3 * ADMIN_AUDIT_PAGE_SIZE - 1]);
  });

  test("aplica los filtros from, to, action y entity_type (fechas de Bogotá)", async () => {
    await call("ROOT", "?from=2026-10-01&to=2026-10-02&action=DEACTIVATE&entity_type=machines");
    expect(auditCalls("gte")[0].args).toEqual(["performed_at", "2026-10-01T05:00:00.000Z"]);
    expect(auditCalls("lt")[0].args).toEqual(["performed_at", "2026-10-03T05:00:00.000Z"]);
    expect(auditCalls("eq")).toContainEqual({ table: "administrative_audit_log", method: "eq", args: ["action", "DEACTIVATE"] });
    expect(auditCalls("eq")).toContainEqual({ table: "administrative_audit_log", method: "eq", args: ["entity_type", "machines"] });
  });

  test("filtra por autor: uuid directo o búsqueda por nombre/usuario", async () => {
    await call("ROOT", "?actor=10000000-0000-0000-0000-000000000001");
    expect(auditCalls("in")[0].args).toEqual(["performed_by", ["10000000-0000-0000-0000-000000000001"]]);
    calls = [];
    await call("ROOT", "?actor=ana");
    expect(calls.some((c) => c.table === "profiles" && c.method === "or")).toBe(true);
    expect(auditCalls("in")[0].args).toEqual(["performed_by", ["p1", "p2"]]);
  });

  test("un autor sin coincidencias devuelve cero filas sin consultar el historial", async () => {
    results.profiles = { data: [], error: null };
    const body = await (await call("ROOT", "?actor=nadie")).json();
    expect(body).toMatchObject({ rows: [], total: 0, totalPages: 1 });
    expect(auditCalls("select")).toHaveLength(0);
  });

  test("parámetros inválidos devuelven 400", async () => {
    for (const query of ["?from=2026-13-40", "?to=hoy", "?from=2026-10-05&to=2026-10-01", "?page=0", "?page=abc", "?action=a;b", "?entity_type=x y", "?actor=a,b"]) {
      expect((await call("ROOT", query)).status).toBe(400);
    }
  });

  test("un error de base de datos devuelve 500 sin filtrar detalles", async () => {
    results.administrative_audit_log = { data: null, error: { message: "secreto interno" } };
    const response = await call("ROOT");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secreto");
  });
});

describe("admin-audit helpers", () => {
  test("parseAdminAuditFilters acepta filtros vacíos y normaliza", () => {
    expect(parseAdminAuditFilters(new URLSearchParams(""))).toEqual({
      from: null, to: null, actor: null, action: null, entityType: null, page: 1,
    });
    expect(parseAdminAuditFilters(new URLSearchParams("action=%20UPDATE%20&page=2"))).toMatchObject({ action: "UPDATE", page: 2 });
  });

  test("describeAdminChanges muestra antes/después legibles y omite campos sin cambio", () => {
    expect(describeAdminChanges({ old_value: { active: true }, new_value: { active: false } }))
      .toEqual([{ label: "Activo", previous: "Sí", next: "No" }]);
    expect(describeAdminChanges({ old_value: { role: "OPERATOR", name: "A" }, new_value: { role: "VIEWER", name: "A" } }))
      .toEqual([{ label: "Rol", previous: "Operario", next: "Auditor" }]);
    expect(describeAdminChanges({ old_value: null, new_value: { code: "M1" } })).toEqual([{ label: "Código", next: "M1" }]);
    expect(describeAdminChanges({ old_value: { code: "M1" }, new_value: null })).toEqual([{ label: "Código", previous: "M1" }]);
  });
});
