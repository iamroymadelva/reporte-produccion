import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { json } from "../../../../../../lib/http";

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
    .select("id, ended_at, duration_seconds")
    .single();

  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, stop: data });
};
