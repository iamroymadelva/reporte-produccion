/** Traduce los errores de las RPC de reportes (approve_report, cancel_report, correct_report) a respuestas HTTP en español. */

export type RpcError = { code?: string | null; message?: string | null; details?: string | null };

export type ReportRpcFailure = { status: number; error: string; code?: string };

const FALLBACK = "No fue posible completar la operación.";

export function reportRpcFailure(error: RpcError): ReportRpcFailure {
  const sqlState = error.code ?? "";
  const message = (error.message ?? "").trim();
  const details = (error.details ?? "").trim();
  switch (sqlState) {
    case "42501":
      return { status: 403, error: message || "No tienes permiso para realizar esta acción.", code: "FORBIDDEN" };
    case "22023":
      return { status: 400, error: message || FALLBACK, code: "INVALID" };
    case "P0006":
      return { status: 404, error: details || "Reporte no encontrado.", code: "NOT_FOUND" };
    case "P0001":
      if (message === "NOT_SUBMITTED") {
        return { status: 409, error: details || "Solo se pueden aprobar reportes enviados.", code: "NOT_SUBMITTED" };
      }
      return { status: 400, error: message || FALLBACK };
    case "P0002":
      return {
        status: 409,
        error: details || "El reporte tiene datos pendientes de conciliar. Resuélvelos antes de aprobar.",
        code: "OPEN_CONFLICT",
      };
    case "P0003":
      return { status: 409, error: details || "El reporte no se puede cancelar.", code: "NOT_CANCELLABLE" };
    case "P0007":
      return {
        status: 409,
        error: details || "El reporte tiene paradas abiertas o sin categoría. Corrígelas antes de aprobar.",
        code: "INVALID_STOPS",
      };
    case "P0008":
      return { status: 409, error: details || "Este elemento ya fue revisado.", code: "ALREADY_REVIEWED" };
    case "P0005":
      return {
        status: 409,
        error: details || "Solo se pueden corregir reportes enviados o cerrados.",
        code: "NOT_CORRECTABLE",
      };
    default:
      return { status: 400, error: message || FALLBACK };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);

/** Traduce los errores de INSERT/UPDATE directos de reportes y paradas a códigos estables (T075). */
export function writeFailure(error: RpcError): ReportRpcFailure {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  switch (error.code ?? "") {
    case "23505":
      if (text.includes("one_active_per_operator")) {
        return { status: 409, code: "ACTIVE_REPORT_EXISTS", error: "Ya tienes un reporte activo. Envíalo o cancélalo antes de iniciar otro." };
      }
      if (text.includes("one_active_per_machine")) {
        return { status: 409, code: "MACHINE_BUSY", error: "La máquina ya tiene un reporte activo." };
      }
      if (text.includes("report_stop_events_one_open_per_report")) {
        return { status: 409, code: "STOP_ALREADY_OPEN", error: "Este reporte ya tiene una parada abierta." };
      }
      return { status: 409, code: "ALREADY_EXISTS", error: "El registro ya existe." };
    case "23P01":
      return { status: 409, code: "STOP_OVERLAP", error: "La parada se solapa con otra parada del reporte." };
    default:
      if (/no está asignada al Operador/i.test(text)) {
        return { status: 409, code: "NO_ASSIGNMENT", error: "Esta máquina no está asignada a tu turno. Solicita una asignación a tu coordinador." };
      }
      return { status: 400, error: (error.message ?? "").trim() || FALLBACK, code: "VALIDATION" };
  }
}
