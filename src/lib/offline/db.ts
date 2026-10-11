/**
 * IndexedDB `reporte-produccion-offline` v2 (T079, data-model.md "Elemento pendiente de subir").
 *
 * Stores: `outbox` [userId, operationId], `entities` [userId, entityType, id], `snapshot` userId, `meta` key
 * (deviceId, contadores seq y último usuario), y los reservados para la Phase 8: `offlineCredentials` y `overview`.
 * La v1 (reportDrafts + outbox por reporte + leases del Block 3B) se migra a operaciones SAVE_REPORT_FIELDS sin
 * perder datos. Toda clave incluye el userId: nunca se mezclan datos de distintos usuarios.
 */
import { REPORT_EDITABLE_FIELDS } from "../report-fields";

export const OFFLINE_DB_NAME = "reporte-produccion-offline";
export const OFFLINE_DB_VERSION = 2;

export type StoreName = "outbox" | "entities" | "snapshot" | "offlineCredentials" | "overview" | "meta";

export class OfflineStorageError extends Error {
  readonly code: "INDEXEDDB_UNAVAILABLE" | "OPEN_BLOCKED" | "OPEN_FAILED" | "QUOTA_EXCEEDED" | "TRANSACTION_ABORTED" | "INVALID_INPUT";
  readonly cause?: unknown;
  constructor(code: OfflineStorageError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "OfflineStorageError";
    this.code = code;
    this.cause = cause;
  }
}

let databasePromise: Promise<IDBDatabase> | null = null;

/** Cierra la conexión en caché (reinicio de pruebas o cambio de versión). */
export function closeOfflineDb() {
  const pending = databasePromise;
  databasePromise = null;
  void pending?.then((database) => database.close()).catch(() => undefined);
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface V1Draft {
  userId: string; reportId: string; folio: string | null; machineId: string | null; machineLabel: string | null;
  localValues: Record<string, unknown>; baseValues: Record<string, unknown>; baseUpdatedAt: string;
  localUpdatedAt: string; syncState: string;
}
interface V1Operation {
  operationId: string; userId: string; reportId: string; payload: Record<string, unknown>; baseUpdatedAt: string;
  createdAtClient: string; updatedAtClient: string; state: string;
}

/** Convierte lo guardado por el Block 3B en operaciones SAVE_REPORT_FIELDS + copia local del reporte. */
export function migrateV1(drafts: V1Draft[], oldOperations: V1Operation[]) {
  const key = (userId: string, reportId: string) => `${userId}|${reportId}`;
  const draftByReport = new Map(drafts.map((draft) => [key(draft.userId, draft.reportId), draft]));
  const opByReport = new Map(oldOperations.map((operation) => [key(operation.userId, operation.reportId), operation]));
  const reports = new Set<string>([...draftByReport.keys(), ...opByReport.keys()]);

  const items = [...reports].map((reportKey) => {
    const draft = draftByReport.get(reportKey);
    const old = opByReport.get(reportKey);
    const userId = (draft?.userId ?? old?.userId)!;
    const reportId = (draft?.reportId ?? old?.reportId)!;
    const capturedAt = old?.updatedAtClient ?? draft?.localUpdatedAt ?? new Date().toISOString();
    const merged = { ...(draft?.localValues ?? {}), ...(old?.payload ?? {}) };
    // Solo viajan los campos que el servidor acepta; lo desconocido no puede hacer fallar todo el guardado, pero
    // tampoco se pierde en silencio: queda en la operación (payload.unknownFields) y en su mensaje.
    const editable = new Set<string>([...REPORT_EDITABLE_FIELDS, "report_date", "shift_id"]);
    const fields: Record<string, unknown> = {};
    const unknownFields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(merged)) (editable.has(name) ? fields : unknownFields)[name] = value;
    return { userId, reportId, draft, old, capturedAt, fields, unknownFields };
  }).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  const counters = new Map<string, number>();
  const operations: Array<Record<string, unknown>> = [];
  const entities: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const seq = (counters.get(item.userId) ?? 0) + 1;
    counters.set(item.userId, seq);
    const baseVersion = item.old?.baseUpdatedAt ?? item.draft?.baseUpdatedAt ?? null;
    operations.push({
      userId: item.userId,
      operationId: item.old?.operationId ?? randomId(),
      seq,
      type: "SAVE_REPORT_FIELDS",
      capturedAt: item.capturedAt,
      capturedOffline: true,
      baseVersion,
      payload: {
        reportId: item.reportId, fields: item.fields,
        ...(Object.keys(item.unknownFields).length ? { unknownFields: item.unknownFields } : {}),
      },
      state: "pending",
      attempts: 0,
      lastAttemptAt: null,
      resultCode: null,
      resultMessage: Object.keys(item.unknownFields).length
        ? `Migración: se omitieron campos desconocidos (${Object.keys(item.unknownFields).join(", ")}); siguen guardados en esta operación.`
        : null,
      review: null,
      createdAt: item.old?.createdAtClient ?? item.capturedAt,
      reportId: item.reportId,
    });
    entities.push({
      userId: item.userId, entityType: "report", id: item.reportId, reportId: item.reportId, synced: false,
      data: {
        ...(item.draft?.baseValues ?? {}), ...item.fields,
        id: item.reportId, folio: item.draft?.folio ?? null, machine_id: item.draft?.machineId ?? "",
        machine_label: item.draft?.machineLabel ?? "", status: "DRAFT",
        report_date: (item.fields as { report_date?: string }).report_date ?? null,
        shift_id: (item.fields as { shift_id?: string }).shift_id ?? null,
        server_updated_at: baseVersion,
      },
    });
  }
  return { operations, entities, counters };
}

