import type { APIRoute } from "astro";
import { isManager } from "../../../../lib/auth";
import { json } from "../../../../lib/http";
import { isUuid, reportRpcFailure } from "../../../../lib/report-rpc";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

/**
 * Revisión de un elemento de la cuarentena de sincronización (solo managers, T076).
 * JSON `{ apply?: boolean, reason?: string }`: sin `apply` solo se marca revisado; con `apply: true` se aplican los
 * datos al reporte vía correct_report (motivo de al menos 5 caracteres; solo reportes enviados o cerrados).
 */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth) return json({ error: "Debes iniciar sesión." }, 401);
  if (!isManager(auth)) return json({ error: "No tienes permiso para revisar datos de sincronización." }, 403);
  if (!isUuid(params.id)) return json({ error: "Elemento no válido." }, 400);

  const body = await request.json().catch(() => null);
  const apply = body?.apply === true;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (apply && reason.length < 5) {
    return json({ error: "El motivo para aplicar los datos debe tener al menos 5 caracteres.", code: "INVALID" }, 400);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("review_quarantine", {
    p_item_id: params.id,
    p_apply: apply,
    p_reason: reason || null,
  });
  if (error) {
    const failure = reportRpcFailure(error);
    return json({ error: failure.error, code: failure.code }, failure.status);
  }
  return json({ ok: true, result: data });
};
