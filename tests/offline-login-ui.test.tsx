/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { Root } from "react-dom/client";
import { MACHINE_1, USER_A, activate, freshIndexedDb, installBrowser, makeSnapshot } from "./helpers/offline-env";

// Phase 8, interfaz: formulario de acceso (interceptor + flujo), resumen de pendientes con sesión local y cierre de
// sesión sin conexión. happy-dom + fake-indexeddb (no es un navegador real).
const browser = installBrowser("http://localhost:4321/iniciar-sesion");
const { createRoot } = await import("react-dom/client");
const { default: PendingSyncSummary } = await import("../src/components/offline/PendingSyncSummary");
const { useLogoutGuard } = await import("../src/components/offline/LogoutGuard");
const auth = await import("../src/lib/offline/offline-auth");
const flow = await import("../src/lib/offline/login-flow");
const sync = await import("../src/lib/offline/sync-client");
const actions = await import("../src/lib/offline/actions");

const PASSWORD = "Clave-Secreta-123";
let online: boolean;
let noServerTime = false;
/** Lo que el navegador cree (navigator.onLine): distinto de si /api/health responde. */
let navOnline = true;
Object.defineProperty(browser.navigator, "onLine", { configurable: true, get: () => navOnline });
let calls: string[];
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const text = () => document.body.textContent ?? "";
const eventually = async (check: () => boolean) => { for (let i = 0; i < 80 && !check(); i += 1) await wait(25); expect(check()).toBe(true); };

