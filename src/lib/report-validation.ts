import type { ReportEditableField } from "./report-fields";

export const ACTIVE_STOP_SUBMISSION_ERROR = "No puedes enviar el reporte mientras haya una parada activa. Detén o cancela la parada primero.";

// Order matches the Operator form. Machine and responsible operator are immutable
// report identity, checked by the database rather than entered by the user.
export const REQUIRED_REPORT_FIELDS = [
  { field: "report_date", label: "Fecha" },
  { field: "product_name", label: "Producto" },
  { field: "production_order", label: "O.P." },
  { field: "line_id", label: "Área / Línea" },
  { field: "client_name", label: "Cliente" },
  { field: "lot", label: "Lote" },
  { field: "shift_id", label: "Turno" },
  { field: "weight", label: "Peso (gr)" },
  { field: "g_min", label: "G/min" },
  { field: "dosifier_type_id", label: "Tipo de dosificador" },
  { field: "started_at", label: "Hora inicio" },
  { field: "ended_at", label: "Hora finalización" },
  { field: "programmed_hours", label: "Horas programadas" },
  { field: "units_produced", label: "Unidades producidas" },
  { field: "waste", label: "Desperdicio" },
] as const satisfies ReadonlyArray<{ field: ReportEditableField; label: string }>;

export type ReportFieldErrors = Partial<Record<ReportEditableField, string>>;
const numericFields = new Set(["weight", "g_min", "programmed_hours", "units_produced", "waste"]);

export function validateReportForSubmission(values: Record<string, unknown>): ReportFieldErrors {
  const errors: ReportFieldErrors = {};
  for (const { field, label } of REQUIRED_REPORT_FIELDS) {
    const value = values[field];
    if (value === null || value === undefined || String(value).trim() === "") {
      errors[field] = `${label} es obligatorio.`;
    } else if (numericFields.has(field)) {
      const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
      if (!Number.isFinite(number) || number < 0 || (field === "units_produced" && !Number.isSafeInteger(number))) {
        errors[field] = field === "units_produced"
          ? "Unidades producidas debe ser un número entero mayor o igual a 0."
          : `${label} debe ser un número mayor o igual a 0.`;
      }
    } else if (["report_date", "started_at", "ended_at"].includes(field) && Number.isNaN(new Date(String(value)).getTime())) {
      errors[field] = `${label} no es válido.`;
    }
  }
  if (!errors.started_at && !errors.ended_at && new Date(String(values.ended_at)) < new Date(String(values.started_at))) {
    errors.ended_at = "La hora de finalización no puede ser anterior al inicio.";
  }
  return errors;
}

export function localDateTime(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
