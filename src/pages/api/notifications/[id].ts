import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { hasAllowedMutationOrigin, isUuid } from "../../../lib/notifications";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  if (!locals.auth) return json({ error: "Debes iniciar sesión." }, 401);
  if (!hasAllowedMutationOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  if (!isUuid(params.id)) return json({ error: "Notificación inválida." }, 400);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400); }
  if (!body || typeof body !== "object" || (body as { read?: unknown }).read !== true) {
    return json({ error: "Solo se permite marcar como leída." }, 400);
  }
  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("mark_notification_read", { p_id: params.id });
  if (error) return json({ error: "No fue posible marcar la notificación." }, 500);
  if (!data) return json({ error: "Notificación no encontrada." }, 404);
  return json({ ok: true });
};
