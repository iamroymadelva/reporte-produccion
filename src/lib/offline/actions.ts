/**
 * Acciones del operario (T080): cada una valida con las mismas reglas que la BD (validation.ts), captura la hora
 * del dispositivo EN ESE MOMENTO (nunca editable por el usuario), y guarda de forma atómica la operación en la
 * outbox y su efecto local en `entities`. Siempre escriben primero en IndexedDB; subir (directo o por lote) es
 * responsabilidad de sync-client.
 */
import { createClientOperationId } from "../client-operation-id";
import { pickReportEditableValues } from "../report-fields";
import { assignmentsForNow, currentShiftAt } from "../shifts";
import { commitAction, listEntities, listOperations } from "./outbox";
import type { CommitInput } from "./outbox";
import type {
  ActionContext, EntityRecord, LocalChange, LocalReport, LocalStop, OperationType, OutboxOperation,
} from "./types";
import {
  validateAddChange, validateCancelReport, validateCancelStop, validateCloseStop, validateEditable,
  validateSetStopCategory, validateStartReport, validateStartStop, validateSubmit,
  type ValidationFailure,
} from "./validation";

export type ActionOk = {
  ok: true;
  operation: OutboxOperation;
  /** Pendientes (pending/syncing) que ya existían antes de esta acción: si es 0 y hay red, se puede enviar directo. */
  priorPending: number;
  reportId?: string;
  stopId?: string;
  changeId?: string;
};
export type ActionResult = ActionOk | ValidationFailure;

export interface ShiftState {
  /** Reporte activo (DRAFT) o, si no hay, el más reciente (para mostrar el resultado del último envío). */
  report: LocalReport | null;
  /** Reporte DRAFT del usuario (null si no tiene uno activo). */
  active: LocalReport | null;
  stops: LocalStop[];
  changes: LocalChange[];
}

/** Estado local del turno del usuario, leído de `entities`. */
export async function loadShiftState(userId: string): Promise<ShiftState> {
  const entities = await listEntities(userId);
  const reports = entities.filter((entity) => entity.entityType === "report").map((entity) => entity.data as LocalReport);
  const activeBase = reports.find((report) => report.status === "DRAFT") ?? null;
  const latest = [...reports].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0] ?? null;
  const base = activeBase ?? latest;
  // Un conflicto o rechazo sin resolver bloquea el reporte hasta que el usuario lo revise en el resumen.
  const problem = base
    ? (await listOperations(userId, ["conflict", "rejected"])).find((operation) => operation.reportId === base.id)
    : undefined;
  const report: LocalReport | null = base && problem
    ? { ...base, blocked: problem.resultMessage ?? "Hay un problema de sincronización con este reporte." }
    : base;
  const reportId = report?.id;
  const active = activeBase && report && report.id === activeBase.id ? report : activeBase;
  return {
    report,
    active,
    stops: entities.filter((entity) => entity.entityType === "stop" && entity.reportId === reportId).map((entity) => entity.data as LocalStop),
    changes: entities.filter((entity) => entity.entityType === "change" && entity.reportId === reportId).map((entity) => entity.data as LocalChange),
  };
}

const fail = (code: string, message: string): ValidationFailure => ({ ok: false, code, message });

function reportEntity(userId: string, report: LocalReport, synced = false): EntityRecord {
  return { userId, entityType: "report", id: report.id, reportId: report.id, data: report, synced };
}

async function commit(
  ctx: ActionContext,
  type: OperationType,
  payload: Record<string, unknown>,
  capturedAt: Date,
  effects: Pick<CommitInput, "entities" | "removeEntities">,
  baseVersion?: string | null,
): Promise<{ operation: OutboxOperation; priorPending: number }> {
  const { operation, priorPending } = await commitAction({
    userId: ctx.userId,
    operation: { type, payload, capturedAt: capturedAt.toISOString(), capturedOffline: ctx.offline, baseVersion: baseVersion ?? null },
    ...effects,
  });
  return { operation, priorPending };
}

const clock = (ctx: ActionContext) => ctx.now ?? new Date();

