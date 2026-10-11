/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CAT_ASEO, CHANGE_PRODUCTO, COMPLETE_FIELDS, MACHINE_1, SHIFTS, USER_A, USER_B, freshIndexedDb, activate, installBrowser, makeSnapshot } from "./helpers/offline-env";
import { FakeSyncServer } from "./helpers/fake-sync-server";

const browser = installBrowser();
const outbox = await import("../src/lib/offline/outbox");
const actions = await import("../src/lib/offline/actions");
const sync = await import("../src/lib/offline/sync-client");
const { getConnectivitySnapshot } = await import("../src/lib/connectivity");

const snapshot = makeSnapshot(USER_A);
const T0 = new Date(Date.now() - 3 * 3_600_000); // pasado: nunca "futuro" para el servidor simulado
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ctx = (minutes = 0, offline = true) => ({ userId: USER_A, snapshot, now: at(minutes), offline });
let server: FakeSyncServer;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function newServer() {
  return new FakeSyncServer({
    userId: USER_A, shifts: SHIFTS,
    assignments: SHIFTS.map((shift) => ({ machine_id: MACHINE_1, shift_id: shift.id })),
    categoryIds: [CAT_ASEO], changeTypeIds: [CHANGE_PRODUCTO],
  });
}

async function goOffline() { browser.dispatchEvent(new browser.Event("offline")); await wait(5); }
async function goOnline() { browser.dispatchEvent(new browser.Event("online")); await wait(40); }

/** Un reporte con una parada cerrada, un cambio y datos completos, todo pendiente. */
async function queueShift() {
  const created = await actions.startReport(ctx(0), MACHINE_1);
  if (!created.ok) throw new Error(created.message);
  const reportId = created.reportId as string;
  const stop = await actions.startStop(ctx(1), reportId, {});
  await actions.closeStop(ctx(5), (stop as { stopId: string }).stopId, { categoryId: CAT_ASEO });
  await actions.addChange(ctx(6), reportId, { changeTypeId: CHANGE_PRODUCTO, description: "Cambio de formato" });
  await actions.saveReportFields(ctx(7), reportId, COMPLETE_FIELDS);
  await actions.submitReport(ctx(8), reportId);
  return reportId;
}

beforeEach(async () => {
  activate(browser);
  freshIndexedDb();
  sync.resetSyncClientForTests();
  sync.configureSyncClient({ deviceStatusDebounceMs: 30 });
  server = newServer();
  globalThis.fetch = server.fetch as typeof fetch;
  await goOnline();
  expect(getConnectivitySnapshot().state).toBe("online");
});
afterEach(() => { sync.resetSyncClientForTests(); });

