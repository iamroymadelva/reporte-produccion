export const REPORT_EDITABLE_FIELDS = [
  "report_date",
  "production_order",
  "line_id",
  "client_id",
  "client_name",
  "lot",
  "shift_id",
  "product_id",
  "product_name",
  "weight",
  "g_min",
  "dosifier_type_id",
  "started_at",
  "ended_at",
  "programmed_hours",
  "units_produced",
  "waste",
  "process_performance",
  "operator_performance",
  "observations",
] as const;

export type ReportEditableField = typeof REPORT_EDITABLE_FIELDS[number];
export type ReportEditableValue = string | number | null;
export type ReportEditableValues = Record<ReportEditableField, ReportEditableValue>;
export type PartialReportEditableValues = Partial<ReportEditableValues>;

const editableFieldSet = new Set<string>(REPORT_EDITABLE_FIELDS);
const numericFields = new Set<ReportEditableField>([
  "weight",
  "g_min",
  "programmed_hours",
  "units_produced",
  "waste",
]);
const percentageFields = new Set<ReportEditableField>([
  "process_performance",
  "operator_performance",
]);
const timestampFields = new Set<ReportEditableField>(["started_at", "ended_at"]);
const trimmedNameFields = new Set<ReportEditableField>(["client_name", "product_name"]);

export function isReportEditableField(value: string): value is ReportEditableField {
  return editableFieldSet.has(value);
}

/** Picks only approved report fields without changing their values. */
export function pickReportEditableValues(source: Record<string, unknown>): PartialReportEditableValues {
  const result: PartialReportEditableValues = {};
  for (const field of REPORT_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (value === null || typeof value === "string" || typeof value === "number") {
      result[field] = value;
    }
  }
  return result;
}

/** Preserves the normalization currently performed by the report PATCH endpoint. */
export function normalizeReportEditableUpdates(source: Record<string, unknown>): PartialReportEditableValues {
  const result: PartialReportEditableValues = {};
  for (const [key, value] of Object.entries(source)) {
    if (!isReportEditableField(key)) continue;
    if (trimmedNameFields.has(key)) {
      result[key] = typeof value === "string" && value.trim() ? value.trim() : null;
    } else {
      result[key] = value === "" ? null : value as ReportEditableValue;
    }
  }
  return result;
}

/** Builds the existing server payload from the editor's string-valued form. */
export function reportFormToPayload(form: Record<string, string>): PartialReportEditableValues {
  const result: PartialReportEditableValues = {};
  for (const field of REPORT_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(form, field)) continue;
    const value = form[field];
    if (!value) result[field] = null;
    else if (numericFields.has(field)) result[field] = Number(value);
    else if (percentageFields.has(field)) result[field] = Number(value) / 100;
    else if (timestampFields.has(field)) result[field] = new Date(value).toISOString();
    else result[field] = value;
  }
  return result;
}

function canonicalValue(field: ReportEditableField, value: unknown): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (trimmedNameFields.has(field)) {
    const trimmed = typeof value === "string" ? value.trim() : String(value).trim();
    return trimmed || null;
  }
  if (numericFields.has(field) || percentageFields.has(field)) {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : String(value);
  }
  if (timestampFields.has(field)) {
    const timestamp = new Date(String(value));
    return Number.isNaN(timestamp.getTime()) ? String(value) : timestamp.toISOString();
  }
  return typeof value === "string" || typeof value === "number" ? value : String(value);
}

/**
 * Compares only fields present in expected. This supports both the current partial
 * PATCH contract and the future full SAVE_REPORT outbox payload.
 */
export function areReportEditableValuesEquivalent(
  serverValues: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  for (const field of REPORT_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(expected, field)) continue;
    if (canonicalValue(field, serverValues[field]) !== canonicalValue(field, expected[field])) return false;
  }
  return true;
}
