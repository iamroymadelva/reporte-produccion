/**
 * Preferencia de formato de hora por usuario (solo presentación): `24h` (por defecto) o `12h` con a. m./p. m.
 * Fuente de verdad: `user_metadata.time_format` de Supabase Auth. Copia local en IndexedDB (`meta`, clave
 * `timeFormat:<userId>`) para que el selector la lea sin red y sin mezclar usuarios en un dispositivo compartido.
 * El valor interno de fecha y hora siempre es `YYYY-MM-DDTHH:mm` en 24 h, sea cual sea la preferencia.
 */
import * as React from "react";
import type { TimeFormat } from "./local-datetime";
import { getMeta, setMeta } from "./offline/db";

export type { TimeFormat };
export const TIME_FORMATS = ["24h", "12h"] as const;
export const DEFAULT_TIME_FORMAT: TimeFormat = "24h";

export function isTimeFormat(value: unknown): value is TimeFormat {
  return value === "24h" || value === "12h";
}

/** Valor seguro: cualquier cosa fuera de la lista cerrada cae en 24 h. */
export function normalizeTimeFormat(value: unknown): TimeFormat {
  return isTimeFormat(value) ? value : DEFAULT_TIME_FORMAT;
}

export const timeFormatKey = (userId: string) => `timeFormat:${userId}`;

const cache = new Map<string, TimeFormat>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Lee la copia local (IndexedDB). Nunca hace peticiones de red y nunca lanza. */
export async function loadTimeFormat(userId: string): Promise<TimeFormat> {
  try {
    const stored = await getMeta<unknown>(timeFormatKey(userId));
    if (isTimeFormat(stored) && cache.get(userId) !== stored) { cache.set(userId, stored); emit(); }
    return normalizeTimeFormat(stored ?? cache.get(userId));
  } catch {
    return cache.get(userId) ?? DEFAULT_TIME_FORMAT;
  }
}

/** Guarda la copia local de ESTE usuario y avisa a los selectores abiertos. Nunca lanza. */
export async function storeTimeFormat(userId: string, format: TimeFormat): Promise<void> {
  if (!userId) return;
  cache.set(userId, format);
  emit();
  try { await setMeta(timeFormatKey(userId), format); } catch { /* sin IndexedDB: queda en memoria durante la sesión */ }
}

/** Copia a IndexedDB la preferencia que el servidor publicó en <body> (data-user-id / data-time-format). */
export async function syncTimeFormatFromBody(body: { dataset: DOMStringMap } | null | undefined): Promise<void> {
  const userId = body?.dataset.userId;
  if (!userId) return;
  await storeTimeFormat(userId, normalizeTimeFormat(body?.dataset.timeFormat));
}

export function resetTimeFormatCache() {
  cache.clear();
  emit();
}

function currentUserId(explicit?: string | null) {
  if (explicit) return explicit;
  return typeof document !== "undefined" ? document.body?.dataset.userId || null : null;
}

/** Preferencia del usuario (explícito o el de la página). Sin preferencia guardada, 24 h. */
export function useTimeFormat(explicitUserId?: string | null): TimeFormat {
  const userId = currentUserId(explicitUserId);
  const subscribe = React.useCallback((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []);
  const format = React.useSyncExternalStore(
    subscribe,
    () => (userId ? cache.get(userId) : undefined) ?? DEFAULT_TIME_FORMAT,
    () => DEFAULT_TIME_FORMAT,
  );
  React.useEffect(() => { if (userId && !cache.has(userId)) void loadTimeFormat(userId); }, [userId]);
  return format;
}
