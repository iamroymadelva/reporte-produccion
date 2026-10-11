/**
 * Arranque del acceso sin conexión en cada página (T091/T092/T094), invocado desde BaseLayout:
 *  - en las pantallas de login: si volvió con `?error=`, el login falló → se DESCARTA la matrícula pendiente;
 *  - en cualquier otra página: si hay una matrícula pendiente, pregunta al servidor quién es la sesión en línea
 *    (GET /api/auth/session-info) y la confirma SOLO si el servidor registró un inicio de sesión posterior al inicio de
 *    la matrícula (`signInAt`); una sesión previa la descarta (FR-006a);
 *  - si hay marcadores de inicios de sesión sin conexión de ESTE usuario (cualquier rol), los envía a
 *    POST /api/offline/login-audit y los borra (FR-006c);
 *  - si la persona autenticada es manager o VIEWER, refresca en silencio el resumen de la consulta sin conexión.
 * No hace nada si no hay IndexedDB; nunca lanza.
 */
import {
  clearServerLogoutPending, discardPendingEnrollment, finalizeEnrollment, hasPendingEnrollment, isServerLogoutPending,
  listOfflineLoginMarkers, removeOfflineLoginMarker,
} from "./offline-auth";
import { refreshOverviewSilently } from "./overview";
import { refreshLoginGate } from "./sync-client";

const LOGIN_PATHS = new Set(["/iniciar-sesion", "/acceso-offline"]);

export interface BootstrapContext {
  pathname: string;
  search: string;
  /** userId y rol de la persona autenticada en esta página (BaseLayout los publica en el <body>); vacío en páginas públicas. */
  userId?: string | null;
  role?: string | null;
}

interface SessionInfo { userId?: string; username?: string; fullName?: string; role?: any; offlineLoginWindow?: string | null; signInAt?: string | null; serverTime?: string | null }

let running: Promise<void> | null = null;

/** Una sola ejecución a la vez (astro:page-load + carga inicial disparan el arranque dos veces). */
export function runOfflineBootstrap(context: BootstrapContext): Promise<void> {
  if (running) return running;
  running = bootstrap(context).finally(() => { running = null; });
  return running;
}

async function readSessionInfo(): Promise<{ status: "ok"; info: SessionInfo } | { status: "none" } | { status: "offline" }> {
  let response: Response;
  try {
    response = await fetch("/api/auth/session-info", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    return { status: "offline" };
  }
  if (!response.ok) return { status: "none" };
  const info = await response.json().catch(() => null) as SessionInfo | null;
  return info?.userId ? { status: "ok", info } : { status: "none" };
}

/** Envía los marcadores de ESTE usuario; se borran con applied/duplicate o con un rechazo definitivo (4xx). */
async function sendLoginMarkers(userId: string) {
  for (const marker of await listOfflineLoginMarkers()) {
    if (marker.userId !== userId) continue;
    try {
      const response = await fetch("/api/offline/login-audit", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: marker.operationId, startedAt: marker.startedAt }),
      });
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401)) await removeOfflineLoginMarker(marker.operationId);
    } catch {
      return; // sin red: se reintenta en la siguiente página
    }
  }
}

async function bootstrap(context: BootstrapContext): Promise<void> {
  try {
    // Un cierre de sesión hecho sin conexión se completa en cuanto hay red: el siguiente usuario no hereda la cookie.
    if (await isServerLogoutPending()) {
      try {
        const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", redirect: "manual" });
        if (response.ok || response.type === "opaqueredirect" || response.status === 303) {
          await clearServerLogoutPending();
          if (!LOGIN_PATHS.has(context.pathname)) window.location.assign("/iniciar-sesion");
          return;
        }
      } catch { /* sin red: se reintenta en la siguiente página */ }
    }
    if (LOGIN_PATHS.has(context.pathname)) {
      if (new URLSearchParams(context.search).has("error") && await hasPendingEnrollment()) await discardPendingEnrollment();
      return;
    }
    let userId = context.userId ?? null;
    let role = context.role ?? null;
    const pending = await hasPendingEnrollment();
    const markers = await listOfflineLoginMarkers();
    if (pending || markers.length > 0) {
      const session = await readSessionInfo();
      if (session.status === "offline") return; // se reintenta en la siguiente página mientras siga vigente
      if (session.status === "none") {
        if (pending) await discardPendingEnrollment(); // el login no llegó a ser válido: no queda nada habilitado
      } else {
        const info = session.info;
        if (pending) {
          if (info.username && info.role) {
            const result = await finalizeEnrollment({
              userId: info.userId!, username: info.username, fullName: info.fullName ?? "", role: info.role,
              offlineLoginWindow: info.offlineLoginWindow ?? null, signInAt: info.signInAt ?? null, serverTime: info.serverTime ?? null,
            });
            if (result.status === "enrolled") await refreshLoginGate(info.userId!);
          } else {
            await discardPendingEnrollment();
          }
        }
        userId = info.userId!;
        role = info.role ?? role;
        await sendLoginMarkers(userId);
      }
    }
    if (userId && role) await refreshOverviewSilently(userId, role);
  } catch {
    /* el acceso sin conexión es una mejora: un fallo aquí no debe romper la página */
  }
}
