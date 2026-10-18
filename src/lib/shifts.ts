/**
 * Turno vigente y fecha operativa en America/Bogota (T078). Espejo en el cliente de `private.current_shift_at`
 * (supabase/migrations/20261010000300_roles_profiles_assignments.sql): los turnos que cruzan la medianoche
 * pertenecen al día en que empiezan (fecha operativa). Bogotá no tiene horario de verano: UTC-5 fijo.
 */
export interface ShiftDefinition {
  id: string;
  name?: string | null;
  /** "HH:MM" o "HH:MM:SS". */
  start_time: string;
  end_time: string;
  sort_order?: number | null;
}

export interface CurrentShift {
  shiftId: string;
  /** Fecha operativa "YYYY-MM-DD". */
  operationalDate: string;
  /** Instante en que termina el turno (UTC). */
  shiftEnd: Date;
}

const BOGOTA_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;

function secondsOfDay(time: string) {
  const [hours = "0", minutes = "0", seconds = "0"] = time.split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Math.floor(Number(seconds));
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Fecha civil "YYYY-MM-DD" a partir de un instante expresado como "hora local de Bogotá en UTC". */
function civilDate(localMs: number) {
  const date = new Date(localMs);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Turno que contiene `at` (solo se consideran los turnos recibidos, que deben ser los activos). */
export function currentShiftAt(shifts: ShiftDefinition[], at: Date | string): CurrentShift | null {
  const instant = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(instant.getTime())) return null;
  const localMs = instant.getTime() - BOGOTA_OFFSET_MS;
  const localDayStart = Math.floor(localMs / DAY_MS) * DAY_MS;
  const localSeconds = Math.floor((localMs - localDayStart) / 1000);

  const ordered = [...shifts].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || secondsOfDay(a.start_time) - secondsOfDay(b.start_time));
  for (const shift of ordered) {
    const start = secondsOfDay(shift.start_time);
    const end = secondsOfDay(shift.end_time);
    const crossesMidnight = start >= end;
    const inside = crossesMidnight ? localSeconds >= start || localSeconds < end : localSeconds >= start && localSeconds < end;
    if (!inside) continue;
    // Fecha operativa: el día en que empieza el turno.
    const operationalStart = crossesMidnight && localSeconds < end ? localDayStart - DAY_MS : localDayStart;
    const endLocalMs = operationalStart + (crossesMidnight ? DAY_MS : 0) + end * 1000;
    return {
      shiftId: shift.id,
      operationalDate: civilDate(operationalStart),
      shiftEnd: new Date(endLocalMs + BOGOTA_OFFSET_MS),
    };
  }
  return null;
}

/** Fecha civil de Bogotá ("YYYY-MM-DD") de un instante. */
export function bogotaDate(at: Date | string = new Date()) {
  const instant = typeof at === "string" ? new Date(at) : at;
  return civilDate(instant.getTime() - BOGOTA_OFFSET_MS);
}

export interface AssignmentLike {
  machine_id: string;
  shift_id: string;
  valid_from: string;
  valid_to: string | null;
  machine?: { id: string; code: string; name: string; active?: boolean; location?: string | null } | null;
}

/**
 * Asignaciones vigentes ahora: el snapshot incluye las de ayer y hoy (un turno nocturno cruza la medianoche);
 * aquí se filtran por el turno actual y la fecha operativa, igual que `apply_sync_operation`.
 */
export function assignmentsForNow<T extends AssignmentLike>(assignments: T[], shifts: ShiftDefinition[], at: Date | string = new Date()) {
  const current = currentShiftAt(shifts, at);
  if (!current) return { current: null, assignments: [] as T[] };
  const valid = assignments.filter((assignment) =>
    assignment.shift_id === current.shiftId
    && assignment.valid_from <= current.operationalDate
    && (assignment.valid_to === null || assignment.valid_to === undefined || assignment.valid_to >= current.operationalDate)
    && assignment.machine?.active !== false);
  return { current, assignments: valid };
}

/** Intervalo de PostgreSQL ("02:00:00", "7 days", "1 day 02:30:00") a milisegundos. */
export function parseIntervalMs(value: string | null | undefined, fallbackMs: number) {
  if (!value || typeof value !== "string") return fallbackMs;
  const text = value.trim();
  if (!text) return fallbackMs;
  let total = 0;
  let matched = false;
  const days = text.match(/(-?\d+)\s*(?:days?|d)\b/i);
  if (days) { total += Number(days[1]) * DAY_MS; matched = true; }
  const hours = text.match(/(-?\d+)\s*(?:hours?|hrs?|h)\b/i);
  if (hours) { total += Number(hours[1]) * 3_600_000; matched = true; }
  const minutes = text.match(/(-?\d+)\s*(?:minutes?|mins?)\b/i);
  if (minutes) { total += Number(minutes[1]) * 60_000; matched = true; }
  const clock = text.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    total += Number(clock[1]) * 3_600_000 + Number(clock[2]) * 60_000 + Number(clock[3] ?? 0) * 1000;
    matched = true;
  }
  return matched ? total : fallbackMs;
}

/** Un reporte está "abierto fuera de turno" cuando pasó el fin de turno más la gracia (`app_settings.off_shift_grace`). */
export function isOffShift(shiftEnd: Date, graceMs: number, now: Date = new Date()) {
  return now.getTime() > shiftEnd.getTime() + graceMs;
}
