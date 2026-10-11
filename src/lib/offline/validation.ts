/**
 * Reglas de la BD aplicadas en el cliente para el modo offline (T080). Funciones puras: reciben el estado local
 * (reporte, paradas, catálogos del snapshot) y devuelven null si la acción es válida o el motivo en español.
 * El servidor las vuelve a validar al subir (apply_sync_operation); esto evita encolar lo que seguro se rechazaría.
 */
import { ACTIVE_STOP_SUBMISSION_ERROR, validateReportForSubmission, type ReportFieldErrors } from "../report-validation";
import { assignmentsForNow, currentShiftAt } from "../shifts";
import { isActiveStop } from "../stop-events";
import type { LocalChange, LocalReport, LocalStop, OfflineSnapshot } from "./types";

export type ValidationFailure = { ok: false; code: string; message: string; fieldErrors?: ReportFieldErrors };
export type Validation = ValidationFailure | null;

/** Tolerancia entre la hora de captura y las horas de la operación (igual que sync-protocol.md): 5 minutos. */
export const DEVICE_TIME_TOLERANCE_MS = 5 * 60_000;

const fail = (code: string, message: string, fieldErrors?: ReportFieldErrors): ValidationFailure => ({ ok: false, code, message, fieldErrors });

/** Horas del dispositivo: ni en el futuro ni posteriores a `capturedAt` + 5 min. Devuelve el motivo o null. */
export function validateDeviceTimes(input: { capturedAt: string; times: Array<string | null | undefined> }, now: Date): string | null {
  const captured = Date.parse(input.capturedAt);
  if (Number.isNaN(captured)) return "La hora del dispositivo no es válida.";
  if (captured > now.getTime() + DEVICE_TIME_TOLERANCE_MS) return "La hora del dispositivo está en el futuro.";
  for (const value of input.times) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isNaN(time)) return "La hora registrada no es válida.";
    if (time > now.getTime() + DEVICE_TIME_TOLERANCE_MS) return "La hora del dispositivo está en el futuro.";
    if (time > captured + DEVICE_TIME_TOLERANCE_MS) return "La hora registrada es posterior a la hora de captura de la operación.";
  }
  return null;
}

function timeCheck(capturedAt: Date, times: string[], now: Date): Validation {
  const message = validateDeviceTimes({ capturedAt: capturedAt.toISOString(), times }, now);
  return message ? fail("VALIDATION", message) : null;
}

/** El reporte solo admite cambios mientras es un borrador propio y sin bloqueo de sincronización. */
export function validateEditable(report: LocalReport | null | undefined): Validation {
  if (!report) return fail("NOT_FOUND", "No hay un reporte activo.");
  if (report.blocked) return fail("REPORT_BLOCKED", "Este reporte tiene un problema de sincronización. Revisa los pendientes antes de continuar.");
  if (report.status !== "DRAFT") return fail("NOT_EDITABLE", "El reporte ya no está activo y no admite cambios.");
  return null;
}

export function validateStartReport(input: {
  active: LocalReport | null;
  machineId: string;
  snapshot: OfflineSnapshot;
  now: Date;
}): Validation {
  if (input.active) {
    return fail("ACTIVE_REPORT_EXISTS", "Ya tienes un reporte activo. Envíalo o cancélalo antes de iniciar otro.");
  }
  if (!currentShiftAt(input.snapshot.shifts, input.now)) {
    return fail("NO_SHIFT", "No hay un turno activo en este momento.");
  }
  const { assignments } = assignmentsForNow(input.snapshot.assignments, input.snapshot.shifts, input.now);
  if (!assignments.some((assignment) => assignment.machine_id === input.machineId)) {
    return fail("NO_ASSIGNMENT", "Esta máquina no está asignada a tu turno. Solicita una asignación a tu coordinador.");
  }
  return null;
}

const hasCategory = (snapshot: OfflineSnapshot, id: string) => snapshot.catalogs.stopCategories.some((category) => category.id === id);

export function validateStartStop(input: {
  report: LocalReport | null;
  stops: LocalStop[];
  categoryId?: string | null;
  capturedAt: Date;
  snapshot: OfflineSnapshot;
  now: Date;
}): Validation {
  const editable = validateEditable(input.report);
  if (editable) return editable;
  const live = input.stops.filter((stop) => !stop.cancelled_at);
  if (live.some(isActiveStop)) return fail("STOP_ALREADY_OPEN", "Este reporte ya tiene una parada abierta.");
  const start = input.capturedAt.getTime();
  if (live.some((stop) => stop.ended_at && start < Date.parse(stop.ended_at))) {
    return fail("STOP_OVERLAP", "La parada se solapa con otra parada del reporte. Revisa la hora del dispositivo.");
  }
  if (input.categoryId && !hasCategory(input.snapshot, input.categoryId)) {
    return fail("VALIDATION", "Selecciona una categoría de parada activa.");
  }
  return timeCheck(input.capturedAt, [input.capturedAt.toISOString()], input.now);
}

