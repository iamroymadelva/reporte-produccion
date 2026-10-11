/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { Root } from "react-dom/client";
import { CAT_ASEO, CHANGE_PRODUCTO, MACHINE_1, OPT, USER_A, freshIndexedDb, activate, installBrowser, makeSnapshot } from "./helpers/offline-env";

const browser = installBrowser();
const { createRoot } = await import("react-dom/client");
const { default: OperatorShiftApp } = await import("../src/components/offline/OperatorShiftApp");
const outbox = await import("../src/lib/offline/outbox");
const sync = await import("../src/lib/offline/sync-client");
const { getConnectivitySnapshot } = await import("../src/lib/connectivity");

let root: Root;
let container: HTMLDivElement;
let snapshotBody: Record<string, unknown>;
let calls: Array<{ url: string; method: string }>;
const DIALOG = "[role=\"alertdialog\"]";
const text = () => document.body.textContent ?? "";
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const buttonsByLabel = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent?.trim() === label);
const click = async (element: Element | undefined) => {
  expect(element).toBeDefined();
  await act(async () => { (element as HTMLElement).click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
};
const change = async (selector: string, value: string) => {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)!;
  expect(field).not.toBeNull();
  await act(async () => {
    const prototype = field.tagName === "SELECT" ? browser.HTMLSelectElement.prototype : field.tagName === "TEXTAREA" ? browser.HTMLTextAreaElement.prototype : browser.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new browser.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }) as never);
  });
};
/** Espera (sin fijar un tiempo) a que la interfaz refleje un texto que se actualiza de forma asíncrona. */
const eventually = async (expected: string) => {
  for (let attempt = 0; attempt < 80 && !text().includes(expected); attempt += 1) await wait(25);
  expect(text()).toContain(expected);
};
const field = (name: string) => `[data-report-field="${name}"]`;

beforeEach(async () => {
  activate(browser);
  freshIndexedDb();
  sync.resetSyncClientForTests();
  calls = [];
  snapshotBody = { ...makeSnapshot(USER_A) } as Record<string, unknown>;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: (init.method ?? "GET").toUpperCase() });
    if (url === "/api/health") return new Response(null, { status: 204 });
    if (url === "/api/offline/snapshot") return new Response(JSON.stringify(snapshotBody), { status: 200 });
    if (url === "/api/device-status") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ error: "no simulado" }), { status: 500 });
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
});

const mountApp = async () => {
  await act(async () => { root.render(<OperatorShiftApp autosaveDelayMs={15} presence={false} />); });
  // La isla resuelve el usuario con IndexedDB/red: se espera (fuera de un único act) a que termine de cargar.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await wait(25);
    if (!text().includes("Cargando turno")) break;
  }
  await wait(30);
};
const goOffline = async () => { await act(async () => { browser.dispatchEvent(new browser.Event("offline")); }); await wait(10); };

