/**
 * Smoke de la Phase 9 (tiempo real) contra un servidor de desarrollo LOCAL y el Realtime REAL de Supabase local
 * (WebSocket verdadero, sin navegador): HTTP por rol (/api/dashboard/summary, páginas con islas) y Realtime con las
 * políticas de `plant-presence` y la RLS de postgres_changes.
 *
 *   BASE=http://127.0.0.1:4399 API=http://127.0.0.1:54321 ANON_KEY=<anon local> SERVICE_KEY=<service local> bun scripts/smoke-phase9.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://127.0.0.1:4399";
const API = process.env.API ?? "http://127.0.0.1:54321";
const ANON = process.env.ANON_KEY!;
const SERVICE = process.env.SERVICE_KEY!;
if (!ANON || !SERVICE) throw new Error("Faltan ANON_KEY y SERVICE_KEY (locales).");
const PASSWORD = "Planta2026!";
const failures: string[] = [];
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(label);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (cond: () => boolean, ms = 12_000) => { const end = Date.now() + ms; while (Date.now() < end && !cond()) await sleep(100); return cond(); };

// ------------------------------------------------------------------ HTTP con cookies por usuario
async function login(username: string) {
  const jar = new Map<string, string>();
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
    body: new URLSearchParams({ username, password: PASSWORD }).toString(),
  });
  for (const line of (response.headers as any).getSetCookie?.() ?? []) {
    const [pair] = String(line).split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    status: response.status,
    get: (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, { redirect: "manual", ...init, headers: { Cookie: cookie(), Origin: BASE, ...(init.headers as Record<string, string>) } }),
  };
}
const sessions: Record<string, Awaited<ReturnType<typeof login>>> = {};
for (const user of ["coord1", "auditor1", "op1", "op2", "root"]) sessions[user] = await login(user);
check("logins HTTP correctos (303)", Object.values(sessions).every((s) => s.status === 303), Object.fromEntries(Object.entries(sessions).map(([k, v]) => [k, v.status])));

const anon = await fetch(`${BASE}/api/dashboard/summary`, { redirect: "manual" });
check("summary sin sesión -> 401", anon.status === 401, anon.status);
for (const user of ["op1", "op2"]) {
  const r = await sessions[user].get("/api/dashboard/summary");
  check(`summary ${user} (OPERATOR) -> 403`, r.status === 403, r.status);
}
for (const user of ["coord1", "auditor1", "root"]) {
  const r = await sessions[user].get("/api/dashboard/summary");
  const body = await r.json().catch(() => null);
  check(`summary ${user} -> 200 sin cache con KPI`, r.status === 200 && r.headers.get("cache-control") === "private, no-store" && typeof body?.kpis?.DRAFT === "number" && Array.isArray(body?.operators), { status: r.status, kpis: body?.kpis, operators: body?.operators?.length });
}
const bad = await sessions.coord1.get("/api/dashboard/summary?from=2026-13-40");
check("summary con rango inválido -> 422", bad.status === 422, bad.status);

for (const user of ["coord1", "auditor1"]) {
  const page = await (await sessions[user].get("/dashboard")).text();
  check(`/dashboard de ${user} incluye la isla en vivo y la presencia`, page.includes("LiveDashboard") && page.includes("PresenceList"), { live: page.includes("LiveDashboard"), presence: page.includes("PresenceList") });
  const list = await (await sessions[user].get("/reportes")).text();
  check(`/reportes de ${user} incluye LiveReportList y el contenedor`, list.includes("LiveReportList") && list.includes('id="report-list-live"'));
}
const opDash = await (await sessions.op1.get("/dashboard")).text();
check("/dashboard del operario NO incluye tablero en vivo ni presencia", !opDash.includes("LiveDashboard") && !opDash.includes("PresenceList"));

// ------------------------------------------------------------------ Realtime real
async function rtClient(username: string): Promise<SupabaseClient> {
  const client = createClient(API, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: `${username}@usuarios.reporte-produccion.invalid`, password: PASSWORD });
  if (error) throw new Error(`${username}: ${error.message}`);
  await client.realtime.setAuth((await client.auth.getSession()).data.session!.access_token);
  return client;
}
const clients: Record<string, SupabaseClient> = {};
for (const user of ["coord1", "auditor1", "op1", "op2", "root"]) clients[user] = await rtClient(user);

function join(client: SupabaseClient, name: string, config: Record<string, unknown>, setup?: (channel: any) => void) {
  return new Promise<{ channel: any; status: string }>((resolve) => {
    const channel = client.channel(name, { config });
    setup?.(channel);
    const timer = setTimeout(() => resolve({ channel, status: "NO_RESPONSE" }), 6000);
    channel.subscribe((status: string) => {
      if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) { clearTimeout(timer); resolve({ channel, status }); }
    });
  });
}
const userIds: Record<string, string> = {};
for (const [name, client] of Object.entries(clients)) userIds[name] = (await client.auth.getUser()).data.user!.id;

// Calentamiento: tras un db:reset el Realtime local reconstruye su conexión a la BD con el primer uso; se une y se sale una vez.
for (const user of ["coord1", "op1"]) {
  const warm = await join(clients[user], "warmup-" + user, user === "op1" ? { private: true } : {}, (channel) => channel.on("postgres_changes", { event: "*", schema: "public", table: "production_reports" }, () => undefined));
  await clients[user].removeChannel(warm.channel);
}
await sleep(3000);

// Presencia: managers y auditor escuchan; operarios publican
const seen: Record<string, any> = {};
const listeners: Record<string, any> = {};
for (const user of ["coord1", "auditor1", "root"]) {
  const joined = await join(clients[user], "plant-presence", { private: true }, (channel) => channel.on("presence", { event: "sync" }, () => { seen[user] = channel.presenceState(); }));
  listeners[user] = joined.channel;
  check(`${user} se une a plant-presence como lector`, joined.status === "SUBSCRIBED", joined.status);
}
const op1Join = await join(clients.op1, "plant-presence", { private: true, presence: { key: userIds.op1 } }, (channel) => channel.on("presence", { event: "sync" }, () => undefined));
check("op1 (OPERATOR) se une al canal privado para publicar", op1Join.status === "SUBSCRIBED", op1Join.status);
const trackResult = await op1Join.channel.track({ userId: userIds.op1, fullName: "Operario Uno", machineId: null, reportId: null, pendingCount: 2, lastSeen: new Date().toISOString() });
check("op1 track -> ok", trackResult === "ok", trackResult);
await sleep(4000);
const flat = (state: any) => Object.values(state ?? {}).flat().map((m: any) => m.userId);
check("coord1 ve a op1 en línea con pendientes", flat(seen.coord1).includes(userIds.op1) && (Object.values(seen.coord1 ?? {}).flat() as any[]).find((m) => m.userId === userIds.op1)?.pendingCount === 2, flat(seen.coord1));
check("auditor1 y root también ven a op1", flat(seen.auditor1).includes(userIds.op1) && flat(seen.root).includes(userIds.op1));

// El auditor y el coordinador NO pueden publicar presencia
const audJoin = await join(clients.auditor1, "plant-presence-write-test", { private: true });
const viewerTrack = await listeners.auditor1.track({ userId: userIds.auditor1, fullName: "Auditor Uno", machineId: null, reportId: null, pendingCount: 0, lastSeen: new Date().toISOString() }).catch((e: unknown) => String(e));
await sleep(1500);
check("auditor1 NO aparece en la presencia aunque intente track", !flat(seen.coord1).includes(userIds.auditor1), { viewerTrack, seen: flat(seen.coord1) });
const coordTrack = await listeners.coord1.track({ userId: userIds.coord1, fullName: "Coordinador Uno", machineId: null, reportId: null, pendingCount: 0, lastSeen: new Date().toISOString() }).catch((e: unknown) => String(e));
await sleep(1500);
check("coord1 NO aparece en la presencia aunque intente track", !flat(seen.coord1).includes(userIds.coord1), { coordTrack });
void audJoin;

// Un operario no puede leer la presencia de los demás
const op2Seen: any = {};
const op2Join = await join(clients.op2, "plant-presence", { private: true, presence: { key: userIds.op2 } }, (channel) => channel.on("presence", { event: "sync" }, () => { Object.assign(op2Seen, channel.presenceState()); }));
await op2Join.channel.track({ userId: userIds.op2, fullName: "Operario Dos", machineId: null, reportId: null, pendingCount: 0, lastSeen: new Date().toISOString() });
await sleep(4000);
check("op2 publica y coord1 lo ve", flat(seen.coord1).includes(userIds.op2), flat(seen.coord1));
check("op2 (OPERATOR) se une (Realtime exige lectura para unirse); RIESGO DOCUMENTADO: la sesión de un operario podría leer quién está en línea, nunca reportes", op2Join.status === "SUBSCRIBED", { status: op2Join.status, seesOthers: flat(op2Seen) });

// Un tema no autorizado se rechaza para todos
const other = await join(clients.coord1, "otro-canal-privado", { private: true });
check("canal privado no autorizado -> no se une", other.status !== "SUBSCRIBED", other.status);

// postgres_changes: SC-005 (< 10 s) y RLS
const events: Record<string, Array<{ at: number; table: string; type: string }>> = {};
const subs: any[] = [];
for (const user of ["coord1", "auditor1", "op1", "op2"]) {
  events[user] = [];
  const joined = await join(clients[user], `pg-${user}`, {}, (channel) => {
    for (const table of ["production_reports", "report_stop_events", "report_audit_log"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload: any) => events[user].push({ at: Date.now(), table, type: payload.eventType }));
    }
  });
  subs.push(joined.channel);
  check(`${user}: postgres_changes SUBSCRIBED`, joined.status === "SUBSCRIBED", joined.status);
}
const machines = await (await fetch(`${API}/rest/v1/machines?select=id,code&order=code&limit=1`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })).json();
await sleep(3000); // las suscripciones de postgres_changes tardan un instante en quedar activas en el servidor
const startedAt = Date.now();
const created = await sessions.op1.get("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machine_id: machines[0].id, started_at: new Date().toISOString() }) });
const createdBody = await created.json().catch(() => null);
check("op1 crea un reporte (201)", created.status === 201 || created.status === 200, { status: created.status, body: createdBody?.error ?? createdBody?.report?.id });
const reportId = createdBody?.report?.id ?? createdBody?.id;
await waitFor(() => ["coord1", "auditor1", "op1"].every((u) => events[u].some((e) => e.table === "production_reports")) && ["coord1", "auditor1"].every((u) => events[u].some((e) => e.table === "report_audit_log")));
await sleep(1500);
const first = (user: string, table: string) => events[user].find((e) => e.table === table);
for (const user of ["coord1", "auditor1"]) {
  const e = first(user, "production_reports");
  check(`${user} recibe el INSERT del reporte en < 10 s`, Boolean(e) && e!.at - startedAt < 10_000, e ? `${e.at - startedAt} ms` : "sin evento");
  check(`${user} recibe la auditoría del reporte`, Boolean(first(user, "report_audit_log")));
}
check("op1 recibe su propio reporte", Boolean(first("op1", "production_reports")));
check("op2 NO recibe el reporte de op1 (RLS)", !first("op2", "production_reports") && !first("op2", "report_audit_log"), events.op2);
check("op1 no recibe la auditoría (nunca la ve)", !first("op1", "report_audit_log"), events.op1.map((e) => e.table));

const stopStart = Date.now();
const stop = await sessions.op1.get(`/api/reports/${reportId}/stops`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
check("op1 inicia una parada (201)", stop.status === 201, stop.status);
await waitFor(() => ["coord1", "auditor1"].every((u) => events[u].some((e) => e.table === "report_stop_events" && e.at >= stopStart)));
await sleep(1500);
for (const user of ["coord1", "auditor1"]) {
  const e = events[user].find((x) => x.table === "report_stop_events" && x.at >= stopStart);
  check(`${user} recibe la parada en < 10 s`, Boolean(e) && e!.at - stopStart < 10_000, e ? `${e.at - stopStart} ms` : "sin evento");
}
check("op2 NO recibe la parada de op1", !events.op2.some((e) => e.table === "report_stop_events"));

// Con el evento, el resumen del servidor ya refleja la parada
const summary = await (await sessions.coord1.get("/api/dashboard/summary")).json();
check("summary refleja la máquina en parada y el reporte activo", summary.machinesStopped.some((m: any) => m.reportId === reportId) && summary.kpis.DRAFT >= 1 && summary.recent.some((r: any) => r.id === reportId && r.activeStop), { stopped: summary.machinesStopped.length, kpis: summary.kpis });

// Limpieza: desconexión
for (const channel of [...subs, op1Join.channel, op2Join.channel, ...Object.values(listeners)]) await clients.coord1.removeChannel(channel).catch(() => undefined);
for (const client of Object.values(clients)) { await client.removeAllChannels(); client.realtime.disconnect(); }

console.log(failures.length ? `\nSMOKE FAIL (${failures.length}): ${failures.join(" | ")}` : "\nSMOKE OK");
process.exit(failures.length ? 1 : 0);
