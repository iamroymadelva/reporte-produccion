/// <reference types="bun" />

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { indexedDB } from "fake-indexeddb";
import { act, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { getReportDraft, getSaveReportOperation, acknowledgeConfirmedReportRevision, savePendingReportRevision } from "../src/lib/offline-report-store";

const browser = new Window({ url: "http://localhost:4321/reportes/test" });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, indexedDB,
  IS_REACT_ACT_ENVIRONMENT: true,
});
browser.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
browser.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new browser.Event("close")); };
browser.HTMLElement.prototype.scrollIntoView = function () {};

// Import after installing the DOM so React enables its browser event handling.
const { createRoot } = await import("react-dom/client");
const { default: ReportEditor } = await import("../src/components/ReportEditor");
const { default: StopManager } = await import("../src/components/StopManager");
const { default: StopEventsTable } = await import("../src/components/StopEventsTable");
const { guardedMutationFetch, getConnectivitySnapshot } = await import("../src/lib/connectivity");
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

beforeAll(() => { getConnectivitySnapshot(); });
beforeEach(async () => {
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
    expect(document.querySelector("dialog")?.textContent).toContain("¿Enviar reporte?");
    expect(requests.length).toBe(0);
    await click(buttons("Cancelar", document.querySelector("dialog")!)[0]);
    expect(document.querySelector("dialog")).toBeNull();
    expect(requests.length).toBe(0);
    await click(buttons("Enviar reporte")[0]);
    await click(buttons("Enviar reporte", document.querySelector("dialog")!)[0]);
    expect(requests.map(({ url }) => url)).toEqual(["/api/reports/test", "/api/reports/test/submit"]);
  });
  test("active stop blocks submission with Spanish guidance", async () => {
    await mount(<ReportEditor {...props} hasActiveStop />);
    await click(buttons("Enviar reporte")[0]);
    expect(text()).toContain("Detén o cancela la parada primero");
    expect(requests.length).toBe(0);
  });
  test("current time is editable and selecting shift never overwrites manual time or hours", async () => {
    await mount(<ReportEditor {...props} />);
    await click(buttons("Usar hora actual")[0]);
    const field = document.querySelector<HTMLInputElement>('[data-report-field="started_at"]')!;
    expect(Math.abs(new Date(field.value).getTime() - Date.now())).toBeLessThan(61_000);
    await change('[data-report-field="started_at"]', "2026-09-15T07:42");
    await change('[data-report-field="shift_id"]', "");
    expect(field.value).toBe("2026-09-15T07:42");
    expect(document.querySelector<HTMLInputElement>('[data-report-field="programmed_hours"]')!.value).toBe("0");
  });
  test("start requires category and confirmation; cancelling the dialog starts nothing", async () => {
    await mount(<StopManager reportId="test" stops={[]} categories={categories} />);
    expect(buttons("Iniciar parada")[0].disabled).toBe(true);
    await change("select", "aseo");
    await click(buttons("Iniciar parada")[0]);
    expect(document.querySelector("dialog")?.textContent).toContain("Aseo");
    await click(buttons("Cancelar", document.querySelector("dialog")!)[0]);
    expect(requests.length).toBe(0);
    respond = () => json({ stop: active });
    await click(buttons("Iniciar parada")[0]);
    await click(buttons("Iniciar parada", document.querySelector("dialog")!)[0]);
    expect(requests.length).toBe(1);
    expect(text()).toContain("Número de paradas: 0");
    expect(text()).toContain("00:06:");
  });
  test("category confirmation preserves timer; close cancel continues and confirmed close updates totals", async () => {
    await mount(<StopManager reportId="test" stops={[active]} categories={categories} />);
    await change("select", "correctivo");
    await click(buttons("Cambiar categoría")[0]);
    expect(document.querySelector("dialog")?.textContent).toContain("El contador continuará sin reiniciarse");
    await click(buttons("Cancelar", document.querySelector("dialog")!)[0]);
    expect(requests.length).toBe(0);
    respond = () => json({ stop: { ...active, stop_category: categories[1] } });
    await click(buttons("Cambiar categoría")[0]);
    await click(buttons("Cambiar categoría", document.querySelector("dialog")!)[0]);
    expect(text()).toContain("00:06:");
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ stop_category_id: "correctivo" });
    await click(buttons("Detener")[0]);
    expect(document.querySelector("dialog")?.textContent).toContain("Correctivo");
    expect(document.querySelector("dialog")?.textContent).toContain("Tiempo transcurrido");
    await click(buttons("Cancelar", document.querySelector("dialog")!)[0]);
    expect(buttons("Detener").length).toBe(1);
    respond = () => json({ stop: { ...active, stop_category: categories[1], ended_at: new Date().toISOString(), duration_seconds: 360 } });
    await click(buttons("Detener")[0]);
    await click(buttons("Detener parada", document.querySelector("dialog")!)[0]);
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
    await click(buttons("Iniciar parada", document.querySelector("dialog")!)[0]);
    await click(buttons("Enviar reporte")[0]);
    expect(text()).toContain("Detén o cancela la parada primero");
    expect(document.querySelector('[data-report-field="lot"]')).toBe(lot);
    respond = () => json({ stop: { ...active, ended_at: new Date().toISOString(), duration_seconds: 360 } });
    await click(buttons("Detener")[0]);
    await click(buttons("Detener parada", document.querySelector("dialog")!)[0]);
    await click(buttons("Enviar reporte")[0]);
    expect(document.querySelector("dialog")?.textContent).toContain("¿Enviar reporte?");
    await click(buttons("Cancelar", document.querySelector("dialog")!)[0]);
  });
  test("offline draft remains editable, persists in IndexedDB and requires manual save on reconnect", async () => {
    const id = "offline-ui";
    await mount(<><ReportEditor {...props} report={{ ...complete, id }} offlinePersistence authenticatedUserId="owner" serverUpdatedAt={complete.updated_at} /><StopManager reportId={id} stops={[active]} categories={categories} /></>);
    await settle(30);
    await act(async () => { browser.dispatchEvent(new browser.Event("offline")); });
    expect(buttons("Detener")[0].disabled).toBe(true);
    await expect(guardedMutationFetch("/forbidden-offline", { method: "POST" })).rejects.toThrow("requiere conexión");
    await change('[data-report-field="lot"]', "LOCAL-1");
    await click(buttons("Guardar en este dispositivo")[0]);
    await settle(30);
    expect((await getReportDraft("owner", id))?.localValues.lot).toBe("LOCAL-1");
    expect((await getSaveReportOperation("owner", id))?.payload.units_produced).toBe(0);
    expect(requests.length).toBe(0);
    await act(async () => { browser.dispatchEvent(new browser.Event("online")); });
    await settle(900);
    expect(text()).toContain("Hay cambios pendientes de guardar");
    expect(requests.length).toBe(0);
    await click(buttons("Guardar ahora")[0]);
    expect(requests.length).toBe(1);
    expect(JSON.parse(String(requests[0].init.body))._base_updated_at).toBe(complete.updated_at);
    expect(await getReportDraft("owner", id)).toBeNull();
  });
  test("a newer pending revision survives acknowledgement of an earlier autosave", async () => {
    const input = { userId: "owner", reportId: "revision-test", baseUpdatedAt: complete.updated_at, writerInstanceId: "writer", baseValues: complete };
    await savePendingReportRevision({ ...input, localRevision: 1, localValues: { lot: "A" }, payload: { lot: "A" } });
    await savePendingReportRevision({ ...input, localRevision: 2, localValues: { lot: "B" }, payload: { lot: "B" } });
    expect((await acknowledgeConfirmedReportRevision({ userId: "owner", reportId: input.reportId, confirmedLocalRevision: 1, confirmedServerValues: { lot: "A" }, confirmedServerUpdatedAt: "2026-09-15T01:00:00Z" })).status).toBe("preserved_newer");
    expect((await getReportDraft("owner", input.reportId))?.localValues.lot).toBe("B");
    expect((await getSaveReportOperation("owner", input.reportId))?.payload.lot).toBe("B");
  });
  test("server saves are serialized and preserve edits made during an in-flight save", async () => {
    await mount(<ReportEditor {...props} />);
    let release!: (response: Response) => void;
    respond = () => requests.length === 1 ? new Promise<Response>((resolve) => { release = resolve; }) : json({ ok: true, report: { updated_at: "2026-09-15T02:00:00Z" } });
    await change('[data-report-field="lot"]', "FIRST");
    await click(buttons("Guardar ahora")[0]);
    expect(requests.length).toBe(1);
    await change('[data-report-field="lot"]', "SECOND");
    expect(requests.length).toBe(1);
    await act(async () => { release(json({ ok: true, report: { updated_at: "2026-09-15T01:00:00Z" } })); });
    expect(requests.length).toBe(2);
    expect(JSON.parse(String(requests[1].init.body)).lot).toBe("SECOND");
    expect(document.querySelector<HTMLInputElement>('[data-report-field="lot"]')!.value).toBe("SECOND");
  });
});
