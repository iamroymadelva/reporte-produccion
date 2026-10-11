import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { json } from "../../../../../lib/http";
import { isUuid, writeFailure } from "../../../../../lib/report-rpc";
import { STOP_EVENT_SELECTION } from "../../../../../lib/stop-events";

/**
 * Inicia una parada (T075). JSON `{ id?, stop_category_id?, description?, started_at? }`:
 * `id` lo genera el cliente (idempotente), `started_at` es la hora del dispositivo y la categoría es opcional al
 * iniciar (se exige al cerrar).
 */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR" || !params.id) {
    return json({ error: "No autorizado para iniciar paradas." }, 403);
  }

  const body = await request.json().catch(() => null);
  const categoryId = typeof body?.stop_category_id === "string" ? body.stop_category_id.trim() : "";
  if (categoryId && !isUuid(categoryId)) return json({ error: "Selecciona una categoría de parada válida.", code: "VALIDATION" }, 400);
  if (body?.id !== undefined && !isUuid(body.id)) return json({ error: "El identificador de la parada no es válido.", code: "VALIDATION" }, 400);
  // Hora del dispositivo: si no llega una fecha válida se usa la hora de la solicitud.
  const startedAt = typeof body?.started_at === "string" && !Number.isNaN(Date.parse(body.started_at))
    ? new Date(body.started_at).toISOString()
    : new Date().toISOString();
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;

  const supabase = createSupabaseServerClient(request, cookies);

  if (body?.id) {
    const { data: existing } = await supabase
      .from("report_stop_events")
      .select(STOP_EVENT_SELECTION)
      .eq("id", body.id).eq("report_id", params.id).maybeSingle();
    if (existing) return json({ ok: true, duplicate: true, stop: existing });
  }

  const { data, error } = await supabase
    .from("report_stop_events")
    .insert({
      ...(body?.id ? { id: body.id } : {}),
      report_id: params.id,
      stop_category_id: categoryId || null,
      description,
      started_at: startedAt,
      responsible_user_id: auth.user.id,
    })
    .select(STOP_EVENT_SELECTION)
    .single();

  if (error) {
    const failure = writeFailure(error);
    return json({ error: failure.error, code: failure.code }, failure.status);
  }
  return json({ ok: true, stop: data }, 201);
};
