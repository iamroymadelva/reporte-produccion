/** Presentación de la cuarentena de sincronización (T076): resumen legible de cada operación en revisión. */

export interface QuarantineRow {
  id: string;
  reason: string;
  created_at: string;
  payload: { type?: string; capturedAt?: string; payload?: Record<string, unknown> } | null;
}

export interface QuarantineItem {
  id: string;
  reasonLabel: string;
  operationLabel: string;
  detail: string;
  capturedAt: string | null;
  receivedAt: string;
  /** Solo hay datos que aplicar para estos tipos y con el reporte enviado o cerrado. */
  applicable: boolean;
}

const REASON_LABELS: Record<string, string> = {
  REPORT_CANCELLED: "El reporte fue cancelado",
  REPORT_NOT_DRAFT: "El reporte ya estaba enviado",
  REPORT_CHANGED: "El reporte cambió en el servidor",
  ASSIGNMENT_REVOKED: "Asignación revocada después de la captura",
  STALE_CAPTURE: "Captura antigua sin conexión",
};

const OPERATION_LABELS: Record<string, string> = {
  CREATE_REPORT: "Creación del reporte",
  SAVE_REPORT_FIELDS: "Campos del reporte",
  START_STOP: "Inicio de parada",
  CLOSE_STOP: "Cierre de parada",
  SET_STOP_CATEGORY: "Categoría de parada",
  CANCEL_STOP: "Cancelación de parada",
  ADD_CHANGE: "Cambio registrado",
  SUBMIT_REPORT: "Envío del reporte",
  CANCEL_REPORT: "Cancelación del reporte",
};

const APPLICABLE_TYPES = new Set(["SAVE_REPORT_FIELDS", "ADD_CHANGE", "START_STOP", "CLOSE_STOP", "SET_STOP_CATEGORY", "CANCEL_STOP"]);

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function detailFor(type: string, payload: Record<string, unknown>) {
  switch (type) {
    case "SAVE_REPORT_FIELDS": {
      const fields = payload.fields && typeof payload.fields === "object" ? Object.keys(payload.fields as object) : [];
      return fields.length ? `Campos: ${fields.join(", ")}` : "Sin campos";
    }
    case "ADD_CHANGE":
      return [text(payload.description), text(payload.occurredAt)].filter(Boolean).join(" · ");
    case "START_STOP":
      return `Inicio: ${text(payload.startedAt)}${payload.description ? ` · ${text(payload.description)}` : ""}`;
    case "CLOSE_STOP":
      return `Fin: ${text(payload.endedAt)}`;
    case "CANCEL_STOP":
    case "CANCEL_REPORT":
      return `Motivo: ${text(payload.reason)}`;
    default:
      return "";
  }
}

export function describeQuarantineItem(row: QuarantineRow, reportStatus: string): QuarantineItem {
  const type = row.payload?.type ?? "";
  const payload = row.payload?.payload ?? {};
  return {
    id: row.id,
    reasonLabel: REASON_LABELS[row.reason] ?? row.reason,
    operationLabel: OPERATION_LABELS[type] ?? (type || "Operación"),
    detail: detailFor(type, payload),
    capturedAt: row.payload?.capturedAt ?? null,
    receivedAt: row.created_at,
    applicable: APPLICABLE_TYPES.has(type) && (reportStatus === "SUBMITTED" || reportStatus === "CLOSED"),
  };
}
