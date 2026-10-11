/**
 * Cliente de sincronización (T081, T112) según contracts/sync-protocol.md.
 *
 * Principio III (binding): mientras el usuario tenga operaciones `pending`/`syncing` NO hay escrituras de red
 * automáticas (ni autosave, ni PATCH, ni lote). Al reconectar solo se ofrece el resumen; subir exige
 * `confirmAndUpload()`. Sin pendientes y con conexión, las acciones van directo a las rutas en línea
 * (`sendDirectIfAllowed`) pero siempre después de escribirse en IndexedDB.
 */
import { checkApplicationReachability, getConnectivitySnapshot, markConnectionFailure, subscribeConnectivity } from "../connectivity";
import { parseIntervalMs } from "../shifts";
import { getDeviceId, requestPersistentStorage } from "./db";
import { clearLocalSession, getLocalSession } from "./offline-auth";
import {
  buildWireOperation, getEntity, getOperation, listOperations, pendingCount, purgeSynced, putEntity, setOperationState, subscribeOutbox,
  updateOperation, notifyOutboxChanged,
} from "./outbox";
import { fetchSnapshot, loadSnapshot, reconcileEntities, resetCurrentUserCache } from "./snapshot";
import type { LocalReport, OperationType, OutboxOperation } from "./types";

// --------------------------------------------------------------------------- configuración y estado

const config = { deviceStatusDebounceMs: 5_000, batchSize: 50 };
const DEFAULT_STALE_MS = 7 * 86_400_000;

export function configureSyncClient(options: Partial<typeof config>) {
  Object.assign(config, options);
}

export interface SyncUiState {
  /** El resumen de pendientes está abierto (ofrecido tras reconectar, al iniciar sesión o desde el indicador). */
  offerOpen: boolean;
  uploading: boolean;
  /** La sesión venció (401): todo se conserva y hay que iniciar sesión. */
  authRequired: boolean;
  /** 403: usuario inactivo o sin permiso; nada se sube. */
  forbidden: boolean;
  /** Hay una sesión local (inicio de sesión sin conexión): hace falta un login ONLINE antes de subir (FR-006b). */
  loginRequired: boolean;
  /** La revalidación encontró el perfil inactivo o con otro rol: sesión cerrada, pendientes conservados. */
  inactive: boolean;
  message: string | null;
  lastOutcome: UploadOutcome | null;
}

const INITIAL_STATE: SyncUiState = { offerOpen: false, uploading: false, authRequired: false, forbidden: false, loginRequired: false, inactive: false, message: null, lastOutcome: null };
const states = new Map<string, SyncUiState>();
const listeners = new Set<() => void>();

export function getSyncState(userId: string): SyncUiState {
  return states.get(userId) ?? INITIAL_STATE;
}

function setSyncState(userId: string, patch: Partial<SyncUiState>) {
  states.set(userId, { ...getSyncState(userId), ...patch });
  for (const listener of [...listeners]) listener();
}

export function subscribeSyncState(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Ofrece el resumen de pendientes (reconexión, inicio de sesión, indicador global). */
export function offerSummary(userId: string) {
  setSyncState(userId, { offerOpen: true });
}

/** "Posponer": cierra el resumen y conserva todo; se vuelve a ofrecer en la siguiente reconexión. */
export function postpone(userId: string) {
  setSyncState(userId, { offerOpen: false, lastOutcome: null });
}

// --------------------------------------------------------------------------- exclusión mutua por usuario

const chains = new Map<string, Promise<unknown>>();

/**
 * Serializa las acciones y las subidas de un usuario. Una acción + su envío directo deben ir dentro de la misma
 * llamada para que dos escrituras nunca se crucen. No se debe anidar (provoca interbloqueo).
 */
export function runExclusive<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  chains.set(userId, next.catch(() => undefined));
  return next;
}

// --------------------------------------------------------------------------- revalidación al reconectar (T093, FR-006b)

export const LOGIN_REQUIRED_MESSAGE = "Ya hay conexión. Inicia sesión en línea con tu contraseña para poder subir tus datos; no se perdió nada.";
export const INACTIVE_MESSAGE = "Tu usuario ya no está activo o cambió de rol, así que se cerró la sesión. Tus datos siguen guardados en este dispositivo y no se perdieron: pide a un coordinador que te reactive temporalmente para iniciar sesión tú mismo y confirmar la subida. Nadie más puede subirlos.";

