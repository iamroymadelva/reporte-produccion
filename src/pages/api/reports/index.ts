import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { json, redirectWithMessage } from "../../../lib/http";
import { isUuid, writeFailure } from "../../../lib/report-rpc";

/**
 * Crea un reporte (T075). Dos formatos:
 *  - JSON `{ id?, machine_id, started_at }` (cliente offline-first): `id` generado en el cliente (idempotente) y
 *    `started_at` con la hora del dispositivo; responde JSON con códigos ACTIVE_REPORT_EXISTS / MACHINE_BUSY /
 *    NO_ASSIGNMENT.
 *  - Formulario `machine_id` (+ `started_at` opcional): flujo actual de la UI, responde con redirección.
 * El servidor fija el turno y la fecha operativa a partir de started_at; origin siempre es online aquí.
 */
function parseStartedAt(value: unknown) {
  return typeof value === "string" && value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR") return json({ error: "Solo un Operario puede crear reportes." }, 403);

  const isJson = (request.headers.get("Content-Type") ?? "").includes("application/json");
  const supabase = createSupabaseServerClient(request, cookies);

  if (isJson) {
    const body = await request.json().catch(() => null);
    const machineId = typeof body?.machine_id === "string" ? body.machine_id : "";
    if (!isUuid(machineId)) return json({ error: "Selecciona una máquina.", code: "VALIDATION" }, 400);
    if (body?.id !== undefined && !isUuid(body.id)) return json({ error: "El identificador del reporte no es válido.", code: "VALIDATION" }, 400);
    const startedAt = parseStartedAt(body?.started_at);

    // Idempotencia por id de cliente: si ya existe y es del mismo operario se devuelve tal cual.
    if (body?.id) {
      const { data: existing } = await supabase
        .from("production_reports")
        .select("id, folio, status, machine_id, updated_at")
        .eq("id", body.id).eq("created_by", auth.user.id).maybeSingle();
      if (existing && existing.machine_id === machineId) return json({ ok: true, duplicate: true, report: existing });
    }

    const { data, error } = await supabase
      .from("production_reports")
      .insert({
        ...(body?.id ? { id: body.id } : {}),
        machine_id: machineId,
        started_at: startedAt,
        created_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .select("id, folio, status, machine_id, shift_id, report_date, started_at, updated_at")
      .single();
    if (error) {
      const failure = writeFailure(error);
      return json({ error: failure.error, code: failure.code }, failure.status);
    }
    return json({ ok: true, report: data }, 201);
  }

  const form = await request.formData();
  const machineId = String(form.get("machine_id") ?? "");
  const startedAt = parseStartedAt(String(form.get("started_at") ?? ""));
  if (!machineId) return redirect(redirectWithMessage("/reportes", "error", "Selecciona una máquina."), 303);

  const { data, error } = await supabase
    .from("production_reports")
    .insert({
      machine_id: machineId,
      started_at: startedAt,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    })
    .select("id")
    .single();

  if (error) {
    const failure = writeFailure(error);
    const message = failure.code === "ACTIVE_REPORT_EXISTS" || failure.code === "MACHINE_BUSY"
      ? "Ya tienes un reporte activo o la máquina ya tiene uno. Solo puede haber un reporte activo por operario y por máquina."
      : failure.error;
    return redirect(redirectWithMessage("/reportes", "error", message), 303);
  }

  return redirect(`/reportes/${data.id}`, 303);
};