function createStores(database: IDBDatabase) {
  const outbox = database.createObjectStore("outbox", { keyPath: ["userId", "operationId"] });
  outbox.createIndex("by_user", "userId", { unique: false });
  outbox.createIndex("by_user_state", ["userId", "state"], { unique: false });
  const entities = database.createObjectStore("entities", { keyPath: ["userId", "entityType", "id"] });
  entities.createIndex("by_user", "userId", { unique: false });
  entities.createIndex("by_user_report", ["userId", "reportId"], { unique: false });
  database.createObjectStore("snapshot", { keyPath: "userId" });
  database.createObjectStore("offlineCredentials", { keyPath: "usernameNormalized" });
  database.createObjectStore("overview", { keyPath: "userId" });
  database.createObjectStore("meta", { keyPath: "key" });
}

function writeMigrated(transaction: IDBTransaction, migrated: ReturnType<typeof migrateV1>) {
  for (const operation of migrated.operations) transaction.objectStore("outbox").put(operation);
  for (const entity of migrated.entities) transaction.objectStore("entities").put(entity);
  for (const [userId, value] of migrated.counters) transaction.objectStore("meta").put({ key: `seq:${userId}`, value });
}

function upgrade(request: IDBOpenDBRequest, oldVersion: number) {
  const database = request.result;
  const transaction = request.transaction!;
  if (oldVersion < 1) {
    createStores(database);
    return;
  }
  // v1 → v2: leer lo existente antes de reemplazar los stores, todo dentro de la transacción de versión.
  const hasDrafts = database.objectStoreNames.contains("reportDrafts");
  const hasOutbox = database.objectStoreNames.contains("outbox");
  const draftsRequest = hasDrafts ? transaction.objectStore("reportDrafts").getAll() : null;
  const finish = (drafts: V1Draft[], operations: V1Operation[]) => {
    if (hasOutbox) database.deleteObjectStore("outbox");
    if (hasDrafts) database.deleteObjectStore("reportDrafts");
    if (database.objectStoreNames.contains("leases")) database.deleteObjectStore("leases");
    createStores(database);
    writeMigrated(transaction, migrateV1(drafts, operations));
  };
  const readOperations = (drafts: V1Draft[]) => {
    if (!hasOutbox) { finish(drafts, []); return; }
    const operationsRequest = transaction.objectStore("outbox").getAll();
    operationsRequest.onsuccess = () => finish(drafts, operationsRequest.result as V1Operation[]);
  };
  if (draftsRequest) draftsRequest.onsuccess = () => readOperations(draftsRequest.result as V1Draft[]);
  else readOperations([]);
}

