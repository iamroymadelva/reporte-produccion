import { formatDate, formatDateTime, formatNumber, formatPercent } from "./format";
import { statusLabels } from "./types";
import { stopDuration } from "./stop-events";

export type ReportAuditRow = {
  id: number | string;
  changed_at: string;
  changed_by: string;
  field_name: string;
  old_value: unknown;
  new_value: unknown;
  user?: { full_name?: string | null } | null;
};

export type AuditCatalogs = Partial<Record<string, Map<string, string>>>;

export type AuditDetail = {
  label: string;
  previous?: string;
  next?: string;
};

export type AuditDisplayEntry = {
  id: number | string;
  title: string;
  actor: string;
  changedAt: string;
  stopNumber?: number;
  details: AuditDetail[];
};

type JsonRecord = Record<string, unknown>;

const fieldLabels: Record<string, string> = {
  report_date: "Fecha",
  production_order: "O.P.",
  machine_id: "Máquina",
  line_id: "Área / Línea",
  client_id: "Cliente (catálogo)",
  client_name: "Cliente",
  lot: "Lote",
  shift_id: "Turno",
  product_id: "Producto (catálogo)",
  product_name: "Producto",
  weight: "Peso (gr)",
  g_min: "G/min",
  dosifier_type_id: "Tipo de dosificador",
  started_at: "Hora de inicio",
  ended_at: "Hora de finalización",
  programmed_hours: "Horas programadas",
  units_produced: "Unidades producidas",
  waste: "Desperdicio",
  process_performance: "Rendimiento del proceso",
  operator_performance: "Rendimiento del operario",
  observations: "Observaciones",
  status: "Estado",
  submitted_at: "Fecha de envío",
  submitted_by: "Enviado por",
  cancellation_reason: "Motivo de cancelación",
  cancelled_at: "Fecha de cancelación",
  cancelled_by: "Cancelado por",
};

const relationFields = new Set([
  "machine_id",
  "line_id",
  "client_id",
  "product_id",
  "shift_id",
  "dosifier_type_id",
]);
const dateTimeFields = new Set(["started_at", "ended_at", "submitted_at", "cancelled_at"]);
const percentageFields = new Set(["process_performance", "operator_performance"]);

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function rawId(value: unknown) {
  const record = asRecord(value);
  if (record && typeof record.id === "string") return record.id;
  return typeof value === "string" ? value : null;
}

function snapshotLabel(value: unknown) {
  const record = asRecord(value);
  return record && typeof record.label === "string" ? record.label : null;
}