async function hasLocalSessionFor(userId: string) {
  return (await getLocalSession())?.userId === userId;
}

/** Recalcula, desde la sesión local, si hace falta un login en línea (tras iniciar/cerrar sesión). */
export async function refreshLoginGate(userId: string) {
  const required = await hasLocalSessionFor(userId);
  setSyncState(userId, { loginRequired: required, ...(required ? { message: LOGIN_REQUIRED_MESSAGE } : { message: null }) });
  return required;
}

export type RevalidationStatus = "none" | "offline" | "login-required" | "inactive";

/** Cierra la sesión (local y del servidor) conservando TODOS los pendientes; solo el autor podrá subirlos (FR-019). */
async function closeSessionKeepingData(userId: string) {
  await clearLocalSession();
  resetCurrentUserCache();
  try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", redirect: "manual" }); } catch { /* sin red: se cerrará al volver */ }
  setSyncState(userId, { inactive: true, loginRequired: false, message: INACTIVE_MESSAGE, offerOpen: true });
}

/**
 * Al reconectar con una sesión local: pregunta al servidor quién es la sesión en línea (si la hay). Perfil inactivo
 * o rol distinto → cierra la sesión y conserva los pendientes. En cualquier otro caso se exige un login en línea
 * (la sesión local se retira cuando el login confirma la identidad; ver finalizeEnrollment).
 */
