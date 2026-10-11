/**
 * Smoke end-to-end de la Phase 7b (sin navegador real): ejecuta el cliente de sincronización REAL (outbox,
 * acciones, sync-client) sobre happy-dom + fake-indexeddb contra un servidor de desarrollo LOCAL ya iniciado.
 *
 *   BASE=http://localhost:4399 JAR=<cookie-jar de curl> SERVICE_KEY=<clave de servicio local> bun scripts/smoke-offline-e2e.ts
 *
 * Encola offline CREATE_REPORT + 2 paradas + 1 cambio + campos + SUBMIT, confirma la subida, reenvía todo
 * (duplicate) y verifica el contenido de la BD local por PostgREST (origen offline, horas del dispositivo, sin duplicados).
 */
import { readFileSync } from "node:fs";
import { installBrowser, freshIndexedDb } from "../tests/helpers/offline-env";

const BASE = process.env.BASE ?? "http://localhost:4399";
const JAR = process.env.JAR!;
const SERVICE_KEY = process.env.SERVICE_KEY!;
const REST = process.env.REST ?? "http://127.0.0.1:54321/rest/v1";
if (!JAR || !SERVICE_KEY) throw new Error("Faltan JAR y SERVICE_KEY");

const cookie = readFileSync(JAR, "utf8").split("\n")
  .map((line) => line.replace(/^#HttpOnly_/, ""))
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("\t"))
  .filter((parts) => parts.length >= 7)
  .map((parts) => `${parts[5]}=${parts[6]}`).join("; ");

const browser = installBrowser(`${BASE}/turno`);
freshIndexedDb();
const realFetch = globalThis.fetch;
const calls: Array<{ url: string; method: string; status?: number }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  const absolute = url.startsWith("/") ? BASE + url : url;
  const response = await realFetch(absolute, { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: cookie, Origin: BASE } });
  calls.push({ url, method: (init.method ?? "GET").toUpperCase(), status: response.status });
  return response;
}) as typeof fetch;

const { fetchSnapshot, reconcileEntities } = await import("../src/lib/offline/snapshot");
const actions = await import("../src/lib/offline/actions");
const outbox = await import("../src/lib/offline/outbox");
const sync = await import("../src/lib/offline/sync-client");
const { assignmentsForNow } = await import("../src/lib/shifts");
const { checkApplicationReachability } = await import("../src/lib/connectivity");

