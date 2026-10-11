import type { APIRoute } from "astro";
import { isManager } from "../../../../lib/auth";
import { json } from "../../../../lib/http";
import { isReportEditableField, normalizeReportEditableUpdates } from "../../../../lib/report-fields";
import { reportRpcFailure } from "../../../../lib/report-rpc";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Corrección con motivo de un reporte SUBMITTED/CLOSED: { patch, stops?, changes?, reason }.
 * La lista blanca de columnas la vuelve a validar correct_report en la base de datos.
 */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || !params.id) return json({ error: "No autorizado." }, 401);
  if (!isManager(auth)) return json({ error: "Solo un coordinador o administrador raíz puede corregir reportes." }, 403);

  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return json({ error: "Datos inválidos." }, 400);

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 5) return json({ error: "El motivo de la corrección debe tener al menos 5 caracteres." }, 400);

  const rawPatch = body.patch ?? {};
  if (!isRecord(rawPatch)) return json({ error: "El parche del reporte debe ser un objeto." }, 400);
  const unknownField = Object.keys(rawPatch).find((key) => !isReportEditableField(key));
  if (unknownField) return json({ error: `El campo "${unknownField}" no se puede corregir.` }, 400);
  if (body.stops != null && !Array.isArray(body.stops)) return json({ error: "Las paradas deben enviarse como una lista." }, 400);
  if (body.changes != null && !Array.isArray(body.changes)) return json({ error: "Los cambios deben enviarse como una lista." }, 400);

  const patch = normalizeReportEditableUpdates(rawPatch);
  const stops = Array.isArray(body.stops) && body.stops.length > 0 ? body.stops : null;
  const changes = Array.isArray(body.changes) && body.changes.length > 0 ? body.changes : null;
  if (Object.keys(patch).length === 0 && !stops && !changes) return json({ error: "No hay cambios para corregir." }, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("correct_report", {
    p_report_id: params.id,
    p_patch: patch,
    p_stops: stops,
    p_changes: changes,
    p_reason: reason,
  });
  if (error) {
    const failure = reportRpcFailure(error);
    return json({ error: failure.error, code: failure.code }, failure.status);
  }
  return json({ ok: true, report: data });
};
