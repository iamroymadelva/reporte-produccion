import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { json } from "../../../../../lib/http";

export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR" || !params.id) {
    return json({ error: "No autorizado para iniciar paradas." }, 403);
  }

  const body = await request.json().catch(() => null);
  const categoryId = typeof body?.stop_category_id === "string" ? body.stop_category_id : "";
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;
  if (!categoryId) return json({ error: "Selecciona una categoría de parada." }, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase
    .from("report_stop_events")
    .insert({
      report_id: params.id,
      stop_category_id: categoryId,
      description,
      responsible_user_id: auth.user.id,
    })
    .select("id, started_at")
    .single();

  if (error) {
    const message = error.code === "23505" || error.code === "23P01"
      ? "Este reporte ya tiene una parada abierta."
      : error.message;
    return json({ error: message }, 400);
  }
  return json({ ok: true, stop: data }, 201);
};