describe("Principio III: nada se sube sin confirmar (SC-004)", () => {
  test("con pendientes y reconexión simulada no se llama a /api/sync/batch ni a PATCH hasta confirmar", async () => {
    const stop = sync.startSyncMonitor(USER_A);
    await queueShift();
    await goOffline();
    server.calls.length = 0;
    await goOnline(); // reconexión confirmada por /api/health
    await wait(50);
    expect(server.calls.some((call) => call.url === "/api/health")).toBe(true);
    expect(server.calls.filter((call) => call.url === "/api/sync/batch")).toHaveLength(0);
    expect(server.calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    expect(server.calls.filter((call) => call.method === "POST" && call.url !== "/api/device-status")).toHaveLength(0);
    expect(sync.getSyncState(USER_A).offerOpen).toBe(true);

    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome.status).toBe("complete");
    expect(server.calls.filter((call) => call.url === "/api/sync/batch")).toHaveLength(1);
    stop();
  });

  test("el resumen cuenta por tipo y calcula la antigüedad de lo más viejo", async () => {
    await queueShift();
    const summary = await sync.getPendingSummary(USER_A, new Date(T0.getTime() + 9 * 86_400_000));
    expect(summary.pending).toBe(6);
    expect(summary.counts).toMatchObject({ reportsNew: 1, stopsStarted: 1, stopsClosed: 1, changes: 1, fieldSaves: 1, submits: 1 });
    expect(summary.oldestCapturedAt).toBe(at(0).toISOString());
    expect(summary.hasStale).toBe(true);
    expect((await sync.getPendingSummary(USER_A, at(10))).hasStale).toBe(false);
  });

  test("Posponer conserva todo y se vuelve a ofrecer en la siguiente reconexión", async () => {
    const stop = sync.startSyncMonitor(USER_A);
    await queueShift();
    sync.offerSummary(USER_A);
    expect(sync.getSyncState(USER_A).offerOpen).toBe(true);
    sync.postpone(USER_A);
    expect(sync.getSyncState(USER_A).offerOpen).toBe(false);
    expect((await outbox.listOperations(USER_A)).filter((operation) => operation.state === "pending")).toHaveLength(6);
    expect(server.calls.filter((call) => call.url === "/api/sync/batch")).toHaveLength(0);
    await goOffline();
    await goOnline();
    await wait(50);
    expect(sync.getSyncState(USER_A).offerOpen).toBe(true);
    stop();
  });

  test("las acciones con pendientes no escriben en el servidor (sin autosave) aunque haya conexión", async () => {
    const reportId = await queueShift();
    server.calls.length = 0;
    const result = await actions.saveReportFields(ctx(20, false), reportId, { lot: "otro" }); // submit ya hecho: se rechaza
    expect(result.ok).toBe(false);
    // Un reporte nuevo con pendientes previos: la operación queda en la outbox, sin llamadas de escritura.
    const second = await actions.startReport(ctx(30, false), MACHINE_1);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.priorPending).toBeGreaterThan(0);
      const direct = await sync.sendDirectIfAllowed(USER_A, second.operation, second.priorPending);
      expect(direct.sent).toBe(false);
    }
    expect(server.calls.filter((call) => call.url !== "/api/health")).toHaveLength(0);
  });

  test("sin pendientes y con conexión las acciones van directo a las rutas en línea y no dejan pendientes", async () => {
    const created = await actions.startReport(ctx(0, false), MACHINE_1);
    if (!created.ok) throw new Error(created.message);
    expect(created.priorPending).toBe(0);
    const sent = await sync.sendDirectIfAllowed(USER_A, created.operation, created.priorPending);
    expect(sent.sent).toBe(true);
    expect(server.calls.some((call) => call.method === "POST" && call.url === "/api/reports")).toBe(true);
    expect(server.calls.some((call) => call.url === "/api/sync/batch")).toBe(false);
    expect(server.reports.size).toBe(1);
    expect(server.reports.get(created.reportId as string)?.origin).toBe("online");
    expect((await outbox.listOperations(USER_A)).filter((operation) => operation.state !== "synced")).toHaveLength(0);
    // El folio del servidor se refleja en la copia local.
    expect((await outbox.getEntity(USER_A, "report", created.reportId as string))?.data.folio).toMatch(/^RPT-2026-/);

    const stop = await actions.startStop(ctx(1, false), created.reportId as string, {});
    if (!stop.ok) throw new Error(stop.message);
    await sync.sendDirectIfAllowed(USER_A, stop.operation, stop.priorPending);
    expect(server.stops.size).toBe(1);
  });

  test("si el envío directo falla por la red, la operación queda pendiente (nunca se pierde)", async () => {
    const created = await actions.startReport(ctx(0, false), MACHINE_1);
    if (!created.ok) throw new Error(created.message);
    server.mode.networkDown = true;
    const sent = await sync.sendDirectIfAllowed(USER_A, created.operation, created.priorPending);
    expect(sent.sent).toBe(false);
    const operations = await outbox.listOperations(USER_A);
    expect(operations).toHaveLength(1);
    expect(operations[0].state).toBe("pending");
  });
});