export async function startReport(ctx: ActionContext, machineId: string): Promise<ActionResult> {
  const now = clock(ctx);
  const state = await loadShiftState(ctx.userId);
  const invalid = validateStartReport({ active: state.active, machineId, snapshot: ctx.snapshot, now });
  if (invalid) return invalid;
  const shift = currentShiftAt(ctx.snapshot.shifts, now)!;
  const machine = assignmentsForNow(ctx.snapshot.assignments, ctx.snapshot.shifts, now).assignments
    .find((assignment) => assignment.machine_id === machineId)?.machine;
  const reportId = createClientOperationId();
  const startedAt = now.toISOString();
  const report: LocalReport = {
    id: reportId, folio: null, machine_id: machineId, machine_label: machine ? `${machine.code} · ${machine.name}` : "",
    status: "DRAFT", started_at: startedAt, report_date: shift.operationalDate, shift_id: shift.shiftId,
    server_updated_at: null, created_at: startedAt,
  };
  const { operation, priorPending } = await commit(
    ctx, "CREATE_REPORT", { reportId, machineId, startedAt }, now, { entities: [reportEntity(ctx.userId, report)] },
  );
  return { ok: true, operation, priorPending, reportId };
}

export async function saveReportFields(ctx: ActionContext, reportId: string, fields: Record<string, unknown>): Promise<ActionResult> {
  const now = clock(ctx);
  const state = await loadShiftState(ctx.userId);
  const report = state.report?.id === reportId ? state.report : null;
  const invalid = validateEditable(report);
  if (invalid) return invalid;
  // report_date y shift_id los fija el sistema; solo se guardan los campos editables aprobados.
  const picked = pickReportEditableValues(fields);
  delete picked.report_date;
  delete picked.shift_id;
  if (Object.keys(picked).length === 0) return fail("VALIDATION", "No hay campos que guardar.");
  const next = { ...report!, ...picked } as LocalReport;
  const { operation, priorPending } = await commit(
    ctx, "SAVE_REPORT_FIELDS", { reportId, fields: picked }, now, { entities: [reportEntity(ctx.userId, next)] }, report!.server_updated_at,
  );
  return { ok: true, operation, priorPending, reportId };
}

export async function startStop(
  ctx: ActionContext, reportId: string, input: { categoryId?: string | null; description?: string | null },
): Promise<ActionResult> {
  const now = clock(ctx);
  const state = await loadShiftState(ctx.userId);
  const report = state.report?.id === reportId ? state.report : null;
  const invalid = validateStartStop({ report, stops: state.stops, categoryId: input.categoryId, capturedAt: now, snapshot: ctx.snapshot, now });
  if (invalid) return invalid;
  const category = input.categoryId ? ctx.snapshot.catalogs.stopCategories.find((entry) => entry.id === input.categoryId) ?? null : null;
  const stopId = createClientOperationId();
  const startedAt = now.toISOString();
  const description = input.description?.trim() || null;
  const stop: LocalStop = {
    id: stopId, report_id: reportId, started_at: startedAt, ended_at: null, duration_seconds: null, description,
    cancelled_at: null, cancellation_reason: null,
    stop_category: category ? { id: category.id, code: category.code, name: category.name } : null,
  };
  const { operation, priorPending } = await commit(
    ctx, "START_STOP",
    { stopId, reportId, startedAt, ...(category ? { categoryId: category.id } : {}), ...(description ? { description } : {}) },
    now, { entities: [{ userId: ctx.userId, entityType: "stop", id: stopId, reportId, data: stop, synced: false }] },
  );
  return { ok: true, operation, priorPending, reportId, stopId };
}

async function openStopContext(ctx: ActionContext, stopId: string) {
  const state = await loadShiftState(ctx.userId);
  const stop = state.stops.find((entry) => entry.id === stopId) ?? null;
  return { state, stop, report: stop && state.report?.id === stop.report_id ? state.report : null };
}

export async function closeStop(ctx: ActionContext, stopId: string, input: { categoryId?: string | null }): Promise<ActionResult> {
  const now = clock(ctx);
  const { stop, report } = await openStopContext(ctx, stopId);
  const invalid = validateCloseStop({ report, stop, categoryId: input.categoryId, capturedAt: now, snapshot: ctx.snapshot, now });
  if (invalid) return invalid;
  const category = input.categoryId ? ctx.snapshot.catalogs.stopCategories.find((entry) => entry.id === input.categoryId) ?? null : null;
  const endedAt = now.toISOString();
  const closed: LocalStop = {
    ...stop!, ended_at: endedAt,
    duration_seconds: Math.max(0, Math.floor((now.getTime() - Date.parse(stop!.started_at)) / 1000)),
    stop_category: category ? { id: category.id, code: category.code, name: category.name } : stop!.stop_category,
  };
  const { operation, priorPending } = await commit(
    ctx, "CLOSE_STOP",
    { stopId, reportId: stop!.report_id, endedAt, ...(category ? { categoryId: category.id } : {}) },
    now, { entities: [{ userId: ctx.userId, entityType: "stop", id: stopId, reportId: stop!.report_id, data: closed, synced: false }] },
  );
  return { ok: true, operation, priorPending, reportId: stop!.report_id, stopId };
}

