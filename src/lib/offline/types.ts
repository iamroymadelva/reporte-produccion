import type { ReportStatus } from "../types";
import type { ShiftDefinition, AssignmentLike } from "../shifts";
import type { StopEvent } from "../stop-events";

/** Tipos de operación de contracts/sync-protocol.md. */
export const OPERATION_TYPES = [
  "CREATE_REPORT", "SAVE_REPORT_FIELDS", "START_STOP", "CLOSE_STOP", "SET_STOP_CATEGORY",
  "CANCEL_STOP", "ADD_CHANGE", "SUBMIT_REPORT", "CANCEL_REPORT",
] as const;
export type OperationType = typeof OPERATION_TYPES[number];

/** pending → syncing → synced; conflict y rejected quedan visibles hasta que el usuario las descarte. */
export type OutboxState = "pending" | "syncing" | "synced" | "conflict" | "rejected";

/** Elemento pendiente de subir (store `outbox`, clave [userId, operationId]). */
export interface OutboxOperation {
  userId: string;
  operationId: string;
  /** Orden causal: entero monótono por usuario y dispositivo. */
  seq: number;
  type: OperationType;
  /** Reloj del dispositivo en el momento de la acción. */
  capturedAt: string;
  capturedOffline: boolean;
  /** `updated_at` del servidor conocido (SAVE_REPORT_FIELDS). */
  baseVersion: string | null;
  payload: Record<string, any>;
  state: OutboxState;
  /** Envíos intentados (una operación ya intentada no se funde con otras). */
  attempts: number;
  lastAttemptAt: string | null;
  resultCode: string | null;
  resultMessage: string | null;
  review: string | null;
  createdAt: string;
  /** Reporte al que pertenece (para dependencias y para descartar en cascada). */
  reportId: string | null;
}

/** Forma que viaja a POST /api/sync/batch. */
export interface WireOperation {
  operationId: string;
  userId: string;
  seq: number;
  type: OperationType;
  capturedAt: string;
  capturedOffline: boolean;
  baseVersion?: string;
  payload: Record<string, any>;
}

export type EntityType = "report" | "stop" | "change";

/** Copia local (store `entities`, clave [userId, entityType, id]) para renderizar sin conexión. */
export interface EntityRecord<T = any> {
  userId: string;
  entityType: EntityType;
  id: string;
  /** Reporte al que pertenece (el propio id para los reportes). */
  reportId: string;
  data: T;
  /** false mientras exista una operación pendiente que no está en el servidor. */
  synced: boolean;
}

export interface LocalReport {
  id: string;
  folio: string | null;
  machine_id: string;
  machine_label: string;
  status: ReportStatus;
  started_at: string;
  report_date: string | null;
  shift_id: string | null;
  server_updated_at: string | null;
  cancellation_reason?: string | null;
  /** Motivo por el que el reporte quedó bloqueado tras un rechazo/conflicto de sincronización. */
  blocked?: string | null;
  [field: string]: unknown;
}

export interface LocalStop extends StopEvent {
  report_id: string;
}

export interface LocalChange {
  id: string;
  report_id: string;
  change_type_id: string;
  change_type_name?: string;
  description: string;
  occurred_at: string;
}

export interface CatalogItem { id: string; code: string; name: string; numeric_code?: number | null; sort_order?: number | null }

/** Snapshot de trabajo del Operario (store `snapshot`, clave userId); ver GET /api/offline/snapshot. */
export interface OfflineSnapshot {
  userId: string;
  fetchedAt: string;
  serverTime: string;
  profile: { id: string; full_name: string; role: string; job_title: string | null };
  settings: { offShiftGrace: string | null; offlineLoginWindow: string | null };
  shifts: ShiftDefinition[];
  assignments: Array<AssignmentLike & { id?: string }>;
  catalogs: {
    stopCategories: CatalogItem[];
    changeTypes: CatalogItem[];
    clients: CatalogItem[];
    products: CatalogItem[];
    lines: CatalogItem[];
    dosifierTypes: CatalogItem[];
  };
  activeReport: Record<string, any> | null;
}

export interface ActionContext {
  userId: string;
  snapshot: OfflineSnapshot;
  /** Hora del dispositivo en el momento de la acción (por defecto, `new Date()`). */
  now?: Date;
  /** Si la app estaba sin conexión al capturar. */
  offline: boolean;
}
