/// <reference types="bun" />
// T097: LiveDashboard con un cliente Realtime simulado: evento → refetch con debounce de /api/dashboard/summary;
// CHANNEL_ERROR o sin suscripción en 5 s → polling cada 8 s; al reconectar el polling se detiene; limpieza al desmontar.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { FakeRealtimeClient, FakeTimers, flush } from "./helpers/fake-realtime";

const browser = new Window({ url: "http://localhost:4321/dashboard" });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true, Node: browser.Node, Element: browser.Element,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
});
const { createRoot } = await import("react-dom/client");
const { default: LiveDashboard } = await import("../src/components/realtime/LiveDashboard");

const summary = (draft: number, extra: Record<string, unknown> = {}) => ({
  range: { from: "2026-10-10", to: "2026-10-10" },
  kpis: { DRAFT: draft, SUBMITTED: 2, CLOSED: 1, CANCELLED: 0, ACTIVE_STOP: 1, OFF_SHIFT: 0, OPEN_CONFLICTS: 3 },
  machinesStopped: [{ reportId: "r1", folio: "RPT-1", machine: { code: "M-01", name: "Envasadora" }, operator: "Op Uno", since: "2026-10-10T15:00:00Z" }],
  offShiftReports: [],
  recent: [{ id: "r1", folio: "RPT-1", status: "DRAFT", createdAt: "2026-10-10T14:00:00Z", machine: { code: "M-01", name: "Envasadora" }, operator: "Op Uno", productionOrder: null, approver: null, approvedAt: null, isOffShift: false, activeStop: true }],
  operators: [], serverTime: "2026-10-10T15:00:00Z", ...extra,
});

const realFetch = globalThis.fetch;
let requests: string[];
let draftCount: number;
let nextStatus: number;
let root: Root;
let container: HTMLDivElement;
let client: FakeRealtimeClient;
let timers: FakeTimers;

const mount = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<LiveDashboard date="2026-10-10" realtime={{ client, timers }} />);
    await flush();
  });
};
const advance = async (ms: number) => { await act(async () => { timers.advance(ms); await flush(); }); };
const kpi = (key: string) => container.querySelector(`[data-kpi="${key}"]`)?.textContent;
const modeText = () => container.querySelector("[data-live-mode]")?.getAttribute("data-live-mode");

beforeAll(() => { Object.assign(globalThis, { document: browser.document, window: browser }); });
beforeEach(() => {
  requests = [];
  draftCount = 4;
  nextStatus = 200;
  client = new FakeRealtimeClient();
  timers = new FakeTimers();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify(summary(draftCount)), { status: nextStatus });
  }) as typeof fetch;
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  globalThis.fetch = realFetch;
});

describe("LiveDashboard (T097)", () => {
  test("carga el resumen al montar y lo pinta (KPI, máquinas en parada, conflictos)", async () => {
    await mount();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toStartWith("/api/dashboard/summary?from=2026-10-10&to=2026-10-10");
    expect(kpi("DRAFT")).toBe("4");
    expect(kpi("OPEN_CONFLICTS")).toBe("3");
    expect(container.textContent).toContain("M-01 · Envasadora");
    expect(container.textContent).toContain("RPT-1");
  });

  test("se suscribe a reportes, paradas y cuarentena", async () => {
    await mount();
    expect(client.channels.map((c) => (c.handlers[0].filter as any).table).sort()).toEqual(["production_reports", "report_stop_events", "sync_quarantine"]);
  });

  test("un evento dispara UN refetch tras el debounce de 500 ms y el KPI se actualiza sin recargar", async () => {
    await mount();
    await act(async () => { client.setAll("SUBSCRIBED"); });
    expect(modeText()).toBe("live");
    draftCount = 7;
    await act(async () => { client.byName("dashboard-reports").emit({ new: { id: "r9" } }); client.byName("dashboard-stops").emit(); client.byName("dashboard-reports").emit(); });
    await advance(499);
    expect(requests).toHaveLength(1);
    await advance(1);
    expect(requests).toHaveLength(2);
    expect(kpi("DRAFT")).toBe("7");
  });

  test("con CHANNEL_ERROR activa el polling cada 8 s y lo indica; al reconectar se detiene", async () => {
    await mount();
    await act(async () => { client.setAll("SUBSCRIBED"); });
    await act(async () => { client.byName("dashboard-stops").setStatus("CHANNEL_ERROR"); });
    expect(modeText()).toBe("polling");
    expect(container.textContent).toContain("Actualización automática cada 8 s");
    const afterError = requests.length; // consulta inmediata al entrar al respaldo
    expect(afterError).toBe(2);
    await advance(8000);
    expect(requests).toHaveLength(afterError + 1);
    await advance(8000);
    expect(requests).toHaveLength(afterError + 2);
    await act(async () => { client.byName("dashboard-stops").setStatus("SUBSCRIBED"); });
    expect(modeText()).toBe("live");
    await advance(500); // recarga final por el debounce
    const afterReconnect = requests.length;
    await advance(60_000);
    expect(requests).toHaveLength(afterReconnect); // el polling se detuvo
  });

  test("sin suscripción en 5 s activa el polling", async () => {
    await mount();
    await advance(4999);
    expect(requests).toHaveLength(1);
    expect(modeText()).toBe("connecting");
    await advance(1);
    expect(modeText()).toBe("polling");
    expect(requests).toHaveLength(2);
    await advance(8000);
    expect(requests).toHaveLength(3);
  });

  test("una respuesta con error muestra un aviso y se reintenta en el siguiente ciclo", async () => {
    nextStatus = 500;
    await mount();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("No fue posible actualizar el tablero");
    nextStatus = 200;
    await advance(5000); // entra el respaldo (consulta inmediata)
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(kpi("DRAFT")).toBe("4");
  });

  test("al desmontar elimina los canales y no vuelve a consultar", async () => {
    await mount();
    await act(async () => { client.setAll("SUBSCRIBED"); client.byName("dashboard-reports").emit(); });
    await act(async () => { root.unmount(); });
    root = createRoot(container); // afterEach vuelve a desmontar
    expect([...client.removedNames].sort()).toEqual(["dashboard-quarantine", "dashboard-reports", "dashboard-stops"]);
    const count = requests.length;
    await advance(120_000);
    expect(requests).toHaveLength(count);
    expect(timers.pending).toBe(0);
  });
});
