/// <reference types="bun" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import ExcelJS from "exceljs";

type Role = "ROOT" | "ADMINISTRATOR" | "VIEWER" | "OPERATOR";

// Constructor de consultas simulado: cada método devuelve la misma cadena y, al esperarla, entrega las filas.
let tableData: Record<string, unknown[]> = {};
const queried: string[] = [];
mock.module("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => {
      queried.push(table);
      const chain: any = new Proxy({}, {
        get: (_, method: string) => {
          if (method === "then") {
            return (resolve: (value: unknown) => void) => resolve({ data: tableData[table] ?? [], error: null, count: (tableData[table] ?? []).length });
          }
          return () => chain;
        },
      });
      return chain;
    },
  }),
}));

const { buildProductionWorkbook } = await import("../src/lib/report-export");
const { GET: exportReports } = await import("../src/pages/api/reports/export");

const report = {
  id: "r1", folio: "RPT-2026-000001", status: "CLOSED", production_order: "OP-1", report_date: "2026-10-07",
  lot: "L1", creator_full_name: "Operario Uno", g_min: 10, programmed_hours: 8, units_produced: 100, waste: 1,
  weight: 20, observations: null, product_name: "Producto", client_name: "Cliente",
  machine: { code: "M1", name: "Máquina 1" }, line: { code: "L", name: "Línea" }, dosifier_type: { code: "D" },
  shift_catalog: { name: "Turno 1", start_time: "06:00:00", end_time: "14:00:00" },
  approver_full_name: "Coordinador Uno", approved_at: "2026-10-07T20:00:00Z", is_off_shift: false,
};

async function readWorkbook(buffer: ExcelJS.Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

describe("buildProductionWorkbook", () => {
  test("crea las cinco hojas con las columnas de aprobación", async () => {
    const buffer = await buildProductionWorkbook({
      reports: [report],
      metrics: [{ id: "r1" }],
      stops: [],
      categories: [{ id: "c1", code: "1", name: "Mecánica" }],
      changes: [],
      history: [],
      filterLabel: "Todos",
      generatedLabel: "hoy",
    });
    const workbook = await readWorkbook(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "SEGUIMIENTO PRODUCCIÓN", "DETALLE PARADAS", "CAMBIOS", "HISTORIAL", "CATÁLOGO PARADAS",
    ]);
    const production = workbook.getWorksheet("SEGUIMIENTO PRODUCCIÓN")!;
    const headers = (production.getRow(3).values as unknown[]).filter(Boolean) as string[];
    expect(headers).toContain("Aprobado por");
    expect(headers).toContain("Fecha de aprobación");
    const row = production.getRow(4);
    expect(row.getCell(headers.indexOf("Aprobado por") + 1).value).toBe("Coordinador Uno");
    expect(row.getCell(headers.indexOf("Fecha de aprobación") + 1).value).toBeInstanceOf(Date);
  });

  test("CAMBIOS lista los cambios y HISTORIAL ordena cronológicamente de forma ascendente", async () => {
    const buffer = await buildProductionWorkbook({
      reports: [report],
      metrics: [{ id: "r1" }],
      stops: [],
      categories: [],
      changes: [{
        id: "c1", report_id: "r1", description: "Cambio de lote", occurred_at: "2026-10-07T12:00:00Z",
        captured_offline: false, change_type: { name: "Lote" },
      }],
      history: [
        { id: 3, report_id: "r1", changed_at: "2026-10-07T20:00:00Z", changed_by: "u2", field_name: "status", old_value: "SUBMITTED", new_value: "CLOSED", reason: "Aprobación y cierre del reporte", actor_role: "ADMINISTRATOR", captured_offline: false, received_at: "2026-10-07T20:00:00Z", user: { full_name: "Coordinador Uno" } },
        { id: 1, report_id: "r1", changed_at: "2026-10-07T10:00:00Z", changed_by: "u1", field_name: "lot", old_value: null, new_value: "L1", reason: null, actor_role: "OPERATOR", captured_offline: true, received_at: "2026-10-07T10:05:00Z", user: { full_name: "Operario Uno" } },
        { id: 2, report_id: "r1", changed_at: "2026-10-07T14:00:00Z", changed_by: "u1", field_name: "status", old_value: "DRAFT", new_value: "SUBMITTED", reason: null, actor_role: "OPERATOR", captured_offline: false, received_at: "2026-10-07T14:00:00Z", user: { full_name: "Operario Uno" } },
      ],
      filterLabel: "Todos",
      generatedLabel: "hoy",
    });
    const workbook = await readWorkbook(buffer);
    const changes = workbook.getWorksheet("CAMBIOS")!;
    expect(changes.getRow(4).values as unknown[]).toContain("Cambio de lote");
    expect(changes.getRow(4).values as unknown[]).toContain("Lote");

    const history = workbook.getWorksheet("HISTORIAL")!;
    const headers = (history.getRow(3).values as unknown[]).filter(Boolean) as string[];
    expect(headers).toEqual(expect.arrayContaining(["Usuario", "Rol", "Motivo", "Capturado sin conexión"]));
    const field = headers.indexOf("Campo") + 1;
    expect(history.rowCount).toBe(6);
    expect([4, 5, 6].map((index) => history.getRow(index).getCell(field).value)).toEqual(["Lote", "Estado", "Estado"]);
    const when = headers.indexOf("Fecha y hora") + 1;
    const times = [4, 5, 6].map((index) => (history.getRow(index).getCell(when).value as Date).getTime());
    expect(times).toEqual([...times].sort((left, right) => left - right));
    expect(history.getRow(4).getCell(headers.indexOf("Capturado sin conexión") + 1).value).toBe("Sí");
    expect(history.getRow(6).getCell(headers.indexOf("Motivo") + 1).value).toBe("Aprobación y cierre del reporte");
  });
});

describe("GET /api/reports/export", () => {
  beforeEach(() => {
    tableData = {};
    queried.length = 0;
  });

  const call = (role: Role | null, query = "") => {
    const url = new URL(`http://localhost:4321/api/reports/export${query}`);
    return exportReports({
      request: new Request(url),
      cookies: {},
      locals: role ? { auth: { user: { id: "u" }, profile: { role } } } : {},
    } as any) as Promise<Response>;
  };

  test("OPERATOR recibe 403 y no se consulta nada", async () => {
    const response = await call("OPERATOR");
    expect(response.status).toBe(403);
    expect(queried).toHaveLength(0);
  });

  test("sin sesión recibe 401", async () => {
    expect((await call(null)).status).toBe(401);
  });

  test("un filtro inválido responde 400 en español", async () => {
    const response = await call("ADMINISTRATOR", "?from=2026-10-09&to=2026-10-01");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("fecha inicial");
  });

  test("sin resultados responde 204 sin cuerpo", async () => {
    const response = await call("ADMINISTRATOR", "?status=CLOSED&from=2026-10-01&to=2026-10-31");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(queried).toContain("production_report_overview");
  });

  test("VIEWER y ROOT también pueden exportar", async () => {
    expect((await call("VIEWER")).status).toBe(204);
    expect((await call("ROOT")).status).toBe(204);
  });
});
