import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { json } from "../../../../../../lib/http";
import { STOP_EVENT_SELECTION } from "../../../../../../lib/stop-events";

export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR" || !params.id || !params.stopId) {
    return json({ error: "No autorizado para cerrar paradas." }, 403);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase
    .from("report_stop_events")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", params.stopId)
    .eq("report_id", params.id)
    .is("ended_at", null)
    .is("cancelled_at", null)
    .select(STOP_EVENT_SELECTION)
    .maybeSingle();

  if (error) return json({ error: error.message }, 400);
  if (!data) return json({ error: "La parada ya no está activa o el reporte no permite cambios." }, 409);
  return json({ ok: true, stop: data });
};