function auditValue(field: string, value: unknown, catalogs: AuditCatalogs) {
  if (value === null || value === undefined || value === "") return "—";
  const savedLabel = snapshotLabel(value);
  if (savedLabel) return savedLabel;
  if (relationFields.has(field)) {
    const id = rawId(value);
    return (id && catalogs[field]?.get(id)) || id || "—";
  }
  if (field === "report_date" && typeof value === "string") return formatDate(value);
  if (dateTimeFields.has(field) && typeof value === "string") return formatDateTime(value);
  if (field === "status" && typeof value === "string") {
    return statusLabels[value as keyof typeof statusLabels] ?? value;
  }
  if (percentageFields.has(field) && (typeof value === "number" || typeof value === "string")) {
    return formatPercent(value);
  }
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function categoryValue(payload: JsonRecord | null, catalogs: AuditCatalogs) {
  if (!payload) return "—";
  const snapshot = asRecord(payload.stop_category);
  if (snapshot) {
    const code = typeof snapshot.code === "string" ? snapshot.code : "";
    const name = typeof snapshot.name === "string" ? snapshot.name : "";
    const label = [code, name].filter(Boolean).join(" · ");
    if (label) return label;
  }
  const id = typeof payload.stop_category_id === "string" ? payload.stop_category_id : null;
  return (id && catalogs.stop_category_id?.get(id)) || id || "—";
}

function changed(previous: JsonRecord | null, next: JsonRecord | null, field: string) {
  return JSON.stringify(previous?.[field] ?? null) !== JSON.stringify(next?.[field] ?? null);
}

function stopDetails(previous: JsonRecord | null, next: JsonRecord | null, catalogs: AuditCatalogs) {
  const details: AuditDetail[] = [];
  const insertion = !previous && Boolean(next);
  const deletion = Boolean(previous) && !next;
  const push = (field: string, label: string, format: (value: unknown) => string = (value) => auditValue(field, value, catalogs)) => {
    if (!insertion && !deletion && !changed(previous, next, field)) return;
    const previousValue = previous?.[field];
    const nextValue = next?.[field];
    if (insertion && (nextValue === null || nextValue === undefined || nextValue === "")) return;
    if (deletion && (previousValue === null || previousValue === undefined || previousValue === "")) return;
    details.push({
      label,
      previous: insertion ? undefined : format(previousValue),
      next: deletion ? undefined : format(nextValue),
    });
  };

  if (insertion || deletion || changed(previous, next, "stop_category_id")) {
    details.push({
      label: "Categoría",
      previous: insertion ? undefined : categoryValue(previous, catalogs),
      next: deletion ? undefined : categoryValue(next, catalogs),
    });
  }
  push("started_at", "Inicio", (value) => formatDateTime(typeof value === "string" ? value : null));
  push("ended_at", "Finalización", (value) => formatDateTime(typeof value === "string" ? value : null));
  push("duration_seconds", "Duración", (value) => value === null || value === undefined ? "—" : stopDuration(Number(value)));
  push("description", "Descripción");
  push("cancellation_reason", "Motivo de cancelación");
  return details;
}

function stopTitle(fieldName: string, previous: JsonRecord | null, next: JsonRecord | null) {
  if (fieldName === "stop_event.insert") return "Parada iniciada";
  if (fieldName === "stop_event.delete") return "Parada eliminada";
  if (!previous || !next) return "Corrección de parada";
  if (!previous.cancelled_at && next.cancelled_at) return "Parada cancelada";
  if (previous.stop_category_id !== next.stop_category_id) return "Cambio de categoría";
  if (!previous.ended_at && next.ended_at) return "Parada finalizada";
  return "Corrección de parada";
}

function reportTitle(row: ReportAuditRow) {
  if (row.field_name === "status") {
    if (row.new_value === "SUBMITTED") return "Reporte enviado";
    if (row.new_value === "CANCELLED") return "Reporte cancelado";
    return "Cambio de estado del reporte";
  }
  if (["cancellation_reason", "cancelled_at", "cancelled_by"].includes(row.field_name)) {
    return "Datos de cancelación actualizados";
  }
  if (["submitted_at", "submitted_by"].includes(row.field_name)) {
    return "Datos de envío actualizados";
  }
  return "Corrección del reporte";
}

export function buildStopNumberMap(
  stops: Array<{ id: string; started_at: string }>,
  auditRows: ReportAuditRow[],
) {
  const stopTimes = new Map<string, string>();
  for (const stop of stops) stopTimes.set(stop.id, stop.started_at);
  for (const row of auditRows) {
    if (!row.field_name.startsWith("stop_event.")) continue;
    for (const value of [row.old_value, row.new_value]) {
      const payload = asRecord(value);
      if (typeof payload?.id !== "string" || typeof payload.started_at !== "string") continue;
      if (!stopTimes.has(payload.id)) stopTimes.set(payload.id, payload.started_at);
    }
  }
  const ordered = [...stopTimes.entries()].sort(([leftId, leftTime], [rightId, rightTime]) =>
    leftTime.localeCompare(rightTime) || leftId.localeCompare(rightId)
  );
  return new Map(ordered.map(([stopId], index) => [stopId, index + 1]));
}

export function describeAuditRows(
  rows: ReportAuditRow[],
  options: {
    catalogs?: AuditCatalogs;
    stops?: Array<{ id: string; started_at: string }>;
  } = {},
) {
  const catalogs = options.catalogs ?? {};
  const stopNumbers = buildStopNumberMap(options.stops ?? [], rows);
  return rows.map<AuditDisplayEntry>((row) => {
    const actor = row.user?.full_name?.trim() || row.changed_by;
    if (!row.field_name.startsWith("stop_event.")) {
      return {
        id: row.id,
        title: reportTitle(row),
        actor,
        changedAt: row.changed_at,
        details: [{
          label: fieldLabels[row.field_name] ?? row.field_name,
          previous: auditValue(row.field_name, row.old_value, catalogs),
          next: auditValue(row.field_name, row.new_value, catalogs),
        }],
      };
    }

    const previous = asRecord(row.old_value);
    const next = asRecord(row.new_value);
    const stopId = typeof next?.id === "string" ? next.id : typeof previous?.id === "string" ? previous.id : null;
    return {
      id: row.id,
      title: stopTitle(row.field_name, previous, next),
      actor,
      changedAt: row.changed_at,
      stopNumber: stopId ? stopNumbers.get(stopId) : undefined,
      details: stopDetails(previous, next, catalogs),
    };
  });
}
