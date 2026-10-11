import type { APIRoute } from "astro";
import { isManager } from "../../../../lib/auth";
import { STOP_EVENT_SELECTION } from "../../../../lib/stop-events";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

const reportSelection = `
  id, folio, status, report_date, production_order, lot, shift, product_name, client_name, weight, g_min,
  programmed_hours, units_produced, waste, observations, started_at, ended_at, created_by, creator_full_name,
  creator_role, submitted_at, submitted_by, approved_at, approved_by, approver_full_name,
  cancellation_reason, cancelled_at, cancelled_by, created_at, updated_at,
  machine:machines(id, code, name)
`;

/**
 * Detalle + historial cronológico de un reporte (T063; lo usará la Phase 9).
 * Managers y VIEWER: reporte, paradas, cambios y auditoría (ascendente), en cualquier estado.
 * OPERATOR autor: reporte, paradas y cambios; nunca la auditoría (FR-029).
 */
export const GET: APIRoute = async ({ request, cookies, locals, params }) => {
  const auth = locals.auth;
  if (!auth) return respond({ error: "Debes iniciar sesión." }, 401);
  const role = auth.profile.role;
  const privileged = isManager(auth) || role === "VIEWER";
  if (!privileged && role !== "OPERATOR") return respond({ error: "No tienes permisos para ver este reporte." }, 403);
  const id = params.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return respond({ error: "Reporte no encontrado." }, 404);

  const supabase = createSupabaseServerClient(request, cookies);
  const { data: report, error: reportError } = await supabase
    .from("production_reports").select(reportSelection).eq("id", id).maybeSingle();
  if (reportError) return respond({ error: "No fue posible consultar el reporte." }, 500);
  if (!report) return respond({ error: "Reporte no encontrado." }, 404);
  if (!privileged && (report as { created_by?: string }).created_by !== auth.user.id) {
    return respond({ error: "No tienes permisos para ver este reporte." }, 403);
  }

  const [stopsResult, changesResult, auditResult] = await Promise.all([
    supabase.from("report_stop_events").select(STOP_EVENT_SELECTION).eq("report_id", id).order("started_at"),
    supabase.from("report_change_events")
      .select("id, description, occurred_at, received_at, captured_offline, created_by, change_type:change_types(id, code, name)")
      .eq("report_id", id).order("occurred_at"),
    privileged
      ? supabase.from("report_audit_log")
        .select("id, changed_at, changed_by, field_name, old_value, new_value, entity_type, entity_id, action, actor_role, reason, captured_offline, captured_at, received_at, user:profiles!report_audit_log_changed_by_fkey(full_name)")
        .eq("report_id", id).order("changed_at", { ascending: true }).order("id", { ascending: true })
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (stopsResult.error || changesResult.error || auditResult.error) {
    return respond({ error: "No fue posible consultar el historial del reporte." }, 500);
  }

  const body: Record<string, unknown> = {
    report,
    stops: stopsResult.data ?? [],
    changes: changesResult.data ?? [],
  };
  if (privileged) body.audit = auditResult.data ?? [];
  return respond(body);
};
