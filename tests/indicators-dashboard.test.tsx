/// <reference types="bun" />
// T008: IndicatorsDashboard con fetch simulado: carga, rango, aborto, error/reintento y datos vacíos.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";

const browser = new Window({ url: "http://localhost:4321/indicadores" });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true, Node: browser.Node, Element: browser.Element,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
});
const { createRoot } = await import("react-dom/client");
const { default: IndicatorsDashboard } = await import("../src/components/indicators/IndicatorsDashboard");

const payload = (cards: Record<string, unknown>) => ({
  range: { key: "30d", from: "2026-09-20", to: "2026-10-19", days: 30 },
  cards, daily: [], machines: [], categories: [], serverTime: "2026-10-19T15:00:00Z",
});
const full = payload({ reports: 12, approved: 9, approvedRatio: 0.75, avgApprovalSeconds: 7200, stopSeconds: 18000 });
const empty = payload({ reports: 0, approved: 0, approvedRatio: null, avgApprovalSeconds: null, stopSeconds: 0 });

const realFetch = globalThis.fetch;
let requests: Array<{ url: string; signal?: AbortSignal | null }>;
let respond: (url: string) => Promise<Response>;
let root: Root;
let container: HTMLDivElement;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const mount = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<IndicatorsDashboard />); await flush(); });
};
const valueOf = (id: string) => container.querySelector(`[data-indicator="${id}"] [data-indicator-value]`)?.textContent;
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeAll(() => { Object.assign(globalThis, { document: browser.document, window: browser }); });
beforeEach(() => {
  requests = [];
  respond = () => json(full);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), signal: init?.signal });
    return respond(String(input));
  }) as typeof fetch;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("IndicatorsDashboard", () => {
  test("al montar pide rango=30d y muestra las cuatro tarjetas formateadas", async () => {
    await mount();
    expect(requests.map((r) => r.url)).toEqual(["/api/indicadores?rango=30d"]);
    const text = container.textContent ?? "";
    for (const title of ["Reportes del periodo", "Reportes aprobados", "Tiempo hasta aprobación", "Horas de parada"]) expect(text).toContain(title);
    expect(text).toContain("Promedio desde el fin del turno");
    expect(valueOf("reports")).toBe("12");
    expect(valueOf("approved")).toContain("75");
    expect(valueOf("approved")).toContain("%");
    expect(valueOf("approval-time")).toBe("2,0 h");
    expect(valueOf("stops")).toBe("5,0 h");
  });

  test("muestra esqueletos mientras carga", async () => {
    respond = () => new Promise<Response>(() => {});
    await mount();
    expect(container.querySelector("[data-indicators-loading]")).not.toBeNull();
    expect(container.querySelector("[data-indicator]")).toBeNull();
  });

  test("cambiar a 7 días vuelve a pedir rango=7d y aborta la petición anterior", async () => {
    respond = () => new Promise<Response>(() => {});
    await mount();
    const first = requests[0]!;
    expect(first.signal?.aborted).toBe(false);
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("Últimos 7 días");
    await act(async () => {
      select.value = "7d";
      select.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event);
      await flush();
    });
    expect(requests.map((r) => r.url)).toEqual(["/api/indicadores?rango=30d", "/api/indicadores?rango=7d"]);
    expect(first.signal?.aborted).toBe(true);
  });

  test("error muestra alerta con Reintentar, que vuelve a pedir", async () => {
    respond = () => json({ error: "x" }, 500);
    await mount();
    expect(container.textContent).toContain("No fue posible cargar los indicadores");
    respond = () => json(full);
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Reintentar")!;
    await act(async () => { retry.click(); await flush(); });
    expect(requests).toHaveLength(2);
    expect(valueOf("reports")).toBe("12");
  });

  test("con datos vacíos las tarjetas muestran 0 y —", async () => {
    respond = () => json(empty);
    await mount();
    expect(valueOf("reports")).toBe("0");
    expect(valueOf("approved")).toBe("—");
    expect(valueOf("approval-time")).toBe("—");
    expect(valueOf("stops")).toBe("0,0 h");
  });
});
