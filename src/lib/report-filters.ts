import { formatDate, getBogotaDateKey } from "./format";

export const REPORT_STATUSES = ["DRAFT", "SUBMITTED", "CANCELLED"] as const;
export type ReportStatusFilter = (typeof REPORT_STATUSES)[number];
export type ReportPeriod = "day" | "week" | "month";

export interface ReportFilters {
  period: ReportPeriod | null;
  date: string | null;
  month: string | null;
  startDate: string | null;
  endDate: string | null;
  status: ReportStatusFilter | null;
  activeStop: boolean;
  periodLabel: string | null;
  error: string | null;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

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

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  const label = new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
    timeZone: "America/Bogota",
  }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function parseReportFilters(searchParams: URLSearchParams): ReportFilters {
  const activeStop = searchParams.get("stop") === "active";
  const requestedStatus = searchParams.get("status");
  const status = !activeStop && REPORT_STATUSES.includes(requestedStatus as ReportStatusFilter)
    ? requestedStatus as ReportStatusFilter
    : null;
  const requestedPeriod = searchParams.get("period");
  const empty: ReportFilters = {
    period: null,
    date: null,
    month: null,
    startDate: null,
    endDate: null,
    status,
    activeStop,
    periodLabel: null,
    error: null,
  };

  if (!requestedPeriod) return empty;
  if (!(["day", "week", "month"] as string[]).includes(requestedPeriod)) {
    return { ...empty, error: "El período seleccionado no es válido." };
  }

  if (requestedPeriod === "month") {
    const monthValue = searchParams.get("month") ?? "";
    const match = MONTH_PATTERN.exec(monthValue);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
      return { ...empty, error: "Selecciona un mes válido." };
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const nextMonth = new Date(Date.UTC(year, month, 1));
    return {
      ...empty,
      period: "month",
      month: monthValue,
      startDate: toDateKey(start),
      endDate: toDateKey(addDays(nextMonth, -1)),
      periodLabel: formatMonthLabel(monthValue),
    };
  }

  const dateValue = searchParams.get("date") ?? "";
  const selectedDate = parseDateKey(dateValue);
  if (!selectedDate) return { ...empty, error: "Selecciona una fecha válida." };

  if (requestedPeriod === "day") {
    return {
      ...empty,
      period: "day",
      date: dateValue,
      startDate: dateValue,
      endDate: dateValue,
      periodLabel: formatDate(dateValue),
    };
  }

  const weekday = selectedDate.getUTCDay();
  const monday = addDays(selectedDate, weekday === 0 ? -6 : 1 - weekday);
  const sunday = addDays(monday, 6);
  const startDate = toDateKey(monday);
  const endDate = toDateKey(sunday);
  return {
    ...empty,
    period: "week",
    date: dateValue,
    startDate,
    endDate,
    periodLabel: `${formatDate(startDate)} – ${formatDate(endDate)}`,
  };
}

export function applyReportFilters<T>(query: T, filters: ReportFilters, activeStopRelation = "report_stop_events"): T {
  let filtered = query as any;
  if (filters.startDate) filtered = filtered.gte("report_date", filters.startDate);
  if (filters.endDate) filtered = filtered.lte("report_date", filters.endDate);
  if (filters.status) filtered = filtered.eq("status", filters.status);
  if (filters.activeStop) filtered = filtered.is(`${activeStopRelation}.ended_at`, null);
  return filtered as T;
}

export function reportFilterParams(filters: ReportFilters, options: { includePeriod?: boolean } = {}) {
  const params = new URLSearchParams();
  const includePeriod = options.includePeriod ?? true;
  if (includePeriod && filters.period === "month" && filters.month) {
    params.set("period", "month");
    params.set("month", filters.month);
  } else if (includePeriod && filters.period && filters.date) {
    params.set("period", filters.period);
    params.set("date", filters.date);
  }
  if (filters.activeStop) params.set("stop", "active");
  else if (filters.status) params.set("status", filters.status);
  return params;
}

export function periodHref(period: ReportPeriod, filters: ReportFilters) {
  const params = reportFilterParams(filters, { includePeriod: false });
  params.set("period", period);
  if (period === "month") params.set("month", getBogotaDateKey().slice(0, 7));
  else params.set("date", getBogotaDateKey());
  return `/reportes?${params.toString()}`;
}
