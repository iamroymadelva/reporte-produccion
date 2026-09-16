/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { REQUIRED_REPORT_FIELDS, localDateTime, validateReportForSubmission } from "../src/lib/report-validation";
import { areReportEditableValuesEquivalent, reportFormToPayload } from "../src/lib/report-fields";
import { isActiveStop, stopDuration, summarizeClosedStops } from "../src/lib/stop-events";
import ExcelJS from "exceljs";
import { buildProductionWorkbook } from "../src/lib/report-export";

const complete = {
  report_date: "2026-09-15", product_name: "Producto libre", production_order: "OP-1", line_id: "line",
  client_name: "Cliente libre", lot: "L1", shift_id: "shift", weight: 0, g_min: 0, dosifier_type_id: "dosifier",
  started_at: "2026-09-15T22:00:00-05:00", ended_at: "2026-09-16T06:00:00-05:00",
  programmed_hours: 0, units_produced: 0, waste: 0,
};

describe("Operator submission", () => {
  test("accepts all numeric zeros, free text names, overnight times and empty observations", () => {
    expect(validateReportForSubmission(complete)).toEqual({});
    expect(validateReportForSubmission({ ...complete, observations: "" })).toEqual({});
  });
  for (const { field } of REQUIRED_REPORT_FIELDS) {
    test(`${field} rejects missing and whitespace-only input`, () => {
      for (const value of [null, undefined, "", " \t\n "]) {
        expect(validateReportForSubmission({ ...complete, [field]: value })[field]).toBeDefined();
      }
    });
  }
  test("rejects invalid numeric values and backwards timing", () => {
    const numericFields = ["weight", "g_min", "programmed_hours", "units_produced", "waste"] as const;
    for (const field of numericFields) {
      for (const value of [-1, "not a number", NaN, Infinity, true]) {
        expect(validateReportForSubmission({ ...complete, [field]: value })[field]).toBeDefined();
      }
    }
    expect(validateReportForSubmission({ ...complete, units_produced: 0.5 }).units_produced).toBeDefined();
    expect(validateReportForSubmission({ ...complete, ended_at: "2026-09-14T06:00" }).ended_at).toBeDefined();
  });
  test("manual times and zeros survive the existing offline payload and comparison", () => {
    const form = Object.fromEntries(Object.entries(complete).map(([key, value]) => [key, String(value)]));
    const payload = reportFormToPayload(form);
    expect(payload.units_produced).toBe(0);
    expect(payload.programmed_hours).toBe(0);
    expect(payload.started_at).toBe("2026-09-16T03:00:00.000Z");
    expect(areReportEditableValuesEquivalent(complete, payload)).toBe(true);
  });
  test("current-time helper uses local hours and minutes", () => {
    const date = new Date(2026, 8, 15, 7, 42, 30);
    expect(localDateTime(date.toISOString())).toBe("2026-09-15T07:42");
  });
});

test("stop summary counts every closed category, including zero duration, but neither active nor cancelled stops", () => {
  const stops: Array<{ ended_at: string | null; cancelled_at: string | null; duration_seconds: number | null }> =
    [0, 60, 120, 180].map((duration_seconds) => ({ ended_at: "2026-09-15", cancelled_at: null, duration_seconds }));
  stops.push({ ended_at: null, cancelled_at: null, duration_seconds: null });
  stops.push({ ended_at: "2026-09-15", cancelled_at: "2026-09-15", duration_seconds: 900 });
  expect(summarizeClosedStops(stops)).toEqual({ count: 4, seconds: 360 });
  expect(stopDuration(360)).toBe("00:06:00");
  expect(stopDuration(100 * 3600 + 61)).toBe("100:01:01");
  expect(isActiveStop(stops[4])).toBe(true);
  expect(isActiveStop(stops[5])).toBe(false);
});

test("export excludes cancelled durations and retains cancellation traceability", async () => {
  const category = { id: "category", code: "19", name: "OTROS" };
  const base = { id: "stop", report_id: "report", started_at: "2026-09-15T10:00:00Z", ended_at: "2026-09-15T10:01:00Z", duration_seconds: 60, description: null, cancelled_at: null, cancellation_reason: null, stop_category_id: category.id, stop_category: category };
  const bytes = await buildProductionWorkbook({
    reports: [{ id: "report", folio: "RPT-2026-000001", status: "DRAFT" }], metrics: [{ id: "report", total_downtime_seconds: 60 }],
    stops: [base, { ...base, id: "cancelled", cancelled_at: base.ended_at, cancellation_reason: "Error de inicio", duration_seconds: 900 }],
    categories: [category], filterLabel: "Prueba", generatedLabel: "Prueba",
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  expect(workbook.getWorksheet("SEGUIMIENTO PRODUCCIÓN")!.getCell("Z4").value).toEqual(new Date("1899-12-30T00:01:00.000Z"));
  const detail = workbook.getWorksheet("DETALLE PARADAS")!;
  const row = [detail.getRow(4), detail.getRow(5)].find((row) => row.getCell(11).value === "Cancelada")!;
  expect(row.getCell(10).value).toBeNull();
  expect(row.getCell(12).value).toContain("Error de inicio");
});
