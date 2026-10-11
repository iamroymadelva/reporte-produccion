import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { hasAllowedMutationOrigin, isTimestamp } from "../../../lib/notifications";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  if (!locals.auth) return json({ error: "Debes iniciar sesión." }, 401);
  if (!hasAllowedMutationOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "Solicitud inválida." }, 400); }
  const before = body && typeof body === "object" ? (body as { before?: unknown }).before : null;
  if (!isTimestamp(before) || Date.parse(before) > Date.now()) return json({ error: "Instantánea inválida." }, 400);
  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("mark_all_notifications_read", { p_before: before });
  if (error) return json({ error: "No fue posible marcar las notificaciones." }, 500);
  return json({ ok: true, markedCount: data });
};
