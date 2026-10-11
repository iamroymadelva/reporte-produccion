/// <reference types="bun" />

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { indexedDB } from "fake-indexeddb";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";

const browser = new Window({ url: "http://localhost:4321/reportes/test" });
const browserGlobals = {
  window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, indexedDB,
  IS_REACT_ACT_ENVIRONMENT: true,
  // Radix UI (AlertDialog, FocusScope, Presence) necesita estas APIs del navegador.
  Node: browser.Node, Element: browser.Element, KeyboardEvent: browser.KeyboardEvent,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
};
Object.assign(globalThis, browserGlobals);
browser.HTMLElement.prototype.scrollIntoView = function () {};

// Import after installing the DOM so React enables its browser event handling.
const { createRoot } = await import("react-dom/client");
const { default: ReportEditor } = await import("../src/components/ReportEditor");
const { default: StopManager } = await import("../src/components/StopManager");
const { default: StopEventsTable } = await import("../src/components/StopEventsTable");
const { guardedMutationFetch, getConnectivitySnapshot, resetConnectivityForTests } = await import("../src/lib/connectivity");
const categories = [{ id: "aseo", code: "8", name: "Aseo" }, { id: "correctivo", code: "4", name: "Correctivo" }];
const catalog = [{ id: "option", code: "1", name: "Existente" }];
const complete = { id: "test", updated_at: "2026-09-15T00:00:00Z", creator_full_name: "Operario responsable", report_date: "2026-09-15", product_name: "Existente", product_id: "option", client_name: "Existente", client_id: "option", production_order: "OP-1", line_id: "option", lot: "L1", shift_id: "option", weight: 0, g_min: 0, dosifier_type_id: "option", started_at: "2026-09-15T08:00:00-05:00", ended_at: "2026-09-15T16:00:00-05:00", programmed_hours: 0, units_produced: 0, waste: 0 };
const props = { report: complete, lines: catalog, clients: catalog, products: catalog, dosifierTypes: catalog, shifts: [{ id: "option", name: "Día", start_time: "06:00", end_time: "14:00" }], canSubmit: true, adminCorrection: false, machineLabel: "M-1" };
const active = { id: "active", started_at: new Date(Date.now() - 360_000).toISOString(), ended_at: null, duration_seconds: null, description: null, cancelled_at: null, cancellation_reason: null, stop_category: categories[0] };
let root: Root;
let container: HTMLDivElement;
let requests: Array<{ url: string; init: RequestInit }>;
let respond: (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
// Los diálogos de confirmación son AlertDialog de Radix (role="alertdialog"), no <dialog> nativos.
const DIALOG = "[role=\"alertdialog\"]";
const text = () => document.body.textContent ?? "";
const buttons = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent === label);
const click = async (button: HTMLButtonElement) => { expect(button).toBeDefined(); await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 20)); }); };
const change = async (selector: string, value: string) => {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)!;
  expect(field).toBeDefined();
  await act(async () => {
    const prototype = field.tagName === "SELECT" ? browser.HTMLSelectElement.prototype : field.tagName === "TEXTAREA" ? browser.HTMLTextAreaElement.prototype : browser.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new browser.Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }) as any);
  });
};
const mount = async (element: ReactNode) => {
  await act(async () => {
    root.render(element);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};
const settle = async (ms: number) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };

// Todos los archivos de prueba comparten proceso y cada uno instala su propio DOM: se reinstala el de este archivo.
beforeAll(() => { Object.assign(globalThis, browserGlobals); resetConnectivityForTests(); getConnectivitySnapshot(); });
beforeEach(async () => {
  Object.assign(globalThis, browserGlobals);
  requests = [];
  respond = () => json({ ok: true, report: { updated_at: "2026-09-15T01:00:00Z" } });
  globalThis.fetch = (async (input, init = {}) => {
    const url = String(input);
    if (url === "/api/health") return new Response(null, { status: 204 });
    requests.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { browser.dispatchEvent(new browser.Event("online")); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Operator interactions", () => {
  test("administrative performance inputs remain available", async () => {
    await mount(<ReportEditor {...props} canSubmit={false} adminCorrection />);
    expect(text()).toContain("Rendimiento del proceso (%)");
    expect(text()).toContain("Rendimiento del Operario (%)");
  });
  // T051: el manager corrige SUBMITTED/CLOSED solo por /correct, con motivo y resumen de campos (sin PATCH).
  test("administrative corrections wait for one explicit save through /correct with a reason", async () => {
    await mount(<ReportEditor {...props} canSubmit={false} adminCorrection />);
    expect(text()).toContain("Los cambios se aplican únicamente al confirmar la corrección con un motivo.");
    expect(buttons("Corregir con motivo")[0].disabled).toBe(true);

    await change('[data-report-field="production_order"]', "AP15");
    await change('[data-report-field="production_order"]', "AP1555");
    await change('[data-report-field="lot"]', "LOTE-FINAL");
    await settle(900);
    expect(requests.length).toBe(0);

    await click(buttons("Corregir con motivo")[0]);
    expect(requests.length).toBe(0);
    const dialog = document.querySelector(DIALOG)!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("O.P.");
    expect(dialog.textContent).toContain("AP1555");
    expect(dialog.textContent).toContain("Lote");
    expect(dialog.textContent).toContain("LOTE-FINAL");
    const confirm = buttons("Guardar corrección", dialog)[0];
    expect(confirm.disabled).toBe(true);

    await change(`${DIALOG} textarea`, "abc");
    expect(buttons("Guardar corrección", document.querySelector(DIALOG)!)[0].disabled).toBe(true);
    await change(`${DIALOG} textarea`, "Error de digitación");
    await click(buttons("Guardar corrección", document.querySelector(DIALOG)!)[0]);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toBe("/api/reports/test/correct");
    expect(requests[0].init.method).toBe("POST");
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      patch: { production_order: "AP1555", lot: "LOTE-FINAL" },
      reason: "Error de digitación",
    });
  });
  test("a rejected administrative correction keeps the dialog open and shows the server message", async () => {
    await mount(<ReportEditor {...props} canSubmit={false} adminCorrection />);
    respond = () => json({ error: "Solo se pueden corregir reportes enviados o cerrados." }, 409);

    await change('[data-report-field="lot"]', "PRIMER-CAMBIO");
    await click(buttons("Corregir con motivo")[0]);
    await change(`${DIALOG} textarea`, "Motivo válido");
    await click(buttons("Guardar corrección", document.querySelector(DIALOG)!)[0]);
    await settle(40);

    expect(requests.length).toBe(1);
    expect(document.querySelector(DIALOG)!.textContent).toContain("Solo se pueden corregir reportes enviados o cerrados.");
    expect(buttons("Guardar corrección", document.querySelector(DIALOG)!)[0].disabled).toBe(false);
  });
  test("orders fields, hides analytics and validates every required control with focus", async () => {
    await mount(<ReportEditor {...props} report={{ id: "empty", creator_full_name: "Operario" }} />);
    const labels = [...container.querySelectorAll(".field-label")].map((node) => node.textContent);
    expect(labels.slice(0, 12)).toEqual(["Máquina", "Operario responsable", "Fecha", "Producto", "O.P.", "Área / Línea", "Cliente", "Lote", "Turno", "Peso (gr)", "G/min", "Tipo de dosificador"]);
    expect(text()).not.toContain("Rendimiento");
    expect(container.querySelectorAll("[required]").length).toBe(15);
    await click(buttons("Enviar reporte")[0]);
    await settle(30);
    expect(container.querySelectorAll('[aria-invalid="true"]').length).toBe(15);
    expect(document.activeElement?.getAttribute("data-report-field")).toBe("report_date");
    expect(text()).toContain("Faltan campos obligatorios");
    expect(requests.length).toBe(0);
  });
  test("submission needs explicit confirmation and cancellation does nothing", async () => {
    await mount(<ReportEditor {...props} />);
    await click(buttons("Enviar reporte")[0]);
    expect(document.querySelector(DIALOG)?.textContent).toContain("¿Enviar reporte?");
    expect(requests.length).toBe(0);
    await click(buttons("Cancelar", document.querySelector(DIALOG)!)[0]);
    expect(document.querySelector(DIALOG)).toBeNull();
    expect(requests.length).toBe(0);
    await click(buttons("Enviar reporte")[0]);
    await click(buttons("Enviar reporte", document.querySelector(DIALOG)!)[0]);
    expect(requests.map(({ url }) => url)).toEqual(["/api/reports/test", "/api/reports/test/submit"]);
  });
  test("active stop blocks submission with Spanish guidance", async () => {
    await mount(<ReportEditor {...props} hasActiveStop />);
    await click(buttons("Enviar reporte")[0]);
    expect(text()).toContain("Detén o cancela la parada primero");
    expect(requests.length).toBe(0);
  });
  test("current time is editable and never overwrites manual hours", async () => {
    await mount(<ReportEditor {...props} />);
    await click(buttons("Usar hora actual")[0]);
    const field = document.querySelector<HTMLInputElement>('[data-report-field="started_at"]')!;
    expect(Math.abs(new Date(field.value).getTime() - Date.now())).toBeLessThan(61_000);
    await change('[data-report-field="started_at"]', "2026-09-15T07:42");
    expect(field.value).toBe("2026-09-15T07:42");
    expect(document.querySelector<HTMLInputElement>('[data-report-field="programmed_hours"]')!.value).toBe("0");
  });
  test("the operator sees the server-assigned date and shift as read-only and cannot edit them", async () => {
    await mount(<ReportEditor {...props} />);
    const date = document.querySelector<HTMLInputElement>('[data-report-field="report_date"]')!;
    const shift = document.querySelector<HTMLInputElement>('[data-report-field="shift_id"]')!;
    expect(date.readOnly).toBe(true);
    expect(date.value).toBe("2026-09-15");
    expect(shift.tagName).toBe("INPUT");
    expect(shift.readOnly).toBe(true);
    expect(shift.value).toBe("Día · 06:00 - 14:00");
    await change('[data-report-field="lot"]', "L2");
    await settle(900);
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector<HTMLInputElement>('[data-report-field="report_date"]')!.value).toBe("2026-09-15");
  });
  test("client and product are selectors of active catalog items, with no frequent-value flow", async () => {
    await mount(<ReportEditor {...props} clients={[...catalog, { id: "otro", code: "2", name: "Otro cliente" }]} />);
    const client = document.querySelector<HTMLSelectElement>('[data-report-field="client_name"]')!;
    const product = document.querySelector<HTMLSelectElement>('[data-report-field="product_name"]')!;
    expect(client.tagName).toBe("SELECT");
    expect(product.tagName).toBe("SELECT");
    expect([...client.options].map((option) => option.value)).toEqual(["", "option", "otro"]);
    expect(document.querySelector("datalist")).toBeNull();
    await change('[data-report-field="client_name"]', "otro");
    await settle(900);
    const patch = requests.find((request) => request.init.method === "PATCH")!;
    expect(JSON.parse(String(patch.init.body))).toMatchObject({ client_id: "otro", client_name: "Otro cliente" });
    expect(requests.some((request) => request.url.includes("/api/catalogs/frequent"))).toBe(false);
    expect(text()).not.toContain("valores frecuentes");
  });
  test("start requires category and confirmation; cancelling the dialog starts nothing", async () => {
    await mount(<StopManager reportId="test" stops={[]} categories={categories} />);
    expect(buttons("Iniciar parada")[0].disabled).toBe(true);
    await change("select", "aseo");
    await click(buttons("Iniciar parada")[0]);
    expect(document.querySelector(DIALOG)?.textContent).toContain("Aseo");
    await click(buttons("Cancelar", document.querySelector(DIALOG)!)[0]);
    expect(requests.length).toBe(0);
    respond = () => json({ stop: active });
    await click(buttons("Iniciar parada")[0]);
    await click(buttons("Iniciar parada", document.querySelector(DIALOG)!)[0]);
    expect(requests.length).toBe(1);
    expect(text()).toContain("Número de paradas: 0");
    expect(text()).toContain("00:06:");
  });
  test("category confirmation preserves timer; close cancel continues and confirmed close updates totals", async () => {
    await mount(<StopManager reportId="test" stops={[active]} categories={categories} />);
    await change("select", "correctivo");
    await click(buttons("Cambiar categoría")[0]);
    expect(document.querySelector(DIALOG)?.textContent).toContain("El contador continuará sin reiniciarse");
    await click(buttons("Cancelar", document.querySelector(DIALOG)!)[0]);
    expect(requests.length).toBe(0);
    respond = () => json({ stop: { ...active, stop_category: categories[1] } });
    await click(buttons("Cambiar categoría")[0]);
    await click(buttons("Cambiar categoría", document.querySelector(DIALOG)!)[0]);
    expect(text()).toContain("00:06:");
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ stop_category_id: "correctivo" });
    await click(buttons("Detener")[0]);
    expect(document.querySelector(DIALOG)?.textContent).toContain("Correctivo");
    expect(document.querySelector(DIALOG)?.textContent).toContain("Tiempo transcurrido");
    await click(buttons("Cancelar", document.querySelector(DIALOG)!)[0]);
    expect(buttons("Detener").length).toBe(1);
    respond = () => json({ stop: { ...active, stop_category: categories[1], ended_at: new Date().toISOString(), duration_seconds: 360 } });
    await click(buttons("Detener")[0]);
    await click(buttons("Detener parada", document.querySelector(DIALOG)!)[0]);
    expect(text()).toContain("Número de paradas: 1");
    expect(text()).toContain("Tiempo total de parada: 00:06:00");
    expect(buttons("Detener").length).toBe(0);
  });
  test("active cancellation rejects whitespace and retains reason outside totals", async () => {
    await mount(<StopManager reportId="test" stops={[active]} categories={categories} />);
    await click(buttons("Cancelar parada")[0]);
    await change("textarea", "   ");
    expect(buttons("Confirmar cancelación")[0].disabled).toBe(true);
    await change("textarea", "Error de inicio");
    respond = () => json({ stop: { ...active, cancelled_at: new Date().toISOString(), ended_at: new Date().toISOString(), cancellation_reason: "Error de inicio" } });
    await click(buttons("Confirmar cancelación")[0]);
    expect(text()).toContain("Cancelada");
    expect(text()).toContain("Error de inicio");
    expect(text()).toContain("Número de paradas: 0");
    expect(text()).toContain("Tiempo total de parada: 00:00:00");
  });
  test("history keeps cancellation in chronological position with no edit controls", async () => {
    const closed = { ...active, ended_at: "2026-09-15T08:01:00Z", duration_seconds: 60 };
    await mount(<StopEventsTable chronologicalOnly stops={[
      { ...closed, id: "last", started_at: "2026-09-15T10:00:00Z" },
      { ...closed, id: "cancelled", started_at: "2026-09-15T09:00:00Z", cancelled_at: "2026-09-15T09:01:00Z", cancellation_reason: "Inicio accidental", duration_seconds: null },
      { ...closed, id: "first", started_at: "2026-09-15T08:00:00Z" },
    ]} />);
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.length).toBe(3);
    expect(rows[1].textContent).toContain("Cancelada");
    expect(rows[1].textContent).toContain("Inicio accidental");
    expect(container.querySelectorAll("button,input,select").length).toBe(0);
  });
  test("starting and closing updates submission guard without remounting the report editor", async () => {
    await mount(<><ReportEditor {...props} /><StopManager reportId="test" stops={[]} categories={categories} /></>);
    const lot = document.querySelector('[data-report-field="lot"]');
    await change("section:last-of-type select", "aseo");
    respond = () => json({ stop: active });
    await click(buttons("Iniciar parada")[0]);
    await click(buttons("Iniciar parada", document.querySelector(DIALOG)!)[0]);
    await click(buttons("Enviar reporte")[0]);
    expect(text()).toContain("Detén o cancela la parada primero");
    expect(document.querySelector('[data-report-field="lot"]')).toBe(lot);
    respond = () => json({ stop: { ...active, ended_at: new Date().toISOString(), duration_seconds: 360 } });
    await click(buttons("Detener")[0]);
    await click(buttons("Detener parada", document.querySelector(DIALOG)!)[0]);
    await click(buttons("Enviar reporte")[0]);
    expect(document.querySelector(DIALOG)?.textContent).toContain("¿Enviar reporte?");
    await click(buttons("Cancelar", document.querySelector(DIALOG)!)[0]);
  });
  test("autosave acknowledgement preserves focus and serializes newer edits", async () => {
    const id = "serialized-ui";
    await mount(<ReportEditor {...props} report={{ ...complete, id }} />);
    await settle(30);
    let release!: (response: Response) => void;
    respond = () => requests.length === 1 ? new Promise<Response>((resolve) => { release = resolve; }) : json({ ok: true, report: { updated_at: "2026-09-15T02:00:00Z" } });
    await change('[data-report-field="lot"]', "FIRST");
    await settle(900);
    expect(requests.length).toBe(1);
    await change('[data-report-field="lot"]', "SECOND");
    const field = document.querySelector<HTMLInputElement>('[data-report-field="lot"]')!;
    field.focus();
    let disabledMutationCount = 0;
    const observer = new browser.MutationObserver((records) => { disabledMutationCount += records.length; });
    observer.observe(field as unknown as Parameters<typeof observer.observe>[0], { attributes: true, attributeFilter: ["disabled"] });
    expect(requests.length).toBe(1);
    await act(async () => { release(json({ ok: true, report: { updated_at: "2026-09-15T01:00:00Z" } })); });
    await settle(50);
    observer.disconnect();
    expect(requests.length).toBe(2);
    expect(JSON.parse(String(requests[1].init.body)).lot).toBe("SECOND");
    expect(field.value).toBe("SECOND");
    expect(field.disabled).toBe(false);
    expect(disabledMutationCount).toBe(0);
    expect(document.activeElement).toBe(field);
  });
});
