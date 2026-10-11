import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { json } from "../../lib/http";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FR-005a: el dispositivo informa cuántos registros pendientes de subir conserva. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  if (!locals.auth) return json({ error: "Debes iniciar sesión." }, 401);

  let body: { deviceId?: unknown; pendingCount?: unknown; oldestPendingAt?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }
  const { deviceId, pendingCount, oldestPendingAt } = body ?? {};
  const oldest = oldestPendingAt == null ? null : String(oldestPendingAt);
  if (
    typeof deviceId !== "string" || !uuidPattern.test(deviceId)
    || typeof pendingCount !== "number" || !Number.isInteger(pendingCount) || pendingCount < 0
    || (oldest !== null && Number.isNaN(Date.parse(oldest)))
  ) {
    return json({ error: "Estado del dispositivo inválido." }, 400);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { error } = await supabase.rpc("report_device_sync_status", {
    p_device_id: deviceId,
    p_pending_count: pendingCount,
    p_oldest_pending_at: oldest,
  });
  if (error) return json({ error: "No fue posible registrar el estado del dispositivo." }, error.code === "42501" ? 403 : 500);
  return new Response(null, { status: 204 });
};