export async function revalidateAfterReconnect(userId: string): Promise<RevalidationStatus> {
  const local = await getLocalSession();
  if (!local || local.userId !== userId) return "none";
  setSyncState(userId, { loginRequired: true, message: LOGIN_REQUIRED_MESSAGE });
  let response: Response;
  try {
    response = await fetch("/api/auth/session-info", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    return "offline";
  }
  if (response.status === 403) { await closeSessionKeepingData(userId); return "inactive"; }
  if (response.status !== 200) return "login-required"; // 401 u otro error: hace falta iniciar sesión en línea
  const info = await response.json().catch(() => null) as { userId?: string; role?: string; active?: boolean } | null;
  if (!info || info.userId !== local.userId) return "login-required"; // la sesión en línea es de otra persona
  if (info.active === false || info.role !== local.role) { await closeSessionKeepingData(userId); return "inactive"; }
  return "login-required";
}

// --------------------------------------------------------------------------- resumen

export interface PendingSummary {
  /** pending + syncing. */
  pending: number;
  counts: {
    reportsNew: number; fieldSaves: number; stopsStarted: number; stopsClosed: number; stopsCancelled: number;
    categoryChanges: number; changes: number; submits: number; reportCancels: number;
  };
  oldestCapturedAt: string | null;
  oldestAgeMs: number | null;
  /** Hay pendientes con más antigüedad que `offlineLoginWindow` (7 días por defecto). */
  hasStale: boolean;
  staleThresholdMs: number;
  /** Operaciones en conflicto o rechazadas: siguen visibles hasta que el usuario las descarte. */
  problems: OutboxOperation[];
}

const COUNT_KEY: Record<OperationType, keyof PendingSummary["counts"]> = {
  CREATE_REPORT: "reportsNew", SAVE_REPORT_FIELDS: "fieldSaves", START_STOP: "stopsStarted", CLOSE_STOP: "stopsClosed",
  CANCEL_STOP: "stopsCancelled", SET_STOP_CATEGORY: "categoryChanges", ADD_CHANGE: "changes", SUBMIT_REPORT: "submits",
  CANCEL_REPORT: "reportCancels",
};

export async function getPendingSummary(userId: string, now: Date = new Date()): Promise<PendingSummary> {
  const operations = await listOperations(userId);
  const pendingOps = operations.filter((operation) => operation.state === "pending" || operation.state === "syncing");
  const counts: PendingSummary["counts"] = {
    reportsNew: 0, fieldSaves: 0, stopsStarted: 0, stopsClosed: 0, stopsCancelled: 0, categoryChanges: 0, changes: 0, submits: 0, reportCancels: 0,
  };
  for (const operation of pendingOps) counts[COUNT_KEY[operation.type]] += 1;
  const oldest = pendingOps.map((operation) => operation.capturedAt).sort()[0] ?? null;
  const snapshot = await loadSnapshot(userId);
  const staleThresholdMs = parseIntervalMs(snapshot?.settings.offlineLoginWindow, DEFAULT_STALE_MS);
  const oldestAgeMs = oldest ? Math.max(0, now.getTime() - Date.parse(oldest)) : null;
  return {
    pending: pendingOps.length,
    counts,
    oldestCapturedAt: oldest,
    oldestAgeMs,
    hasStale: oldestAgeMs !== null && oldestAgeMs > staleThresholdMs,
    staleThresholdMs,
    problems: operations.filter((operation) => operation.state === "conflict" || operation.state === "rejected"),
  };
}

// --------------------------------------------------------------------------- resultados

export type UploadStatus = "nothing" | "complete" | "partial" | "network-error" | "unauthorized" | "forbidden" | "login-required" | "error";

export interface UploadOutcome {
  status: UploadStatus;
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  /** pending/syncing que siguen en la outbox. */
  remaining: number;
  message?: string;
}

interface WireResult {
  operationId: string;
  status: "applied" | "duplicate" | "conflict" | "rejected";
  code?: string;
  message?: string;
  previousStatus?: string;
  review?: string;
  entity?: { type: string; id: string; folio?: string | null; updatedAt?: string };
}

type ResultKind = "applied" | "duplicate" | "conflict" | "rejected";

/** Registra el resultado de una operación y actualiza la copia local. Devuelve cómo contarla. */
async function applyResult(userId: string, operation: OutboxOperation, result: WireResult): Promise<ResultKind> {
  if (result.status === "applied" || result.status === "duplicate") {
    if (result.status === "duplicate" && (result.previousStatus === "conflict" || result.previousStatus === "rejected")) {
      const kind = result.previousStatus === "conflict" ? "conflict" : "rejected";
      await setOperationState(userId, operation.operationId, kind, {
        code: result.code ?? "PREVIOUS_RESULT",
        message: result.message ?? `El servidor ya había registrado esta operación como ${kind === "conflict" ? "en conflicto" : "rechazada"}.`,
      });
      return kind;
    }
    await setOperationState(userId, operation.operationId, "synced", { review: result.review ?? null });
    await absorbEntity(userId, operation, result.entity);
    return result.status;
  }
  await setOperationState(userId, operation.operationId, result.status, {
    code: result.code ?? "VALIDATION",
    message: result.message ?? (result.status === "conflict" ? "El reporte cambió en el servidor." : "El servidor rechazó la operación."),
  });
  return result.status;
}

/** Folio y versión del servidor en la copia local, y re-base de los guardados pendientes del mismo reporte. */
async function absorbEntity(userId: string, operation: OutboxOperation, entity: WireResult["entity"]) {
  if (!entity || entity.type !== "report" || !operation.reportId) return;
  const record = await getEntity<LocalReport>(userId, "report", entity.id);
  if (record) {
    await putEntity({
      ...record,
      data: {
        ...record.data,
        folio: entity.folio ?? record.data.folio,
        server_updated_at: entity.updatedAt ?? record.data.server_updated_at,
      },
    });
  }
  if (!entity.updatedAt) return;
  for (const other of await listOperations(userId, ["pending"])) {
    if (other.type === "SAVE_REPORT_FIELDS" && other.reportId === entity.id && other.baseVersion && other.operationId !== operation.operationId) {
      await updateOperation(userId, other.operationId, { baseVersion: entity.updatedAt });
    }
  }
}

// --------------------------------------------------------------------------- subida por lotes

/** Lote en orden de seq (≤ 50). Nunca dos SAVE_REPORT_FIELDS del mismo reporte con la misma baseVersion. */
function buildBatch(operations: OutboxOperation[]): OutboxOperation[] {
  const batch: OutboxOperation[] = [];
  const reportsWithSave = new Set<string>();
  for (const operation of operations) {
    if (batch.length >= config.batchSize) break;
    if (operation.type === "SAVE_REPORT_FIELDS" && operation.reportId) {
      if (reportsWithSave.has(operation.reportId)) break; // el resto espera a que se rebase la versión
      reportsWithSave.add(operation.reportId);
    }
    batch.push(operation);
  }
  return batch;
}

async function markSyncing(userId: string, batch: OutboxOperation[]) {
  const stamp = new Date().toISOString();
  for (const operation of batch) {
    await updateOperation(userId, operation.operationId, { state: "syncing", attempts: operation.attempts + 1, lastAttemptAt: stamp });
  }
}

async function revertToPending(userId: string, batch: OutboxOperation[]) {
  for (const operation of batch) {
    const current = await getOperation(userId, operation.operationId);
    if (current?.state === "syncing") await updateOperation(userId, operation.operationId, { state: "pending" });
  }
}

/** Sube TODO lo pendiente del usuario. Solo debe invocarse tras el "Confirmar y subir" explícito del autor. */
export function confirmAndUpload(userId: string): Promise<UploadOutcome> {
  return runExclusive(userId, () => uploadAll(userId));
}

async function uploadAll(userId: string): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { status: "nothing", applied: 0, duplicates: 0, conflicts: 0, rejected: 0, remaining: 0 };
  // FR-006b: una sesión local (inicio de sesión sin conexión) NO puede subir; antes hace falta un login en línea.
  if (await hasLocalSessionFor(userId)) {
    outcome.status = "login-required";
    outcome.message = LOGIN_REQUIRED_MESSAGE;
    outcome.remaining = await pendingCount(userId);
    setSyncState(userId, { loginRequired: true, message: LOGIN_REQUIRED_MESSAGE });
    return outcome;
  }
  setSyncState(userId, { uploading: true, authRequired: false, forbidden: false });
  try {
    for (;;) {
      const queue = await listOperations(userId, ["pending", "syncing"]); // 'syncing' huérfanas: resultado incierto
      if (queue.length === 0) break;
      const batch = buildBatch(queue);
      await markSyncing(userId, batch);

      let response: Response;
      try {
        response = await fetch("/api/sync/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ operations: batch.map(buildWireOperation) }),
        });
      } catch {
        // Resultado incierto: se reenviará con la misma operationId (el servidor devuelve duplicate).
        await revertToPending(userId, batch);
        markConnectionFailure();
        outcome.status = "network-error";
        outcome.message = "Se perdió la conexión. Tus datos siguen guardados en este dispositivo.";
        break;
      }

      if (response.status === 401) {
        await revertToPending(userId, batch);
        outcome.status = "unauthorized";
        outcome.message = "Tu sesión venció. Inicia sesión para subir tus datos; no se perdió nada.";
        setSyncState(userId, { authRequired: true });
        break;
      }
      if (response.status === 403) {
        await revertToPending(userId, batch);
        outcome.status = "forbidden";
        outcome.message = "Tu usuario no puede sincronizar. Tus datos siguen guardados en este dispositivo.";
        setSyncState(userId, { forbidden: true });
        break;
      }
      const body = await response.json().catch(() => null) as { results?: WireResult[]; error?: string } | null;
      if (!response.ok || !Array.isArray(body?.results)) {
        await revertToPending(userId, batch);
        outcome.status = "error";
        outcome.message = body?.error ?? "No fue posible sincronizar. Intenta de nuevo.";
        break;
      }

      const byId = new Map(body.results.map((result) => [result.operationId, result]));
      let cut = false;
      for (const operation of batch) {
        const result = byId.get(operation.operationId);
        if (!result) { cut = true; await revertToPending(userId, [operation]); continue; }
        const kind = await applyResult(userId, operation, result);
        if (kind === "applied") outcome.applied += 1;
        else if (kind === "duplicate") outcome.duplicates += 1;
        else if (kind === "conflict") outcome.conflicts += 1;
        else outcome.rejected += 1;
      }
      if (cut) { outcome.status = "partial"; break; }
    }
  } finally {
    outcome.remaining = await pendingCount(userId);
    // Lo confirmado se purga cuando ya no queda nada pendiente (tras una subida parcial permanece como synced).
    if (outcome.remaining === 0) await purgeSynced(userId);
    if (outcome.status === "nothing" && (outcome.applied + outcome.duplicates + outcome.conflicts + outcome.rejected) > 0) {
      outcome.status = outcome.remaining === 0 ? "complete" : "partial";
    }
    if (outcome.status === "partial" && outcome.remaining === 0) outcome.status = "complete";
    // Tras subir: refrescar snapshot y copia local desde el servidor (solo con sesión válida).
    if (outcome.applied + outcome.duplicates > 0 && outcome.status !== "unauthorized") {
      const fresh = await fetchSnapshot();
      if (fresh.status === "ok") await reconcileEntities(userId, fresh.snapshot);
    }
    const problems = (await listOperations(userId)).filter((operation) => operation.state === "conflict" || operation.state === "rejected").length;
    setSyncState(userId, { uploading: false, lastOutcome: outcome, offerOpen: outcome.status !== "nothing" || problems > 0 });
    notifyOutboxChanged(userId);
    if (outcome.status !== "nothing") await reportDeviceStatus(userId);
  }
  return outcome;
}

