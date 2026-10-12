/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import type { Root } from "react-dom/client";
import { MACHINE_1, USER_A, activate, freshIndexedDb, installBrowser, makeSnapshot } from "./helpers/offline-env";
import { HELP_ROLES, firstSteps, helpProblems, helpTasks, imagesForRole, problemsForRole, tasksForRole } from "../src/lib/help-content";
import { breadcrumbFor, mobileTabs, navForRole } from "../src/components/shell/nav-config";
import type { AppRole } from "../src/lib/types";

const browser = installBrowser();
const OPERATOR_QUICK_TIPS_REF = () => OPERATOR_QUICK_TIPS;
const { createRoot } = await import("react-dom/client");
const { default: HelpAccordion } = await import("../src/components/HelpAccordion");
const { default: OperatorShiftApp, OPERATOR_QUICK_TIPS } = await import("../src/components/offline/OperatorShiftApp");
const sync = await import("../src/lib/offline/sync-client");

const projectDir = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(projectDir, path), "utf8");
const everyText = (role: AppRole) => JSON.stringify([firstSteps[role], tasksForRole(role)]);
const BANNED = /sincronizaci[oó]n|indexeddb|service worker|webcrypto|cach[eé]|payload|endpoint/i;

describe("help-content: contenido por rol", () => {
  test("hay primeros pasos, tareas y problemas para los 4 roles", () => {
    expect([...HELP_ROLES].sort()).toEqual(["ADMINISTRATOR", "OPERATOR", "ROOT", "VIEWER"]);
    for (const role of HELP_ROLES) {
      expect(firstSteps[role].steps.length).toBeGreaterThan(2);
      expect(tasksForRole(role).length).toBeGreaterThan(1);
    }
    expect(helpProblems.length).toBeGreaterThanOrEqual(8);
  });

  test("cada tarea tiene pasos cortos e ids únicos", () => {
    const ids = helpTasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const task of helpTasks) {
      expect(task.steps.length).toBeGreaterThan(0);
      for (const step of task.steps) expect(step.length).toBeLessThan(170);
    }
  });

  test("el operario ve Iniciar reporte, Paradas, Datos, Cambios, Enviar y Sin conexión; no ve tareas de coordinador", () => {
    const ids = tasksForRole("OPERATOR").map((task) => task.id);
    for (const id of ["iniciar-reporte", "paradas", "datos-produccion", "cambios", "enviar-reporte", "sin-conexion"]) expect(ids).toContain(id);
    for (const id of ["aprobar", "corregir", "administrar", "exportar", "conflictos", "historial-admin", "consultar-reportes"]) expect(ids).not.toContain(id);
    expect(everyText("OPERATOR")).not.toContain("Aprobar y cerrar");
  });

  test("coordinador: aprobar, corregir, administrar, exportar y conflictos; no historial administrativo", () => {
    const ids = tasksForRole("ADMINISTRATOR").map((task) => task.id);
    for (const id of ["aprobar", "corregir", "administrar", "exportar", "conflictos", "consulta-sin-conexion"]) expect(ids).toContain(id);
    for (const id of ["historial-admin", "administrar-raiz", "cambios", "paradas"]) expect(ids).not.toContain(id);
  });

  test("auditor: consulta, exporta y consulta sin conexión; sin tareas de aprobar ni administrar", () => {
    const ids = tasksForRole("VIEWER").map((task) => task.id);
    for (const id of ["consultar-reportes", "exportar", "consulta-sin-conexion"]) expect(ids).toContain(id);
    for (const id of ["aprobar", "corregir", "administrar", "historial-admin", "conflictos"]) expect(ids).not.toContain(id);
  });

  test("historial administrativo y administrar coordinadores solo para ROOT", () => {
    for (const role of HELP_ROLES) {
      const ids = tasksForRole(role).map((task) => task.id);
      expect(ids.includes("historial-admin")).toBe(role === "ROOT");
      expect(ids.includes("administrar-raiz")).toBe(role === "ROOT");
    }
    expect(tasksForRole("ROOT").map((task) => task.id)).toContain("aprobar");
  });

  test("el aviso «lo que no puedes hacer» se resuelve para el rol de quien lee", () => {
    expect(tasksForRole("VIEWER").find((task) => task.id === "consultar-reportes")?.limit).toContain("No puedes aprobar");
    expect(tasksForRole("ADMINISTRATOR").find((task) => task.id === "administrar")?.limit).toContain("administrador raíz");
    expect(tasksForRole("OPERATOR").find((task) => task.id === "cambios")?.limit).toContain("coordinador");
  });

  test("«Cambios» explica tipo, descripción, botón apagado, hora automática, dónde se ve, sin conexión y diferencia con parada", () => {
    const cambios = helpTasks.find((task) => task.id === "cambios")!;
    const all = JSON.stringify(cambios);
    for (const fragment of ["Tipo de cambio", "Descripción", "Registrar cambio", "apagado", "lote 120 a lote 121", "reloj", "no se puede editar", "CAMBIOS", "historial", "Sin conexión", "parada", "coordinador"]) expect(all).toContain(fragment);
    expect(cambios.roles).toEqual(["OPERATOR"]);
  });

  test("Paradas explica toque único, categoría obligatoria al cerrar y cancelar por error; Sin conexión explica «Confirmar y subir»", () => {
    const paradas = JSON.stringify(helpTasks.find((task) => task.id === "paradas"));
    for (const fragment of ["Iniciar parada", "Cerrar parada", "Cancelar parada", "obligatoria", "por error"]) expect(paradas).toContain(fragment);
    const offline = JSON.stringify(helpTasks.find((task) => task.id === "sin-conexion"));
    expect(offline).toContain("Confirmar y subir");
    expect(offline).toContain("Posponer");
  });

  test("no promete nada que la interfaz no hace: sin «1 000 reportes» ni coordinador que corrige cambios o paradas", () => {
    const all = JSON.stringify([firstSteps, helpTasks, helpProblems, OPERATOR_QUICK_TIPS_REF()]);
    expect(all).not.toMatch(/1[s ]?000 reportes/);
    expect(all).not.toContain("1000 reportes");
    expect(all).not.toContain("Él lo corrige y deja escrito el motivo");
    expect(all).not.toMatch(/corriges un cambio o una parada/);
    const cambios = JSON.stringify(helpTasks.find((task) => task.id === "cambios"));
    expect(cambios).toContain("no se puede borrar ni editar");
    expect(cambios).toContain("Observaciones");
    expect(cambios).not.toMatch(/coordinador.? ?[ÉE]l (lo )?corrige/);
    const exportar = JSON.stringify(helpTasks.find((task) => task.id === "exportar"));
    expect(exportar).toContain("período más corto");
    expect(read("docs/USER_GUIDE.md")).not.toMatch(/1[s ]000 reportes/);
  });

  test("problemas frecuentes filtrados por rol", () => {
    const messages = (role: AppRole) => problemsForRole(role).map((problem) => problem.message).join("|");
    expect(messages("OPERATOR")).not.toContain("desactivar");
    expect(messages("OPERATOR")).not.toContain("exportar");
    expect(messages("OPERATOR")).toContain("Ya tienes un reporte activo");
    expect(messages("VIEWER")).not.toContain("Ya tienes un reporte activo");
    expect(messages("VIEWER")).not.toContain("desactivar");
    expect(messages("VIEWER")).toContain("exportar");
    expect(messages("ADMINISTRATOR")).toContain("desactivar");
    expect(messages("ROOT")).toContain("desactivar");
    expect(messages("ADMINISTRATOR")).not.toContain("Ya tienes un reporte activo");
    for (const role of HELP_ROLES) expect(problemsForRole(role).length).toBeGreaterThan(0);
    expect(read("src/pages/ayuda.astro")).toContain("problemsForRole(role)");
  });

  test("ROOT puede forzar la desactivación con motivo; el coordinador no", () => {
    const administrar = JSON.stringify(helpTasks.find((task) => task.id === "administrar"));
    expect(administrar).toContain("administrador raíz sí puede forzarlo");
    expect(administrar).toContain("10 caracteres");
  });

  test("lenguaje sencillo: sin jerga técnica en ningún rol", () => {
    for (const role of HELP_ROLES) expect(everyText(role)).not.toMatch(BANNED);
    expect(JSON.stringify(helpProblems)).not.toMatch(BANNED);
  });

  test("las imágenes referenciadas existen en public/ayuda y tienen texto alternativo", () => {
    for (const role of HELP_ROLES) {
      for (const image of imagesForRole(role)) {
        expect(image.src.startsWith("/ayuda/")).toBe(true);
        expect(image.alt.length).toBeGreaterThan(10);
        expect(existsSync(join(projectDir, "public", image.src))).toBe(true);
      }
    }
  });
});