const failures: string[] = [];
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(label);
};
const rest = async (path: string) => {
  const response = await realFetch(`${REST}/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  return response.json() as Promise<any[]>;
};

check("health HEAD 204", await checkApplicationReachability({ force: true }));
const fetched = await fetchSnapshot();
if (fetched.status !== "ok") throw new Error(`snapshot: ${fetched.status}`);
const snapshot = fetched.snapshot;
await reconcileEntities(snapshot.userId, snapshot);
const userId = snapshot.userId;
console.log(`usuario ${snapshot.profile.full_name} (${userId}); turnos=${snapshot.shifts.length}`);

const nowMs = Date.now();
const at = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000);
const ctx = (minutesAgo: number) => ({ userId, snapshot, now: at(minutesAgo), offline: true });
const machine = assignmentsForNow(snapshot.assignments, snapshot.shifts, at(50)).assignments[0];
if (!machine) throw new Error("op1 no tiene asignación vigente para el turno actual");

// 1) Captura "sin conexión": solo IndexedDB, ninguna escritura de red.
calls.length = 0;
const created = await actions.startReport(ctx(50), machine.machine_id);
if (!created.ok) throw new Error(created.message);
const reportId = created.reportId!;
const category = snapshot.catalogs.stopCategories[0];
const changeType = snapshot.catalogs.changeTypes[0];
const stopIds: string[] = [];
for (const [startAgo, endAgo] of [[45, 40], [35, 30]]) {
  const stop = await actions.startStop(ctx(startAgo), reportId, {});
  if (!stop.ok) throw new Error(stop.message);
  const closed = await actions.closeStop(ctx(endAgo), stop.stopId!, { categoryId: category.id });
  if (!closed.ok) throw new Error(closed.message);
  stopIds.push(stop.stopId!);
}
const change = await actions.addChange(ctx(25), reportId, { changeTypeId: changeType.id, description: "Cambio de formato (smoke)" });
if (!change.ok) throw new Error(change.message);
const c = snapshot.catalogs;
const fields = {
  product_id: c.products[0].id, product_name: c.products[0].name, production_order: "OP-SMOKE", line_id: c.lines[0].id,
  client_id: c.clients[0].id, client_name: c.clients[0].name, lot: "L-SMOKE", weight: 250, g_min: 40,
  dosifier_type_id: c.dosifierTypes[0].id, started_at: at(55).toISOString(), ended_at: at(5).toISOString(),
  programmed_hours: 8, units_produced: 1200, waste: 3,
};
await actions.saveReportFields(ctx(20), reportId, { lot: "borrador" });
const saved = await actions.saveReportFields(ctx(19), reportId, fields);
if (!saved.ok) throw new Error(saved.message);
const submitted = await actions.submitReport(ctx(10), reportId);
if (!submitted.ok) throw new Error(submitted.message);

const queued = await outbox.listOperations(userId);
check("ops en cola (CREATE, 2x START+CLOSE, ADD_CHANGE, 1 SAVE fundido, SUBMIT) = 8", queued.length === 8, queued.map((o) => o.type));
check("seq 1..8 consecutivos", queued.every((o, i) => o.seq === i + 1));
check("sin escrituras de red antes de confirmar", calls.filter((x) => x.method !== "GET" && x.method !== "HEAD").length === 0, calls);
const wire = queued.map((operation) => outbox.buildWireOperation(operation));

// 2) Confirmar y subir.
const outcome = await sync.confirmAndUpload(userId);
console.log("outcome", outcome);
check("subida completa, 8 aplicadas", outcome.status === "complete" && outcome.applied === 8 && outcome.rejected === 0 && outcome.conflicts === 0, outcome);
check("lote enviado a /api/sync/batch", calls.some((x) => x.url === "/api/sync/batch" && x.status === 200), calls.filter((x) => x.url === "/api/sync/batch"));
check("device-status enviado tras la subida", calls.some((x) => x.url === "/api/device-status"));

// 3) Reenviar lo mismo → duplicate.
const resend = await realFetch(`${BASE}/api/sync/batch`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: JSON.stringify({ operations: wire }),
});
const resendBody = await resend.json() as { results: Array<{ status: string }> };
check("reenvío: 8 duplicate", resend.status === 200 && resendBody.results.length === 8 && resendBody.results.every((r) => r.status === "duplicate"), resendBody.results.map((r) => r.status));

// 4) Verificar la BD.
const [report] = await rest(`production_reports?id=eq.${reportId}&select=id,folio,status,origin,started_at,lot,units_produced,created_by`);
check("reporte único en la BD, SUBMITTED, origin offline, con folio", Boolean(report) && report.status === "SUBMITTED" && report.origin === "offline" && Boolean(report.folio), report);
check("campos guardados", report?.lot === "L-SMOKE" && report?.units_produced === 1200);
const stops = await rest(`report_stop_events?report_id=eq.${reportId}&select=id,started_at,ended_at,captured_offline,stop_category_id&order=started_at`);
check("2 paradas sin duplicados, captured_offline", stops.length === 2 && stops.every((s) => s.captured_offline === true), stops.length);
check("horas del dispositivo de las paradas", stops.length === 2
  && Date.parse(stops[0].started_at) === at(45).getTime() && Date.parse(stops[0].ended_at) === at(40).getTime()
  && Date.parse(stops[1].started_at) === at(35).getTime() && Date.parse(stops[1].ended_at) === at(30).getTime(),
  stops.map((s) => [s.started_at, s.ended_at]));
const changes = await rest(`report_change_events?report_id=eq.${reportId}&select=id,occurred_at,captured_offline`);
check("1 cambio, hora del dispositivo, captured_offline", changes.length === 1 && changes[0].captured_offline === true && Date.parse(changes[0].occurred_at) === at(25).getTime(), changes);
const all = await rest(`production_reports?id=eq.${reportId}&select=id`);
check("sin reportes duplicados", all.length === 1);
check("outbox local vacía tras subir", (await outbox.listOperations(userId)).length === 0);
void browser;
console.log(failures.length ? `\nSMOKE FALLÓ: ${failures.join("; ")}` : "\nSMOKE OK");
process.exit(failures.length ? 1 : 0);
