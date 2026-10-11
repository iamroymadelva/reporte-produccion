/**
 * Resumen de solo lectura para la consulta sin conexión de coordinadores, administradores raíz y auditores (T094,
 * FR-020, R10). Se descarga de GET /api/offline/overview, se guarda en IndexedDB (`overview`, clave userId) y NUNCA en
 * Cache Storage. Sin conexión solo lo lee quien tiene una sesión local o en línea con ese mismo userId.
 */
import { idbGet, idbPut } from "./db";

export interface OverviewStop { id: string; started_at: string; ended_at: string | null; cancelled_at: string | null; category: string | null; description: string | null }
export interface OverviewChange { id: string; occurred_at: string; type: string | null; description: string }
export interface OverviewReport {
  id: string;
  folio: string | null;
  status: string;
  report_date: string | null;
  production_order: string | null;
  machine: { id: string; code: string; name: string } | null;
  operator: string | null;
  approver: string | null;
  approved_at: string | null;
  is_off_shift: boolean;
  active_stop: boolean;
  created_at: string;
  stops_count: number;
  stops_minutes: number;
  stops: OverviewStop[];
  changes: OverviewChange[];
}
export interface OverviewKpis {
  date: string; DRAFT: number; SUBMITTED: number; CLOSED: number; CANCELLED: number; ACTIVE_STOP: number; OFF_SHIFT: number;
}
export interface OverviewRecord {
  userId: string;
  fetchedAt: string;
  serverTime: string;
  kpis: OverviewKpis;
  reports: OverviewReport[];
}

export type OverviewFetch =
  | { status: "ok"; overview: OverviewRecord }
  | { status: "unauthorized" }
  | { status: "forbidden"; message: string }
  | { status: "offline" }
  | { status: "error"; message: string };

export async function loadOverview(userId: string): Promise<OverviewRecord | null> {
  return (await idbGet<OverviewRecord>("overview", userId)) ?? null;
}

export async function saveOverview(overview: OverviewRecord) {
  await idbPut("overview", overview);
}

/** GET del resumen y, si responde, lo guarda para el usuario indicado (la respuesta no trae el userId). */
export async function fetchOverview(userId: string): Promise<OverviewFetch> {
  let response: Response;
  try {
    response = await fetch("/api/offline/overview", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    return { status: "offline" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  const body = await response.json().catch(() => null) as Record<string, any> | null;
  if (response.status === 403) return { status: "forbidden", message: body?.error ?? "Esta consulta es solo para coordinadores y auditores." };
  if (!response.ok || !body || !Array.isArray(body.reports) || !body.kpis) {
    return { status: "error", message: body?.error ?? "No fue posible descargar la consulta." };
  }
  const now = new Date().toISOString();
  const overview: OverviewRecord = {
    userId,
    fetchedAt: typeof body.fetchedAt === "string" ? body.fetchedAt : now,
    serverTime: typeof body.serverTime === "string" ? body.serverTime : now,
    kpis: body.kpis,
    reports: body.reports,
  };
  await saveOverview(overview);
  return { status: "ok", overview };
}

const REFRESH_MIN_INTERVAL_MS = 5 * 60_000;
let lastRefresh = 0;
let refreshing: Promise<void> | null = null;

/**
 * Refresco silencioso al visitar el tablero o los reportes en línea (solo GET, como mucho una vez cada 5 minutos).
 * No hace nada para un operario y nunca lanza.
 */
export function refreshOverviewSilently(userId: string, role: string | null | undefined, now: number = Date.now()): Promise<void> {
  if (!userId || !(role === "ROOT" || role === "ADMINISTRATOR" || role === "VIEWER")) return Promise.resolve();
  if (refreshing) return refreshing;
  if (now - lastRefresh < REFRESH_MIN_INTERVAL_MS) return Promise.resolve();
  lastRefresh = now;
  refreshing = fetchOverview(userId).then(() => undefined, () => undefined).finally(() => { refreshing = null; });
  return refreshing;
}

export function resetOverviewRefreshForTests() {
  lastRefresh = 0;
  refreshing = null;
}
