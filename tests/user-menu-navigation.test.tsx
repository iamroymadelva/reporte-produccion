/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Root } from "react-dom/client";
import { MACHINE_1, USER_A, activate, freshIndexedDb, installBrowser, makeSnapshot } from "./helpers/offline-env";

// «Volver al dashboard» en Turno y menú de usuario autónomo (única entrada de «Cerrar sesión» en Turno y en las
// pantallas offline). happy-dom + fake-indexeddb, sin red real.
const browser = installBrowser();
const { createRoot } = await import("react-dom/client");
const { default: OperatorShiftApp } = await import("../src/components/offline/OperatorShiftApp");
const { default: OfflineOverview } = await import("../src/components/offline/OfflineOverview");
const { default: UserMenu } = await import("../src/components/UserMenu");
const outbox = await import("../src/lib/offline/outbox");
const sync = await import("../src/lib/offline/sync-client");
const auth = await import("../src/lib/offline/offline-auth");
const actions = await import("../src/lib/offline/actions");

let root: Root;
let container: HTMLDivElement;
let calls: string[];
let assigned: string[];
let originalAssign: unknown;
const text = () => document.body.textContent ?? "";
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const eventually = async (expected: string) => {
  for (let attempt = 0; attempt < 80 && !text().includes(expected); attempt += 1) await wait(25);
  expect(text()).toContain(expected);
};
const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 40)); });
};
const change = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new browser.Event("input", { bubbles: true }) as never);
  });
};
const trigger = () => document.querySelector<HTMLButtonElement>("button[aria-label^='Cuenta de']")!;
const openMenu = async () => {
  const button = trigger();
  expect(button).not.toBeNull();
  await act(async () => {
    button.dispatchEvent(new browser.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }) as never);
    button.dispatchEvent(new browser.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }) as never);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
};
const menuItems = () => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];
const logoutItems = () => menuItems().filter((item) => item.textContent?.includes("Cerrar sesión"));
const looseLogoutButtons = () => [...document.querySelectorAll<HTMLElement>("button, a")].filter((el) => el.textContent?.trim() === "Cerrar sesión" && el.getAttribute("role") !== "menuitem");
const setOffline = async () => { await act(async () => { browser.dispatchEvent(new browser.Event("offline")); }); await wait(10); };
const setOnline = async () => { await act(async () => { browser.dispatchEvent(new browser.Event("online")); }); await wait(30); };
const backControl = () => document.querySelector<HTMLElement>("[data-testid=back-to-dashboard]");

beforeEach(async () => {
  activate(browser);
  freshIndexedDb();
  sync.resetSyncClientForTests();
  calls = []; assigned = [];
  originalAssign = browser.location.assign;
  (browser.location as { assign: (url: string) => void }).assign = (url: string) => { assigned.push(url); };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === "/api/health") return new Response(null, { status: 204 });
    if (url === "/api/offline/snapshot") return new Response(JSON.stringify(makeSnapshot(USER_A)), { status: 200 });
    if (url === "/api/device-status") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ error: "no simulado" }), { status: 500 });
  }) as unknown as typeof fetch;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await setOnline();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  (browser.location as { assign: unknown }).assign = originalAssign;
  sync.resetSyncClientForTests();
});