// --------------------------------------------------------------------------- envío directo (en línea, sin pendientes)

type Direct =
  | { kind: "result"; result: WireResult }
  | { kind: "retry"; reason: "network" | "server" | "unauthorized"; message: string };

const jsonHeaders = { "Content-Type": "application/json" };

function directRequest(operation: OutboxOperation): { url: string; method: string; body?: Record<string, unknown> } {
  const p = operation.payload;
  const base = `/api/reports/${p.reportId}`;
  switch (operation.type) {
    case "CREATE_REPORT":
      return { url: "/api/reports", method: "POST", body: { id: p.reportId, machine_id: p.machineId, started_at: p.startedAt } };
    case "SAVE_REPORT_FIELDS":
      return { url: base, method: "PATCH", body: { ...p.fields, ...(operation.baseVersion ? { _base_updated_at: operation.baseVersion } : {}) } };
    case "START_STOP":
      return { url: `${base}/stops`, method: "POST", body: { id: p.stopId, stop_category_id: p.categoryId, description: p.description, started_at: p.startedAt } };
    case "CLOSE_STOP":
      return { url: `${base}/stops/${p.stopId}/close`, method: "POST", body: { ended_at: p.endedAt, ...(p.categoryId ? { stop_category_id: p.categoryId } : {}) } };
    case "SET_STOP_CATEGORY":
      return { url: `${base}/stops/${p.stopId}/category`, method: "PATCH", body: { stop_category_id: p.categoryId } };
    case "CANCEL_STOP":
      return { url: `${base}/stops/${p.stopId}/cancel`, method: "POST", body: { reason: p.reason } };
    case "ADD_CHANGE":
      return { url: `${base}/changes`, method: "POST", body: { id: p.changeId, change_type_id: p.changeTypeId, description: p.description, occurred_at: p.occurredAt } };
    case "SUBMIT_REPORT":
      return { url: `${base}/submit`, method: "POST" };
    case "CANCEL_REPORT":
      return { url: `${base}/cancel`, method: "POST", body: { reason: p.reason } };
  }
}