describe("Ayuda en la navegación", () => {
  test("nav-config incluye Ayuda en el grupo Cuenta de todos los roles", () => {
    for (const role of HELP_ROLES) {
      const cuenta = navForRole(role).find((group) => group.id === "cuenta")!;
      expect(cuenta.items.some((item) => item.title === "Ayuda" && item.href === "/ayuda")).toBe(true);
    }
  });

  test("breadcrumb de /ayuda y las pestañas móviles no cambian", () => {
    expect(breadcrumbFor("/ayuda").map((crumb) => crumb.label)).toEqual(["Inicio", "Ayuda"]);
    expect(mobileTabs.map((item) => item.href)).toEqual(["/dashboard", "/reportes", "/notificaciones"]);
  });

  test("TopBar y BottomNav muestran el ícono «?»", () => {
    const top = read("src/components/shell/TopBar.tsx");
    expect(top).toContain('href="/ayuda"');
    expect(top).toContain('aria-label="Ayuda"');
    expect(top).toContain("size-11");
    expect(top).toContain("focus-visible:ring");
    expect(read("src/components/shell/BottomNav.tsx")).toContain("CircleHelp");
  });

  test("ayuda.astro filtra por el rol de la sesión y el middleware no necesita reglas nuevas", () => {
    const page = read("src/pages/ayuda.astro");
    expect(page).toContain("Astro.locals.auth!");
    expect(page).toContain("tasksForRole(role)");
    expect(page).toContain("firstStepsForRole(role)");
    expect(page).toContain("overflow-x-auto");
    expect(page).not.toContain("prerender");
    expect(read("src/middleware.ts")).not.toContain("/ayuda");
  });
});

