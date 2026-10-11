/**
 * Inicio de sesión sin conexión (T091, FR-006, FR-006a/b/c, R8).
 *
 * - La contraseña SOLO existe al escribirla en el formulario. Con ella se deriva un verificador PBKDF2-SHA-256
 *   (sal aleatoria de 16 B por usuario y dispositivo, 32 B derivados) que se guarda en IndexedDB (`offlineCredentials`);
 *   la contraseña jamás se guarda ni se registra (Principio III).
 * - El verificador se deriva ANTES de enviar el formulario de login en línea y queda como matrícula PENDIENTE
 *   (`meta.pendingEnrollment`). Solo se confirma (`finalizeEnrollment`) cuando la primera página autenticada recibe la
 *   identidad del servidor; si el login falla se descarta, y una matrícula pendiente nunca habilita nada.
 * - Cada login en línea reemplaza el verificador (sal nueva) y renueva `enabledUntil` (ventana configurable, 7 días).
 * - `verifyOffline` aplica el bloqueo local 5 fallos → 15 min (persistido por usuario, también bloquea la contraseña
 *   correcta) y devuelve siempre el mismo mensaje para contraseña errónea o bloqueo.
 * - La sesión local (`meta.localSession`) vale solo para el rol guardado y se elimina al cerrar sesión o al iniciar
 *   sesión en línea y caduca a las 12 h o al vencer la habilitación. Cada inicio de sesión sin conexión (cualquier rol)
 *   deja un marcador que la primera página en línea envía a POST /api/offline/login-audit (FR-006c).
 */
import { parseIntervalMs } from "../shifts";
import type { AppRole } from "../types";
import { getMeta, idbGet, requestResult, setMeta, withTransaction } from "./db";

export const OFFLINE_PBKDF2_ITERATIONS = 600_000;

let configuredIterations = OFFLINE_PBKDF2_ITERATIONS;
/**
 * Solo para pruebas: reduce las iteraciones de las matrículas NUEVAS. Cada registro guarda las suyas, así que la
 * verificación no cambia. En producción nadie lo llama (siempre 600 000).
 */
export function configureOfflineAuth(options: { iterations?: number }) {
  configuredIterations = options.iterations ?? OFFLINE_PBKDF2_ITERATIONS;
}
export const getConfiguredIterations = () => configuredIterations;

/** La sesión local termina a las 12 h de su inicio o al vencer la habilitación (lo que ocurra antes). */
export const LOCAL_SESSION_MAX_MS = 12 * 3_600_000;
/** Tolerancia (entre la hora de /api/health y last_sign_in_at, ambas del servidor) al atar la matrícula a un inicio de sesión real. */
export const SIGN_IN_SKEW_MS = 30_000;
export const NEEDS_CONNECTION_MESSAGE = "Necesitas conexión para entrar";
export const INVALID_CREDENTIALS_MESSAGE = "Usuario o contraseña incorrectos";

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const DEFAULT_WINDOW_MS = 7 * 86_400_000;
const PENDING_TTL_MS = 10 * 60_000;
export const LOCK_AFTER_FAILURES = 5;
export const LOCK_DURATION_MS = 15 * 60_000;
const PENDING_KEY = "pendingEnrollment";
const SESSION_KEY = "localSession";

export interface LocalSession {
  userId: string;
  role: AppRole;
  username: string;
  fullName: string;
  startedAt: string;
  /** Fin de la habilitación offline del usuario al abrir la sesión (la sesión no puede durar más). */
  enabledUntil?: string;
  /** Marca de que la identidad se verificó sin conexión (aún no la validó el servidor). */
  offline: true;
}

/** Identidad que el servidor confirma (GET /api/auth/session-info) tras un login en línea. */
export interface OfflineProfile {
  userId: string;
  username: string;
  fullName: string;
  role: AppRole;
  offlineLoginWindow?: string | null;
  /** Hora del inicio de sesión en línea según el servidor (last_sign_in_at); la matrícula solo se confirma si es posterior a su inicio. */
  signInAt?: string | null;
  /** Hora actual del SERVIDOR (session-info.serverTime): mide el vencimiento de la matrícula pendiente sin el reloj del dispositivo. */
  serverTime?: string | null;
}

