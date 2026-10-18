/**
 * «Reloj desfasado» (clock_skew_review) es un diagnóstico exclusivo del administrador raíz (ROOT).
 * Las rutas del Operario nunca lo devuelven; la base entrega el aviso y has_pending_review solo a ROOT.
 */

/** Quita `clock_skew_review` de un registro de evento (parada o cambio). */
export function withoutClockSkew<T extends Record<string, unknown>>(row: T): Omit<T, "clock_skew_review"> {
  const { clock_skew_review: _omit, ...rest } = row;
  return rest;
}

/** Quita la bandera de los eventos anidados de un reporte (`report_stop_events`, `report_change_events`). */
export function stripClockSkewFromReport<T extends Record<string, unknown> | null>(report: T): T {
  if (!report) return report;
  const out: Record<string, unknown> = { ...report };
  for (const key of ["report_stop_events", "report_change_events"]) {
    const nested = out[key];
    if (Array.isArray(nested)) {
      out[key] = nested.map((row) => (row && typeof row === "object" ? withoutClockSkew(row as Record<string, unknown>) : row));
    }
  }
  return out as T;
}
