/**
 * Flujo del formulario de inicio de sesión con soporte sin conexión (T092, FR-006, SC-012).
 *
 * Un único interceptor global (fase de captura en `window`, antes que el de BaseLayout) atiende los formularios con
 * `data-offline-login`:
 *  - con conexión: deriva el verificador PBKDF2 con la contraseña tecleada (matrícula PENDIENTE, nada se habilita aún)
 *    y envía el formulario normal a /api/auth/login; la primera página autenticada la confirma (bootstrap.ts) y si el
 *    login falla se descarta;
 *  - sin conexión (`/api/health` falla): verifica contra el verificador de este dispositivo; si acierta, abre la sesión
 *    local y navega por el rol guardado (OPERATOR → /turno; manager o VIEWER → /consulta-offline).
 * La contraseña solo vive en el campo del formulario; jamás se guarda.
 */
import { checkApplicationReachability } from "../connectivity";
import {
  INVALID_CREDENTIALS_MESSAGE, NEEDS_CONNECTION_MESSAGE, beginEnrollment, clearLocalSession, getLocalSession, landingPathFor, loginOffline,
} from "./offline-auth";

export type LoginAttempt =
  | { kind: "online" }
  | { kind: "offline-ok"; path: string }
  | { kind: "offline-failed"; message: string };

/** Hora del SERVIDOR (cabecera X-Server-Time de /api/health); null si no responde o no la informa. */
export async function readServerTime(): Promise<string | null> {
  try {
    const response = await fetch("/api/health", { method: "HEAD", cache: "no-store", credentials: "same-origin" });
    const value = response.headers.get("X-Server-Time");
    return value && Number.isFinite(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

/** Decide el camino del login: en línea (matricula y envía) o sin conexión (verifica localmente). */
export async function prepareLogin(username: string, password: string): Promise<LoginAttempt> {
  const online = await checkApplicationReachability({ force: true });
  if (online) {
    // La matrícula es una mejora: si IndexedDB o WebCrypto no están disponibles, o el servidor no informó su hora,
    // el login en línea sigue funcionando sin dejar el dispositivo habilitado.
    try { await beginEnrollment(username, password, await readServerTime()); } catch { /* sin acceso sin conexión en este dispositivo */ }
    return { kind: "online" };
  }
  // Si el navegador cree estar en línea (navigator.onLine) pero /api/health falló, el login en línea nunca se bloquea
  // por el código de matrícula: ante "sin habilitación" o un error se cae al envío nativo del formulario.
  const browserThinksOnline = typeof navigator !== "undefined" && navigator.onLine === true;
  const nativeFallback = async (): Promise<LoginAttempt> => {
    // /api/health no respondió: no hay hora del servidor, así que no se matricula; el formulario se envía igualmente.
    try { await beginEnrollment(username, password, null); } catch { /* sin IndexedDB */ }
    return { kind: "online" };
  };
  try {
    const result = await loginOffline(username, password);
    if (result.status === "ok") return { kind: "offline-ok", path: landingPathFor(result.session.role) };
    if (result.status === "needs-connection") {
      return browserThinksOnline ? nativeFallback() : { kind: "offline-failed", message: NEEDS_CONNECTION_MESSAGE };
    }
    return { kind: "offline-failed", message: INVALID_CREDENTIALS_MESSAGE }; // contraseña errónea o bloqueo: mismo mensaje
  } catch {
    return browserThinksOnline ? nativeFallback() : { kind: "offline-failed", message: NEEDS_CONNECTION_MESSAGE };
  }
}

function showMessage(form: HTMLFormElement, message: string | null) {
  const slot = form.querySelector<HTMLElement>("[data-login-messages]");
  if (!slot) return;
  slot.replaceChildren();
  if (!message) return;
  const alert = document.createElement("div");
  alert.setAttribute("role", "alert");
  alert.className = "rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-text";
  alert.textContent = message;
  slot.append(alert);
}

function setBusy(form: HTMLFormElement, busy: boolean) {
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent ?? "";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Comprobando…";
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

let installed = false;
let busy = false;

export function installLoginInterceptor() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-offline-login")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    busy = true;
    showMessage(form, null);
    setBusy(form, true);
    const username = String((form.elements.namedItem("username") as HTMLInputElement | null)?.value ?? "");
    const password = String((form.elements.namedItem("password") as HTMLInputElement | null)?.value ?? "");
    void prepareLogin(username, password).then((attempt) => {
      if (attempt.kind === "online") {
        form.setAttribute("data-astro-reload", "");
        HTMLFormElement.prototype.submit.call(form); // envío nativo: no vuelve a disparar el evento "submit"
        return;
      }
      busy = false;
      setBusy(form, false);
      if (attempt.kind === "offline-ok") { window.location.assign(attempt.path); return; }
      showMessage(form, attempt.message);
    }, () => {
      busy = false;
      setBusy(form, false);
      showMessage(form, NEEDS_CONNECTION_MESSAGE);
    });
  }, true);
}

/** Aviso de sesión local activa en la pantalla de acceso sin conexión: continuar o cerrarla. */
export async function renderLocalSessionNotice(slot: HTMLElement | null) {
  if (!slot) return;
  slot.replaceChildren();
  const session = await getLocalSession().catch(() => null);
  if (!session) return;
  const box = document.createElement("div");
  box.className = "space-y-2 rounded-lg border bg-muted/50 p-3 text-sm";
  const text = document.createElement("p");
  text.textContent = `Tienes una sesión sin conexión activa como ${session.fullName}.`;
  const actions = document.createElement("div");
  actions.className = "flex flex-wrap gap-2";
  const proceed = document.createElement("a");
  proceed.href = landingPathFor(session.role);
  proceed.setAttribute("data-astro-reload", "");
  proceed.className = "inline-flex min-h-9 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground";
  proceed.textContent = "Continuar";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "inline-flex min-h-9 items-center rounded-md border px-3 font-medium";
  close.textContent = "Cerrar sesión sin conexión";
  close.addEventListener("click", () => { void clearLocalSession().then(() => renderLocalSessionNotice(slot)); });
  actions.append(proceed, close);
  box.append(text, actions);
  slot.append(box);
}
