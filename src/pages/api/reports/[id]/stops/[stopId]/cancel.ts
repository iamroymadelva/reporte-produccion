import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { json } from "../../../../../../lib/http";
import { STOP_EVENT_SELECTION } from "../../../../../../lib/stop-events";

export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  if (locals.auth?.profile.role !== "OPERATOR" || !params.id || !params.stopId) {
    return json({ error: "No autorizado para cancelar paradas." }, 403);
  }
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return json({ error: "Debes indicar el motivo de cancelación de la parada." }, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  // The trigger stamps the cancellation actor/time and excludes the duration.
  const { data, error } = await supabase.from("report_stop_events")
    .update({ cancellation_reason: reason })
    .eq("id", params.stopId).eq("report_id", params.id)
    .is("ended_at", null).is("cancelled_at", null)
    .select(STOP_EVENT_SELECTION).maybeSingle();

  if (error) return json({ error: error.message }, 400);
  if (!data) return json({ error: "La parada ya no está activa o el reporte no permite cambios." }, 409);
  return json({ ok: true, stop: data });
};
