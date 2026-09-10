import {
  pickReportEditableValues,
  type PartialReportEditableValues,
} from "./report-fields";
import { ClientOperationIdError, createClientOperationId } from "./client-operation-id";

export const OFFLINE_REPORT_DATABASE_NAME = "reporte-produccion-offline";
export const OFFLINE_REPORT_DATABASE_VERSION = 1;
export const SAVE_REPORT_OPERATION = "SAVE_REPORT" as const;

const REPORT_DRAFTS_STORE = "reportDrafts";
const OUTBOX_STORE = "outbox";
const LEASES_STORE = "leases";

export type ReportDraftSyncState = "pending" | "syncing" | "retry_wait" | "blocked" | "conflict";
export type OutboxState = ReportDraftSyncState;

export interface ReportDraftSnapshot {
  userId: string;
  reportId: string;
  folio: string | null;
  machineId: string | null;
  machineLabel: string | null;
  localValues: PartialReportEditableValues;
  baseValues: PartialReportEditableValues;
  baseUpdatedAt: string;
  localUpdatedAt: string;
  localRevision: number;
  syncState: ReportDraftSyncState;
  lastError: string | null;
  writerInstanceId: string;
}

export interface SaveReportOutboxOperation {
  operationId: string;
  userId: string;
  reportId: string;
  operationType: typeof SAVE_REPORT_OPERATION;
  payload: PartialReportEditableValues;
  baseUpdatedAt: string;
  createdAtClient: string;
  updatedAtClient: string;
  localRevision: number;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  state: OutboxState;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  writerInstanceId: string;
}

export interface LeaseRecord {
  leaseKey: string;
  ownerInstanceId: string;
  acquiredAt: string;
  expiresAt: string;
}

export type OfflineReportStorageErrorCode =
  | "INDEXEDDB_UNAVAILABLE"
  | "OPEN_BLOCKED"
  | "OPEN_FAILED"
  | "TRANSACTION_ABORTED"
  | "QUOTA_EXCEEDED"
  | "SECURE_RANDOM_UNAVAILABLE"
  | "READ_FAILED"
  | "WRITE_FAILED"
  | "INVALID_INPUT"
  | "STALE_REVISION";

export class OfflineReportStorageError extends Error {
  readonly code: OfflineReportStorageErrorCode;
  readonly cause?: unknown;

  constructor(code: OfflineReportStorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "OfflineReportStorageError";
    this.code = code;
    this.cause = cause;
  }
}

export interface SavePendingReportRevisionInput {
  userId: string;
  reportId: string;
  folio?: string | null;
  machineId?: string | null;
  machineLabel?: string | null;
  localValues: Record<string, unknown>;
  baseValues: Record<string, unknown>;
  payload: Record<string, unknown>;
  baseUpdatedAt: string;
  localRevision: number;
  localUpdatedAt?: string;
  syncState?: ReportDraftSyncState;
  lastError?: string | null;
  writerInstanceId: string;
}

export interface ConfirmReportRevisionInput {
  userId: string;
  reportId: string;
  confirmedLocalRevision: number;
  confirmedServerValues: Record<string, unknown>;
  confirmedServerUpdatedAt: string;
}

export type ConfirmReportRevisionResult =
  | { status: "cleared"; localRevision: number }
  | { status: "preserved_newer"; localRevision: number }
  | { status: "missing"; localRevision: null }
  | { status: "revision_mismatch"; localRevision: number };

export interface AcquireLeaseInput {
  leaseKey: string;
  ownerInstanceId: string;
  ttlMs: number;
  now?: Date;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function requireIndexedDb() {
  if (typeof indexedDB === "undefined") {
    throw new OfflineReportStorageError(
      "INDEXEDDB_UNAVAILABLE",
      "IndexedDB no está disponible en este navegador.",
    );
  }
  return indexedDB;
}

function assertIdentifier(value: string, label: string) {
  if (!value.trim()) {
    throw new OfflineReportStorageError("INVALID_INPUT", `${label} es obligatorio.`);
  }
}

function assertRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new OfflineReportStorageError(
      "INVALID_INPUT",
      "localRevision debe ser un entero positivo.",
    );
  }
}

function assertIsoDate(value: string, label: string) {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new OfflineReportStorageError("INVALID_INPUT", `${label} debe ser una fecha válida.`);
  }
}

