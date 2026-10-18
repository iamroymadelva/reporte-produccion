import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { json } from "../../../../lib/http";
import { isUuid, writeFailure } from "../../../../lib/report-rpc";

/**
 * Registra un cambio del reporte (T075). JSON `{ id?, change_type_id, description, occurred_at? }`:
 * `id` lo genera el cliente (idempotente) y `occurred_at` es la hora del dispositivo.
 */
const CHANGE_SELECTION = "id, report_id, change_type_id, description, occurred_at, captured_offline, created_at";
// `clock_skew_review` es solo para ROOT y no se devuelve en esta ruta (es del Operario).

export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR" || !params.id) {
    return json({ error: "Solo el Operario responsable puede registrar cambios." }, 403);
  }

  const body = await request.json().catch(() => null);
  const changeTypeId = typeof body?.change_type_id === "string" ? body.change_type_id.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!isUuid(changeTypeId)) return json({ error: "Selecciona un tipo de cambio.", code: "VALIDATION" }, 400);
  if (!description || description.length > 500) {
    return json({ error: "Describe el cambio (hasta 500 caracteres).", code: "VALIDATION" }, 400);
  }
  if (body?.id !== undefined && !isUuid(body.id)) return json({ error: "El identificador del cambio no es válido.", code: "VALIDATION" }, 400);
  const occurredAt = typeof body?.occurred_at === "string" && !Number.isNaN(Date.parse(body.occurred_at))
    ? new Date(body.occurred_at).toISOString()
    : new Date().toISOString();

  const supabase = createSupabaseServerClient(request, cookies);

  if (body?.id) {
    const { data: existing } = await supabase
      .from("report_change_events")
      .select(CHANGE_SELECTION)
      .eq("id", body.id).eq("report_id", params.id).maybeSingle();
    if (existing) return json({ ok: true, duplicate: true, change: existing });
  }

  const { data, error } = await supabase
    .from("report_change_events")
    .insert({
      ...(body?.id ? { id: body.id } : {}),
      report_id: params.id,
      change_type_id: changeTypeId,
      description,
      occurred_at: occurredAt,
      created_by: auth.user.id,
    })
    .select(CHANGE_SELECTION)
    .single();

  if (error) {
    const failure = writeFailure(error);
    return json({ error: failure.error, code: failure.code }, failure.status);
  }
  return json({ ok: true, change: data }, 201);
};
