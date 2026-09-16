import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { json } from "../../../../lib/http";
import { ACTIVE_STOP_SUBMISSION_ERROR, validateReportForSubmission } from "../../../../lib/report-validation";

export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR" || !params.id) {
    return json({ error: "Solo el Operario responsable puede enviar el reporte." }, 403);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { data: report, error: reportError } = await supabase
    .from("production_reports")
    .select("*, report_stop_events(ended_at, cancelled_at)")
    .eq("id", params.id)
    .eq("created_by", auth.user.id)
    .eq("status", "DRAFT")
    .maybeSingle();

  if (reportError) return json({ error: reportError.message }, 400);
  if (!report) return json({ error: "Reporte en borrador no encontrado." }, 404);
  if (report.report_stop_events?.some((stop: { ended_at: string | null }) => !stop.ended_at)) {
    return json({ error: ACTIVE_STOP_SUBMISSION_ERROR }, 409);
  }
  const fieldErrors = validateReportForSubmission(report);
  if (Object.keys(fieldErrors).length > 0) {
    return json({ error: "Completa los campos obligatorios antes de enviar el reporte.", fieldErrors }, 400);
  }

  const { data, error } = await supabase
    .from("production_reports")
    .update({ status: "SUBMITTED" })
    .eq("id", params.id)
    .eq("created_by", auth.user.id)
    .eq("status", "DRAFT")
    .select("id")
    .maybeSingle();

  if (error) return json({ error: error.message }, 400);
  if (!data) return json({ error: "El reporte ya no está disponible para enviar." }, 409);
  return json({ ok: true });
};