describe("subida (T081)", () => {
  test("sube en orden de seq y deja los datos exactos en el servidor, marcados como offline", async () => {
    const reportId = await queueShift();
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome).toMatchObject({ status: "complete", applied: 6, remaining: 0 });
    expect(server.batches).toHaveLength(1);
    const report = server.reports.get(reportId)!;
    expect(report.status).toBe("SUBMITTED");
    expect(report.origin).toBe("offline");
    expect(report.started_at).toBe(COMPLETE_FIELDS.started_at); // el guardado de campos fija la hora de inicio de producción
    expect([...server.stops.values()][0]).toMatchObject({ started_at: at(1).toISOString(), ended_at: at(5).toISOString(), captured_offline: true });
    expect([...server.changes.values()][0].occurred_at).toBe(at(6).toISOString());
    // Todo sincronizado se purga y el folio del servidor queda en la copia local.
    expect(await outbox.listOperations(USER_A)).toHaveLength(0);
  });

  test("un corte de red tras N resultados deja N synced y el resto pending", async () => {
    await queueShift();
    server.mode.cutAfter = 3;
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome.status).toBe("partial");
    expect(outcome.applied).toBe(3);
    expect(outcome.remaining).toBe(3);
    const operations = await outbox.listOperations(USER_A);
    expect(operations.filter((operation) => operation.state === "synced")).toHaveLength(3);
    const pending = operations.filter((operation) => operation.state === "pending");
    expect(pending).toHaveLength(3);
    expect(pending.every((operation) => operation.seq > 3)).toBe(true);
  });

  test("un reintento reutiliza la operationId y recibe duplicate sin duplicar datos", async () => {
    await queueShift();
    const before = (await outbox.listOperations(USER_A)).map((operation) => operation.operationId);
    // El primer envío llega al servidor pero la respuesta se pierde (resultado incierto).
    const original = server.fetch;
    let drop = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      if (drop && String(input) === "/api/sync/batch") { drop = false; throw new TypeError("Failed to fetch"); }
      return response;
    }) as typeof fetch;
    const first = await sync.confirmAndUpload(USER_A);
    expect(first.status).toBe("network-error");
    expect((await outbox.listOperations(USER_A)).every((operation) => operation.state === "pending")).toBe(true);
    const second = await sync.confirmAndUpload(USER_A);
    expect(second.status).toBe("complete");
    expect(second.duplicates).toBe(6);
    expect(server.batches[1]).toEqual(before);
    expect(server.stops.size).toBe(1);
    expect(server.changes.size).toBe(1);
    expect(server.reports.size).toBe(1);
  });

  test("un 401 conserva todo y pide iniciar sesión", async () => {
    await queueShift();
    server.mode.unauthorized = true;
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome.status).toBe("unauthorized");
    expect(sync.getSyncState(USER_A).authRequired).toBe(true);
    const operations = await outbox.listOperations(USER_A);
    expect(operations).toHaveLength(6);
    expect(operations.every((operation) => operation.state === "pending")).toBe(true);
  });

  test("un 403 conserva todo e informa que el usuario no puede sincronizar", async () => {
    await queueShift();
    server.mode.forbidden = true;
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome.status).toBe("forbidden");
    expect((await outbox.listOperations(USER_A)).filter((operation) => operation.state === "pending")).toHaveLength(6);
  });

  test("rejected y conflict quedan visibles con su mensaje y no se borran; las dependientes reciben DEPENDENCY_FAILED", async () => {
    const reportId = await queueShift();
    // Otro dispositivo del mismo usuario ya tiene un reporte activo: el CREATE se rechaza.
    server.reports.set("99999999-9999-4999-8999-999999999999", { id: "99999999-9999-4999-8999-999999999999", created_by: USER_A, status: "DRAFT", machine_id: "x" });
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome.rejected).toBe(6);
    const operations = await outbox.listOperations(USER_A);
    expect(operations).toHaveLength(6);
    expect(operations.every((operation) => operation.state === "rejected")).toBe(true);
    expect(operations[0].resultCode).toBe("ACTIVE_REPORT_EXISTS");
    expect(operations[0].resultMessage).toContain("reporte activo");
    expect(operations.slice(1).every((operation) => operation.resultCode === "DEPENDENCY_FAILED")).toBe(true);
    // La copia local del reporte queda bloqueada hasta que el usuario lo revise.
    expect((await actions.loadShiftState(USER_A)).report?.blocked).toBeTruthy();
    // Descartar el CREATE rechazado (con confirmación) retira el reporte y sus dependientes locales.
    await outbox.discardOperation(USER_A, operations[0].operationId, { confirmed: true });
    expect(await outbox.listOperations(USER_A)).toHaveLength(0);
    expect(await outbox.getEntity(USER_A, "report", reportId)).toBeNull();
  });

  test("nunca se envían dos SAVE_REPORT_FIELDS del mismo reporte con la misma baseVersion en un lote", async () => {
    const reportId = "55555555-5555-4555-8555-555555555555";
    // Reporte ya existente en el servidor (versión V0) con dos guardados pendientes (el primero ya se intentó).
    server.reports.set(reportId, { id: reportId, folio: "RPT-1", created_by: USER_A, status: "DRAFT", machine_id: MACHINE_1, updated_at: "V0", started_at: at(0).toISOString() });
    await outbox.commitAction({
      userId: USER_A,
      operation: { type: "SAVE_REPORT_FIELDS", payload: { reportId, fields: { lot: "A" } }, capturedAt: at(1).toISOString(), capturedOffline: true, baseVersion: "V0" },
      entities: [{ userId: USER_A, entityType: "report", id: reportId, reportId, synced: true, data: { id: reportId, status: "DRAFT", server_updated_at: "V0" } }],
    });
    const first = (await outbox.listOperations(USER_A))[0];
    await outbox.updateOperation(USER_A, first.operationId, { attempts: 1 }); // ya intentada: no se funde
    await outbox.commitAction({
      userId: USER_A,
      operation: { type: "SAVE_REPORT_FIELDS", payload: { reportId, fields: { units_produced: 9 } }, capturedAt: at(2).toISOString(), capturedOffline: true, baseVersion: "V0" },
    });
    expect(await outbox.listOperations(USER_A)).toHaveLength(2);
    const outcome = await sync.confirmAndUpload(USER_A);
    // Dos lotes: el segundo se reenvía con la versión rebasada y se aplica (no hay conflicto falso).
    expect(server.batches).toHaveLength(2);
    expect(server.batches.every((batch) => batch.length === 1)).toBe(true);
    expect(outcome).toMatchObject({ status: "complete", applied: 2, conflicts: 0 });
    expect(server.reports.get(reportId)).toMatchObject({ lot: "A", units_produced: 9 });
  });

  test("respuesta perdida: lo ya aplicado fuera del log (ruta en línea) se reenvía por el lote y devuelve duplicate, sin conflictos ni rechazos", async () => {
    const reportId = await queueShift();
    // El servidor aplicó todo (p. ej. por las rutas en línea, que no escriben el log) pero el cliente no recibió respuesta.
    for (const operation of await outbox.listOperations(USER_A)) {
      const result = server.apply({ ...outbox.buildWireOperation(operation), operationId: crypto.randomUUID() });
      expect(result.status).toBe("applied");
    }
    expect(server.reports.get(reportId)?.status).toBe("SUBMITTED");
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome).toMatchObject({ status: "complete", conflicts: 0, rejected: 0, remaining: 0 });
    expect(outcome.duplicates).toBe(6);
    expect(await outbox.listOperations(USER_A)).toHaveLength(0);
    expect(server.stops.size).toBe(1);
    expect(server.changes.size).toBe(1);
  });

  test("los lotes son de 50 operaciones como máximo, en orden de seq", async () => {
    const reportId = (await actions.startReport(ctx(0), MACHINE_1)) as { reportId: string };
    for (let index = 0; index < 60; index += 1) {
      await actions.addChange(ctx(1 + index), reportId.reportId, { changeTypeId: CHANGE_PRODUCTO, description: `Cambio ${index}` });
    }
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome.status).toBe("complete");
    expect(server.batches.map((batch) => batch.length)).toEqual([50, 11]);
    expect(server.changes.size).toBe(60);
  });

  test("el usuario B no ve ni envía operaciones del usuario A", async () => {
    await queueShift();
    const summaryB = await sync.getPendingSummary(USER_B);
    expect(summaryB.pending).toBe(0);
    const outcome = await sync.confirmAndUpload(USER_B);
    expect(outcome.status).toBe("nothing");
    expect(server.calls.filter((call) => call.url === "/api/sync/batch")).toHaveLength(0);
  });

  test("tras subir se refresca el snapshot", async () => {
    await queueShift();
    await sync.confirmAndUpload(USER_A);
    expect(server.calls.some((call) => call.url === "/api/offline/snapshot")).toBe(true);
  });
});

