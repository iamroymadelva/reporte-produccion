/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";

const browser = new Window({ url: "http://localhost:4321/dashboard" });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Event: browser.Event, CustomEvent: browser.CustomEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser), Node: browser.Node, Element: browser.Element,
  NodeFilter: browser.NodeFilter, MutationObserver: browser.MutationObserver, DocumentFragment: browser.DocumentFragment, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent ?? browser.MouseEvent, FocusEvent: browser.FocusEvent, requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});
for (const key of Object.getOwnPropertyNames(browser)) {
  if (/^(HTML|SVG)/.test(key) && !(key in globalThis)) (globalThis as any)[key] = (browser as any)[key];
}
browser.HTMLElement.prototype.scrollIntoView = function () {};
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
(browser as any).ResizeObserver ??= (globalThis as any).ResizeObserver;

const { createRoot } = await import("react-dom/client");
const { navForRole, isActivePath, breadcrumbFor, mobileTabs } = await import("../src/components/shell/nav-config");
const { NotificationBell } = await import("../src/components/notifications/NotificationBell");
const { resetNotificationStores } = await import("../src/components/notifications/notification-store");
const { default: AdminDialogHost } = await import("../src/components/AdminDialogHost");

describe("nav-config", () => {
  test("VIEWER y OPERATOR no ven administración", () => {
    for (const role of ["VIEWER", "OPERATOR"] as const) {
      const groups = navForRole(role);
      expect(groups.map((group) => group.id)).toEqual(["operacion", "cuenta"]);
      expect(groups.flatMap((group) => group.items).some((item) => item.href.startsWith("/administracion"))).toBe(false);
    }
  });

  test("ADMINISTRATOR ve 9 enlaces de administración", () => {
    const groups = navForRole("ADMINISTRATOR");
    expect(groups.map((group) => group.id)).toEqual(["operacion", "administracion", "cuenta"]);
    const admin = groups.find((group) => group.id === "administracion")!;
    expect(admin.items).toHaveLength(9);
    expect(admin.items.every((item) => item.href.startsWith("/administracion"))).toBe(true);
  });

  test("mobileTabs: dashboard, reportes y notificaciones", () => {
    expect(mobileTabs.map((item) => item.href)).toEqual(["/dashboard", "/reportes", "/notificaciones"]);
  });

  test("isActivePath: dashboard exacto, el resto por prefijo", () => {
    expect(isActivePath("/dashboard", "/dashboard")).toBe(true);
    expect(isActivePath("/dashboard/otro", "/dashboard")).toBe(false);
    expect(isActivePath("/reportes", "/reportes")).toBe(true);
    expect(isActivePath("/reportes/abc", "/reportes")).toBe(true);
    expect(isActivePath("/reportesx", "/reportes")).toBe(false);
    expect(isActivePath("/administracion/usuarios", "/administracion/usuarios")).toBe(true);
    expect(isActivePath("/administracion/usuarios", "/administracion")).toBe(false);
  });

  test("breadcrumbFor", () => {
    expect(breadcrumbFor("/dashboard").map((crumb) => crumb.label)).toEqual(["Inicio", "Dashboard"]);
    expect(breadcrumbFor("/reportes").map((crumb) => crumb.label)).toEqual(["Inicio", "Reportes"]);
    expect(breadcrumbFor("/reportes/123").map((crumb) => crumb.label)).toEqual(["Inicio", "Detalle de reporte"]);
    expect(breadcrumbFor("/administracion").map((crumb) => crumb.label)).toEqual(["Inicio", "Administración"]);
    expect(breadcrumbFor("/administracion/paradas").map((crumb) => crumb.label)).toEqual(["Inicio", "Administración", "Categorías de parada"]);
    expect(breadcrumbFor("/notificaciones").map((crumb) => crumb.label)).toEqual(["Inicio", "Notificaciones"]);
  });
});

