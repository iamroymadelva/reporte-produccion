/**
 * Outbox tipada (T080): operaciones de contracts/sync-protocol.md guardadas en IndexedDB con `operationId`,
 * `seq` monótono por usuario y la copia local (`entities`) que permite renderizar sin conexión. Toda escritura de
 * una acción (operación + entidades + contador seq) es UNA transacción: o queda todo o no queda nada.
 */
import { createClientOperationId } from "../client-operation-id";
import {
  idbGet, idbGetAllByIndex, idbPut, requestResult, withTransaction, OfflineStorageError,
} from "./db";
import type { EntityRecord, EntityType, OperationType, OutboxOperation, OutboxState, WireOperation } from "./types";

export interface NewOperation {
  type: OperationType;
  payload: Record<string, any>;
  capturedAt: string;
  capturedOffline: boolean;
  baseVersion?: string | null;
}

export interface CommitInput {
  userId: string;
  operation: NewOperation;
  entities?: EntityRecord[];
  removeEntities?: Array<{ entityType: EntityType; id: string }>;
}

export interface CommitResult {
  operation: OutboxOperation;
  /** Operaciones pending/syncing que ya existían del usuario justo antes de esta acción. */
  priorPending: number;
  merged: boolean;
}

const OUTBOX_EVENT = "offline:outbox-changed";

function assertUser(userId: string) {
  if (!userId || !userId.trim()) throw new OfflineStorageError("INVALID_INPUT", "userId es obligatorio.");
}

export function notifyOutboxChanged(userId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { userId } }));
}

export function subscribeOutbox(listener: (userId?: string) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<{ userId?: string }>).detail?.userId);
  window.addEventListener(OUTBOX_EVENT, handler);
  return () => window.removeEventListener(OUTBOX_EVENT, handler);
}

const isPendingState = (state: OutboxState) => state === "pending" || state === "syncing";

/** Guarda una acción: operación (con su seq) + entidades locales, atómicamente. */
export async function commitAction(input: CommitInput): Promise<CommitResult> {
  assertUser(input.userId);
  const { userId, operation } = input;
  const createdAt = new Date().toISOString();
  const newOperationId = createClientOperationId();

  const result = await withTransaction(["outbox", "entities", "meta"], "readwrite", async (tx) => {
    const outbox = tx.objectStore("outbox");
    const existing = await requestResult(outbox.index("by_user").getAll(userId)) as OutboxOperation[];
    const priorPending = existing.filter((entry) => isPendingState(entry.state)).length;
    const reportId = typeof operation.payload.reportId === "string" ? operation.payload.reportId : null;

    // Guardados consecutivos de campos del mismo reporte: una sola operación con los últimos valores.
    if (operation.type === "SAVE_REPORT_FIELDS" && reportId) {
      const target = existing.find((entry) =>
        entry.type === "SAVE_REPORT_FIELDS" && entry.reportId === reportId && entry.state === "pending" && entry.attempts === 0);
      if (target) {
        const merged: OutboxOperation = {
          ...target,
          capturedAt: operation.capturedAt,
          payload: { ...target.payload, fields: { ...(target.payload.fields ?? {}), ...(operation.payload.fields ?? {}) } },
        };
        await requestResult(outbox.put(merged));
        await writeEntities(tx, input);
        return { operation: merged, priorPending, merged: true };
      }
    }

    const meta = tx.objectStore("meta");
    const counter = await requestResult(meta.get(`seq:${userId}`)) as { value: number } | undefined;
    const seq = (counter?.value ?? 0) + 1;
    await requestResult(meta.put({ key: `seq:${userId}`, value: seq }));
    const stored: OutboxOperation = {
      userId, operationId: newOperationId, seq, type: operation.type, capturedAt: operation.capturedAt,
      capturedOffline: operation.capturedOffline, baseVersion: operation.baseVersion ?? null, payload: operation.payload,
      state: "pending", attempts: 0, lastAttemptAt: null, resultCode: null, resultMessage: null, review: null,
      createdAt, reportId,
    };
    await requestResult(outbox.put(stored));
    await writeEntities(tx, input);
    return { operation: stored, priorPending, merged: false };
  });
  notifyOutboxChanged(userId);
  return result;
}

async function writeEntities(tx: IDBTransaction, input: CommitInput) {
  const entities = tx.objectStore("entities");
  for (const entity of input.entities ?? []) await requestResult(entities.put({ ...entity, userId: input.userId }));
  for (const removal of input.removeEntities ?? []) {
    await requestResult(entities.delete([input.userId, removal.entityType, removal.id]));
  }
}

export async function listOperations(userId: string, states?: OutboxState[]): Promise<OutboxOperation[]> {
  assertUser(userId);
  const all = await idbGetAllByIndex<OutboxOperation>("outbox", "by_user", userId);
  return all.filter((entry) => !states || states.includes(entry.state)).sort((a, b) => a.seq - b.seq);
}

export async function getOperation(userId: string, operationId: string): Promise<OutboxOperation | null> {
  assertUser(userId);
  return (await idbGet<OutboxOperation>("outbox", [userId, operationId])) ?? null;
}

/** Lectura-modificación-escritura atómica de una operación del usuario. */
export async function updateOperation(userId: string, operationId: string, patch: Partial<OutboxOperation>): Promise<OutboxOperation | null> {
  assertUser(userId);
  const updated = await withTransaction(["outbox"], "readwrite", async (tx) => {
    const store = tx.objectStore("outbox");
    const current = await requestResult(store.get([userId, operationId])) as OutboxOperation | undefined;
    if (!current) return null;
    const next = { ...current, ...patch, userId, operationId } as OutboxOperation;
    await requestResult(store.put(next));
    return next;
  });
  notifyOutboxChanged(userId);
  return updated;
}