function mapStorageError(
  error: unknown,
  fallbackCode: "READ_FAILED" | "WRITE_FAILED",
  fallbackMessage: string,
) {
  if (error instanceof OfflineReportStorageError) return error;
  if (error instanceof ClientOperationIdError) {
    return new OfflineReportStorageError(
      "SECURE_RANDOM_UNAVAILABLE",
      "No fue posible generar un identificador seguro para el guardado local.",
      error,
    );
  }
  return new OfflineReportStorageError(fallbackCode, fallbackMessage, error);
}

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = requireIndexedDb().open(OFFLINE_REPORT_DATABASE_NAME, OFFLINE_REPORT_DATABASE_VERSION);
    } catch (error) {
      databasePromise = null;
      reject(mapStorageError(error, "READ_FAILED", "No fue posible abrir el almacenamiento local."));
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REPORT_DRAFTS_STORE)) {
        const drafts = database.createObjectStore(REPORT_DRAFTS_STORE, {
          keyPath: ["userId", "reportId"],
        });
        drafts.createIndex("by_user", "userId", { unique: false });
        drafts.createIndex("by_user_state", ["userId", "syncState"], { unique: false });
        drafts.createIndex("by_local_updated_at", "localUpdatedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = database.createObjectStore(OUTBOX_STORE, {
          keyPath: ["userId", "reportId", "operationType"],
        });
        outbox.createIndex("by_user", "userId", { unique: false });
        outbox.createIndex("by_user_state", ["userId", "state"], { unique: false });
        outbox.createIndex("by_user_next_attempt", ["userId", "nextAttemptAt"], { unique: false });
      }
      if (!database.objectStoreNames.contains(LEASES_STORE)) {
        database.createObjectStore(LEASES_STORE, { keyPath: "leaseKey" });
      }
    };

    request.onblocked = () => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(new OfflineReportStorageError(
        "OPEN_BLOCKED",
        "Otra pestaña mantiene abierta una versión anterior del almacenamiento local.",
      ));
    };

    request.onerror = () => {
      if (settled) return;
      settled = true;
      databasePromise = null;
      reject(new OfflineReportStorageError(
        "OPEN_FAILED",
        "No fue posible abrir el almacenamiento local.",
        request.error,
      ));
    };

    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
  });

  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => {
      const quotaExceeded = transaction.error?.name === "QuotaExceededError";
      reject(new OfflineReportStorageError(
        quotaExceeded ? "QUOTA_EXCEEDED" : "TRANSACTION_ABORTED",
        quotaExceeded
          ? "No hay espacio disponible para guardar el reporte en este dispositivo."
          : "La transacción de almacenamiento local fue cancelada.",
        transaction.error,
      ));
    };
    transaction.onerror = () => {
      // onabort provides the final failure and prevents a false persistence confirmation.
    };
  });
}

async function readRecord<T>(storeName: string, key: IDBValidKey) {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const result = await requestResult(transaction.objectStore(storeName).get(key)) as T | undefined;
    await transactionComplete(transaction);
    return result ?? null;
  } catch (error) {
    throw mapStorageError(error, "READ_FAILED", "No fue posible leer el almacenamiento local.");
  }
}

export async function getReportDraft(userId: string, reportId: string) {
  assertIdentifier(userId, "userId");
  assertIdentifier(reportId, "reportId");
  return readRecord<ReportDraftSnapshot>(REPORT_DRAFTS_STORE, [userId, reportId]);
}

export async function getSaveReportOperation(userId: string, reportId: string) {
  assertIdentifier(userId, "userId");
  assertIdentifier(reportId, "reportId");
  return readRecord<SaveReportOutboxOperation>(OUTBOX_STORE, [userId, reportId, SAVE_REPORT_OPERATION]);
}

export async function listUserReportDrafts(userId: string) {
  assertIdentifier(userId, "userId");
  try {
    const database = await openDatabase();
    const transaction = database.transaction(REPORT_DRAFTS_STORE, "readonly");
    const request = transaction.objectStore(REPORT_DRAFTS_STORE).index("by_user").getAll(userId);
    const result = await requestResult(request) as ReportDraftSnapshot[];
    await transactionComplete(transaction);
    return result;
  } catch (error) {
    throw mapStorageError(error, "READ_FAILED", "No fue posible consultar los borradores locales.");
  }
}

export async function listUserOutboxOperations(userId: string, state?: OutboxState) {
  assertIdentifier(userId, "userId");
  try {
    const database = await openDatabase();
    const transaction = database.transaction(OUTBOX_STORE, "readonly");
    const store = transaction.objectStore(OUTBOX_STORE);
    const request = state
      ? store.index("by_user_state").getAll([userId, state])
      : store.index("by_user").getAll(userId);
    const result = await requestResult(request) as SaveReportOutboxOperation[];
    await transactionComplete(transaction);
    return result;
  } catch (error) {
    throw mapStorageError(error, "READ_FAILED", "No fue posible consultar la cola local.");
  }
}

/**
 * Persists the safety snapshot and its coalesced SAVE_REPORT operation atomically.
 * Older revisions are rejected before either store is written.
 */
