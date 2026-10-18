/**
 * Fecha y hora local como texto `YYYY-MM-DDTHH:mm` (24 horas), el mismo valor que entregaba
 * `<input type="datetime-local">`. No lleva zona horaria: se interpreta con el reloj/zona del dispositivo.
 */
export const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export type LocalDateTimeParts = { date: Date; hours: number; minutes: number };

const pad = (value: number) => String(value).padStart(2, "0");

/** Devuelve las partes del valor, o null si no es una fecha y hora local válida. */
export function parseLocalDateTime(value: string | null | undefined): LocalDateTimeParts | null {
  const match = LOCAL_DATETIME_PATTERN.exec(value ?? "");
  if (!match) return null;
  const [year, month, day, hours, minutes] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  if (hours > 23 || minutes > 59) return null;
  return { date, hours, minutes };
}

/** Construye `YYYY-MM-DDTHH:mm` a partir de un día (fecha local) y la hora en 24 h. */
export function formatLocalDateTime(date: Date, hours: number, minutes: number): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hours)}:${pad(minutes)}`;
}

export type TimeFormat = "24h" | "12h";
export type DayPeriod = "AM" | "PM";

/** Hora de 24 h (0-23) → hora de reloj de 12 h (1-12) y periodo. 00 → 12 a. m.; 12 → 12 p. m. */
export function to12Hour(hours24: number): { hour: number; period: DayPeriod } {
  const period: DayPeriod = hours24 >= 12 ? "PM" : "AM";
  return { hour: hours24 % 12 === 0 ? 12 : hours24 % 12, period };
}

/** Hora de reloj de 12 h (1-12) y periodo → hora de 24 h (0-23). 12 a. m. → 0; 12 p. m. → 12. */
export function to24Hour(hour12: number, period: DayPeriod): number {
  return (hour12 % 12) + (period === "PM" ? 12 : 0);
}

export const periodLabel = (period: DayPeriod) => (period === "AM" ? "a. m." : "p. m.");

/** Texto para mostrar en español: `09/10/2026 18:37` (24 h) o `09/10/2026 06:37 p. m.` (12 h). */
export function displayLocalDateTime(value: string | null | undefined, format: TimeFormat = "24h"): string {
  const parts = parseLocalDateTime(value);
  if (!parts) return "";
  const { date, hours, minutes } = parts;
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  if (format === "12h") {
    const clock = to12Hour(hours);
    return `${day} ${pad(clock.hour)}:${pad(minutes)} ${periodLabel(clock.period)}`;
  }
  return `${day} ${pad(hours)}:${pad(minutes)}`;
}

/** Ahora (o el instante dado) como `YYYY-MM-DDTHH:mm` local. */
export function nowAsLocalDateTime(now: Date = new Date()): string {
  return formatLocalDateTime(now, now.getHours(), now.getMinutes());
}

/** Fecha local como texto `YYYY-MM-DD` (solo día, sin hora ni zona). Devuelve el día o null si no es válida. */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return parseLocalDateTime(`${value}T00:00`)?.date ?? null;
}

/** `YYYY-MM-DD` a partir de un día (fecha local del dispositivo). */
export function formatLocalDate(date: Date): string {
  return formatLocalDateTime(date, 0, 0).slice(0, 10);
}

/** Texto para mostrar en español: `09/10/2026`. Cadena vacía si el valor no es válido. */
export function displayLocalDate(value: string | null | undefined): string {
  const date = parseLocalDate(value);
  return date ? `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` : "";
}
