import { formatDate, getBogotaDateKey } from "./format";

export const REPORT_STATUSES = ["DRAFT", "SUBMITTED", "CLOSED", "CANCELLED"] as const;
export type ReportStatusFilter = (typeof REPORT_STATUSES)[number];
export type ReportPeriod = "day" | "week" | "month";

/**
 * Filtros de listados, panel y exportación. `from`/`to` son fechas operativas (America/Bogota) inclusivas;
 * los parámetros antiguos `period`/`date`/`month` se traducen a ese rango.
 */
export interface ReportFilters {
  from: string | null;
  to: string | null;
  machine: string | null;
  shift: string | null;
  operator: string | null;
  status: ReportStatusFilter | null;
  activeStop: boolean;
  offShift: boolean;
  periodLabel: string | null;
  error: string | null;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDateKey(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Rango (lunes a domingo, o día o mes completo) de los atajos Día / Semana / Mes para una fecha dada. */
export function periodRange(period: ReportPeriod, dateKey: string): { from: string; to: string } | null {
  const date = parseDateKey(dateKey);
  if (!date) return null;
  if (period === "day") return { from: dateKey, to: dateKey };
  if (period === "week") {
    const weekday = date.getUTCDay();
    const monday = addDays(date, weekday === 0 ? -6 : 1 - weekday);
    return { from: toDateKey(monday), to: toDateKey(addDays(monday, 6)) };
  }
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { from: toDateKey(first), to: toDateKey(addDays(next, -1)) };
}

function rangeLabel(from: string | null, to: string | null) {
  if (from && to) return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `Desde ${formatDate(from)}`;
  if (to) return `Hasta ${formatDate(to)}`;
  return null;
}

function emptyFilters(): ReportFilters {
  return {
    from: null,
    to: null,
    machine: null,
    shift: null,
    operator: null,
    status: null,
    activeStop: false,
    offShift: false,
    periodLabel: null,
    error: null,
  };
}

export function parseReportFilters(searchParams: URLSearchParams): ReportFilters {
  const filters = emptyFilters();
  const fail = (error: string): ReportFilters => ({ ...filters, error });

  const requestedStatus = searchParams.get("status");
  if (requestedStatus) {
    if (!REPORT_STATUSES.includes(requestedStatus as ReportStatusFilter)) {
      return fail("El estado seleccionado no es válido.");
    }
    filters.status = requestedStatus as ReportStatusFilter;
  }
  filters.activeStop = searchParams.get("stop") === "active";
  filters.offShift = searchParams.get("offshift") === "1";

  for (const [param, label, key] of [
    ["machine", "máquina", "machine"],
    ["shift", "turno", "shift"],
    ["operator", "operario", "operator"],
  ] as const) {
    const value = searchParams.get(param);
    if (!value) continue;
    if (!UUID_PATTERN.test(value)) return fail(`El filtro de ${label} no es válido.`);
    filters[key] = value.toLowerCase();
  }

  const rawFrom = searchParams.get("from") ?? "";
  const rawTo = searchParams.get("to") ?? "";
  if (rawFrom || rawTo) {
    if (rawFrom && !parseDateKey(rawFrom)) return fail("La fecha inicial no es válida.");
    if (rawTo && !parseDateKey(rawTo)) return fail("La fecha final no es válida.");
    if (rawFrom && rawTo && rawFrom > rawTo) return fail("La fecha inicial no puede ser posterior a la fecha final.");
    filters.from = rawFrom || null;
    filters.to = rawTo || null;
    filters.periodLabel = rangeLabel(filters.from, filters.to);
    return filters;
  }

  // Parámetros antiguos period / date / month.
  const requestedPeriod = searchParams.get("period");
  if (!requestedPeriod) return filters;
  if (!(["day", "week", "month"] as string[]).includes(requestedPeriod)) {
    return fail("El período seleccionado no es válido.");
  }
  if (requestedPeriod === "month") {
    const monthValue = searchParams.get("month") ?? "";
    const match = MONTH_PATTERN.exec(monthValue);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return fail("Selecciona un mes válido.");
    const range = periodRange("month", `${monthValue}-01`)!;
    filters.from = range.from;
    filters.to = range.to;
    filters.periodLabel = rangeLabel(range.from, range.to);
    return filters;
  }
  const range = periodRange(requestedPeriod as ReportPeriod, searchParams.get("date") ?? "");
  if (!range) return fail("Selecciona una fecha válida.");
  filters.from = range.from;
  filters.to = range.to;
  filters.periodLabel = rangeLabel(range.from, range.to);
  return filters;
}

/**
 * Aplica los filtros a una consulta de `production_report_overview` (la vista aporta `is_off_shift`).
 * La parada activa se filtra con la columna `active_stop` de la vista (jsonb de la parada abierta o null).
 */
export function applyReportFilters<T>(query: T, filters: ReportFilters): T {
  let filtered = query as any;
  if (filters.from) filtered = filtered.gte("report_date", filters.from);
  if (filters.to) filtered = filtered.lte("report_date", filters.to);
  if (filters.machine) filtered = filtered.eq("machine_id", filters.machine);
  if (filters.shift) filtered = filtered.eq("shift_id", filters.shift);
  if (filters.operator) filtered = filtered.eq("created_by", filters.operator);
  if (filters.status) filtered = filtered.eq("status", filters.status);
  if (filters.offShift) filtered = filtered.eq("is_off_shift", true);
  if (filters.activeStop) filtered = filtered.not("active_stop", "is", null);
  return filtered as T;
}

export function reportFilterParams(filters: ReportFilters) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.machine) params.set("machine", filters.machine);
  if (filters.shift) params.set("shift", filters.shift);
  if (filters.operator) params.set("operator", filters.operator);
  if (filters.status) params.set("status", filters.status);
  if (filters.activeStop) params.set("stop", "active");
  if (filters.offShift) params.set("offshift", "1");
  return params;
}