export async function setOperationState(
  userId: string,
  operationId: string,
  state: OutboxState,
  info: { code?: string | null; message?: string | null; review?: string | null } = {},
) {
  return updateOperation(userId, operationId, {
    state,
    resultCode: info.code ?? null,
    resultMessage: info.message ?? null,
    review: info.review ?? null,
  });
}

/** Retira las operaciones ya confirmadas por el servidor. conflict y rejected NUNCA se tocan aquí. */
export async function purgeSynced(userId: string) {
  assertUser(userId);
  await withTransaction(["outbox"], "readwrite", async (tx) => {
    const store = tx.objectStore("outbox");
    const entries = await requestResult(store.index("by_user").getAll(userId)) as OutboxOperation[];
    for (const entry of entries) if (entry.state === "synced") await requestResult(store.delete([userId, entry.operationId]));
  });
  notifyOutboxChanged(userId);
}

/**
 * Descarta una operación en conflicto o rechazada, solo con confirmación explícita del usuario. Descartar un
 * CREATE_REPORT retira el reporte local y todo lo que dependía de él.
 */
export async function discardOperation(userId: string, operationId: string, options: { confirmed: boolean }) {
  assertUser(userId);
  if (!options.confirmed) throw new OfflineStorageError("INVALID_INPUT", "Descartar datos requiere confirmación explícita.");
  await withTransaction(["outbox", "entities"], "readwrite", async (tx) => {
    const outbox = tx.objectStore("outbox");
    const entities = tx.objectStore("entities");
    const target = await requestResult(outbox.get([userId, operationId])) as OutboxOperation | undefined;
    if (!target) throw new OfflineStorageError("INVALID_INPUT", "La operación no existe para este usuario.");
    if (target.state !== "conflict" && target.state !== "rejected") {
      throw new OfflineStorageError("INVALID_INPUT", "Solo se pueden descartar operaciones en conflicto o rechazadas.");
    }
    if (target.type === "CREATE_REPORT" && target.reportId) {
      const all = await requestResult(outbox.index("by_user").getAll(userId)) as OutboxOperation[];
      for (const entry of all) if (entry.reportId === target.reportId) await requestResult(outbox.delete([userId, entry.operationId]));
      const related = await requestResult(entities.index("by_user_report").getAll([userId, target.reportId])) as EntityRecord[];
      for (const entity of related) await requestResult(entities.delete([userId, entity.entityType, entity.id]));
      return;
    }
    await requestResult(outbox.delete([userId, operationId]));
    if (target.type === "START_STOP" && typeof target.payload.stopId === "string") {
      await requestResult(entities.delete([userId, "stop", target.payload.stopId]));
    }
    if (target.type === "ADD_CHANGE" && typeof target.payload.changeId === "string") {
      await requestResult(entities.delete([userId, "change", target.payload.changeId]));
    }
  });
  notifyOutboxChanged(userId);
}

export interface StateCounts { pending: number; syncing: number; synced: number; conflict: number; rejected: number }

export async function countByState(userId: string): Promise<StateCounts> {
  const counts: StateCounts = { pending: 0, syncing: 0, synced: 0, conflict: 0, rejected: 0 };
  for (const entry of await listOperations(userId)) counts[entry.state] += 1;
  return counts;
}

/** Pendientes de subir = pending + syncing (lo que el aviso al servidor y el indicador cuentan). */
export async function pendingCount(userId: string) {
  const counts = await countByState(userId);
  return counts.pending + counts.syncing;
}

export function buildWireOperation(operation: OutboxOperation): WireOperation {
  return {
    operationId: operation.operationId,
    userId: operation.userId,
    seq: operation.seq,
    type: operation.type,
    capturedAt: operation.capturedAt,
    capturedOffline: operation.capturedOffline,
    ...(operation.baseVersion ? { baseVersion: operation.baseVersion } : {}),
    payload: operation.payload,
  };
}

// --------------------------------------------------------------------------- entidades locales

export async function listEntities<T = any>(userId: string, entityType?: EntityType): Promise<EntityRecord<T>[]> {
  assertUser(userId);
  const all = await idbGetAllByIndex<EntityRecord<T>>("entities", "by_user", userId);
  return entityType ? all.filter((entity) => entity.entityType === entityType) : all;
}

export async function getEntity<T = any>(userId: string, entityType: EntityType, id: string): Promise<EntityRecord<T> | null> {
  assertUser(userId);
  return (await idbGet<EntityRecord<T>>("entities", [userId, entityType, id])) ?? null;
}

export async function putEntity(entity: EntityRecord) {
  await idbPut("entities", entity);
  notifyOutboxChanged(entity.userId);
}

/** Reemplaza TODAS las copias locales del usuario (tras subir todo y refrescar desde el servidor). */
export async function replaceEntities(userId: string, entities: EntityRecord[]) {
  assertUser(userId);
  await withTransaction(["entities"], "readwrite", async (tx) => {
    const store = tx.objectStore("entities");
    const current = await requestResult(store.index("by_user").getAll(userId)) as EntityRecord[];
    for (const entity of current) await requestResult(store.delete([userId, entity.entityType, entity.id]));
    for (const entity of entities) await requestResult(store.put({ ...entity, userId }));
  });
  notifyOutboxChanged(userId);
}

/** Operaciones que aún no están confirmadas por el servidor (pending, syncing, conflict, rejected). */
export async function unsyncedCount(userId: string) {
  const counts = await countByState(userId);
  return counts.pending + counts.syncing + counts.conflict + counts.rejected;
}
