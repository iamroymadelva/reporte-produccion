import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { json } from "../../../../lib/http";

export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR" || !params.id) {
    return json({ error: "Solo el Operario responsable puede enviar el reporte." }, 403);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { data: report, error: reportError } = await supabase
    .from("production_reports")
    .select("id, ended_at")
    .eq("id", params.id)
    .eq("created_by", auth.user.id)
    .eq("status", "DRAFT")
    .maybeSingle();

  if (reportError) return json({ error: reportError.message }, 400);
  if (!report) return json({ error: "Reporte en borrador no encontrado." }, 404);
  if (!report.ended_at) return json({ error: "Debes registrar la hora de finalización antes de enviar el reporte." }, 400);

  const { error } = await supabase
    .from("production_reports")
    .update({ status: "SUBMITTED" })
    .eq("id", params.id)
    .eq("created_by", auth.user.id)
    .eq("status", "DRAFT");

  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
};
