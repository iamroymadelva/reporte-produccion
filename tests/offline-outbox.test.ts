/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { COMPLETE_FIELDS, CAT_ASEO, CHANGE_PRODUCTO, MACHINE_1, MACHINE_2, OPT, USER_A, USER_B, freshIndexedDb, activate, installBrowser, makeSnapshot } from "./helpers/offline-env";

const browser = installBrowser();
const { closeOfflineDb, openOfflineDb, idbGet, OFFLINE_DB_NAME } = await import("../src/lib/offline/db");
const outbox = await import("../src/lib/offline/outbox");
const actions = await import("../src/lib/offline/actions");
const { validateDeviceTimes } = await import("../src/lib/offline/validation");

const snapshot = makeSnapshot(USER_A);
const T0 = new Date("2026-10-09T15:00:00.000Z"); // 10:00 en Bogotá (turno Día)
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ctx = (minutes = 0, userId = USER_A) => ({ userId, snapshot: { ...snapshot, userId }, now: at(minutes), offline: true });

beforeEach(() => { activate(browser); freshIndexedDb(); });

/** Crea a mano una base v1 (reportDrafts + outbox + leases) igual a la del Block 3B. */
async function seedV1() {
  const factory = (globalThis as { indexedDB: IDBFactory }).indexedDB;
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(OFFLINE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const drafts = database.createObjectStore("reportDrafts", { keyPath: ["userId", "reportId"] });
      drafts.createIndex("by_user", "userId");
      drafts.createIndex("by_user_state", ["userId", "syncState"]);
      const box = database.createObjectStore("outbox", { keyPath: ["userId", "reportId", "operationType"] });
      box.createIndex("by_user", "userId");
      box.createIndex("by_user_state", ["userId", "state"]);
      database.createObjectStore("leases", { keyPath: "leaseKey" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(["reportDrafts", "outbox"], "readwrite");
      const draft = (reportId: string, syncState: string, folio: string) => ({
        userId: USER_A, reportId, folio, machineId: MACHINE_1, machineLabel: "M-01",
        localValues: { lot: "L-9", units_produced: 77 }, baseValues: { lot: null, units_produced: null },
        baseUpdatedAt: "2026-10-08T12:00:00.000Z", localUpdatedAt: "2026-10-08T13:00:00.000Z", localRevision: 3,
        syncState, lastError: null, writerInstanceId: "w1",
      });
      transaction.objectStore("reportDrafts").put(draft("11111111-1111-4111-8111-111111111111", "pending", "RPT-1"));
      transaction.objectStore("reportDrafts").put(draft("22222222-2222-4222-8222-222222222222", "conflict", "RPT-2"));
      transaction.objectStore("outbox").put({
        operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: USER_A, reportId: "11111111-1111-4111-8111-111111111111",
        operationType: "SAVE_REPORT", payload: { lot: "L-9", units_produced: 77 }, baseUpdatedAt: "2026-10-08T12:00:00.000Z",
        createdAtClient: "2026-10-08T12:30:00.000Z", updatedAtClient: "2026-10-08T13:00:00.000Z", localRevision: 3,
        attemptCount: 0, lastAttemptAt: null, nextAttemptAt: null, state: "pending", lastErrorCode: null,
        lastErrorMessage: null, writerInstanceId: "w1",
      });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

describe("migración de IndexedDB v1 a v2 (T079)", () => {
  test("convierte reportDrafts y la outbox v1 en operaciones SAVE_REPORT_FIELDS sin perder datos", async () => {
    await seedV1();
    const database = await openOfflineDb();
    expect(database.version).toBe(2);
    for (const store of ["outbox", "entities", "snapshot", "offlineCredentials", "overview"]) {
      expect(database.objectStoreNames.contains(store)).toBe(true);
    }
    expect(database.objectStoreNames.contains("reportDrafts")).toBe(false);

    const operations = await outbox.listOperations(USER_A);
    expect(operations).toHaveLength(2);
    expect(operations.map((operation) => operation.seq)).toEqual([1, 2]);
    expect(operations.every((operation) => operation.type === "SAVE_REPORT_FIELDS" && operation.state === "pending")).toBe(true);

    const withOutbox = operations.find((operation) => operation.payload.reportId === "11111111-1111-4111-8111-111111111111")!;
    expect(withOutbox.operationId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(withOutbox.payload.fields).toEqual({ lot: "L-9", units_produced: 77 });
    expect(withOutbox.baseVersion).toBe("2026-10-08T12:00:00.000Z");
    expect(withOutbox.capturedOffline).toBe(true);

    // El borrador en conflicto (sin operación v1) también conserva sus valores locales.
    const fromDraft = operations.find((operation) => operation.payload.reportId === "22222222-2222-4222-8222-222222222222")!;
    expect(fromDraft.payload.fields).toEqual({ lot: "L-9", units_produced: 77 });

    const entity = await outbox.getEntity(USER_A, "report", "11111111-1111-4111-8111-111111111111");
    expect(entity?.data.folio).toBe("RPT-1");
    expect(entity?.data.lot).toBe("L-9");
    expect(entity?.data.server_updated_at).toBe("2026-10-08T12:00:00.000Z");

    // El contador seq continúa después de lo migrado y se conserva al reabrir.
    closeOfflineDb();
    const next = await outbox.commitAction({ userId: USER_A, operation: { type: "CANCEL_REPORT", payload: { reportId: "x", reason: "r" }, capturedAt: at(0).toISOString(), capturedOffline: true } });
    expect(next.operation.seq).toBe(3);
  });

  test("los nombres de campo reales del editor v1 se conservan; los desconocidos no rompen el guardado y quedan registrados", async () => {
    const { REPORT_EDITABLE_FIELDS, reportFormToPayload } = await import("../src/lib/report-fields");
    // Payload real del editor del Block 3B: reportFormToPayload de un formulario completo (todos los campos editables).
    const form = Object.fromEntries(REPORT_EDITABLE_FIELDS.map((field) => [field, ({
      report_date: "2026-10-08", shift_id: "s1", line_id: "l1", client_id: "c1", product_id: "p1", dosifier_type_id: "d1",
      started_at: "2026-10-08T08:00", ended_at: "2026-10-08T16:00", process_performance: "85", operator_performance: "90",
    } as Record<string, string>)[field] ?? (["weight", "g_min", "programmed_hours", "units_produced", "waste"].includes(field) ? "5" : "x")]));
    const v1Payload = { ...reportFormToPayload(form as Record<string, string>), campo_inventado: "no existe", otro: 1 };
    const factory = (globalThis as { indexedDB: IDBFactory }).indexedDB;
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(OFFLINE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("reportDrafts", { keyPath: ["userId", "reportId"] });
        database.createObjectStore("outbox", { keyPath: ["userId", "reportId", "operationType"] });
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(["reportDrafts", "outbox"], "readwrite");
        transaction.objectStore("outbox").put({
          operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", userId: USER_A, reportId: "33333333-3333-4333-8333-333333333333",
          operationType: "SAVE_REPORT", payload: v1Payload, baseUpdatedAt: "2026-10-08T12:00:00.000Z",
          createdAtClient: "2026-10-08T12:30:00.000Z", updatedAtClient: "2026-10-08T13:00:00.000Z", localRevision: 1,
          attemptCount: 0, state: "pending",
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
    await openOfflineDb();
    const [operation] = await outbox.listOperations(USER_A);
    const fields = operation.payload.fields as Record<string, unknown>;
    // Todos los campos editables del v1 sobreviven con su valor (incluidos report_date/shift_id, que el servidor ignora).
    for (const field of REPORT_EDITABLE_FIELDS) expect(fields[field]).toBe((v1Payload as Record<string, unknown>)[field]);
    // Lo desconocido no viaja (no haría fallar todo el guardado) pero queda visible en la operación.
    expect(fields).not.toHaveProperty("campo_inventado");
    expect(fields).not.toHaveProperty("otro");
    expect(operation.payload.unknownFields).toEqual({ campo_inventado: "no existe", otro: 1 });
    expect(operation.resultMessage).toContain("campo_inventado");
    expect(operation.state).toBe("pending");
  });

  test("una base nueva se crea directamente en v2 y pide almacenamiento persistente sin fallar si no existe", async () => {
    const database = await openOfflineDb();
    expect(database.version).toBe(2);
    expect(await idbGet("meta", "deviceId")).toBeUndefined();
  });
});

describe("outbox: seq y aislamiento por usuario", () => {
  test("seq es monótono por usuario, está persistido y no se comparte entre usuarios", async () => {
    const base = { type: "CANCEL_REPORT" as const, payload: { reportId: "r", reason: "x" }, capturedAt: at(0).toISOString(), capturedOffline: true };
    const first = await outbox.commitAction({ userId: USER_A, operation: base });
    const second = await outbox.commitAction({ userId: USER_A, operation: base });
    closeOfflineDb(); // reabre: el contador no vuelve a empezar
    const third = await outbox.commitAction({ userId: USER_A, operation: base });
    const other = await outbox.commitAction({ userId: USER_B, operation: base });
    expect([first.operation.seq, second.operation.seq, third.operation.seq]).toEqual([1, 2, 3]);
    expect(other.operation.seq).toBe(1);
    expect(new Set([first, second, third].map((entry) => entry.operation.operationId)).size).toBe(3);
  });

  test("un usuario no ve ni descarta las operaciones de otro", async () => {
    const created = await outbox.commitAction({ userId: USER_A, operation: { type: "CANCEL_REPORT", payload: { reportId: "r", reason: "x" }, capturedAt: at(0).toISOString(), capturedOffline: true } });
    expect(await outbox.listOperations(USER_B)).toEqual([]);
    expect(await outbox.getOperation(USER_B, created.operation.operationId)).toBeNull();
    await outbox.setOperationState(USER_A, created.operation.operationId, "rejected", { code: "VALIDATION", message: "x" });
    await expect(outbox.discardOperation(USER_B, created.operation.operationId, { confirmed: true })).rejects.toThrow();
    expect(await outbox.listOperations(USER_A)).toHaveLength(1);
  });

  test("conflict y rejected nunca se borran solos; solo se descartan con confirmación explícita", async () => {
    const make = (n: number) => outbox.commitAction({ userId: USER_A, operation: { type: "CANCEL_REPORT", payload: { reportId: `r${n}`, reason: "x" }, capturedAt: at(0).toISOString(), capturedOffline: true } });
    const a = await make(1); const b = await make(2); const c = await make(3);
    await outbox.setOperationState(USER_A, a.operation.operationId, "synced");
    await outbox.setOperationState(USER_A, b.operation.operationId, "conflict", { code: "REPORT_CHANGED", message: "cambió" });
    await outbox.setOperationState(USER_A, c.operation.operationId, "rejected", { code: "VALIDATION", message: "no" });
    await outbox.purgeSynced(USER_A);
    const remaining = await outbox.listOperations(USER_A);
    expect(remaining.map((operation) => operation.state).sort()).toEqual(["conflict", "rejected"]);
    await expect(outbox.discardOperation(USER_A, b.operation.operationId, { confirmed: false })).rejects.toThrow();
    expect(await outbox.listOperations(USER_A)).toHaveLength(2);
    await outbox.discardOperation(USER_A, b.operation.operationId, { confirmed: true });
    expect((await outbox.listOperations(USER_A)).map((operation) => operation.operationId)).toEqual([c.operation.operationId]);
  });

  test("una operación pendiente no se puede descartar", async () => {
    const created = await outbox.commitAction({ userId: USER_A, operation: { type: "CANCEL_REPORT", payload: { reportId: "r", reason: "x" }, capturedAt: at(0).toISOString(), capturedOffline: true } });
    await expect(outbox.discardOperation(USER_A, created.operation.operationId, { confirmed: true })).rejects.toThrow();
  });
});

describe("acciones y validación offline (T080)", () => {
  async function started() {
    const result = await actions.startReport(ctx(0), MACHINE_1);
    if (!result.ok) throw new Error(result.message);
    return result.reportId as string;
  }

  test("iniciar un reporte guarda CREATE_REPORT con la hora del dispositivo y fija turno y fecha localmente", async () => {
    const reportId = await started();
    const [operation] = await outbox.listOperations(USER_A);
    expect(operation.type).toBe("CREATE_REPORT");
    expect(operation.capturedOffline).toBe(true);
    expect(operation.capturedAt).toBe(at(0).toISOString());
    expect(operation.payload).toEqual({ reportId, machineId: MACHINE_1, startedAt: at(0).toISOString() });
    const report = await outbox.getEntity(USER_A, "report", reportId);
    expect(report?.data.status).toBe("DRAFT");
    expect(report?.data.report_date).toBe("2026-10-09");
    expect(report?.data.shift_id).toBe(snapshot.shifts[0].id);
  });

  test("un solo reporte activo por operario", async () => {
    await started();
    const second = await actions.startReport(ctx(1), MACHINE_1);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("ACTIVE_REPORT_EXISTS");
    expect(await outbox.listOperations(USER_A)).toHaveLength(1);
  });

  test("sin asignación vigente para el turno actual no se inicia y se pide solicitarla al coordinador", async () => {
    const denied = await actions.startReport(ctx(0), MACHINE_2);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.code).toBe("NO_ASSIGNMENT");
      expect(denied.message).toContain("Solicita una asignación a tu coordinador");
    }
    expect(await outbox.listOperations(USER_A)).toHaveLength(0);
  });

  test("la categoría es opcional al iniciar una parada y obligatoria al cerrarla", async () => {
    const reportId = await started();
    const start = await actions.startStop(ctx(1), reportId, {});
    expect(start.ok).toBe(true);
    const stopId = (start as { stopId: string }).stopId;
    const noCategory = await actions.closeStop(ctx(5), stopId, {});
    expect(noCategory.ok).toBe(false);
    if (!noCategory.ok) expect(noCategory.code).toBe("CATEGORY_REQUIRED");
    const closed = await actions.closeStop(ctx(5), stopId, { categoryId: CAT_ASEO });
    expect(closed.ok).toBe(true);
    const operations = await outbox.listOperations(USER_A);
    const close = operations.find((operation) => operation.type === "CLOSE_STOP")!;
    expect(close.payload).toMatchObject({ stopId, endedAt: at(5).toISOString(), categoryId: CAT_ASEO });
    expect(close.capturedAt).toBe(at(5).toISOString());
    const stop = await outbox.getEntity(USER_A, "stop", stopId);
    expect(stop?.data.ended_at).toBe(at(5).toISOString());
    expect(stop?.data.stop_category?.id).toBe(CAT_ASEO);
  });

  test("no se abre otra parada mientras haya una abierta ni se solapan paradas", async () => {
    const reportId = await started();
    const first = await actions.startStop(ctx(1), reportId, {});
    const again = await actions.startStop(ctx(2), reportId, {});
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("STOP_ALREADY_OPEN");
    await actions.closeStop(ctx(10), (first as { stopId: string }).stopId, { categoryId: CAT_ASEO });
    // El reloj del dispositivo retrocedió: la nueva parada empezaría dentro de la anterior.
    const overlap = await actions.startStop(ctx(5), reportId, {});
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.code).toBe("STOP_OVERLAP");
    const adjacent = await actions.startStop(ctx(10), reportId, {});
    expect(adjacent.ok).toBe(true);
  });

  test("no se puede cerrar con una hora anterior al inicio de la parada", async () => {
    const reportId = await started();
    const first = await actions.startStop(ctx(10), reportId, {});
    const early = await actions.closeStop(ctx(5), (first as { stopId: string }).stopId, { categoryId: CAT_ASEO });
    expect(early.ok).toBe(false);
  });

  test("no se envía con una parada abierta ni con campos obligatorios vacíos", async () => {
    const reportId = await started();
    const stop = await actions.startStop(ctx(1), reportId, {});
    const blockedByStop = await actions.submitReport(ctx(2), reportId);
    expect(blockedByStop.ok).toBe(false);
    if (!blockedByStop.ok) expect(blockedByStop.code).toBe("OPEN_STOP");
    await actions.cancelStop(ctx(2), (stop as { stopId: string }).stopId, "Error de registro");
    const missing = await actions.submitReport(ctx(3), reportId);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("MISSING_FIELDS");
      expect(Object.keys(missing.fieldErrors ?? {})).toContain("lot");
    }
    expect((await outbox.listOperations(USER_A)).some((operation) => operation.type === "SUBMIT_REPORT")).toBe(false);
    await actions.saveReportFields(ctx(3), reportId, COMPLETE_FIELDS);
    const submitted = await actions.submitReport(ctx(4), reportId);
    expect(submitted.ok).toBe(true);
    const report = await outbox.getEntity(USER_A, "report", reportId);
    expect(report?.data.status).toBe("SUBMITTED");
    // Tras enviar ya no se puede editar ni abrir paradas.
    expect((await actions.startStop(ctx(5), reportId, {})).ok).toBe(false);
    expect((await actions.saveReportFields(ctx(5), reportId, { lot: "otro" })).ok).toBe(false);
  });

  test("los guardados consecutivos de campos se funden en una sola operación pendiente con los últimos valores", async () => {
    const reportId = await started();
    await actions.saveReportFields(ctx(1), reportId, { lot: "L-1" });
    await actions.startStop(ctx(2), reportId, {});
    await actions.saveReportFields(ctx(3), reportId, { lot: "L-2", units_produced: 5 });
    const saves = (await outbox.listOperations(USER_A)).filter((operation) => operation.type === "SAVE_REPORT_FIELDS");
    expect(saves).toHaveLength(1);
    expect(saves[0].payload.fields).toEqual({ lot: "L-2", units_produced: 5 });
    expect(saves[0].capturedAt).toBe(at(3).toISOString());
  });

  test("cambios: requiere tipo activo y descripción; guarda la hora del dispositivo", async () => {
    const reportId = await started();
    expect((await actions.addChange(ctx(1), reportId, { changeTypeId: CHANGE_PRODUCTO, description: "  " })).ok).toBe(false);
    expect((await actions.addChange(ctx(1), reportId, { changeTypeId: OPT, description: "x" })).ok).toBe(false);
    const added = await actions.addChange(ctx(2), reportId, { changeTypeId: CHANGE_PRODUCTO, description: "Cambio de formato" });
    expect(added.ok).toBe(true);
    const operation = (await outbox.listOperations(USER_A)).find((entry) => entry.type === "ADD_CHANGE")!;
    expect(operation.payload).toMatchObject({ reportId, changeTypeId: CHANGE_PRODUCTO, description: "Cambio de formato", occurredAt: at(2).toISOString() });
  });

  test("las horas del dispositivo no pueden estar en el futuro ni superar la captura + 5 min", () => {
    const now = new Date("2026-10-09T15:00:00.000Z");
    expect(validateDeviceTimes({ capturedAt: now.toISOString(), times: [now.toISOString()] }, now)).toBeNull();
    expect(validateDeviceTimes({ capturedAt: now.toISOString(), times: ["2026-10-09T15:04:00.000Z"] }, now)).toBeNull();
    expect(validateDeviceTimes({ capturedAt: now.toISOString(), times: ["2026-10-09T15:06:00.000Z"] }, now)).not.toBeNull();
    expect(validateDeviceTimes({ capturedAt: "2026-10-09T15:07:00.000Z", times: ["2026-10-09T15:07:00.000Z"] }, now)).not.toBeNull();
    expect(validateDeviceTimes({ capturedAt: "no es fecha", times: [] }, now)).not.toBeNull();
  });
});