describe("HelpAccordion: accesibilidad", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    activate(browser);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  test("botones con aria-expanded/aria-controls, objetivo táctil de 44 px, foco visible y panel enlazado", async () => {
    await act(async () => { root.render(<HelpAccordion tasks={tasksForRole("OPERATOR")} />); });
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")];
    expect(buttons.length).toBe(tasksForRole("OPERATOR").length);
    for (const button of buttons) {
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("focus-visible:ring");
      const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
      expect(panel.hasAttribute("hidden")).toBe(true);
      expect(panel.getAttribute("aria-labelledby")).toBe(button.id);
    }
    await act(async () => { buttons[0].click(); });
    expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(buttons[0].getAttribute("aria-controls")!)!.hasAttribute("hidden")).toBe(false);
    await act(async () => { buttons[1].click(); });
    expect(buttons[0].getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1].getAttribute("aria-expanded")).toBe("true");
  });

  test("sin desbordamiento a 375 px: las imágenes se ajustan al ancho y llevan texto alternativo", async () => {
    await act(async () => { root.render(<HelpAccordion tasks={tasksForRole("ADMINISTRATOR")} defaultOpenId="aprobar" />); });
    for (const image of container.querySelectorAll("img")) {
      expect(image.className).toContain("w-full");
      expect(image.className).toContain("max-w-");
      expect(image.getAttribute("alt")).toBeTruthy();
    }
    expect(container.querySelector('[data-testid="help-limit"]')).not.toBeNull();
  });

  test("cada rol solo recibe su contenido en el acordeón", async () => {
    await act(async () => { root.render(<HelpAccordion tasks={tasksForRole("OPERATOR")} />); });
    expect(container.textContent).toContain("Cambios: anota cada cambio de producción");
    expect(container.textContent).not.toContain("Aprobar un reporte");
    await act(async () => { root.render(<HelpAccordion tasks={tasksForRole("VIEWER")} />); });
    expect(container.textContent).toContain("Consultar reportes");
    expect(container.textContent).not.toContain("Paradas de máquina");
    expect(container.textContent).not.toContain("Historial administrativo");
  });
});

