/**
 * Smoke de la Phase 8 (sin navegador real): ejecuta el código REAL de acceso sin conexión (offline-auth, login-flow,
 * bootstrap, snapshot, sync-client, overview) sobre happy-dom + fake-indexeddb contra un servidor de desarrollo LOCAL ya
 * iniciado con Supabase local. "Sin conexión" se simula haciendo que el fetch del dispositivo falle.
 *
 *   BASE=http://127.0.0.1:4399 SERVICE_KEY=<clave de servicio local> bun scripts/smoke-phase8.ts
 */
import { installBrowser, freshIndexedDb } from "../tests/helpers/offline-env";

const BASE = process.env.BASE ?? "http://127.0.0.1:4399";
const SERVICE_KEY = process.env.SERVICE_KEY!;
const REST = process.env.REST ?? "http://127.0.0.1:54321/rest/v1";
if (!SERVICE_KEY) throw new Error("Falta SERVICE_KEY");
const PASSWORD = "Planta2026!";

const browser = installBrowser(`${BASE}/iniciar-sesion`);
freshIndexedDb();
const realFetch = globalThis.fetch;
let networkDown = false;
let browserOnline = true;
Object.defineProperty(browser.navigator, "onLine", { configurable: true, get: () => browserOnline });
/** Simula modo avión: el fetch del dispositivo falla y el navegador también sabe que no hay red. */
function setNetwork(down: boolean) { networkDown = down; browserOnline = !down; }
let jar = new Map<string, string>();
const calls: Array<{ url: string; method: string; status?: number }> = [];

function storeCookies(response: Response) {
  for (const line of (response.headers as any).getSetCookie?.() ?? []) {
    const [pair, ...attrs] = String(line).split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    const expired = attrs.some((attr) => /max-age=0/i.test(attr)) || value === "";
    if (expired) jar.delete(name); else jar.set(name, value);
  }
}
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (networkDown) { calls.push({ url, method: (init.method ?? "GET").toUpperCase(), status: -1 }); throw new TypeError("Failed to fetch (simulado sin conexión)"); }
  const absolute = url.startsWith("/") ? BASE + url : url;
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await realFetch(absolute, { ...init, redirect: init.redirect ?? "manual", headers: { ...(init.headers as Record<string, string>), ...(cookie ? { Cookie: cookie } : {}), Origin: BASE } });
  storeCookies(response);
  calls.push({ url, method: (init.method ?? "GET").toUpperCase(), status: response.status });
  return response;
}) as typeof fetch;

const auth = await import("../src/lib/offline/offline-auth");
const flow = await import("../src/lib/offline/login-flow");
const boot = await import("../src/lib/offline/bootstrap");
const snapshotLib = await import("../src/lib/offline/snapshot");
const overviewLib = await import("../src/lib/offline/overview");
const actions = await import("../src/lib/offline/actions");
const outbox = await import("../src/lib/offline/outbox");
const sync = await import("../src/lib/offline/sync-client");
const { assignmentsForNow } = await import("../src/lib/shifts");

const failures: string[] = [];
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(label);
};
const rest = async (path: string, init: RequestInit = {}) => {
  const response = await realFetch(`${REST}/${path}`, { ...init, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers as Record<string, string>) } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null } as { status: number; body: any };
};

/** Lo que hace el navegador al iniciar sesión en línea: verificador pendiente → POST del formulario → primera página. */
async function onlineLogin(username: string) {
  jar = new Map();
  const attempt = await flow.prepareLogin(username, PASSWORD);
  if (attempt.kind !== "online") throw new Error(`prepareLogin no detectó conexión: ${JSON.stringify(attempt)}`);
  const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username, password: PASSWORD }).toString() });
  if (response.status !== 303 || response.headers.get("X-Offline-Enroll") !== "1") throw new Error(`login ${username}: ${response.status} ${response.headers.get("location")}`);
  await boot.runOfflineBootstrap({ pathname: "/dashboard", search: "" });
}

// ------------------------------------------------------------------ 1) Matrícula en línea (op1, coord1, auditor1)
const ids: Record<string, string> = {};
for (const username of ["op1", "coord1", "auditor1"]) {
  await onlineLogin(username);
  const record = await auth.getCredentialRecord(username);
  check(`${username}: tras el login en línea queda el verificador habilitado`, Boolean(record) && record!.failedCount === 0 && Date.parse(record!.enabledUntil) > Date.now() + 6.9 * 86_400_000, { role: record?.role, enabledUntil: record?.enabledUntil });
  check(`${username}: el registro no contiene la contraseña`, !JSON.stringify(record).includes(PASSWORD));
  ids[username] = record!.userId;
  if (record!.role === "OPERATOR") {
    snapshotLib.resetCurrentUserCache();
    const current = await snapshotLib.resolveCurrentUser({ force: true });
    check("op1: snapshot de trabajo descargado en línea", current.status === "ok" && current.online);
  } else {
    const fetched = await overviewLib.fetchOverview(record!.userId);
    check(`${username}: consulta descargada y guardada (${record!.role})`, fetched.status === "ok" && Boolean((await overviewLib.loadOverview(record!.userId))?.fetchedAt), fetched.status);
  }
}
check("no queda matrícula pendiente", !(await auth.hasPendingEnrollment()));