async function sendOperationOnline(operation: OutboxOperation): Promise<Direct> {
  const request = directRequest(operation);
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method, headers: jsonHeaders, credentials: "same-origin",
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
  } catch {
    markConnectionFailure();
    return { kind: "retry", reason: "network", message: "Se perdió la conexión. El dato quedó guardado en este dispositivo." };
  }
  if (response.status === 401) return { kind: "retry", reason: "unauthorized", message: "Tu sesión venció. Inicia sesión para subir tus datos." };
  if (response.status >= 500) return { kind: "retry", reason: "server", message: "El servidor no respondió. El dato quedó guardado en este dispositivo." };
  const body = await response.json().catch(() => null) as Record<string, any> | null;
  if (response.ok) {
    const report = body?.report;
    const entity = report ? { type: "report", id: report.id ?? operation.reportId, folio: report.folio ?? null, updatedAt: report.updated_at } : undefined;
    return { kind: "result", result: { operationId: operation.operationId, status: body?.duplicate ? "duplicate" : "applied", entity } };
  }
  const code = typeof body?.code === "string" ? body.code : "VALIDATION";
  const message = typeof body?.error === "string" ? body.error : "El servidor rechazó la operación.";
  const conflict = response.status === 409 && (code === "REPORT_CONFLICT" || code === "REPORT_NOT_DRAFT");
  return { kind: "result", result: { operationId: operation.operationId, status: conflict ? "conflict" : "rejected", code: code === "REPORT_CONFLICT" ? "REPORT_CHANGED" : code, message } };
}

export interface DirectOutcome {
  sent: boolean;
  /** Presente si el servidor respondió: applied/duplicate/conflict/rejected. */
  result?: ResultKind;
  message?: string;
}

/**
 * Envía UNA operación a las rutas en línea, solo si antes de ella no había pendientes y hay conexión confirmada.
 * La operación ya está en IndexedDB: si falla por red queda pendiente (y desde entonces exige confirmación).
 */
