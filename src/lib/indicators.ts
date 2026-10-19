import { getBogotaDateKey } from "./format";

export type IndicatorsRangeKey = "7d" | "30d" | "90d";

export const DEFAULT_INDICATORS_RANGE: IndicatorsRangeKey = "30d";

export const INDICATOR_RANGES: Record<IndicatorsRangeKey, { days: number; label: string }> = {
  "7d": { days: 7, label: "Últimos 7 días" },
  "30d": { days: 30, label: "Últimos 30 días" },
  "90d": { days: 90, label: "Últimos 3 meses" },
};

export type IndicatorsRange = { key: IndicatorsRangeKey; from: string; to: string; days: number };

export function isIndicatorsRangeKey(value: unknown): value is IndicatorsRangeKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INDICATOR_RANGES, value);
}

/** `to` = hoy (fecha operativa de Bogotá); `from` = to − (días − 1), sobre calendario a mediodía UTC. */
export function resolveIndicatorsRange(key: IndicatorsRangeKey, today: string = getBogotaDateKey()): IndicatorsRange {
  const { days } = INDICATOR_RANGES[key];
  const start = new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86_400_000);
  return { key, from: start.toISOString().slice(0, 10), to: today, days };
}

export type IndicatorsCards = {
  reports: number;
  approved: number;
  approvedRatio: number | null;
  avgApprovalSeconds: number | null;
  stopSeconds: number;
};
export type IndicatorsDailyPoint = { date: string; seconds: number };
export type IndicatorsMachine = { machineId: string; code: string; name: string; seconds: number };
export type IndicatorsCategorySegment =
  | { kind: "category"; categoryId: string; name: string; seconds: number }
  | { kind: "uncategorized"; categoryId: null; name: null; seconds: number }
  | { kind: "other"; categoryId: null; name: null; seconds: number };
export type IndicatorsResponse = {
  range: IndicatorsRange;
  cards: IndicatorsCards;
  daily: IndicatorsDailyPoint[];
  machines: IndicatorsMachine[];
  categories: IndicatorsCategorySegment[];
  serverTime: string;
};

export const CATEGORY_LABELS = { uncategorized: "Sin categoría", other: "Otras" } as const;

export function categoryLabel(segment: Pick<IndicatorsCategorySegment, "kind" | "name">): string {
  if (segment.kind === "uncategorized") return CATEGORY_LABELS.uncategorized;
  if (segment.kind === "other") return CATEGORY_LABELS.other;
  return segment.name ?? CATEGORY_LABELS.uncategorized;
}

export const secondsToHours = (seconds: number) => seconds / 3600;

const hoursFormat = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 });

export function formatHours(seconds: number): string {
  return `${hoursFormat.format(secondsToHours(seconds))} h`;
}

export function formatRatioPercent(ratio: number | null | undefined): string {
  return ratio == null || !Number.isFinite(ratio) ? "—" : `${percentFormat.format(ratio).replace(/[\s ]*%$/, "")} %`; // espacio duro antes de %, igual en todos los runtimes
}

export function formatAvgApprovalHours(seconds: number | null | undefined): string {
  return seconds == null || !Number.isFinite(seconds) ? "—" : formatHours(seconds);
}