beforeEach(async () => {
  activate(browser);
  auth.configureOfflineAuth({ iterations: 1000 });
  navOnline = true; noServerTime = false;
  Object.assign(globalThis, { NodeFilter: browser.NodeFilter, HTMLFormElement: browser.HTMLFormElement, HTMLButtonElement: browser.HTMLButtonElement, HTMLAnchorElement: browser.HTMLAnchorElement });
  freshIndexedDb();
  sync.resetSyncClientForTests();
  online = true; calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(`${(init.method ?? "GET").toUpperCase()} ${url}`);
    if (!online) throw new TypeError("Failed to fetch");
    if (url === "/api/health") return new Response(null, { status: 204, headers: noServerTime ? {} : { "X-Server-Time": new Date().toISOString() } });
    if (url === "/api/auth/session-info") return new Response(JSON.stringify({ userId: USER_A, username: "op1", fullName: "Operario Uno", role: "OPERATOR", active: true, signInAt: new Date().toISOString(), serverTime: new Date().toISOString() }), { status: 200 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  document.body.replaceChildren();
});
afterEach(() => { sync.resetSyncClientForTests(); });

async function enrolOp1() {
  await auth.beginEnrollment("op1", PASSWORD, new Date().toISOString());
  await auth.finalizeEnrollment({ userId: USER_A, username: "op1", fullName: "Operario Uno", role: "OPERATOR", offlineLoginWindow: "7 days", signInAt: new Date().toISOString(), serverTime: new Date().toISOString() });
}

describe("flujo del formulario de acceso (T092)", () => {
  test("con conexión matricula el verificador pendiente y deja que el formulario se envíe", async () => {
    const attempt = await flow.prepareLogin("op1", PASSWORD);
    expect(attempt.kind).toBe("online");
    expect(await auth.hasPendingEnrollment()).toBe(true);
    expect(await auth.getCredentialRecord("op1")).toBeNull(); // pendiente ≠ habilitado
  });

  test("RONDA 3: /api/health sin X-Server-Time ⇒ el login en línea sigue pero NO se crea matrícula pendiente", async () => {
    noServerTime = true;
    expect(await flow.prepareLogin("op1", PASSWORD)).toEqual({ kind: "online" });
    expect(await auth.hasPendingEnrollment()).toBe(false);
    noServerTime = false;
    expect(await flow.readServerTime()).not.toBeNull();
  });

  test("RONDA 3: la matrícula pendiente guarda la hora del servidor de /api/health, no la del dispositivo", async () => {
    const attempt = await flow.prepareLogin("op1", PASSWORD);
    expect(attempt.kind).toBe("online");
    const pending = await (await import("../src/lib/offline/db")).getMeta<{ serverCreatedAt: string; createdAt?: string }>("pendingEnrollment");
    expect(Number.isNaN(Date.parse(pending!.serverCreatedAt))).toBe(false);
    expect(pending!.createdAt).toBeUndefined();
  });

  test("sin conexión y habilitado: entra y devuelve la ruta por rol; sin habilitar: 'Necesitas conexión para entrar'", async () => {
    await enrolOp1();
    online = false; navOnline = false;
    expect(await flow.prepareLogin("op1", PASSWORD)).toEqual({ kind: "offline-ok", path: "/turno" });
    expect(await flow.prepareLogin("op2", PASSWORD)).toEqual({ kind: "offline-failed", message: "Necesitas conexión para entrar" });
    expect(await flow.prepareLogin("op1", "mal")).toEqual({ kind: "offline-failed", message: "Usuario o contraseña incorrectos" });
  });

  test("tras 5 fallos sin conexión el mensaje sigue siendo el genérico, también con la contraseña correcta", async () => {
    await enrolOp1();
    online = false; navOnline = false;
    for (let i = 0; i < 5; i += 1) expect(await flow.prepareLogin("op1", "mal")).toEqual({ kind: "offline-failed", message: "Usuario o contraseña incorrectos" });
    expect(await flow.prepareLogin("op1", PASSWORD)).toEqual({ kind: "offline-failed", message: "Usuario o contraseña incorrectos" });
    expect(await auth.getLocalSession()).toBeNull();
  });

  test("MINOR-6: si /api/health falla pero el navegador cree estar en línea y no hay habilitación, cae al envío nativo (el login en línea no se bloquea)", async () => {
    online = false; // /api/health falla; navigator.onLine sigue true
    expect(await flow.prepareLogin("op2", PASSWORD)).toEqual({ kind: "online" });
    expect(await auth.hasPendingEnrollment()).toBe(false); // sin hora del servidor no se matricula (el login en línea sigue)
    await enrolOp1();
    expect(await flow.prepareLogin("op1", "mal")).toEqual({ kind: "offline-failed", message: "Usuario o contraseña incorrectos" }); // con habilitación y clave mala no se salta la verificación
    expect(await flow.prepareLogin("op1", PASSWORD)).toEqual({ kind: "offline-ok", path: "/turno" });
  });

  test("MINOR-6: si el código sin conexión lanza un error (p. ej. sin IndexedDB) y el navegador cree estar en línea, cae al envío nativo", async () => {
    const original = (globalThis as { indexedDB: unknown }).indexedDB;
    const { closeOfflineDb } = await import("../src/lib/offline/db");
    closeOfflineDb();
    (globalThis as { indexedDB: unknown }).indexedDB = undefined;
    online = false;
    try {
      expect(await flow.prepareLogin("op1", PASSWORD)).toEqual({ kind: "online" });
      navOnline = false;
      expect(await flow.prepareLogin("op1", PASSWORD)).toEqual({ kind: "offline-failed", message: "Necesitas conexión para entrar" });
    } finally {
      (globalThis as { indexedDB: unknown }).indexedDB = original;
    }
  });

  test("el interceptor de submit atiende solo formularios data-offline-login, muestra el error y no envía sin conexión", async () => {
    await enrolOp1();
    const form = document.createElement("form");
    form.method = "POST"; form.action = "/api/auth/login"; form.setAttribute("data-offline-login", "");
    form.innerHTML = '<div data-login-messages></div><input name="username" value="op2"><input name="password" value="x"><button type="submit">Iniciar sesión</button>';
    document.body.append(form);
    let nativeSubmits = 0;
    const originalSubmit = browser.HTMLFormElement.prototype.submit;
    browser.HTMLFormElement.prototype.submit = function () { nativeSubmits += 1; };
    let reachedDocument = 0;
    document.addEventListener("submit", () => { reachedDocument += 1; }, true);
    flow.installLoginInterceptor();
    online = false; navOnline = false;
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as never);
    await eventually(() => (form.querySelector("[data-login-messages]")?.textContent ?? "").includes("Necesitas conexión para entrar"));
    expect(nativeSubmits).toBe(0);
    expect(reachedDocument).toBe(0); // el interceptor corta la propagación antes que el de BaseLayout
    expect(form.querySelector("button")!.disabled).toBe(false);

    online = true; navOnline = true;
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as never);
    await eventually(() => nativeSubmits === 1);
    expect(await auth.hasPendingEnrollment()).toBe(true);
    browser.HTMLFormElement.prototype.submit = originalSubmit;
  });
});