export async function setStopCategory(ctx: ActionContext, stopId: string, categoryId: string): Promise<ActionResult> {
  const now = clock(ctx);
  const { stop, report } = await openStopContext(ctx, stopId);
  const invalid = validateSetStopCategory({ report, stop, categoryId, snapshot: ctx.snapshot });
  if (invalid) return invalid;
  const category = ctx.snapshot.catalogs.stopCategories.find((entry) => entry.id === categoryId)!;
  const updated: LocalStop = { ...stop!, stop_category: { id: category.id, code: category.code, name: category.name } };
  const { operation, priorPending } = await commit(
    ctx, "SET_STOP_CATEGORY", { stopId, reportId: stop!.report_id, categoryId }, now,
    { entities: [{ userId: ctx.userId, entityType: "stop", id: stopId, reportId: stop!.report_id, data: updated, synced: false }] },
  );
  return { ok: true, operation, priorPending, reportId: stop!.report_id, stopId };
}

export async function cancelStop(ctx: ActionContext, stopId: string, reason: string): Promise<ActionResult> {
  const now = clock(ctx);
  const { stop, report } = await openStopContext(ctx, stopId);
  const invalid = validateCancelStop({ report, stop, reason });
  if (invalid) return invalid;
  const cancelled: LocalStop = { ...stop!, cancelled_at: now.toISOString(), cancellation_reason: reason.trim() };
  const { operation, priorPending } = await commit(
    ctx, "CANCEL_STOP", { stopId, reportId: stop!.report_id, reason: reason.trim() }, now,
    { entities: [{ userId: ctx.userId, entityType: "stop", id: stopId, reportId: stop!.report_id, data: cancelled, synced: false }] },
  );
  return { ok: true, operation, priorPending, reportId: stop!.report_id, stopId };
}

export async function addChange(
  ctx: ActionContext, reportId: string, input: { changeTypeId: string; description: string },
): Promise<ActionResult> {
  const now = clock(ctx);
  const state = await loadShiftState(ctx.userId);
  const report = state.report?.id === reportId ? state.report : null;
  const invalid = validateAddChange({ report, changeTypeId: input.changeTypeId, description: input.description, capturedAt: now, snapshot: ctx.snapshot, now });
  if (invalid) return invalid;
  const type = ctx.snapshot.catalogs.changeTypes.find((entry) => entry.id === input.changeTypeId)!;
  const changeId = createClientOperationId();
  const occurredAt = now.toISOString();
  const description = input.description.trim();
  const change: LocalChange = {
    id: changeId, report_id: reportId, change_type_id: type.id, change_type_name: type.name, description, occurred_at: occurredAt,
  };
  const { operation, priorPending } = await commit(
    ctx, "ADD_CHANGE", { changeId, reportId, changeTypeId: type.id, description, occurredAt }, now,
    { entities: [{ userId: ctx.userId, entityType: "change", id: changeId, reportId, data: change, synced: false }] },
  );
  return { ok: true, operation, priorPending, reportId, changeId };
}

export async function submitReport(ctx: ActionContext, reportId: string): Promise<ActionResult> {
  const now = clock(ctx);
  const state = await loadShiftState(ctx.userId);
  const report = state.report?.id === reportId ? state.report : null;
  const invalid = validateSubmit({ report, stops: state.stops });
  if (invalid) return invalid;
  const next: LocalReport = { ...report!, status: "SUBMITTED" };
  const { operation, priorPending } = await commit(ctx, "SUBMIT_REPORT", { reportId }, now, { entities: [reportEntity(ctx.userId, next)] });
  return { ok: true, operation, priorPending, reportId };
}

export async function cancelReport(ctx: ActionContext, reportId: string, reason: string): Promise<ActionResult> {
  const now = clock(ctx);
  const state = await loadShiftState(ctx.userId);
  const report = state.report?.id === reportId ? state.report : null;
  const invalid = validateCancelReport({ report, reason });
  if (invalid) return invalid;
  const next: LocalReport = { ...report!, status: "CANCELLED", cancellation_reason: reason.trim() };
  const { operation, priorPending } = await commit(
    ctx, "CANCEL_REPORT", { reportId, reason: reason.trim() }, now, { entities: [reportEntity(ctx.userId, next)] },
  );
  return { ok: true, operation, priorPending, reportId };
}