describe("NotificationBell", () => {
  let root: Root;
  let container: HTMLDivElement;
  let calls: Array<{ url: string; init?: RequestInit }>;
  let unread = 3;
  let items: unknown[] = [];
  const realFetch = globalThis.fetch;

  const page = () => ({ items, unreadCount: unread, nextCursor: null, snapshotAt: "2026-10-08T12:00:00.000Z" });
  const item = { id: "11111111-1111-4111-8111-111111111111", type: "REPORT_SUBMITTED", resourceType: "report", resourceId: "r1", actorId: null, stopStatus: null, title: "Reporte enviado", body: "Se envió el reporte", href: "/reportes/r1", createdAt: "2026-10-08T11:00:00.000Z", updatedAt: "2026-10-08T11:00:00.000Z", readAt: null };

  const mount = async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root.render(<NotificationBell />); await new Promise((resolve) => setTimeout(resolve, 30)); });
  };
  const openBell = async () => {
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-label^='Notificaciones']")!;
    await act(async () => { trigger.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
  };

  beforeEach(() => {
    resetNotificationStores();
    calls = [];
    unread = 3;
    items = [item];
    Object.defineProperty(browser.navigator, "onLine", { value: true, configurable: true });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("/api/notifications/read-all")) { unread = 0; return new Response("{}", { status: 200 }); }
      return new Response(JSON.stringify(page()), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    document.body.innerHTML = "";
    globalThis.fetch = realFetch;
  });

  test("muestra el conteo de no leídas", async () => {
    await mount();
    const trigger = container.querySelector("button[aria-label^='Notificaciones']")!;
    expect(trigger.getAttribute("aria-label")).toBe("Notificaciones, 3 sin leer");
    expect(trigger.textContent).toBe("3");
    expect(calls[0].url).toContain("/api/notifications?filter=all");
  });

  test("muestra 99+ cuando hay más de 99", async () => {
    unread = 150;
    await mount();
    expect(container.querySelector("button[aria-label^='Notificaciones']")!.textContent).toBe("99+");
  });

  test("Marcar todas como leídas llama a POST read-all", async () => {
    await mount();
    await openBell();
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Marcar todas como leídas")!;
    expect(button).toBeDefined();
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
    const call = calls.find((entry) => entry.url === "/api/notifications/read-all")!;
    expect(call).toBeDefined();
    expect(call.init?.method).toBe("POST");
    expect(JSON.parse(String(call.init?.body))).toEqual({ before: "2026-10-08T12:00:00.000Z" });
  });

  test("una respuesta en vuelo anterior a marcar todas no pisa el estado actualizado", async () => {
    let release: (() => void) | null = null;
    let listCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("/api/notifications/read-all")) { unread = 0; items = [{ ...item, readAt: "2026-10-08T12:01:00.000Z" }]; return new Response("{}", { status: 200 }); }
      listCalls++;
      const snapshot = JSON.stringify(page());
      // La segunda carga (polling) queda retenida con datos antiguos hasta que la liberemos.
      if (listCalls === 2) await new Promise<void>((resolve) => { release = resolve; });
      return new Response(snapshot, { status: 200 });
    }) as typeof fetch;
    await mount();
    const store = (await import("../src/components/notifications/notification-store")).getNotificationStore("all");
    // Polling en vuelo con datos antiguos (3 sin leer)...
    let inflight!: Promise<void>;
    await act(async () => { inflight = store.refresh(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(release).not.toBeNull();
    // ...mientras el usuario marca todas como leídas: la respuesta vieja debe descartarse y repetirse.
    await act(async () => { await store.readAll(); });
    await act(async () => { release!(); await inflight; await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(store.getSnapshot().count).toBe(0);
    expect(listCalls).toBeGreaterThanOrEqual(3);
  });

  test("estado vacío", async () => {
    unread = 0;
    items = [];
    await mount();
    await openBell();
    expect(document.body.textContent).toContain("No hay notificaciones todavía.");
    expect(container.querySelector("button[aria-label^='Notificaciones']")!.textContent).toBe("");
  });
});

describe("AdminDialogHost", () => {
  let root: Root;
  let container: HTMLDivElement;

  const open = async (templateHtml: string, attrs = "") => {
    document.body.innerHTML = `<button id="opener" data-admin-modal-open="t1">Nuevo</button><template id="t1" data-dialog-title="Nuevo registro" ${attrs}>${templateHtml}</template>`;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root.render(<AdminDialogHost />); });
    await act(async () => { document.getElementById("opener")!.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
  };
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    document.body.innerHTML = "";
  });

  test("el h2 visible de la plantilla es el nombre accesible del diálogo (sin título sr-only duplicado)", async () => {
    await open('<form><h2 id="t1-title">Nuevo: Líneas</h2></form>');
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBe("t1-title");
    expect(document.getElementById("t1-title")?.textContent).toBe("Nuevo: Líneas");
    expect(dialog.querySelectorAll(".sr-only").length).toBe(1); // solo la descripción
  });

  test("sin h2 con id conserva el título sr-only con nombre accesible", async () => {
    await open("<form><p>Sin encabezado</p></form>");
    const dialog = document.querySelector("[role=dialog]")!;
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe("Nuevo registro");
  });
});