// Un login con contraseña errónea no habilita nada y descarta la matrícula al volver con ?error
jar = new Map();
await flow.prepareLogin("op9", "mal");
const bad = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "op9", password: "mal" }).toString() });
check("login con usuario inexistente: 303 a /iniciar-sesion?error", bad.status === 303 && /error=/.test(bad.headers.get("location") ?? ""), bad.headers.get("location"));
check("hay matrícula pendiente antes de volver al login", await auth.hasPendingEnrollment());
await boot.runOfflineBootstrap({ pathname: "/iniciar-sesion", search: "?error=Usuario%20o%20contrase%C3%B1a%20incorrectos" });
check("al volver con ?error se descarta; op9 no queda habilitado", !(await auth.hasPendingEnrollment()) && (await auth.getCredentialRecord("op9")) === null);

// MAJOR-2: una matrícula pendiente con sesión previa (login anterior a su inicio) no se confirma
await onlineLogin("op1");
const staleRecord = await auth.getCredentialRecord("op1");
await auth.beginEnrollment("op1", PASSWORD, await flow.readServerTime());
const pendingNow = await (await import("../src/lib/offline/db")).getMeta<any>("pendingEnrollment");
await (await import("../src/lib/offline/db")).setMeta("pendingEnrollment", { ...pendingNow, serverCreatedAt: new Date(Date.now() + 120_000).toISOString() }); // inicio (hora del servidor) posterior al last_sign_in_at real
await boot.runOfflineBootstrap({ pathname: "/dashboard", search: "" });
check("MAJOR-2: sesión previa (last_sign_in_at anterior) descarta la matrícula y no cambia la anterior", !(await auth.hasPendingEnrollment()) && (await auth.getCredentialRecord("op1"))?.salt === staleRecord?.salt);

// ------------------------------------------------------------------ 2) Sin conexión: coord1 (consulta) y usuario no habilitado
setNetwork(true);
const never = await flow.prepareLogin("op9", PASSWORD);
check("op9 (nunca habilitado) → 'Necesitas conexión para entrar'", never.kind === "offline-failed" && never.message === auth.NEEDS_CONNECTION_MESSAGE, never);
const coordTry = await flow.prepareLogin("coord1", PASSWORD);
check("coord1 sin conexión entra y va a /consulta-offline", coordTry.kind === "offline-ok" && coordTry.path === "/consulta-offline", coordTry);
const coordSession = await auth.getLocalSession();
check("sesión local de coord1 con el rol guardado", coordSession?.userId === ids.coord1 && coordSession?.role === "ADMINISTRATOR");
snapshotLib.resetCurrentUserCache();
const coordAsOperator = await snapshotLib.resolveCurrentUser({ force: true });
check("la sesión de coord1 NO abre /turno del operario", coordAsOperator.status === "forbidden", coordAsOperator.status);
check("coord1 lee su resumen guardado; op1 no tiene el suyo", Boolean(await overviewLib.loadOverview(ids.coord1)) && (await overviewLib.loadOverview(ids.op1)) === null);
await snapshotLib.forgetCurrentUser();
check("cerrar sesión elimina la sesión local", (await auth.getLocalSession()) === null);
snapshotLib.resetCurrentUserCache();
check("sin sesión local nadie opera sin conexión", (await snapshotLib.resolveCurrentUser({ force: true })).status === "no-snapshot");

