import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { json } from "../../../../../../lib/http";
import { isUuid, writeFailure } from "../../../../../../lib/report-rpc";
import { STOP_EVENT_SELECTION } from "../../../../../../lib/stop-events";

/**
 * Cierra una parada (T075). JSON `{ ended_at?, stop_category_id? }`: `ended_at` es la hora del dispositivo.
 * La parada debe quedar con categoría (la que ya tenía o `stop_category_id`); si no, CATEGORY_REQUIRED.
 */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR" || !params.id || !params.stopId) {
    return json({ error: "No autorizado para cerrar paradas." }, 403);
  }

  const body = await request.json().catch(() => null);
  // Hora del dispositivo: si no llega una fecha válida se usa la hora de la solicitud.
  const endedAt = typeof body?.ended_at === "string" && !Number.isNaN(Date.parse(body.ended_at))
    ? new Date(body.ended_at).toISOString()
    : new Date().toISOString();
  const sentCategory = typeof body?.stop_category_id === "string" ? body.stop_category_id.trim() : "";
  if (sentCategory && !isUuid(sentCategory)) return json({ error: "Selecciona una categoría de parada válida.", code: "VALIDATION" }, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  const { data: current, error: currentError } = await supabase
    .from("report_stop_events")
    .select("id, stop_category_id")
    .eq("id", params.stopId)
    .eq("report_id", params.id)
    .is("ended_at", null)
    .is("cancelled_at", null)
    .maybeSingle();
  if (currentError) return json({ error: currentError.message }, 400);
  if (!current) return json({ error: "La parada ya no está activa o el reporte no permite cambios." }, 409);
  if (!sentCategory && !current.stop_category_id) {
    return json({ error: "Selecciona la categoría de la parada antes de cerrarla.", code: "CATEGORY_REQUIRED" }, 400);
  }

  const { data, error } = await supabase
    .from("report_stop_events")
    .update({ ended_at: endedAt, ...(sentCategory ? { stop_category_id: sentCategory } : {}) })
    .eq("id", params.stopId)
    .eq("report_id", params.id)
    .is("ended_at", null)
    .is("cancelled_at", null)
    .select(STOP_EVENT_SELECTION)
    .maybeSingle();

  if (error) {
    const failure = writeFailure(error);
    return json({ error: failure.error, code: failure.code }, failure.status);
  }
  if (!data) return json({ error: "La parada ya no está activa o el reporte no permite cambios." }, 409);
  return json({ ok: true, stop: data });
};
