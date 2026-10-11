import type { APIRoute } from "astro";
import { isManager } from "../../../../lib/auth";
import { json } from "../../../../lib/http";
import { reportRpcFailure } from "../../../../lib/report-rpc";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

/** Cancela un reporte vía cancel_report: el autor (DRAFT) o un manager si está abierto fuera de turno. */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || !params.id) return json({ error: "No autorizado." }, 401);
  if (auth.profile.role !== "OPERATOR" && !isManager(auth)) {
    return json({ error: "No tienes permiso para cancelar reportes." }, 403);
  }

  const body = await request.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim();
  if (!reason) return json({ error: "Debes indicar el motivo de cancelación." }, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  const { error } = await supabase.rpc("cancel_report", { p_report_id: params.id, p_reason: reason });
  if (error) {
    const failure = reportRpcFailure(error);
    return json({ error: failure.error, code: failure.code }, failure.status);
  }
  return json({ ok: true });
};