describe("aviso de pendientes al servidor (T112 / FR-005a)", () => {
  test("se envía al arrancar con conexión, sin confirmación, con solo el conteo y la antigüedad", async () => {
    await queueShift();
    const stop = sync.startSyncMonitor(USER_A);
    await wait(60);
    const status = server.deviceStatuses.at(-1)!;
    expect(Object.keys(status).sort()).toEqual(["deviceId", "oldestPendingAt", "pendingCount"]);
    expect(status.pendingCount).toBe(6);
    expect(status.oldestPendingAt).toBe(at(0).toISOString());
    expect(status.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(status)).not.toContain("payload");
    expect(server.calls.filter((call) => call.url === "/api/sync/batch")).toHaveLength(0);
    // El deviceId se conserva entre arranques.
    const again = await sync.getDeviceIdentifier();
    expect(again).toBe(status.deviceId);
    stop();
  });

  test("no se envía sin conexión", async () => {
    await queueShift();
    await goOffline();
    server.calls.length = 0;
    expect(await sync.reportDeviceStatus(USER_A)).toBe(false);
    expect(server.calls).toHaveLength(0);
    expect(server.deviceStatuses).toHaveLength(0);
  });

  test("se envía tras cada subida y al cambiar el conteo (con debounce)", async () => {
    const stop = sync.startSyncMonitor(USER_A);
    await wait(60);
    const baseline = server.deviceStatuses.length;
    const created = await actions.startReport(ctx(0), MACHINE_1);
    expect(created.ok).toBe(true);
    sync.scheduleDeviceStatus(USER_A);
    sync.scheduleDeviceStatus(USER_A); // varios cambios seguidos → un solo aviso
    expect(server.deviceStatuses.length).toBe(baseline);
    await wait(120);
    expect(server.deviceStatuses.length).toBe(baseline + 1);
    expect(server.deviceStatuses.at(-1)!.pendingCount).toBe(1);
    await sync.confirmAndUpload(USER_A);
    expect(server.deviceStatuses.at(-1)!.pendingCount).toBe(0);
    stop();
  });
});