// ------------------------------------------------------------------ 3) Sin conexión: op1 con contraseña, turno completo
const wrong = await flow.prepareLogin("op1", "otra-clave");
check("op1 con contraseña errónea: mensaje genérico", wrong.kind === "offline-failed" && wrong.message === auth.INVALID_CREDENTIALS_MESSAGE, wrong);
const opTry = await flow.prepareLogin("op1", PASSWORD);
check("op1 sin conexión entra y va a /turno", opTry.kind === "offline-ok" && opTry.path === "/turno", opTry);
snapshotLib.resetCurrentUserCache();
const current = await snapshotLib.resolveCurrentUser({ force: true });
check("resolveCurrentUser sin conexión usa la sesión local de op1", current.status === "ok" && !current.online && current.userId === ids.op1, current.status);
if (current.status !== "ok") throw new Error("sin snapshot de op1");
const snapshot = current.snapshot;
const userId = ids.op1;
const nowMs = Date.now();
const at = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000);
const ctx = (minutesAgo: number) => ({ userId, snapshot, now: at(minutesAgo), offline: true });
const machine = assignmentsForNow(snapshot.assignments, snapshot.shifts, at(50)).assignments[0];
if (!machine) throw new Error("op1 no tiene asignación vigente");
const created = await actions.startReport(ctx(50), machine.machine_id);
if (!created.ok) throw new Error(created.message);
const reportId = created.reportId!;
const category = snapshot.catalogs.stopCategories[0];
const stop = await actions.startStop(ctx(45), reportId, {});
if (!stop.ok) throw new Error(stop.message);
const closed = await actions.closeStop(ctx(40), stop.stopId!, { categoryId: category.id });
if (!closed.ok) throw new Error(closed.message);
const change = await actions.addChange(ctx(25), reportId, { changeTypeId: snapshot.catalogs.changeTypes[0].id, description: "Cambio de formato (smoke F4b)" });
if (!change.ok) throw new Error(change.message);
const c = snapshot.catalogs;
await actions.saveReportFields(ctx(19), reportId, {
  product_id: c.products[0].id, product_name: c.products[0].name, production_order: "OP-F4B", line_id: c.lines[0].id,
  client_id: c.clients[0].id, client_name: c.clients[0].name, lot: "L-F4B", weight: 250, g_min: 40, dosifier_type_id: c.dosifierTypes[0].id,
  started_at: at(55).toISOString(), ended_at: at(5).toISOString(), programmed_hours: 8, units_produced: 900, waste: 2,
});
const submitted = await actions.submitReport(ctx(10), reportId);
if (!submitted.ok) throw new Error(submitted.message);
const queued = await outbox.listOperations(userId);
check("cola de op1: solo el turno (el inicio de sesión no es una operación; deja un marcador)", queued[0]?.type === "CREATE_REPORT" && queued.length === 6 && (await auth.listOfflineLoginMarkers()).length === 2, { ops: queued.map((o) => o.type), markers: (await auth.listOfflineLoginMarkers()).length });

// ------------------------------------------------------------------ 4) Otro usuario del mismo dispositivo
await snapshotLib.forgetCurrentUser(); // op1 cierra sesión (datos conservados)
const coordAgain = await flow.prepareLogin("coord1", PASSWORD);
check("coord1 vuelve a entrar sin conexión en el mismo dispositivo", coordAgain.kind === "offline-ok");
check("coord1 no ve la cola de op1", (await outbox.listOperations(ids.coord1)).length === 0 && (await outbox.listOperations(userId)).length === queued.length);
setNetwork(false);
jar = new Map(); await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "coord1", password: PASSWORD }).toString() });
calls.length = 0;
const stolen = await sync.confirmAndUpload(userId); // sesión en línea de coord1 intentando subir lo de op1
check("coord1 no puede subir lo de op1 (el servidor rechaza) y nada cambia", stolen.status === "forbidden" && (await outbox.pendingCount(userId)) === queued.length, stolen.status);
await snapshotLib.forgetCurrentUser();

// ------------------------------------------------------------------ 5) Reconexión de op1: login en línea obligatorio antes de subir
setNetwork(true);
await flow.prepareLogin("op1", PASSWORD); // segunda sesión sin conexión de op1
setNetwork(false);
jar = new Map(); await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "op1", password: PASSWORD }).toString() }); // cookie válida de op1 (sin matrícula nueva)
calls.length = 0;
await sync.handleReconnection(userId);
check("al reconectar con sesión local se exige login en línea", sync.getSyncState(userId).loginRequired === true, sync.getSyncState(userId).message);
const gated = await sync.confirmAndUpload(userId);
check("confirmAndUpload no sube sin login en línea (ni siquiera con cookie válida)", gated.status === "login-required" && !calls.some((x) => x.url === "/api/sync/batch"), gated.status);
await onlineLogin("op1"); // login en línea con la contraseña tecleada
check("el login en línea retira la sesión local", (await auth.getLocalSession()) === null);
check("la compuerta de login se levanta", (await sync.refreshLoginGate(userId)) === false && sync.getSyncState(userId).loginRequired === false);
const pendingBefore = await outbox.pendingCount(userId);
const outcome = await sync.confirmAndUpload(userId);
check("subida completa tras el login en línea", outcome.status === "complete" && outcome.applied === pendingBefore && outcome.rejected === 0 && outcome.conflicts === 0, outcome);

