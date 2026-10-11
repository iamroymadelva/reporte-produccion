import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/**
 * POST /api/offline/login-audit (Phase 8, FR-006c): registra en la auditoría un inicio de sesión SIN conexión hecho en
 * un dispositivo. Cualquier usuario autenticado y activo; el actor es siempre el de la sesión (record_offline_login).
 * Body: { operationId: uuid, startedAt: ISO }. Idempotente: 200 applied | duplicate; 403/422/429 si se rechaza.
 */
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = { FORBIDDEN: 403, VALIDATION: 422, RATE_LIMITED: 429 };

function noStore(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  if (!locals.auth) return noStore({ error: "Debes iniciar sesión." }, 401);
  const body = await request.json().catch(() => null) as { operationId?: unknown; startedAt?: unknown } | null;
  const operationId = typeof body?.operationId === "string" ? body.operationId : "";
  const startedAt = typeof body?.startedAt === "string" ? body.startedAt : "";
  if (!uuidPattern.test(operationId) || Number.isNaN(Date.parse(startedAt))) {
    return noStore({ error: "Faltan operationId o startedAt válidos." }, 400);
  }
  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("record_offline_login", { p_operation_id: operationId, p_started_at: new Date(startedAt).toISOString() });
  if (error || !data || typeof data !== "object") return noStore({ error: "No fue posible registrar el inicio de sesión." }, 500);
  const result = data as { status?: string; code?: string; message?: string };
  if (result.status === "applied" || result.status === "duplicate") return noStore({ status: result.status });
  return noStore({ status: "rejected", code: result.code, error: result.message }, STATUS[result.code ?? ""] ?? 422);
};
