/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import type { Root } from "react-dom/client";
import { activate, freshIndexedDb, installBrowser } from "./helpers/offline-env";

// «Mi cuenta» (/cuenta): enlace en el menú del usuario y en nav-config, preferencia de formato de hora y enlace a contraseña.
const browser = installBrowser("http://localhost:4321/cuenta");
for (const key of Object.getOwnPropertyNames(browser)) {
  if (/^(HTML|SVG)/.test(key) && !(key in globalThis)) (globalThis as any)[key] = (browser as any)[key];
}
Object.assign(globalThis, {
  MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent ?? browser.MouseEvent, FocusEvent: browser.FocusEvent,
  DocumentFragment: browser.DocumentFragment, requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
});

const { createRoot } = await import("react-dom/client");
const { navForRole, breadcrumbFor, isActivePath, mobileTabs } = await import("../src/components/shell/nav-config");
const { NavUser } = await import("../src/components/shell/NavUser");
const { SidebarProvider } = await import("../src/components/ui/sidebar");
const { default: AccountPreferences } = await import("../src/components/account/AccountPreferences");
const tf = await import("../src/lib/time-format");
const { getMeta } = await import("../src/lib/offline/db");

const realFetch = globalThis.fetch;
let root: Root;
let container: HTMLDivElement;
let posts: Array<{ url: string; body: unknown }>;
let respond: () => Response | Promise<Response>;
const wait = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  activate(browser);
  freshIndexedDb();
  tf.resetTimeFormatCache();
  posts = [];
  respond = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return respond();
  }) as typeof fetch;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
});

describe("nav-config: Mi cuenta", () => {
  test("todos los roles ven «Mi cuenta» en el grupo Cuenta", () => {
    for (const role of ["ROOT", "ADMINISTRATOR", "VIEWER", "OPERATOR"] as const) {
      const cuenta = navForRole(role).find((group) => group.id === "cuenta")!;
      expect(cuenta.items.map((item) => item.href)).toEqual(["/notificaciones", "/cuenta", "/ayuda"]);
      expect(cuenta.items.find((item) => item.href === "/cuenta")!.title).toBe("Mi cuenta");
    }
  });

  test("breadcrumb «Inicio > Mi cuenta», ruta activa y sin cambiar las pestañas móviles", () => {
    expect(breadcrumbFor("/cuenta").map((crumb) => crumb.label)).toEqual(["Inicio", "Mi cuenta"]);
    expect(isActivePath("/cuenta", "/cuenta")).toBe(true);
    expect(mobileTabs.map((item) => item.href)).toEqual(["/dashboard", "/reportes", "/notificaciones"]);
  });
});

describe("NavUser: enlace «Mi cuenta»", () => {
  test("el menú del usuario incluye un enlace a /cuenta", async () => {
    const profile = { id: "u1", full_name: "Ana Pérez", role: "VIEWER" as const, job_title: null, active: true };
    await act(async () => { root.render(<SidebarProvider><NavUser profile={profile} variant="icon" /></SidebarProvider>); });
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-label^='Cuenta de']")!;
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger.dispatchEvent(new browser.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }) as never);
      trigger.dispatchEvent(new browser.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }) as never);
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    const link = [...document.querySelectorAll<HTMLAnchorElement>("a[href='/cuenta']")][0];
    expect(link).toBeDefined();
    expect(link.textContent).toContain("Mi cuenta");
  });

  test("el código del menú enlaza /cuenta (red de seguridad si el menú no se abre en el DOM de pruebas)", () => {
    expect(readFileSync("src/components/shell/NavUser.tsx", "utf8")).toContain('href="/cuenta"');
  });
});

describe("página /cuenta", () => {
  test("usa el mismo layout que /notificaciones y se apoya en la sesión del middleware", () => {
    const page = readFileSync("src/pages/cuenta.astro", "utf8");
    expect(page).toContain("BaseLayout");
    expect(page).toContain("PageHeader");
    expect(page).toContain('title="Mi cuenta"');
    expect(page).toContain("Astro.locals.auth!");
    expect(page).toContain("AccountPreferences");
    // No hay lista de excepciones públicas para /cuenta: el middleware exige sesión (cubierto en role-access.test.ts).
    expect(readFileSync("src/middleware.ts", "utf8")).not.toContain("/cuenta");
  });
});

describe("AccountPreferences", () => {
  const mount = async (initial: string | null = null) => {
    await act(async () => { root.render(<AccountPreferences userId="user-a" initialTimeFormat={initial} />); });
  };
  const radio = (value: string) => container.querySelector<HTMLButtonElement>(`button[role='radio'][value='${value}']`)!;

  test("muestra «Formato de hora» con 24 h por defecto, ejemplos y el enlace «Cambiar contraseña»", async () => {
    await mount();
    expect(container.textContent).toContain("Formato de hora");
    expect(container.textContent).toContain("24 horas");
    expect(container.textContent).toContain("12 horas (a. m. / p. m.)");
    expect(container.textContent).toContain("06:37 p. m.");
    expect(radio("24h").getAttribute("aria-checked")).toBe("true");
    expect(radio("12h").getAttribute("aria-checked")).toBe("false");
    const link = [...container.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent?.includes("Cambiar contraseña"))!;
    expect(link.getAttribute("href")).toBe("/configurar-contrasena");
  });

  test("refleja la preferencia guardada (12h) y trata un valor desconocido como 24 h", async () => {
    await mount("12h");
    expect(radio("12h").getAttribute("aria-checked")).toBe("true");
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount("raro");
    expect(radio("24h").getAttribute("aria-checked")).toBe("true");
  });

  test("elegir 12 horas hace POST con el valor y deja la copia local por usuario", async () => {
    await mount();
    await act(async () => { radio("12h").click(); await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(posts).toEqual([{ url: "/api/account/preferences", body: { time_format: "12h" } }]);
    expect(container.textContent).toContain("Preferencia guardada.");
    expect(await getMeta<string>("timeFormat:user-a")).toBe("12h");
    expect(await getMeta<string>("timeFormat:user-b")).toBeUndefined();
  });

  test("si el servidor rechaza, vuelve a la opción anterior, avisa y no guarda copia local", async () => {
    respond = () => new Response(JSON.stringify({ error: "No fue posible guardar la preferencia. Intenta nuevamente." }), { status: 500 });
    await mount();
    await act(async () => { radio("12h").click(); await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(container.querySelector("[role='alert']")!.textContent).toContain("No fue posible guardar");
    expect(radio("24h").getAttribute("aria-checked")).toBe("true");
    expect(await getMeta<string>("timeFormat:user-a")).toBeUndefined();
  });

  test("sin conexión avisa que hay que conectarse y conserva la opción anterior", async () => {
    respond = () => { throw new TypeError("Failed to fetch"); };
    await mount("12h");
    await act(async () => { radio("24h").click(); await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(container.querySelector("[role='alert']")!.textContent).toContain("Sin conexión");
    expect(radio("12h").getAttribute("aria-checked")).toBe("true");
  });
});