export async function savePendingReportRevision(input: SavePendingReportRevisionInput) {
  assertIdentifier(input.userId, "userId");
  assertIdentifier(input.reportId, "reportId");
  assertIdentifier(input.writerInstanceId, "writerInstanceId");
  assertRevision(input.localRevision);
  assertIsoDate(input.baseUpdatedAt, "baseUpdatedAt");

  const localUpdatedAt = input.localUpdatedAt ?? new Date().toISOString();
  assertIsoDate(localUpdatedAt, "localUpdatedAt");

  try {
    // Generate this before opening a transaction so compatibility failures are
    // classified without leaving an IndexedDB transaction in an ambiguous state.
    const operationId = createClientOperationId();
    const database = await openDatabase();
    const transaction = database.transaction([REPORT_DRAFTS_STORE, OUTBOX_STORE], "readwrite");
    const completion = transactionComplete(transaction);
    const drafts = transaction.objectStore(REPORT_DRAFTS_STORE);
    const outbox = transaction.objectStore(OUTBOX_STORE);
    const draftKey: IDBValidKey = [input.userId, input.reportId];
    const operationKey: IDBValidKey = [input.userId, input.reportId, SAVE_REPORT_OPERATION];
    const existingDraft = await requestResult(drafts.get(draftKey)) as ReportDraftSnapshot | undefined;
    const existingOperation = await requestResult(outbox.get(operationKey)) as SaveReportOutboxOperation | undefined;

    const newestRevision = Math.max(
      existingDraft?.localRevision ?? 0,
      existingOperation?.localRevision ?? 0,
    );
    if (newestRevision > 0 && input.localRevision <= newestRevision) {
      transaction.abort();
      await completion.catch(() => undefined);
      throw new OfflineReportStorageError(
        "STALE_REVISION",
        `La revisión local ${input.localRevision} no es posterior a la revisión persistida ${newestRevision}.`,
      );
    }

    const draft: ReportDraftSnapshot = {
      userId: input.userId,
      reportId: input.reportId,
      folio: input.folio ?? null,
      machineId: input.machineId ?? null,
      machineLabel: input.machineLabel ?? null,
      localValues: pickReportEditableValues(input.localValues),
      baseValues: pickReportEditableValues(input.baseValues),
      baseUpdatedAt: input.baseUpdatedAt,
      localUpdatedAt,
      localRevision: input.localRevision,
      syncState: input.syncState ?? "pending",
      lastError: input.lastError ?? null,
      writerInstanceId: input.writerInstanceId,
    };

    const operation: SaveReportOutboxOperation = {
      operationId: existingOperation?.operationId ?? operationId,
      userId: input.userId,
      reportId: input.reportId,
      operationType: SAVE_REPORT_OPERATION,
      payload: pickReportEditableValues(input.payload),
      baseUpdatedAt: input.baseUpdatedAt,
      createdAtClient: existingOperation?.createdAtClient ?? localUpdatedAt,
      updatedAtClient: localUpdatedAt,
      localRevision: input.localRevision,
      attemptCount: existingOperation?.attemptCount ?? 0,
      lastAttemptAt: existingOperation?.lastAttemptAt ?? null,
      nextAttemptAt: existingOperation?.nextAttemptAt ?? null,
      state: input.syncState ?? "pending",
      lastErrorCode: null,
      lastErrorMessage: input.lastError ?? null,
      writerInstanceId: input.writerInstanceId,
    };

    drafts.put(draft);
    outbox.put(operation);
    await completion;
    return { draft, operation };
  } catch (error) {
    throw mapStorageError(error, "WRITE_FAILED", "No fue posible guardar el reporte en este dispositivo.");
  }
}

/**
 * Clears only the exact revision acknowledged by the server. When a newer local
 * revision exists, it is preserved and rebased onto the confirmed server version.
 */
