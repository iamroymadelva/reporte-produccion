import type { APIRoute } from "astro";
import { isManager } from "../../../lib/auth";
import { formatDateTime, getBogotaDateKey } from "../../../lib/format";
import { buildProductionWorkbook } from "../../../lib/report-export";
import { applyReportFilters, parseReportFilters } from "../../../lib/report-filters";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { statusLabels } from "../../../lib/types";

const MAX_STOPS = 10000;
const MAX_HISTORY_ROWS = 50000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const QUERY_CHUNK = 100;
const PAGE_SIZE = 1000;

function spanishResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const auth = locals.auth;
  if (!auth) return spanishResponse("Debes iniciar sesión.", 401);
  if (!isManager(auth) && auth.profile.role !== "VIEWER") {
    return spanishResponse("No tienes permisos para exportar reportes.", 403);
  }

  const url = new URL(request.url);
  const filters = parseReportFilters(url.searchParams);
  if (filters.error) return spanishResponse(filters.error, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  const reportSelect = `
    id, folio, status, production_order, report_date, lot, creator_full_name, shift, g_min, programmed_hours,
    units_produced, waste, weight, observations, product_name, client_name, created_at,
    approver_full_name, approved_at, is_off_shift,
    line:lines(code, name), product:products(code, name), client:clients(code, name),
    shift_catalog:shifts(name, start_time, end_time), machine:machines(code, name),
    dosifier_type:dosifier_types(code, name)
  `;
  const reports: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let reportQuery = supabase.from("production_report_overview")
      .select(reportSelect)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    reportQuery = applyReportFilters(reportQuery, filters);
    const reportResult = await reportQuery;
    if (reportResult.error) return spanishResponse("No fue posible consultar los reportes para exportar.", 500);
    const reportPage = reportResult.data ?? [];
    reports.push(...reportPage);
    if (reportPage.length < PAGE_SIZE) break;
  }
  // Sin resultados: 204 y la interfaz muestra "No hay reportes para los filtros seleccionados".
  if (reports.length === 0) return new Response(null, { status: 204 });

  const reportIds = reports.map((report) => report.id);
  const metrics: any[] = [];
  const stops: any[] = [];
  const changes: any[] = [];
  const history: any[] = [];

  for (const idChunk of chunks(reportIds, QUERY_CHUNK)) {
    const metricsResult = await supabase
      .from("production_report_metrics")
      .select("id, theoretical_units_per_hour, total_downtime_seconds, net_productive_hours, theoretical_target, net_target, theoretical_performance, net_performance")
      .in("id", idChunk);
    if (metricsResult.error) return spanishResponse("No fue posible consultar las métricas de producción.", 500);
    metrics.push(...(metricsResult.data ?? []));

    let from = 0;
    while (true) {
      const stopsResult = await supabase
        .from("report_stop_events")
        .select("id, report_id, stop_category_id, started_at, ended_at, duration_seconds, description, cancelled_at, cancellation_reason, stop_category:stop_categories(id, code, name, numeric_code)")
        .in("report_id", idChunk)
        .order("started_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (stopsResult.error) return spanishResponse("No fue posible consultar el detalle de paradas.", 500);
      const page = stopsResult.data ?? [];
      stops.push(...page);
      if (stops.length > MAX_STOPS) {
        return spanishResponse(`La exportación supera el límite de ${MAX_STOPS} paradas. Selecciona un período más corto.`, 422);
      }
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const changesResult = await supabase
      .from("report_change_events")
      .select("id, report_id, description, occurred_at, captured_offline, change_type:change_types(name)")
      .in("report_id", idChunk)
      .order("occurred_at", { ascending: true });
    if (changesResult.error) return spanishResponse("No fue posible consultar los cambios de los reportes.", 500);
    changes.push(...(changesResult.data ?? []));

    let historyFrom = 0;
    while (true) {
      const historyResult = await supabase
        .from("report_audit_log")
        .select("id, report_id, changed_at, changed_by, field_name, old_value, new_value, entity_type, action, actor_role, reason, captured_offline, captured_at, received_at, user:profiles!report_audit_log_changed_by_fkey(full_name)")
        .in("report_id", idChunk)
        .order("changed_at", { ascending: true })
        .order("id", { ascending: true })
        .range(historyFrom, historyFrom + PAGE_SIZE - 1);
      if (historyResult.error) return spanishResponse("No fue posible consultar el historial de los reportes.", 500);
      const page = historyResult.data ?? [];
      history.push(...page);
      if (history.length > MAX_HISTORY_ROWS) {
        return spanishResponse(`La exportación supera el límite de ${MAX_HISTORY_ROWS} registros de historial. Selecciona un período más corto.`, 422);
      }
      if (page.length < PAGE_SIZE) break;
      historyFrom += PAGE_SIZE;
    }
  }

  if (metrics.length !== reports.length) {
    return spanishResponse("No fue posible obtener todas las métricas de producción.", 500);
  }

  const categoriesResult = await supabase
    .from("stop_categories")
    .select("id, code, name, numeric_code")
    .order("numeric_code", { ascending: true })
    .order("code", { ascending: true });
  if (categoriesResult.error) return spanishResponse("No fue posible consultar las categorías de parada.", 500);

  const filterParts = [filters.periodLabel ?? "Todos los períodos"];
  if (filters.machine && reports[0]?.machine) filterParts.push(`Máquina ${reports[0].machine.code}`);
  if (filters.shift && reports[0]?.shift_catalog?.name) filterParts.push(`Turno ${reports[0].shift_catalog.name}`);
  if (filters.operator && reports[0]?.creator_full_name) filterParts.push(`Operario ${reports[0].creator_full_name}`);
  if (filters.status) filterParts.push(statusLabels[filters.status]);
  if (filters.activeStop) filterParts.push("Parada activa");
  if (filters.offShift) filterParts.push("Abiertos fuera de turno");
  const generatedAt = new Date();

  try {
    const buffer = await buildProductionWorkbook({
      reports,
      metrics,
      stops,
      categories: categoriesResult.data ?? [],
      changes,
      history,
      filterLabel: filterParts.join(" · "),
      generatedLabel: formatDateTime(generatedAt.toISOString()),
    });
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      return spanishResponse("El archivo supera el tamaño permitido. Selecciona un período más corto.", 413);
    }

    const formatFilenameDate = (value: string) => value.split("-").reverse().join("-");
    const generationDate = getBogotaDateKey(generatedAt);
    const filenamePeriod = filters.from && filters.to
      ? filters.from === filters.to
        ? formatFilenameDate(filters.from)
        : `${formatFilenameDate(filters.from)}_AL_${formatFilenameDate(filters.to)}`
      : formatFilenameDate(generationDate);
    const unicodeName = `SEGUIMIENTO DIARIO DE PRODUCCIÓN-${filenamePeriod}.xlsx`;
    const asciiName = `SEGUIMIENTO DIARIO DE PRODUCCION-${filenamePeriod}.xlsx`;
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(unicodeName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return spanishResponse("No fue posible generar el archivo de Excel.", 500);
  }
};