export function openOfflineDb(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      databasePromise = null;
      reject(new OfflineStorageError("INDEXEDDB_UNAVAILABLE", "IndexedDB no está disponible en este navegador."));
      return;
    }
    let settled = false;
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = (event) => upgrade(request, event.oldVersion);
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(new OfflineStorageError("OPEN_BLOCKED", "Otra pestaña mantiene abierta una versión anterior del almacenamiento local."));
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(new OfflineStorageError("OPEN_FAILED", "No fue posible abrir el almacenamiento local.", request.error));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      settled = true;
      database.onversionchange = () => { database.close(); databasePromise = null; };
      resolve(database);
    };
  });
  return databasePromise;
}

export function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => {
      const quota = transaction.error?.name === "QuotaExceededError";
      reject(new OfflineStorageError(
        quota ? "QUOTA_EXCEEDED" : "TRANSACTION_ABORTED",
        quota ? "No hay espacio disponible para guardar los datos en este dispositivo." : "La transacción de almacenamiento local fue cancelada.",
        transaction.error,
      ));
    };
    transaction.onerror = () => { /* onabort informa el fallo definitivo */ };
  });
}

/** Ejecuta `work` dentro de una transacción; resuelve solo cuando la transacción confirmó (sin falsas confirmaciones). */
export async function withTransaction<T>(stores: StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const database = await openOfflineDb();
  const transaction = database.transaction(stores, mode);
  const completion = transactionComplete(transaction);
  completion.catch(() => undefined);
  try {
    const result = await work(transaction);
    await completion;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* ya finalizada */ }
    await completion.catch(() => undefined);
    throw error;
  }
}

export async function idbGet<T = any>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return withTransaction([store], "readonly", (tx) => requestResult(tx.objectStore(store).get(key)) as Promise<T | undefined>);
}

export async function idbPut(store: StoreName, value: unknown): Promise<void> {
  await withTransaction([store], "readwrite", async (tx) => { await requestResult(tx.objectStore(store).put(value)); });
}

export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  await withTransaction([store], "readwrite", async (tx) => { await requestResult(tx.objectStore(store).delete(key)); });
}

export async function idbGetAllByIndex<T = any>(store: StoreName, index: string, key: IDBValidKey): Promise<T[]> {
  return withTransaction([store], "readonly", (tx) => requestResult(tx.objectStore(store).index(index).getAll(key)) as Promise<T[]>);
}

/** Pide almacenamiento persistente para reducir el riesgo de que el navegador borre los datos (R9). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage?.persist) return false;
    if (storage.persisted && await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Identificador estable de este dispositivo (T112): UUID generado una vez y guardado en IndexedDB. */
export async function getDeviceId(): Promise<string> {
  const existing = await idbGet<{ key: string; value: string }>("meta", "deviceId");
  if (existing?.value) return existing.value;
  const value = randomId();
  // Si dos pestañas compiten, gana la primera escritura (se vuelve a leer para devolver el valor definitivo).
  await withTransaction(["meta"], "readwrite", async (tx) => {
    const store = tx.objectStore("meta");
    const current = await requestResult(store.get("deviceId")) as { value: string } | undefined;
    if (!current) await requestResult(store.put({ key: "deviceId", value }));
  });
  return (await idbGet<{ value: string }>("meta", "deviceId"))!.value;
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  return (await idbGet<{ value: T }>("meta", key))?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await idbPut("meta", { key, value });
}
