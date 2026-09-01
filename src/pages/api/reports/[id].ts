import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { json } from "../../../lib/http";
import {
  areReportEditableValuesEquivalent,
  normalizeReportEditableUpdates,
} from "../../../lib/report-fields";

const reportStateSelection = `
  id, status, created_by, updated_at,
  report_date, production_order, line_id, client_id, client_name, lot, shift_id,
  product_id, product_name, weight, g_min, dosifier_type_id, started_at, ended_at,
  programmed_hours, units_produced, waste, process_performance,
  operator_performance, observations
`;

export const PATCH: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth || !params.id) return json({ error: "No autorizado." }, 401);
  if (auth.profile.role === "VIEWER") return json({ error: "No autorizado para editar reportes." }, 403);

  const incoming = await request.json().catch(() => null);
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return json({ error: "Datos inválidos." }, 400);
  }

  const hasBaseUpdatedAt = Object.prototype.hasOwnProperty.call(incoming, "_base_updated_at");
  const baseUpdatedAt = (incoming as Record<string, unknown>)._base_updated_at;
  const useOptimisticConcurrency = auth.profile.role === "OPERATOR" && hasBaseUpdatedAt;
  if (useOptimisticConcurrency && (typeof baseUpdatedAt !== "string" || !baseUpdatedAt.trim())) {
    return json({ error: "La versión base del reporte es inválida." }, 400);
  }

  const updates = normalizeReportEditableUpdates(incoming as Record<string, unknown>);

  if (Object.keys(updates).length === 0) return json({ ok: true });

  const supabase = createSupabaseServerClient(request, cookies);

  // Administrative corrections deliberately retain their existing unconditional behavior.
  // Operator clients that do not yet send a base version also remain backward compatible.
  if (!useOptimisticConcurrency) {
    const { data, error } = await supabase
      .from("production_reports")
      .update(updates)
      .eq("id", params.id)
      .select("id, updated_at")
      .single();

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, report: data });
  }

  const { data, error } = await supabase
    .from("production_reports")
    .update(updates)
    .eq("id", params.id)
    .eq("created_by", auth.user.id)
    .eq("status", "DRAFT")
    .eq("updated_at", baseUpdatedAt as string)
    .select("id, updated_at")
    .maybeSingle();

  if (error) return json({ error: error.message }, 400);
  if (data) return json({ ok: true, report: data });

  const { data: current, error: currentError } = await supabase
    .from("production_reports")
    .select(reportStateSelection)
    .eq("id", params.id)
    .maybeSingle();

  if (currentError) return json({ error: currentError.message }, 400);
  if (!current) return json({ error: "Reporte no encontrado." }, 404);
  if (current.created_by !== auth.user.id) {
    return json({ error: "No autorizado para editar este reporte." }, 403);
  }
  if (current.status !== "DRAFT") {
    return json({
      error: "El reporte ya no está disponible para edición.",
      code: "REPORT_NOT_DRAFT",
      report: current,
    }, 409);
  }
  if (areReportEditableValuesEquivalent(current, updates)) {
    return json({ ok: true, alreadyApplied: true, report: current });
  }

  return json({
    error: "El reporte cambió en el servidor. Revisa los cambios antes de continuar.",
    code: "REPORT_CONFLICT",
    report: current,
  }, 409);
};
