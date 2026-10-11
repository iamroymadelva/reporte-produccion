/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import {
  activePeriod,
  applyReportFilters,
  parseReportFilters,
  periodHref,
  periodRange,
  reportFilterParams,
} from "../src/lib/report-filters";

const parse = (query: string) => parseReportFilters(new URLSearchParams(query));
const MACHINE = "3a000000-0000-0000-0000-000000000001";
const SHIFT = "3b000000-0000-0000-0000-000000000002";
const OPERATOR = "3c000000-0000-0000-0000-000000000003";

describe("parseReportFilters", () => {
  test("sin parámetros no filtra nada", () => {
    const filters = parse("");
    expect(filters).toMatchObject({
      from: null, to: null, machine: null, shift: null, operator: null,
      status: null, activeStop: false, offShift: false, error: null,
    });
  });

  test("lee rango libre, máquina, turno, operario, estado y fuera de turno", () => {
    const filters = parse(
      `from=2026-10-01&to=2026-10-09&machine=${MACHINE}&shift=${SHIFT}&operator=${OPERATOR}&status=CLOSED&offshift=1`,
    );
    expect(filters.error).toBeNull();
    expect(filters.from).toBe("2026-10-01");
    expect(filters.to).toBe("2026-10-09");
    expect(filters.machine).toBe(MACHINE);
    expect(filters.shift).toBe(SHIFT);
    expect(filters.operator).toBe(OPERATOR);
    expect(filters.status).toBe("CLOSED");
    expect(filters.offShift).toBe(true);
    expect(filters.periodLabel).toContain("–");
  });

  test("admite un rango abierto por un extremo", () => {
    expect(parse("from=2026-10-01").to).toBeNull();
    expect(parse("from=2026-10-01").periodLabel).toStartWith("Desde");
    expect(parse("to=2026-10-09").periodLabel).toStartWith("Hasta");
  });

  test("stop=active se combina con el resto de filtros", () => {
    const filters = parse("stop=active&status=DRAFT");
    expect(filters.activeStop).toBe(true);
    expect(filters.status).toBe("DRAFT");
  });

  test("traduce period/date/month antiguos a from/to", () => {
    expect(parse("period=day&date=2026-10-07")).toMatchObject({ from: "2026-10-07", to: "2026-10-07" });
    // 7 de octubre de 2026 es miércoles: la semana va de lunes 5 a domingo 11.
    expect(parse("period=week&date=2026-10-07")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    expect(parse("period=week&date=2026-10-11")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    expect(parse("period=month&month=2026-02")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });

  test("from/to tiene prioridad sobre los parámetros antiguos", () => {
    expect(parse("from=2026-10-01&to=2026-10-02&period=day&date=2026-10-07")).toMatchObject({
      from: "2026-10-01", to: "2026-10-02",
    });
  });

  test("un rango invertido o una fecha inválida dan error en español", () => {
    expect(parse("from=2026-10-09&to=2026-10-01").error).toBe(
      "La fecha inicial no puede ser posterior a la fecha final.",
    );
    expect(parse("from=2026-13-40").error).toBe("La fecha inicial no es válida.");
    expect(parse("to=hoy").error).toBe("La fecha final no es válida.");
    expect(parse("period=day&date=ayer").error).toBe("Selecciona una fecha válida.");
    expect(parse("period=month&month=2026-13").error).toBe("Selecciona un mes válido.");
    expect(parse("period=year").error).toBe("El período seleccionado no es válido.");
  });

  test("rechaza estados e identificadores inválidos", () => {
    expect(parse("status=APPROVED").error).toBe("El estado seleccionado no es válido.");
    expect(parse("machine=abc").error).toBe("El filtro de máquina no es válido.");
    expect(parse("shift=1").error).toBe("El filtro de turno no es válido.");
    expect(parse("operator=%27%3B--").error).toBe("El filtro de operario no es válido.");
  });
});

describe("reportFilterParams / atajos", () => {
  test("reconstruye los parámetros canónicos", () => {
    const filters = parse(`period=day&date=2026-10-07&status=SUBMITTED&machine=${MACHINE}&offshift=1&stop=active`);
    const params = reportFilterParams(filters);
    expect(params.get("from")).toBe("2026-10-07");
    expect(params.get("to")).toBe("2026-10-07");
    expect(params.get("status")).toBe("SUBMITTED");
    expect(params.get("machine")).toBe(MACHINE);
    expect(params.get("offshift")).toBe("1");
    expect(params.get("stop")).toBe("active");
    expect(params.has("period")).toBe(false);
  });

  test("periodRange y los atajos Día / Semana / Mes", () => {
    expect(periodRange("day", "2026-10-07")).toEqual({ from: "2026-10-07", to: "2026-10-07" });
    expect(periodRange("week", "2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodRange("month", "2026-10-07")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("day", "no-fecha")).toBeNull();
    const href = periodHref("week", parse(`status=CLOSED&machine=${MACHINE}`), "2026-10-07");
    expect(href).toStartWith("/reportes?");
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("from")).toBe("2026-10-05");
    expect(params.get("to")).toBe("2026-10-11");
    expect(params.get("status")).toBe("CLOSED");
    expect(activePeriod(parse("from=2026-10-05&to=2026-10-11"), "2026-10-07")).toBe("week");
    expect(activePeriod(parse("from=2026-10-01&to=2026-10-02"), "2026-10-07")).toBeNull();
  });
});

describe("applyReportFilters", () => {
  test("encadena los filtros sobre la consulta", () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const query: any = new Proxy({}, {
      get: (_, method: string) => (...args: unknown[]) => {
        calls.push([method, ...args]);
        return query;
      },
    });
    applyReportFilters(
      query,
      parse(`from=2026-10-01&to=2026-10-09&machine=${MACHINE}&shift=${SHIFT}&operator=${OPERATOR}&status=CLOSED&offshift=1&stop=active`),
    );
    expect(calls).toContainEqual(["gte", "report_date", "2026-10-01"]);
    expect(calls).toContainEqual(["lte", "report_date", "2026-10-09"]);
    expect(calls).toContainEqual(["eq", "machine_id", MACHINE]);
    expect(calls).toContainEqual(["eq", "shift_id", SHIFT]);
    expect(calls).toContainEqual(["eq", "created_by", OPERATOR]);
    expect(calls).toContainEqual(["eq", "status", "CLOSED"]);
    expect(calls).toContainEqual(["eq", "is_off_shift", true]);
    expect(calls).toContainEqual(["not", "active_stop", "is", null]);
  });
});

describe("rowMayMatchReportFilters (T101, Realtime)", () => {
  const { rowMayMatchReportFilters } = require("../src/lib/report-filters") as typeof import("../src/lib/report-filters");
  const filters = parse(`from=2026-10-10&to=2026-10-12&machine=${MACHINE}&status=SUBMITTED`);

  test("filas dentro del rango y de la máquina pasan; fuera de rango o de otra máquina no", () => {
    expect(rowMayMatchReportFilters(filters, { new: { report_date: "2026-10-11", machine_id: MACHINE } })).toBe(true);
    expect(rowMayMatchReportFilters(filters, { new: { report_date: "2026-10-13", machine_id: MACHINE } })).toBe(false);
    expect(rowMayMatchReportFilters(filters, { new: { report_date: "2026-10-11", machine_id: SHIFT } })).toBe(false);
  });

  test("un cambio de estado puede sacar o meter la fila: el estado no se filtra", () => {
    expect(rowMayMatchReportFilters(filters, { new: { report_date: "2026-10-11", machine_id: MACHINE, status: "CLOSED" } })).toBe(true);
  });

  test("datos ausentes o sin filas cuentan como 'podría afectar' (no se pierden cambios)", () => {
    expect(rowMayMatchReportFilters(filters, { new: { id: "x" } })).toBe(true);
    expect(rowMayMatchReportFilters(filters, {})).toBe(true);
    expect(rowMayMatchReportFilters(filters, undefined)).toBe(true);
    expect(rowMayMatchReportFilters(parse(""), { new: { report_date: "1999-01-01" } })).toBe(true);
  });

  test("DELETE/UPDATE: basta con que la fila anterior o la nueva cumpla", () => {
    expect(rowMayMatchReportFilters(filters, { new: { report_date: "2026-10-20" }, old: { report_date: "2026-10-11" } })).toBe(true);
  });
});