describe("OperatorShiftApp (T082)", () => {
  test("flujo completo sin conexión: iniciar, 2 paradas, 1 cambio, datos y envío encolan las operaciones con la hora del dispositivo", async () => {
    await mountApp();
    expect(getConnectivitySnapshot().state).toBe("online");
    expect(text()).toContain("Operario Uno");
    await goOffline();
    expect(text()).toContain("Sin conexión — guardado en este dispositivo · 0 pendientes");

    // Iniciar reporte con la máquina asignada del turno vigente.
    await change("[data-testid=\"machine-select\"]", MACHINE_1);
    await click(buttonsByLabel("Iniciar reporte")[0]);
    await eventually("Pendiente de subir");

    // Dos paradas: inicio de un toque (sin categoría) y cierre eligiendo categoría.
    for (let stop = 0; stop < 2; stop += 1) {
      await click(buttonsByLabel("Iniciar parada")[0]);
      expect(buttonsByLabel("Cerrar parada")[0].disabled).toBe(true); // exige categoría
      await change("[data-testid=\"stop-category\"]", CAT_ASEO);
      await click(buttonsByLabel("Cerrar parada")[0]);
    }

    // Un cambio.
    await change("[data-testid=\"change-type\"]", CHANGE_PRODUCTO);
    await change("[data-testid=\"change-description\"]", "Cambio de formato");
    await click(buttonsByLabel("Registrar cambio")[0]);

    // Datos de producción.
    await change(field("product_name"), OPT);
    await change(field("production_order"), "OP-77");
    await change(field("line_id"), OPT);
    await change(field("client_name"), OPT);
    await change(field("lot"), "L-5");
    await change(field("weight"), "250");
    await change(field("g_min"), "40");
    await change(field("dosifier_type_id"), OPT);
    await change(field("started_at"), "2026-10-09T08:00");
    await change(field("ended_at"), "2026-10-09T16:00");
    await change(field("programmed_hours"), "8");
    await change(field("units_produced"), "1200");
    await change(field("waste"), "3");
    await wait(200);

    await click(buttonsByLabel("Enviar reporte")[0]);
    const dialog = document.querySelector(DIALOG)!;
    expect(dialog).not.toBeNull();
    await click(buttonsByLabel("Enviar reporte", dialog)[0]);
    await wait(150);

    const operations = await outbox.listOperations(USER_A);
    expect(operations.map((operation) => operation.type)).toEqual([
      "CREATE_REPORT", "START_STOP", "CLOSE_STOP", "START_STOP", "CLOSE_STOP", "ADD_CHANGE", "SAVE_REPORT_FIELDS", "SUBMIT_REPORT",
    ]);
    expect(operations.every((operation) => operation.capturedOffline && operation.state === "pending")).toBe(true);
    // La hora del dispositivo es la de la captura (no editable por el usuario).
    const [create, start, close, , , change1] = operations;
    expect(create.payload.startedAt).toBe(create.capturedAt);
    expect(start.payload.startedAt).toBe(start.capturedAt);
    expect(close.payload.endedAt).toBe(close.capturedAt);
    expect(close.payload.categoryId).toBe(CAT_ASEO);
    expect(change1.payload.occurredAt).toBe(change1.capturedAt);
    expect(Date.parse(close.capturedAt)).toBeGreaterThanOrEqual(Date.parse(start.capturedAt));
    expect(operations[6].payload.fields).toMatchObject({ production_order: "OP-77", lot: "L-5", units_produced: 1200 });

    // Nada se escribió en el servidor y el indicador cuenta las 8 operaciones.
    expect(calls.filter((call) => call.method !== "GET" && call.method !== "HEAD" && call.url !== "/api/device-status")).toHaveLength(0);
    await eventually("Sin conexión — guardado en este dispositivo · 8 pendientes");
  });

  test("sin asignación vigente muestra «Solicita una asignación a tu coordinador» y no permite iniciar", async () => {
    snapshotBody = { ...makeSnapshot(USER_A, { assignments: [] }) };
    await mountApp();
    expect(text()).toContain("Solicita una asignación a tu coordinador");
    expect(buttonsByLabel("Iniciar reporte")).toHaveLength(0);
  });

  test("sin conexión y sin ningún snapshot guardado pide conectarse", async () => {
    await goOffline();
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await mountApp();
    expect(text()).toContain("Necesitas conexión para iniciar sesión");
  });

  test("sin conexión usa el snapshot guardado SOLO con la sesión local (contraseña verificada)", async () => {
    await mountApp(); // en línea: guarda el snapshot
    await act(async () => root.unmount());
    root = createRoot(container);
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    sync.resetSyncClientForTests();
    await goOffline();
    // Sin sesión local (nadie verificó la contraseña) no se opera como el último usuario.
    await mountApp();
    expect(text()).toContain("Necesitas conexión para iniciar sesión");
    await act(async () => root.unmount());
    root = createRoot(container);
    sync.resetSyncClientForTests();
    const offlineAuth = await import("../src/lib/offline/offline-auth");
    await offlineAuth.startLocalSession({ userId: USER_A, role: "OPERATOR", username: "op1", fullName: "Operario Uno", startedAt: new Date().toISOString(), offline: true });
    await mountApp();
    expect(text()).toContain("Operario Uno");
    expect(buttonsByLabel("Iniciar reporte")).toHaveLength(1);
  });
});