describe("resumen de pendientes con sesión local (FR-006b)", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  async function offlineSessionWithPending() {
    await enrolOp1();
    online = false;
    await auth.loginOffline("op1", PASSWORD);
    const created = await actions.startReport({ userId: USER_A, snapshot: makeSnapshot(USER_A), now: new Date(Date.now() - 60_000), offline: true }, MACHINE_1);
    if (!created.ok) throw new Error(created.message);
    online = true;
  }

  test("con sesión local el botón 'Confirmar y subir' no se ofrece: pide iniciar sesión en línea", async () => {
    await offlineSessionWithPending();
    await act(async () => { root.render(<PendingSyncSummary userId={USER_A} />); });
    await act(async () => { browser.dispatchEvent(new browser.Event("offline")); });
    await act(async () => { browser.dispatchEvent(new browser.Event("online")); });
    await eventually(() => text().includes("Inicia sesión en línea para subir"));
    const upload = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Confirmar y subir");
    expect(upload).toBeDefined();
    expect(upload!.disabled).toBe(true);
    const link = [...document.querySelectorAll<HTMLAnchorElement>("a")].find((anchor) => anchor.textContent === "Iniciar sesión");
    expect(link?.getAttribute("href")).toBe("/iniciar-sesion?reauth=1");
    expect(calls.filter((entry) => entry.includes("/api/sync/batch"))).toHaveLength(0);
  });

  test("usuario inactivo: la ventana explica que los datos se conservaron y que solo el autor puede subirlos", async () => {
    await offlineSessionWithPending();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health") return new Response(null, { status: 204 });
      if (url === "/api/auth/session-info") return new Response(JSON.stringify({ code: "INACTIVE" }), { status: 403 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await act(async () => { root.render(<PendingSyncSummary userId={USER_A} />); });
    await act(async () => { browser.dispatchEvent(new browser.Event("offline")); });
    await act(async () => { browser.dispatchEvent(new browser.Event("online")); });
    await eventually(() => text().includes("Sesión cerrada"));
    expect(text()).toContain("Tus datos siguen guardados en este dispositivo");
    expect(text()).toContain("Nadie más puede subirlos");
    const upload = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Confirmar y subir");
    expect(upload!.disabled).toBe(true);
    expect(await auth.getLocalSession()).toBeNull();
  });
});

describe("cerrar sesión sin conexión", () => {
  let root: Root;
  let container: HTMLDivElement;
  let submitted = 0;
  function Harness() {
    const guard = useLogoutGuard(undefined, () => { submitted += 1; });
    return <><button type="button" onClick={guard.request}>Salir</button>{guard.dialog}</>;
  }
  beforeEach(() => { submitted = 0; container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  test("sin conexión se cierra la sesión local, se anota el cierre pendiente en el servidor y no se envía el formulario", async () => {
    await enrolOp1();
    await auth.loginOffline("op1", PASSWORD);
    await act(async () => { browser.dispatchEvent(new browser.Event("offline")); });
    await act(async () => { root.render(<Harness />); });
    document.cookie = "sb-127-auth-token=abc; Path=/";
    document.cookie = "tema=oscuro; Path=/";
    expect(document.cookie).toContain("sb-127-auth-token");
    const original = browser.location.assign;
    let target = "";
    (browser.location as { assign: (url: string) => void }).assign = (url: string) => { target = url; };
    await act(async () => { document.querySelector<HTMLButtonElement>("button")!.click(); await new Promise((resolve) => setTimeout(resolve, 60)); });
    (browser.location as { assign: unknown }).assign = original;
    expect(submitted).toBe(0);
    expect(await auth.getLocalSession()).toBeNull();
    expect(await auth.isServerLogoutPending()).toBe(true);
    expect(target).toBe("/iniciar-sesion");
    // MINOR-7: las cookies sb-* no son HttpOnly, así que el logout sin conexión las borra; las demás no se tocan.
    expect(document.cookie).not.toContain("sb-127-auth-token");
    expect(document.cookie).toContain("tema=oscuro");
  });
});