export async function acknowledgeConfirmedReportRevision(input: ConfirmReportRevisionInput): Promise<ConfirmReportRevisionResult> {
  assertIdentifier(input.userId, "userId");
  assertIdentifier(input.reportId, "reportId");
  assertRevision(input.confirmedLocalRevision);
  assertIsoDate(input.confirmedServerUpdatedAt, "confirmedServerUpdatedAt");

  try {
    const database = await openDatabase();
    const transaction = database.transaction([REPORT_DRAFTS_STORE, OUTBOX_STORE], "readwrite");
    const completion = transactionComplete(transaction);
    const drafts = transaction.objectStore(REPORT_DRAFTS_STORE);
    const outbox = transaction.objectStore(OUTBOX_STORE);
    const draftKey: IDBValidKey = [input.userId, input.reportId];
    const operationKey: IDBValidKey = [input.userId, input.reportId, SAVE_REPORT_OPERATION];
    const draft = await requestResult(drafts.get(draftKey)) as ReportDraftSnapshot | undefined;
    const operation = await requestResult(outbox.get(operationKey)) as SaveReportOutboxOperation | undefined;

    if (!draft && !operation) {
      await completion;
      return { status: "missing", localRevision: null };
    }

    if (!draft || !operation || draft.localRevision !== operation.localRevision) {
      await completion;
      return {
        status: "revision_mismatch",
        localRevision: Math.max(draft?.localRevision ?? 0, operation?.localRevision ?? 0),
      };
    }

    if (draft.localRevision === input.confirmedLocalRevision) {
      drafts.delete(draftKey);
      outbox.delete(operationKey);
      await completion;
      return { status: "cleared", localRevision: input.confirmedLocalRevision };
    }

    if (draft.localRevision > input.confirmedLocalRevision) {
      const confirmedValues = pickReportEditableValues(input.confirmedServerValues);
      drafts.put({
        ...draft,
        baseValues: confirmedValues,
        baseUpdatedAt: input.confirmedServerUpdatedAt,
        syncState: "pending",
        lastError: null,
      } satisfies ReportDraftSnapshot);
      outbox.put({
        ...operation,
        baseUpdatedAt: input.confirmedServerUpdatedAt,
        state: "pending",
        attemptCount: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      } satisfies SaveReportOutboxOperation);
      await completion;
      return { status: "preserved_newer", localRevision: draft.localRevision };
    }

    await completion;
    return { status: "revision_mismatch", localRevision: draft.localRevision };
  } catch (error) {
    throw mapStorageError(error, "WRITE_FAILED", "No fue posible confirmar la revisión local.");
  }
}

export async function getLease(leaseKey: string) {
  assertIdentifier(leaseKey, "leaseKey");
  return readRecord<LeaseRecord>(LEASES_STORE, leaseKey);
}

export async function acquireLease(input: AcquireLeaseInput) {
  assertIdentifier(input.leaseKey, "leaseKey");
  assertIdentifier(input.ownerInstanceId, "ownerInstanceId");
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    throw new OfflineReportStorageError("INVALID_INPUT", "ttlMs debe ser mayor que cero.");
  }

  try {
    const database = await openDatabase();
    const transaction = database.transaction(LEASES_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(LEASES_STORE);
    const existing = await requestResult(store.get(input.leaseKey)) as LeaseRecord | undefined;
    const now = input.now ?? new Date();
    if (
      existing
      && existing.ownerInstanceId !== input.ownerInstanceId
      && Date.parse(existing.expiresAt) > now.getTime()
    ) {
      await completion;
      return { acquired: false, lease: existing } as const;
    }

    const lease: LeaseRecord = {
      leaseKey: input.leaseKey,
      ownerInstanceId: input.ownerInstanceId,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
    };
    store.put(lease);
    await completion;
    return { acquired: true, lease } as const;
  } catch (error) {
    throw mapStorageError(error, "WRITE_FAILED", "No fue posible adquirir el lease local.");
  }
}

export async function renewLease(input: AcquireLeaseInput) {
  assertIdentifier(input.leaseKey, "leaseKey");
  assertIdentifier(input.ownerInstanceId, "ownerInstanceId");
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
    throw new OfflineReportStorageError("INVALID_INPUT", "ttlMs debe ser mayor que cero.");
  }

  try {
    const database = await openDatabase();
    const transaction = database.transaction(LEASES_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(LEASES_STORE);
    const existing = await requestResult(store.get(input.leaseKey)) as LeaseRecord | undefined;
    if (!existing || existing.ownerInstanceId !== input.ownerInstanceId) {
      await completion;
      return { renewed: false, lease: existing ?? null } as const;
    }

    const now = input.now ?? new Date();
    const lease: LeaseRecord = {
      ...existing,
      expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
    };
    store.put(lease);
    await completion;
    return { renewed: true, lease } as const;
  } catch (error) {
    throw mapStorageError(error, "WRITE_FAILED", "No fue posible renovar el lease local.");
  }
}

export async function releaseLease(leaseKey: string, ownerInstanceId: string) {
  assertIdentifier(leaseKey, "leaseKey");
  assertIdentifier(ownerInstanceId, "ownerInstanceId");
  try {
    const database = await openDatabase();
    const transaction = database.transaction(LEASES_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(LEASES_STORE);
    const existing = await requestResult(store.get(leaseKey)) as LeaseRecord | undefined;
    if (!existing || existing.ownerInstanceId !== ownerInstanceId) {
      await completion;
      return false;
    }
    store.delete(leaseKey);
    await completion;
    return true;
  } catch (error) {
    throw mapStorageError(error, "WRITE_FAILED", "No fue posible liberar el lease local.");
  }
}