describe("Panel «¿Necesitas ayuda?» del operario", () => {
  let root: Root;
  let container: HTMLDivElement;
  let calls: string[];
  const realFetch = globalThis.fetch;
  const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

  beforeEach(async () => {
    activate(browser);
    freshIndexedDb();
    sync.resetSyncClientForTests();
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/offline/snapshot") return new Response(JSON.stringify(makeSnapshot(USER_A)), { status: 200 });
      if (url === "/api/health" || url === "/api/device-status") return new Response(null, { status: 204 });
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { browser.dispatchEvent(new browser.Event("online")); });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    sync.resetSyncClientForTests();
    globalThis.fetch = realFetch;
  });

  const mount = async () => {
    await act(async () => { root.render(<OperatorShiftApp autosaveDelayMs={15} presence={false} />); });
    for (let attempt = 0; attempt < 80 && (document.body.textContent ?? "").includes("Cargando turno"); attempt += 1) await wait(25);
    await wait(30);
  };

  test("el contenido incrustado tiene de 4 a 6 consejos e incluye Cambios", () => {
    expect(OPERATOR_QUICK_TIPS.length).toBeGreaterThanOrEqual(4);
    expect(OPERATOR_QUICK_TIPS.length).toBeLessThanOrEqual(6);
    const cambios = OPERATOR_QUICK_TIPS.find((tip) => tip.title === "Cambios")!;
    expect(cambios.text).toContain("Registrar cambio");
    expect(cambios.text).toContain("Tipo de cambio");
    for (const tip of OPERATOR_QUICK_TIPS) expect(`${tip.title} ${tip.text}`).not.toMatch(BANNED);
  });

  test("aparece sin conexión, se pliega y despliega con aria-expanded y no hace llamadas de red", async () => {
    await mount();
    await act(async () => { browser.dispatchEvent(new browser.Event("offline")); });
    await wait(20);
    const toggle = [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((button) => button.textContent?.includes("¿Necesitas ayuda?"))!;
    expect(toggle).toBeDefined();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.className).toContain("min-h-11");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel.hasAttribute("hidden")).toBe(true);

    const before = calls.length;
    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hasAttribute("hidden")).toBe(false);
    expect(panel.textContent).toContain("Registrar cambio");
    expect(panel.textContent).toContain("Confirmar y subir");
    await wait(30);
    expect(calls.length).toBe(before);
    expect(calls.some((url) => url.includes("ayuda"))).toBe(false);
    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  test("sigue visible con un reporte activo", async () => {
    await mount();
    const select = document.querySelector<HTMLSelectElement>('[data-testid="machine-select"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(browser.HTMLSelectElement.prototype, "value")!.set!.call(select, MACHINE_1);
      select.dispatchEvent(new browser.Event("change", { bubbles: true }) as never);
    });
    const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Iniciar reporte")!;
    await act(async () => { start.click(); await new Promise((resolve) => setTimeout(resolve, 50)); });
    for (let attempt = 0; attempt < 40 && !(document.body.textContent ?? "").includes("Registrar cambio"); attempt += 1) await wait(25);
    expect(document.body.textContent).toContain("¿Necesitas ayuda?");
    expect(document.body.textContent).toContain("Registrar cambio");
  });

  test("no se tocó el service worker para la ayuda", () => {
    expect(read("public/sw.js")).not.toContain("/ayuda");
  });
});
