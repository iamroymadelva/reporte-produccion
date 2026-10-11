import type { APIRoute } from "astro";
import { isManagerRole } from "../../../lib/auth";
import { getBogotaDateKey } from "../../../lib/format";
import { json } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/**
 * GET /api/offline/overview (T094, FR-020): resumen de solo lectura para consulta sin conexión de coordinadores,
 * administradores raíz y auditores (VIEWER): KPI del día y los últimos 200 reportes con resumen de paradas y cambios.
 * El OPERATOR recibe 403. Sin secretos y sin cache (`private, no-store`).
 */
const MAX_REPORTS = 200;

function noStore(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

type StopRow = { id: string; started_at: string; ended_at: string | null; cancelled_at: string | null; description: string | null; stop_category?: { name?: string } | null };
type ChangeRow = { id: string; occurred_at: string; description: string | null; change_type?: { name?: string } | null };

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const auth = locals.auth;
  if (!auth) return noStore({ error: "Debes iniciar sesión." }, 401);
  const role = auth.profile.role;
  if (!isManagerRole(role) && role !== "VIEWER") {
    return noStore({ error: "Esta consulta es solo para coordinadores y auditores." }, 403);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const today = getBogotaDateKey();
  const count = (status: string) => supabase.from("production_reports").select("id", { count: "exact", head: true }).eq("report_date", today).eq("status", status);
  const [reports, draft, submitted, closed, cancelled, activeStop, offShift] = await Promise.all([
    supabase.from("production_report_overview")
      .select("id, folio, report_date, production_order, status, creator_full_name, created_at, approver_full_name, approved_at, is_off_shift, machine:machines(id, code, name), report_stop_events(id, started_at, ended_at, cancelled_at, description, stop_category:stop_categories(name)), report_change_events(id, occurred_at, description, change_type:change_types(name))")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(MAX_REPORTS),
    count("DRAFT"), count("SUBMITTED"), count("CLOSED"), count("CANCELLED"),
    supabase.from("production_reports").select("id, active_stops:report_stop_events!inner(id, ended_at)", { count: "exact", head: true })
      .eq("report_date", today).is("active_stops.ended_at", null),
    supabase.from("production_report_overview").select("id", { count: "exact", head: true }).eq("status", "DRAFT").eq("is_off_shift", true),
  ]);

  const failure = [reports, draft, submitted, closed, cancelled, activeStop, offShift].find((result) => result.error);
  if (failure) {
    console.error("offline overview failed", failure.error);
    return noStore({ error: "No fue posible preparar la consulta sin conexión." }, 500);
  }

  const rows = ((reports.data ?? []) as unknown as Array<Record<string, any>>).map((row) => {
    const stops = ((row.report_stop_events ?? []) as StopRow[]).filter((stop) => !stop.cancelled_at);
    const minutes = stops.reduce((total, stop) => total + (stop.ended_at ? Math.max(0, Date.parse(stop.ended_at) - Date.parse(stop.started_at)) / 60_000 : 0), 0);
    return {
      id: row.id, folio: row.folio ?? null, status: row.status, report_date: row.report_date, production_order: row.production_order ?? null,
      machine: row.machine ?? null, operator: row.creator_full_name ?? null, approver: row.approver_full_name ?? null, approved_at: row.approved_at ?? null,
      is_off_shift: Boolean(row.is_off_shift), active_stop: stops.some((stop) => !stop.ended_at), created_at: row.created_at,
      stops_count: stops.length, stops_minutes: Math.round(minutes),
      stops: stops.map((stop) => ({ id: stop.id, started_at: stop.started_at, ended_at: stop.ended_at, cancelled_at: null, category: stop.stop_category?.name ?? null, description: stop.description ?? null })),
      changes: ((row.report_change_events ?? []) as ChangeRow[]).map((change) => ({ id: change.id, occurred_at: change.occurred_at, type: change.change_type?.name ?? null, description: change.description ?? "" })),
    };
  });

  const now = new Date().toISOString();
  return noStore({
    kpis: {
      date: today, DRAFT: draft.count ?? 0, SUBMITTED: submitted.count ?? 0, CLOSED: closed.count ?? 0, CANCELLED: cancelled.count ?? 0,
      ACTIVE_STOP: activeStop.count ?? 0, OFF_SHIFT: offShift.count ?? 0,
    },
    reports: rows,
    serverTime: now,
    fetchedAt: now,
  });
};