// ------------------------------------------------------------------ 6) Verificación en la BD
const audit = await rest(`administrative_audit_log?action=eq.OFFLINE_LOGIN&performed_by=eq.${userId}&select=action,performed_by,actor_role,entity_type,entity_id,details&order=performed_at`);
check("administrative_audit_log: 2 filas OFFLINE_LOGIN de op1 (dos inicios de sesión sin conexión)", audit.body.length === 2 && audit.body.every((row: any) => row.actor_role === "OPERATOR" && row.entity_id === userId && row.details?.device_started_at), audit.body.map((row: any) => row.details?.device_started_at));
const other = await rest(`administrative_audit_log?action=eq.OFFLINE_LOGIN&performed_by=neq.${userId}&select=id`);
check("(antes del bootstrap de coord1) ninguna fila de otros usuarios a nombre de op1", other.body.length === 0, other.body.length);
check("los marcadores de op1 se enviaron en su login en línea y ya no quedan", (await auth.listOfflineLoginMarkers()).every((m) => m.userId !== userId));
const [report] = (await rest(`production_reports?id=eq.${reportId}&select=id,folio,status,origin,lot,created_by`)).body;
check("reporte SUBMITTED, origen offline, de op1", report?.status === "SUBMITTED" && report?.origin === "offline" && report?.created_by === userId, report);
const dupes = await rest(`administrative_audit_log?action=eq.OFFLINE_LOGIN&performed_by=eq.${userId}&select=details`);
check("sin doble registro: 2 filas con operation_id distintos", new Set(dupes.body.map((row: any) => row.details.operation_id)).size === 2);
const replay = await outbox.listOperations(userId);
check("outbox de op1 vacía tras subir", replay.length === 0, replay.length);

// Consulta real con datos
const ov = await fetch("/api/offline/overview");
check("op1 (sesión en línea) no puede leer /api/offline/overview", ov.status === 403, ov.status);
jar = new Map(); await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "coord1", password: PASSWORD }).toString() });
await boot.runOfflineBootstrap({ pathname: "/dashboard", search: "" }); // sesión en línea de coord1: envía los marcadores de sus 2 inicios de sesión sin conexión
const auditCoord = await rest(`administrative_audit_log?action=eq.OFFLINE_LOGIN&performed_by=eq.${ids.coord1}&select=actor_role,details`);
check("MAJOR-3: coord1 (ADMINISTRATOR) también audita sus 2 inicios de sesión sin conexión", auditCoord.body.length === 2 && auditCoord.body.every((row: any) => row.actor_role === "ADMINISTRATOR"), auditCoord.body.length);
const ovCoord = await (await fetch("/api/offline/overview")).json() as any;
const found = ovCoord.reports?.find((item: any) => item.id === reportId);
check("coord1 ve el reporte en el resumen con paradas y cambios", Boolean(found) && found.stops_count === 1 && found.changes.length === 1 && found.operator === "Operario Uno" && found.machine?.code, found && { folio: found.folio, stops: found.stops, changes: found.changes, kpis: ovCoord.kpis });

// ------------------------------------------------------------------ 7) Usuario desactivado mientras estaba sin conexión
setNetwork(true);
await flow.prepareLogin("op1", PASSWORD);
snapshotLib.resetCurrentUserCache();
const again = await snapshotLib.resolveCurrentUser({ force: true });
if (again.status !== "ok") throw new Error("op1 sin sesión");
const ctx2 = { userId, snapshot: again.snapshot, now: at(1), offline: true };
const second = await actions.startReport(ctx2, machine.machine_id);
check("op1 trabaja otra vez sin conexión", second.ok);
setNetwork(false);
jar = new Map(); await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: "op1", password: PASSWORD }).toString() });
const deactivate = await rest(`profiles?id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ active: false }), headers: { Prefer: "return=representation" } });
check("(preparación) op1 desactivado en la BD local", deactivate.status === 200 && deactivate.body?.[0]?.active === false, deactivate.status);
const info = await fetch("/api/auth/session-info");
check("session-info real de un usuario inactivo → 403 INACTIVE", info.status === 403 && (await info.json() as any).code === "INACTIVE", info.status);
await sync.handleReconnection(userId);
const state = sync.getSyncState(userId);
check("revalidación: sesión cerrada, aviso mostrado", state.inactive === true && /datos/.test(state.message ?? ""), state.message);
check("la sesión local se cerró y las cookies del servidor también", (await auth.getLocalSession()) === null && ![...jar.keys()].some((name) => name.startsWith("sb-") && jar.get(name)));
check("los pendientes de op1 se conservan", (await outbox.pendingCount(userId)) >= 1, await outbox.pendingCount(userId));
const blocked = await sync.confirmAndUpload(userId);
check("nada se sube sin sesión válida", blocked.status === "unauthorized" || blocked.status === "forbidden", blocked.status);
await rest(`profiles?id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ active: true }) });

console.log(failures.length ? `\nSMOKE FALLÓ: ${failures.join("; ")}` : "\nSMOKE OK");
process.exit(failures.length ? 1 : 0);