export function hasActiveReportFilters(filters: ReportFilters) {
  return reportFilterParams(filters).size > 0;
}

/** Enlace de los atajos Día / Semana / Mes: conserva el resto de filtros y fija el rango. */
export function periodHref(period: ReportPeriod, filters: ReportFilters, todayKey = getBogotaDateKey()) {
  const params = reportFilterParams(filters);
  const range = periodRange(period, todayKey)!;
  params.set("from", range.from);
  params.set("to", range.to);
  return `/reportes?${params.toString()}`;
}

/** Atajo activo cuando el rango coincide exactamente con el de hoy / esta semana / este mes. */
export function activePeriod(filters: ReportFilters, todayKey = getBogotaDateKey()): ReportPeriod | null {
  if (!filters.from || !filters.to) return null;
  for (const period of ["day", "week", "month"] as const) {
    const range = periodRange(period, todayKey);
    if (range && range.from === filters.from && range.to === filters.to) return period;
  }
  return null;
}

/**
 * Realtime (T101): ¿puede este evento de `production_reports` afectar a la lista con estos filtros? Se mira la fila nueva
 * y la anterior (esta última solo trae la clave primaria salvo REPLICA IDENTITY FULL); un dato ausente cuenta como
 * "podría afectar" para no perder cambios. `status`, `activeStop` y `offShift` no se filtran: un cambio de estado puede sacar o meter la fila en la lista.
 */
export function rowMayMatchReportFilters(filters: ReportFilters, payload: unknown): boolean {
  const event = (payload ?? {}) as { new?: Record<string, unknown>; old?: Record<string, unknown> };
  const rows = [event.new, event.old].filter((row): row is Record<string, unknown> => Boolean(row) && Object.keys(row as object).length > 0);
  if (rows.length === 0) return true;
  const matches = (row: Record<string, unknown>) => {
    const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string).toLowerCase() : null);
    const date = typeof row.report_date === "string" ? row.report_date : null;
    if (date && filters.from && date < filters.from) return false;
    if (date && filters.to && date > filters.to) return false;
    for (const [key, wanted] of [["machine_id", filters.machine], ["shift_id", filters.shift], ["created_by", filters.operator]] as const) {
      const value = text(key);
      if (wanted && value && value !== wanted) return false;
    }
    return true;
  };
  return rows.some(matches);
}