export async function sendDirectIfAllowed(userId: string, operation: OutboxOperation, priorPending: number): Promise<DirectOutcome> {
  if (priorPending > 0) return { sent: false };
  if (getConnectivitySnapshot().state !== "online") return { sent: false };
  const queue = await listOperations(userId, ["pending", "syncing"]);
  if (queue.length !== 1 || queue[0].operationId !== operation.operationId) return { sent: false };
  await markSyncing(userId, [operation]);
  const direct = await sendOperationOnline(operation);
  if (direct.kind === "retry") {
    await revertToPending(userId, [operation]);
    if (direct.reason === "unauthorized") setSyncState(userId, { authRequired: true });
    return { sent: false, message: direct.message };
  }
  const kind = await applyResult(userId, operation, direct.result);
  await purgeSynced(userId);
  return { sent: true, result: kind, message: direct.result.message };
}

// --------------------------------------------------------------------------- aviso de pendientes (T112)

let statusTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function getDeviceIdentifier() {
  return getDeviceId();
}

/**
 * FR-005a: informa al servidor SOLO el conteo y la antigüedad (nunca datos de operaciones). No requiere
 * confirmación del autor y nunca se envía sin conexión confirmada.
 */
export async function reportDeviceStatus(userId: string): Promise<boolean> {
  if (typeof window === "undefined" || getConnectivitySnapshot().state !== "online") return false;
  try {
    const pending = (await listOperations(userId, ["pending", "syncing"])).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    const response = await fetch("/api/device-status", {
      method: "POST",
      headers: jsonHeaders,
      credentials: "same-origin",
      body: JSON.stringify({
        deviceId: await getDeviceId(),
        pendingCount: pending.length,
        oldestPendingAt: pending[0]?.capturedAt ?? null,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Avisa con debounce (5 s) cuando cambia el número de pendientes. */
export function scheduleDeviceStatus(userId: string) {
  const current = statusTimers.get(userId);
  if (current) clearTimeout(current);
  statusTimers.set(userId, setTimeout(() => {
    statusTimers.delete(userId);
    void reportDeviceStatus(userId);
  }, config.deviceStatusDebounceMs));
}

// --------------------------------------------------------------------------- monitor de conexión

/** Reconexión confirmada: solo ofrece el resumen y avisa el conteo. NUNCA sube. */
export async function handleReconnection(userId: string) {
  if (await pendingCount(userId) > 0) offerSummary(userId);
  await revalidateAfterReconnect(userId);
  void reportDeviceStatus(userId);
}

const monitors = new Map<string, { refs: number; stop: () => void }>();

/**
 * Arranca la vigilancia del usuario (idempotente, con contador de referencias): aviso inicial de pendientes,
 * oferta del resumen al entrar con pendientes, y al confirmarse cada reconexión. Devuelve la función de parada.
 */
export function startSyncMonitor(userId: string): () => void {
  const existing = monitors.get(userId);
  if (existing) {
    existing.refs += 1;
    return () => releaseMonitor(userId);
  }
  const unsubscribers: Array<() => void> = [];
  unsubscribers.push(subscribeConnectivity((snapshot) => {
    if (snapshot.restored && snapshot.state === "online") void handleReconnection(userId);
  }));
  unsubscribers.push(subscribeOutbox((changedUser) => {
    if (!changedUser || changedUser === userId) scheduleDeviceStatus(userId);
  }));
  void requestPersistentStorage();
  void (async () => {
    // Arranque / inicio de sesión: si hay pendientes se vuelve a ofrecer el resumen.
    if (await pendingCount(userId) > 0) offerSummary(userId);
    if (await refreshLoginGate(userId) && getConnectivitySnapshot().state === "online") await revalidateAfterReconnect(userId);
    if (getConnectivitySnapshot().state === "online") void reportDeviceStatus(userId);
  })();
  monitors.set(userId, { refs: 1, stop: () => unsubscribers.forEach((stop) => stop()) });
  return () => releaseMonitor(userId);
}

function releaseMonitor(userId: string) {
  const entry = monitors.get(userId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.stop();
  monitors.delete(userId);
}

/** Comprueba la conexión real y, si volvió, ofrece el resumen (desde el indicador global). */
export async function recheckConnection(userId: string) {
  const online = await checkApplicationReachability({ force: true });
  if (online && await pendingCount(userId) > 0) offerSummary(userId);
  return online;
}

export function resetSyncClientForTests() {
  for (const timer of statusTimers.values()) clearTimeout(timer);
  statusTimers = new Map();
  for (const monitor of monitors.values()) monitor.stop();
  monitors.clear();
  states.clear();
  chains.clear();
  config.deviceStatusDebounceMs = 5_000;
  config.batchSize = 50;
  resetCurrentUserCache();
  for (const listener of [...listeners]) listener();
}

export type { OperationType };
