import type { APIRoute } from "astro";
import { json } from "../../lib/http";
import { isIndicatorsRangeKey, resolveIndicatorsRange } from "../../lib/indicators";
import { createSupabaseServerClient } from "../../lib/supabase/server";

/**
 * GET /api/indicadores?rango=7d|30d|90d (specs/002-indicators-dashboard/contracts/http-api.md): totales, paradas por día,
 * por máquina y por categoría. Solo ROOT, ADMINISTRATOR y VIEWER (otro rol → 403 sin consultar la base; sin sesión → 401).
 * Se consulta con la sesión del usuario (RPC `security invoker`), así que la RLS decide qué ve. Sin cache (`private, no-store`).
 */
const ALLOWED_ROLES = new Set(["ROOT", "ADMINISTRATOR", "VIEWER"]);

function noStore(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET: APIRoute = async ({ request, cookies, locals, url }) => {
  const auth = locals.auth;
  if (!auth) return noStore({ error: "Debes iniciar sesión." }, 401);
  if (!ALLOWED_ROLES.has(auth.profile.role)) return noStore({ error: "Los indicadores son solo para coordinadores y auditores." }, 403);

  const key = url.searchParams.get("rango");
  if (!isIndicatorsRangeKey(key)) return noStore({ error: "El rango no es válido: usa 7d, 30d o 90d." }, 422);

  const range = resolveIndicatorsRange(key);
  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("indicators_summary", { p_from: range.from, p_to: range.to });
  if (error || !data || typeof data !== "object") {
    console.error("indicators summary failed", error);
    return noStore({ error: "No fue posible cargar los indicadores." }, 500);
  }

  const summary = data as Record<string, unknown>;
  return noStore({
    ...summary,
    range: { key: range.key, from: range.from, to: range.to, days: range.days },
    serverTime: new Date().toISOString(),
  });
};
