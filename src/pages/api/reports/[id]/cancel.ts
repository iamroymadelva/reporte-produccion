import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { json } from "../../../../lib/http";

export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR" || !params.id) {
    return json({ error: "Solo el Operario responsable puede cancelar el reporte." }, 403);
  }

  const body = await request.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim();
  if (!reason) return json({ error: "Debes indicar el motivo de cancelación." }, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase
    .from("production_reports")
    .update({ status: "CANCELLED", cancellation_reason: reason })
    .eq("id", params.id)
    .eq("created_by", auth.user.id)
    .eq("status", "DRAFT")
    .select("id")
    .maybeSingle();

  if (error) return json({ error: error.message }, 400);
  if (!data) return json({ error: "El reporte ya no está disponible para cancelar." }, 409);
  return json({ ok: true });
};
