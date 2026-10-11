import type { APIRoute } from "astro";
import { isManagerRole } from "../../../lib/auth";
import { getBogotaDateKey } from "../../../lib/format";
import { json } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/**
 * GET /api/dashboard/summary (T100, contracts/http-api.md F5): KPI por estado del rango, máquinas en parada, reportes abiertos
 * fuera de turno, conflictos abiertos y operarios activos (para la presencia). Solo managers y VIEWER (OPERATOR → 403,
 * sin sesión → 401); todo se consulta con la sesión del usuario, así que la RLS sigue siendo la que decide qué ve.
 * Query: `from`, `to` (fecha operativa AAAA-MM-DD; por defecto hoy). Sin cache (`private, no-store`).
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RECENT_LIMIT = 10;
const LIST_LIMIT = 50;
/** Rango máximo (días, inclusive) para que el tablero no pueda pedir años de datos. */
const MAX_RANGE_DAYS = 366;

function noStore(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

const isRealDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().startsWith(value);

export const GET: APIRoute = async ({ request, cookies, locals, url }) => {
  const auth = locals.auth;
  if (!auth) return noStore({ error: "Debes iniciar sesión." }, 401);
  const role = auth.profile.role;
  if (!isManagerRole(role) && role !== "VIEWER") return noStore({ error: "El tablero en vivo es solo para coordinadores y auditores." }, 403);

  const today = getBogotaDateKey();
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || from;
  if (!isRealDate(from) || !isRealDate(to) || from > to) {
    return noStore({ error: "El rango de fechas no es válido: usa AAAA-MM-DD y que la fecha inicial no sea posterior a la final." }, 422);
  }
  const days = (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) {
    return noStore({ error: `El rango de fechas es demasiado amplio: el máximo es de ${MAX_RANGE_DAYS} días.` }, 422);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const count = (status: string) => supabase.from("production_reports").select("id", { count: "exact", head: true })
    .gte("report_date", from).lte("report_date", to).eq("status", status);
  const [recent, draft, submitted, closed, cancelled, activeStopCount, offShiftCount, stopped, offShift, conflicts, operators] = await Promise.all([
    supabase.from("production_report_overview")
      .select("id, folio, report_date, production_order, status, creator_full_name, created_at, approver_full_name, approved_at, is_off_shift, machine:machines(id, code, name), report_stop_events(id, ended_at, cancelled_at)")
      .gte("report_date", from).lte("report_date", to)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(RECENT_LIMIT),
    count("DRAFT"), count("SUBMITTED"), count("CLOSED"), count("CANCELLED"),
    supabase.from("production_reports").select("id, active_stops:report_stop_events!inner(id, ended_at, cancelled_at)", { count: "exact", head: true })
      .gte("report_date", from).lte("report_date", to).is("active_stops.ended_at", null).is("active_stops.cancelled_at", null),
    supabase.from("production_report_overview").select("id", { count: "exact", head: true }).eq("status", "DRAFT").eq("is_off_shift", true),
    // Máquinas detenidas AHORA (sin importar el rango).
    supabase.from("production_report_overview")
      .select("id, folio, creator_full_name, machine:machines(id, code, name), report_stop_events!inner(id, started_at, ended_at, cancelled_at)")
      .is("report_stop_events.ended_at", null).is("report_stop_events.cancelled_at", null).limit(LIST_LIMIT),
    supabase.from("production_report_overview")
      .select("id, folio, creator_full_name, created_at, machine:machines(id, code, name)")
      .eq("status", "DRAFT").eq("is_off_shift", true).order("created_at", { ascending: false }).limit(LIST_LIMIT),
    supabase.from("sync_quarantine").select("id", { count: "exact", head: true }).eq("status", "OPEN"),
    supabase.from("profiles").select("id, full_name").eq("role", "OPERATOR").eq("active", true).order("full_name").limit(500),
  ]);

  const failure = [recent, draft, submitted, closed, cancelled, activeStopCount, offShiftCount, stopped, offShift, conflicts, operators].find((result) => result.error);
  if (failure) {
    console.error("dashboard summary failed", failure.error);
    return noStore({ error: "No fue posible cargar el resumen del tablero." }, 500);
  }

  const rows = (list: unknown) => (Array.isArray(list) ? list : []) as Array<Record<string, any>>;
  return noStore({
    range: { from, to },
    kpis: {
      DRAFT: draft.count ?? 0, SUBMITTED: submitted.count ?? 0, CLOSED: closed.count ?? 0, CANCELLED: cancelled.count ?? 0,
      ACTIVE_STOP: activeStopCount.count ?? 0, OFF_SHIFT: offShiftCount.count ?? 0, OPEN_CONFLICTS: conflicts.count ?? 0,
    },
    machinesStopped: rows(stopped.data).map((row) => ({
      reportId: row.id, folio: row.folio ?? null, machine: row.machine ?? null, operator: row.creator_full_name ?? null,
      since: rows(row.report_stop_events)[0]?.started_at ?? null,
    })),
    offShiftReports: rows(offShift.data).map((row) => ({
      reportId: row.id, folio: row.folio ?? null, machine: row.machine ?? null, operator: row.creator_full_name ?? null, createdAt: row.created_at,
    })),
    recent: rows(recent.data).map((row) => ({
      id: row.id, folio: row.folio ?? null, status: row.status, createdAt: row.created_at, machine: row.machine ?? null,
      operator: row.creator_full_name ?? null, productionOrder: row.production_order ?? null, approver: row.approver_full_name ?? null,
      approvedAt: row.approved_at ?? null, isOffShift: Boolean(row.is_off_shift),
      activeStop: rows(row.report_stop_events).some((stop) => !stop.ended_at && !stop.cancelled_at),
    })),
    operators: rows(operators.data).map((row) => ({ id: row.id, fullName: row.full_name })),
    serverTime: new Date().toISOString(),
  });
};