async function mountTurno(autosaveDelayMs = 60_000) {
  await act(async () => { root.render(<OperatorShiftApp autosaveDelayMs={autosaveDelayMs} presence={false} />); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(25);
    if (!text().includes("Cargando turno")) break;
  }
  await wait(30);
}
/** Inicia un reporte SIN conexión (queda pendiente en la outbox) y vuelve a conectar. */
async function startReportOffline() {
  await setOffline();
  const select = document.querySelector<HTMLSelectElement>("[data-testid=machine-select]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLSelectElement.prototype, "value")!.set!.call(select, MACHINE_1);
    select.dispatchEvent(new browser.Event("change", { bubbles: true }) as never);
  });
  await click([...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Iniciar reporte"));
  await eventually("Reporte activo");
  await setOnline();
}

describe("Turno: «Volver al dashboard»", () => {
  test("con conexión es un enlace a /dashboard de 44 px; sin conexión es un botón deshabilitado que dice «Requiere conexión»", async () => {
    await mountTurno();
    const link = backControl()!;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/dashboard");
    expect(link.textContent).toContain("Volver al dashboard");
    expect(link.className).toContain("min-h-11");

    await setOffline();
    const disabled = backControl() as HTMLButtonElement;
    expect(disabled.tagName).toBe("BUTTON");
    expect(disabled.disabled).toBe(true);
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    const hint = document.getElementById(disabled.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe("Requiere conexión");
    await click(disabled);
    expect(assigned).toEqual([]);
  });

  test("navegar guarda lo escrito solo en este dispositivo, no sube nada, no cancela el reporte y no toca otras operaciones", async () => {
    await mountTurno();
    await startReportOffline();
    const before = await outbox.listOperations(USER_A);
    expect(before.map((op) => op.type)).toEqual(["CREATE_REPORT"]);
    const callsBefore = calls.length;

    await change("[data-report-field=production_order]", "OP-99");
    await click(backControl());
    await wait(60);

    const after = await outbox.listOperations(USER_A);
    expect(after.map((op) => op.type)).toEqual(["CREATE_REPORT", "SAVE_REPORT_FIELDS"]); // lo escrito quedó guardado
    expect(after.every((op) => op.state === "pending")).toBe(true); // nada se subió
    expect(after.some((op) => op.type === "CANCEL_REPORT")).toBe(false);
    expect(calls.slice(callsBefore).filter((url) => url.startsWith("/api/") && !["/api/health", "/api/device-status"].includes(url))).toEqual([]);
    expect(assigned).toEqual(["/dashboard"]);
    // El reporte sigue activo en la bandeja local.
    const state = await actions.loadShiftState(USER_A);
    expect(state.active?.status).toBe("DRAFT");
  });

  test("sin cambios pendientes navega sin tocar la outbox", async () => {
    await mountTurno();
    await startReportOffline();
    const before = JSON.stringify(await outbox.listOperations(USER_A));
    await click(backControl());
    await wait(40);
    expect(JSON.stringify(await outbox.listOperations(USER_A))).toBe(before);
    expect(assigned).toEqual(["/dashboard"]);
  });
});

describe("Turno: menú de perfil como única entrada de «Cerrar sesión»", () => {
  test("no hay botón suelto «Cerrar sesión»; el menú trae nombre, rol, Mi cuenta, Notificaciones y un único Cerrar sesión", async () => {
    await mountTurno();
    expect(looseLogoutButtons()).toEqual([]);
    expect(text()).not.toContain("Cerrar sesión");
    const menuTrigger = trigger();
    expect(menuTrigger.getAttribute("aria-label")).toBe("Cuenta de Operario Uno");
    expect(menuTrigger.className).toContain("size-11"); // objetivo táctil de 44 px
    expect(menuTrigger.textContent).toBe("OU"); // iniciales

    await openMenu();
    const menu = document.querySelector("[role=menu]")!;
    expect(menu.textContent).toContain("Operario Uno");
    expect(menu.textContent).toContain("Operario");
    expect(document.querySelector("a[href='/cuenta']")?.textContent).toContain("Mi cuenta");
    expect(document.querySelector("a[href='/notificaciones']")?.textContent).toContain("Notificaciones");
    expect(logoutItems()).toHaveLength(1);
    expect(menuItems().every((item) => item.className.includes("min-h-11"))).toBe(true);
    expect(looseLogoutButtons()).toEqual([]);
  });

  test("sin conexión Mi cuenta y Notificaciones quedan deshabilitadas con «Requiere conexión»; Cerrar sesión sigue disponible", async () => {
    await mountTurno();
    await setOffline();
    await openMenu();
    expect(document.querySelector("a[href='/cuenta']")).toBeNull();
    expect(document.querySelector("a[href='/notificaciones']")).toBeNull();
    const disabled = menuItems().filter((item) => item.getAttribute("aria-disabled") === "true");
    expect(disabled.map((item) => item.textContent?.replace(/\s+/g, " ").trim())).toEqual(["Mi cuenta Requiere conexión", "Notificaciones Requiere conexión"]);
    expect(logoutItems()).toHaveLength(1);
  });

  test("accesibilidad: el disparador anuncia menú desplegable y los elementos son menuitem alcanzables con teclado (Radix)", async () => {
    await mountTurno();
    await openMenu();
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menuItems().length).toBeGreaterThanOrEqual(3);
    expect(menuItems().every((item) => item.getAttribute("role") === "menuitem")).toBe(true);
  });

  test("cerrar sesión con datos sin subir pide confirmación; «Quedarme» conserva todo", async () => {
    await mountTurno();
    await startReportOffline();
    await openMenu();
    await click(logoutItems()[0]);
    await eventually("Tienes datos sin subir");
    expect(assigned).toEqual([]);
    const stay = [...document.querySelectorAll<HTMLButtonElement>("[role=alertdialog] button")].find((b) => b.textContent?.trim() === "Quedarme");
    await click(stay);
    expect(text()).not.toContain("Tienes datos sin subir");
    expect((await outbox.listOperations(USER_A)).length).toBe(1);
    expect(await auth.isServerLogoutPending()).toBe(false);
  });

  test("cerrar sesión sin conexión y sin pendientes cierra la sesión local, marca el cierre del servidor y va a /iniciar-sesion", async () => {
    await mountTurno();
    await auth.startLocalSession({ userId: USER_A, role: "OPERATOR", username: "op1", fullName: "Operario Uno", startedAt: new Date().toISOString(), offline: true });
    document.cookie = "sb-127-auth-token=abc; Path=/";
    await setOffline();
    await openMenu();
    await click(logoutItems()[0]);
    await wait(80);
    expect(assigned).toEqual(["/iniciar-sesion"]);
    expect(await auth.getLocalSession()).toBeNull();
    expect(await auth.isServerLogoutPending()).toBe(true);
    expect(document.cookie).not.toContain("sb-127-auth-token");
  });
});

describe("pantallas sin AppShell: UserMenu y consulta sin conexión", () => {
  test("UserMenu de un coordinador: sin pendientes pasa por el guard y envía el formulario de cierre cuando hay conexión", async () => {
    let submitted = 0;
    await act(async () => { root.render(<UserMenu user={{ id: "coord", fullName: "Ana Pérez", role: "ADMINISTRATOR" }} />); });
    const form = document.querySelector<HTMLFormElement>("form[action='/api/auth/logout']")!;
    expect(form.method.toUpperCase()).toBe("POST");
    form.requestSubmit = () => { submitted += 1; };
    expect(trigger().textContent).toBe("AP");
    await openMenu();
    expect(document.querySelector("[role=menu]")!.textContent).toContain("Coordinador");
    await click(logoutItems()[0]);
    await wait(60);
    expect(submitted).toBe(1);
  });

  test("/consulta-offline: sin botón suelto «Cerrar sesión»; el menú de perfil lo contiene y cierra la sesión local sin conexión", async () => {
    await auth.startLocalSession({ userId: "10000000-0000-4000-8000-00000000000c", role: "ADMINISTRATOR", username: "coord1", fullName: "Coordinador Uno", startedAt: new Date().toISOString(), offline: true });
    await setOffline();
    await act(async () => { root.render(<OfflineOverview />); });
    for (let attempt = 0; attempt < 80 && !trigger(); attempt += 1) await wait(25);
    expect(trigger().getAttribute("aria-label")).toBe("Cuenta de Coordinador Uno");
    expect(looseLogoutButtons()).toEqual([]);
    await openMenu();
    expect(logoutItems()).toHaveLength(1);
    await click(logoutItems()[0]);
    await wait(80);
    expect(assigned).toEqual(["/iniciar-sesion"]);
    expect(await auth.getLocalSession()).toBeNull();
    expect(await auth.isServerLogoutPending()).toBe(true);
  });
});

describe("«Cerrar sesión» solo en el menú de perfil (código)", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  test("el texto «Cerrar sesión» solo aparece en los menús de perfil, el diálogo del guard y el aviso de la pantalla de acceso", () => {
    const files = walk("src").filter((path) => /\.(tsx|ts|astro)$/.test(path)).filter((path) => readFileSync(path, "utf8").includes("Cerrar sesión"))
      .map((path) => path.replaceAll("\\", "/")).sort();
    expect(files).toEqual([
      "src/components/UserMenu.tsx",
      "src/components/offline/LogoutGuard.tsx",
      "src/components/shell/NavUser.tsx",
      "src/lib/help-content.ts", // texto de ayuda
      "src/lib/offline/login-flow.ts",
      "src/lib/offline/offline-auth.ts",
    ]);
  });

  test("el dashboard del operario ofrece «Continuar turno» hacia /turno", () => {
    const page = readFileSync("src/pages/dashboard.astro", "utf8");
    expect(page).toContain("Continuar turno");
    expect(page).toContain('href="/turno"');
  });
});