export function validateCloseStop(input: {
  report: LocalReport | null;
  stop: LocalStop | null;
  categoryId?: string | null;
  capturedAt: Date;
  snapshot: OfflineSnapshot;
  now: Date;
}): Validation {
  const editable = validateEditable(input.report);
  if (editable) return editable;
  if (!input.stop || !isActiveStop(input.stop)) return fail("STOP_NOT_OPEN", "La parada ya no está abierta.");
  if (input.capturedAt.getTime() < Date.parse(input.stop.started_at)) {
    return fail("VALIDATION", "La hora de fin no puede ser anterior al inicio de la parada.");
  }
  const category = input.categoryId ?? input.stop.stop_category?.id ?? null;
  if (!category) return fail("CATEGORY_REQUIRED", "Selecciona la categoría de la parada antes de cerrarla.");
  if (!hasCategory(input.snapshot, category)) return fail("VALIDATION", "Selecciona una categoría de parada activa.");
  return timeCheck(input.capturedAt, [input.capturedAt.toISOString()], input.now);
}

export function validateSetStopCategory(input: {
  report: LocalReport | null; stop: LocalStop | null; categoryId: string; snapshot: OfflineSnapshot;
}): Validation {
  const editable = validateEditable(input.report);
  if (editable) return editable;
  if (!input.stop || !isActiveStop(input.stop)) return fail("STOP_NOT_OPEN", "La parada ya no está abierta.");
  if (!hasCategory(input.snapshot, input.categoryId)) return fail("VALIDATION", "Selecciona una categoría de parada activa.");
  return null;
}

export function validateCancelStop(input: { report: LocalReport | null; stop: LocalStop | null; reason: string }): Validation {
  const editable = validateEditable(input.report);
  if (editable) return editable;
  if (!input.stop || !isActiveStop(input.stop)) return fail("STOP_NOT_OPEN", "La parada ya no está abierta.");
  if (!input.reason.trim()) return fail("VALIDATION", "Debes indicar el motivo de cancelación de la parada.");
  return null;
}

export function validateAddChange(input: {
  report: LocalReport | null;
  changeTypeId: string;
  description: string;
  capturedAt: Date;
  snapshot: OfflineSnapshot;
  now: Date;
}): Validation {
  const editable = validateEditable(input.report);
  if (editable) return editable;
  if (!input.snapshot.catalogs.changeTypes.some((type) => type.id === input.changeTypeId)) {
    return fail("VALIDATION", "Selecciona un tipo de cambio activo.");
  }
  const description = input.description.trim();
  if (!description || description.length > 500) return fail("VALIDATION", "Describe el cambio (hasta 500 caracteres).");
  return timeCheck(input.capturedAt, [input.capturedAt.toISOString()], input.now);
}

export function validateSubmit(input: { report: LocalReport | null; stops: LocalStop[] }): Validation {
  const editable = validateEditable(input.report);
  if (editable) return editable;
  const live = input.stops.filter((stop) => !stop.cancelled_at);
  if (live.some(isActiveStop)) return fail("OPEN_STOP", ACTIVE_STOP_SUBMISSION_ERROR);
  if (live.some((stop) => !stop.stop_category)) {
    return fail("CATEGORY_REQUIRED", "No se puede enviar un reporte con paradas sin categoría.");
  }
  const fieldErrors = validateReportForSubmission(input.report as Record<string, unknown>);
  if (Object.keys(fieldErrors).length > 0) {
    return fail("MISSING_FIELDS", "Completa los campos obligatorios antes de enviar el reporte.", fieldErrors);
  }
  return null;
}

export function validateCancelReport(input: { report: LocalReport | null; reason: string }): Validation {
  if (!input.report) return fail("NOT_FOUND", "No hay un reporte activo.");
  if (input.report.status !== "DRAFT") return fail("NOT_EDITABLE", "El reporte ya no está activo y no admite cambios.");
  if (!input.reason.trim()) return fail("VALIDATION", "Debes indicar el motivo de cancelación.");
  return null;
}

export type { LocalChange };