interface CredentialRecord {
  usernameNormalized: string;
  username: string;
  userId: string;
  role: AppRole;
  fullName: string;
  salt: string;
  verifier: string;
  iterations: number;
  enrolledAt: string;
  enabledUntil: string;
  failedCount: number;
  lockedUntil: string | null;
}

interface PendingEnrollment {
  usernameNormalized: string;
  /** Hora del SERVIDOR (X-Server-Time de /api/health) al iniciar la matrícula: nunca el reloj del dispositivo. */
  serverCreatedAt: string;
  salt: string;
  verifier: string;
  iterations: number;
}

export type VerifyResult =
  | { status: "ok"; session: LocalSession }
  | { status: "needs-connection" }
  | { status: "invalid" }
  | { status: "locked"; until: string };

export const normalizeUsername = (value: string) => value.trim().toLowerCase();
export const landingPathFor = (role: AppRole) => (role === "OPERATOR" ? "/turno" : "/consulta-offline");

// --------------------------------------------------------------------------- primitivas de criptografía

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function deriveVerifier(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto no está disponible en este navegador.");
  const key = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

// --------------------------------------------------------------------------- matrícula

/** Deriva el verificador con la contraseña tecleada y lo deja como matrícula PENDIENTE (aún no habilita nada). */
export async function beginEnrollment(username: string, password: string, serverTime: string | null | undefined): Promise<boolean> {
  // Sin hora del servidor no se puede atar la matrícula a un inicio de sesión real: no se matricula (el login en línea
  // sigue su curso normal) y se descarta cualquier matrícula pendiente anterior.
  if (!serverTime || !Number.isFinite(Date.parse(serverTime))) {
    await discardPendingEnrollment();
    return false;
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iterations = configuredIterations;
  const verifier = await deriveVerifier(password, salt, iterations);
  const pending: PendingEnrollment = {
    usernameNormalized: normalizeUsername(username), salt: toBase64(salt), verifier: toBase64(verifier),
    iterations, serverCreatedAt: new Date(serverTime).toISOString(),
  };
  await setMeta(PENDING_KEY, pending);
  return true;
}

const LOGOUT_KEY = "serverLogoutPending";

/**
 * Cerrar sesión SIN conexión no puede cerrar la cookie del servidor: queda marcado y se completa en la primera página
 * con conexión (bootstrap.ts), para que el siguiente usuario del dispositivo no herede la sesión en línea del anterior.
 */
export async function markServerLogoutPending(): Promise<void> {
  await setMeta(LOGOUT_KEY, { at: new Date().toISOString() });
}
export async function isServerLogoutPending(): Promise<boolean> {
  return Boolean(await getMeta(LOGOUT_KEY));
}
export async function clearServerLogoutPending(): Promise<void> {
  await withTransaction(["meta"], "readwrite", async (tx) => { await requestResult(tx.objectStore("meta").delete(LOGOUT_KEY)); });
}

export async function hasPendingEnrollment(): Promise<boolean> {
  return Boolean(await getMeta<PendingEnrollment>(PENDING_KEY));
}

/** El login en línea falló (o se abandonó): no queda nada habilitado. */
export async function discardPendingEnrollment(): Promise<void> {
  await withTransaction(["meta"], "readwrite", async (tx) => { await requestResult(tx.objectStore("meta").delete(PENDING_KEY)); });
}

/**
 * El servidor confirmó la identidad tras un login en línea: la matrícula pendiente pasa a ser el verificador del
 * usuario, con `enabledUntil = ahora + ventana`. También retira cualquier sesión local (el login en línea la sustituye).
 */
export async function finalizeEnrollment(profile: OfflineProfile, now: Date = new Date()): Promise<{ status: "enrolled" | "no-pending" | "mismatch" | "stale-session" }> {
  const pending = await getMeta<PendingEnrollment>(PENDING_KEY);
  if (!pending) return { status: "no-pending" };
  // FR-006a: TODO se compara con horas del SERVIDOR (serverCreatedAt, signInAt, serverTime); el reloj del dispositivo no
  // interviene, así que un reloj atrasado o adelantado no puede ni confirmar una sesión previa ni descartar un login legítimo.
  const serverNow = profile.serverTime ? Date.parse(profile.serverTime) : NaN;
  const serverCreated = Date.parse(pending.serverCreatedAt);
  if (!Number.isFinite(serverNow) || !Number.isFinite(serverCreated)) {
    await discardPendingEnrollment();
    return { status: "stale-session" };
  }
  if (serverNow - serverCreated > PENDING_TTL_MS) {
    await discardPendingEnrollment();
    return { status: "no-pending" };
  }
  // La matrícula solo vale si el servidor registró un inicio de sesión REAL posterior a su inicio; una sesión previa
  // (misma cookie que ya existía) no la confirma.
  const signIn = profile.signInAt ? Date.parse(profile.signInAt) : NaN;
  if (!Number.isFinite(signIn) || signIn < serverCreated - SIGN_IN_SKEW_MS) {
    await discardPendingEnrollment();
    return { status: "stale-session" };
  }
  const usernameNormalized = normalizeUsername(profile.username);
  if (pending.usernameNormalized !== usernameNormalized) {
    await discardPendingEnrollment();
    return { status: "mismatch" };
  }
  const windowMs = parseIntervalMs(profile.offlineLoginWindow, DEFAULT_WINDOW_MS);
  const record: CredentialRecord = {
    usernameNormalized, username: profile.username, userId: profile.userId, role: profile.role, fullName: profile.fullName,
    salt: pending.salt, verifier: pending.verifier, iterations: pending.iterations,
    enrolledAt: now.toISOString(), enabledUntil: new Date(now.getTime() + windowMs).toISOString(), failedCount: 0, lockedUntil: null,
  };
  await withTransaction(["offlineCredentials", "meta"], "readwrite", async (tx) => {
    await requestResult(tx.objectStore("offlineCredentials").put(record));
    await requestResult(tx.objectStore("meta").delete(PENDING_KEY));
    await requestResult(tx.objectStore("meta").delete(SESSION_KEY));
  });
  return { status: "enrolled" };
}

export async function getCredentialRecord(username: string): Promise<CredentialRecord | null> {
  return (await idbGet<CredentialRecord>("offlineCredentials", normalizeUsername(username))) ?? null;
}

// --------------------------------------------------------------------------- verificación y bloqueo

async function mutateRecord(usernameNormalized: string, change: (record: CredentialRecord) => CredentialRecord) {
  await withTransaction(["offlineCredentials"], "readwrite", async (tx) => {
    const store = tx.objectStore("offlineCredentials");
    const current = await requestResult(store.get(usernameNormalized)) as CredentialRecord | undefined;
    if (current) await requestResult(store.put(change(current)));
  });
}

/**
 * Verifica usuario y contraseña contra el verificador de este dispositivo. No crea sesión (ver `loginOffline`).
 * Usuario sin matrícula o ventana vencida → `needs-connection`; contraseña errónea → `invalid`; bloqueado → `locked`
 * (la interfaz muestra el mismo mensaje genérico para ambos).
 */
export async function verifyOffline(username: string, password: string, now: Date = new Date()): Promise<VerifyResult> {
  const usernameNormalized = normalizeUsername(username);
  const record = await getCredentialRecord(usernameNormalized);
  if (!record || Date.parse(record.enabledUntil) <= now.getTime()) return { status: "needs-connection" };

  if (record.lockedUntil) {
    if (Date.parse(record.lockedUntil) > now.getTime()) return { status: "locked", until: record.lockedUntil };
    await mutateRecord(usernameNormalized, (current) => ({ ...current, failedCount: 0, lockedUntil: null }));
    record.failedCount = 0;
  }

  const expected = fromBase64(record.verifier);
  const actual = await deriveVerifier(password, fromBase64(record.salt), record.iterations);
  if (sameBytes(expected, actual)) {
    if (record.failedCount > 0) await mutateRecord(usernameNormalized, (current) => ({ ...current, failedCount: 0, lockedUntil: null }));
    return {
      status: "ok",
      session: { userId: record.userId, role: record.role, username: record.username, fullName: record.fullName, startedAt: now.toISOString(), enabledUntil: record.enabledUntil, offline: true },
    };
  }

  let lockedUntil: string | null = null;
  await mutateRecord(usernameNormalized, (current) => {
    const failedCount = current.failedCount + 1;
    lockedUntil = failedCount >= LOCK_AFTER_FAILURES ? new Date(now.getTime() + LOCK_DURATION_MS).toISOString() : null;
    return { ...current, failedCount, lockedUntil };
  });
  return lockedUntil ? { status: "locked", until: lockedUntil } : { status: "invalid" };
}

// --------------------------------------------------------------------------- sesión local

export async function startLocalSession(session: LocalSession): Promise<void> {
  await setMeta(SESSION_KEY, session);
}

/**
 * Sesión local vigente. Termina a las 12 h de su inicio o al pasar `enabledUntil` (lo que ocurra antes); se comprueba
 * cada vez que un shell la lee y, si venció, se elimina.
 */
export async function getLocalSession(now: Date = new Date()): Promise<LocalSession | null> {
  try {
    const session = await getMeta<LocalSession>(SESSION_KEY);
    if (!session || typeof session.userId !== "string" || session.offline !== true) return null;
    const started = Date.parse(session.startedAt);
    const limits = [started + LOCAL_SESSION_MAX_MS];
    if (session.enabledUntil) limits.push(Date.parse(session.enabledUntil));
    if (!Number.isFinite(started) || limits.some((limit) => !Number.isFinite(limit) || now.getTime() >= limit)) {
      await clearLocalSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function clearLocalSession(): Promise<void> {
  try {
    await withTransaction(["meta"], "readwrite", async (tx) => { await requestResult(tx.objectStore("meta").delete(SESSION_KEY)); });
  } catch { /* sin IndexedDB no hay sesión local que cerrar */ }
}

// --------------------------------------------------------------------------- marcadores de auditoría (FR-006c)

const MARKERS_KEY = "offlineLoginMarkers";

export interface OfflineLoginMarker { operationId: string; userId: string; startedAt: string }

export async function listOfflineLoginMarkers(): Promise<OfflineLoginMarker[]> {
  return (await getMeta<OfflineLoginMarker[]>(MARKERS_KEY)) ?? [];
}

async function mutateMarkers(change: (markers: OfflineLoginMarker[]) => OfflineLoginMarker[]) {
  await withTransaction(["meta"], "readwrite", async (tx) => {
    const store = tx.objectStore("meta");
    const current = ((await requestResult(store.get(MARKERS_KEY)) as { value: OfflineLoginMarker[] } | undefined)?.value) ?? [];
    await requestResult(store.put({ key: MARKERS_KEY, value: change(current) }));
  });
}

/**
 * Cada inicio de sesión sin conexión (de cualquier rol) deja un marcador {operationId, startedAt}. La primera página en
 * línea donde el servidor confirme al mismo usuario lo envía a POST /api/offline/login-audit y lo borra (bootstrap.ts).
 */
export async function addOfflineLoginMarker(userId: string, startedAt: string) {
  const marker: OfflineLoginMarker = { operationId: globalThis.crypto.randomUUID(), userId, startedAt };
  await mutateMarkers((markers) => [...markers, marker]);
  return marker;
}

export async function removeOfflineLoginMarker(operationId: string) {
  await mutateMarkers((markers) => markers.filter((marker) => marker.operationId !== operationId));
}

/** Verificación + sesión local + marcador de auditoría. Es lo que ejecuta la pantalla de acceso sin conexión. */
export async function loginOffline(username: string, password: string, now: Date = new Date()): Promise<VerifyResult> {
  const result = await verifyOffline(username, password, now);
  if (result.status !== "ok") return result;
  await startLocalSession(result.session);
  await addOfflineLoginMarker(result.session.userId, result.session.startedAt);
  return result;
}
