import type { APIRoute } from "astro";
import { isManager } from "../../../../lib/auth";
import { json } from "../../../../lib/http";
import { reportRpcFailure } from "../../../../lib/report-rpc";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || !params.id) return json({ error: "No autorizado." }, 401);
  if (!isManager(auth)) return json({ error: "Solo un coordinador o administrador raíz puede aprobar reportes." }, 403);

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("approve_report", { p_report_id: params.id });
  if (error) {
    const failure = reportRpcFailure(error);
    return json({ error: failure.error, code: failure.code }, failure.status);
  }
  return json({ ok: true, report: data });
};
