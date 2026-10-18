/// <reference types="bun" />

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { clickElement, dialog, dialogButton } from "./helpers/datetime-picker";

const browser = new Window({ url: "http://localhost:4321/reportes" });
const browserGlobals = {
  window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  Node: browser.Node, Element: browser.Element, KeyboardEvent: browser.KeyboardEvent, NodeFilter: browser.NodeFilter,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
};
Object.assign(globalThis, browserGlobals);
browser.HTMLElement.prototype.scrollIntoView = function () {};

const { createRoot } = await import("react-dom/client");
const { DatePicker } = await import("../src/components/ui/date-picker");
const { default: ReportDateRange } = await import("../src/components/reports/ReportDateRange");
const { parseLocalDate, formatLocalDate, displayLocalDate } = await import("../src/lib/local-datetime");
const { getBogotaDateKey } = await import("../src/lib/format");
const { periodHref, parseReportFilters } = await import("../src/lib/report-filters");

let container: HTMLElement;
let root: Root;

const mount = async (element: React.ReactNode) => {
  await act(async () => { root.render(element); await new Promise((resolve) => setTimeout(resolve, 20)); });
};
const wait = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const triggers = () => [...document.querySelectorAll<HTMLButtonElement>('[data-slot="date-picker"]')];
const hidden = (name: string) => document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)!;
const open = async (index = 0) => { await clickElement(browser, triggers()[index]); await wait(); };
const dayButton = (day: number) =>
  [...dialog()!.querySelectorAll<HTMLButtonElement>("td:not([data-outside]) button")]
    .find((button) => new RegExp(`\\b${day} de `, "i").test(button.getAttribute("aria-label") ?? ""))!;

beforeAll(() => { Object.assign(globalThis, browserGlobals); });
beforeEach(() => {
  Object.assign(globalThis, browserGlobals);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ""; });

describe("helpers de fecha", () => {
  test("YYYY-MM-DD se valida, formatea y muestra como dd/MM/yyyy", () => {
    expect(formatLocalDate(new Date(2026, 9, 9))).toBe("2026-10-09");
    expect(parseLocalDate("2026-10-09")?.getDate()).toBe(9);
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-10-09T10:00")).toBeNull();
    expect(parseLocalDate("")).toBeNull();
    expect(displayLocalDate("2026-10-09")).toBe("09/10/2026");
    expect(displayLocalDate("x")).toBe("");
  });
});

describe("DatePicker", () => {
  test("muestra el placeholder, el nombre accesible y clases de tamaño táctil", async () => {
    await mount(<ReportDateRange />);
    const [from, to] = triggers();
    expect(from.textContent).toContain("Seleccionar fecha");
    expect(from.getAttribute("aria-label")).toBe("Desde: sin seleccionar");
    expect(to.getAttribute("aria-label")).toBe("Hasta: sin seleccionar");
    expect(from.getAttribute("aria-expanded")).toBe("false");
    expect(from.getAttribute("type")).toBe("button");
    expect(from.className).toContain("h-12"); // 48 px >= 44 px
    expect(from.className).toContain("focus-visible:ring-[3px]");
    expect(hidden("from").value).toBe("");
    expect(hidden("to").value).toBe("");
  });

  test("hidrata el valor inicial: texto dd/MM/yyyy y valor YYYY-MM-DD oculto", async () => {
    await mount(<ReportDateRange initialFrom="2026-10-05" initialTo="2026-10-11" />);
    expect(triggers()[0].textContent).toContain("05/10/2026");
    expect(triggers()[1].textContent).toContain("11/10/2026");
    expect(triggers()[0].getAttribute("aria-label")).toBe("Desde: 05/10/2026");
    expect(hidden("from").value).toBe("2026-10-05");
    expect(hidden("to").value).toBe("2026-10-11");
  });

  test("seleccionar un día emite YYYY-MM-DD en el input oculto y cierra el desplegable", async () => {
    await mount(<ReportDateRange initialFrom="2026-10-05" />);
    await open(1);
    expect(triggers()[1].getAttribute("aria-expanded")).toBe("true");
    await clickElement(browser, dayButton(20));
    await wait();
    expect(hidden("to").value).toBeTruthy();
    expect(hidden("to").value).toMatch(/^\d{4}-\d{2}-20$/);
    expect(triggers()[1].textContent).toMatch(/^20\/\d{2}\/\d{4}/);
    expect(dialog()).toBeNull();
  });

  test("Borrar vacía el valor", async () => {
    await mount(<ReportDateRange initialFrom="2026-10-05" initialTo="2026-10-11" />);
    await open(0);
    await clickElement(browser, dialogButton("Borrar"));
    await wait();
    expect(hidden("from").value).toBe("");
    expect(triggers()[0].textContent).toContain("Seleccionar fecha");
    expect(dialog()).toBeNull();
  });

  test("Hoy emite la fecha operativa de Bogotá", async () => {
    let emitted = "";
    await mount(<DatePicker label="Fecha" name="d" value="" onChange={(value) => { emitted = value; }} />);
    await open(0);
    await clickElement(browser, dialogButton("Hoy"));
    expect(emitted).toBe(getBogotaDateKey());
  });

  test("«Hasta» no admite días anteriores a «Desde»", async () => {
    await mount(<ReportDateRange initialFrom="2026-10-15" initialTo="2026-10-20" />);
    await open(1);
    const early = dayButton(10);
    expect(early.disabled || early.closest("td")?.hasAttribute("data-disabled")).toBeTruthy();
    await clickElement(browser, early);
    await wait();
    expect(hidden("to").value).toBe("2026-10-20");
  });

  test("el formulario GET envía from y to con los mismos nombres", async () => {
    await mount(
      <form method="GET" action="/reportes"><ReportDateRange initialFrom="2026-10-05" initialTo="2026-10-11" /></form>,
    );
    await open(1);
    await clickElement(browser, dayButton(12));
    await wait();
    const form = document.querySelector("form")!;
    const data = new browser.FormData(form as never);
    expect(data.get("from")).toBe("2026-10-05");
    expect(data.get("to")).toBe("2026-10-12");
    const parsed = parseReportFilters(new URLSearchParams([...data.entries()].map(([k, v]) => [k, String(v)])));
    expect(parsed.error).toBeNull();
    expect(parsed.from).toBe("2026-10-05");
    expect(parsed.to).toBe("2026-10-12");
  });

  test("el desplegable es accesible y cabe en pantallas de poca altura", async () => {
    await mount(<ReportDateRange />);
    await open(0);
    const content = dialog()!;
    expect(content.getAttribute("aria-label")).toBe("Seleccionar Desde");
    expect(content.className).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(content.className).toContain("overflow-hidden");
    expect(content.querySelector('[data-slot="date-picker-scroll"]')!.className).toContain("overflow-y-auto");
    expect(content.querySelector('[data-slot="date-picker-actions"]')!.className).toContain("shrink-0");
    expect(dialogButton("Hoy").className).toContain("min-h-11");
    expect(dialogButton("Hoy").className).toContain("md:pointer-fine:min-h-9");
    expect(dialogButton("Borrar").className).toContain("min-h-11");
  });
});

describe("atajos Día / Semana / Mes y página", () => {
  test("los atajos siguen siendo enlaces que fijan from y to (la isla se hidrata con ellos)", () => {
    const href = periodHref("week", parseReportFilters(new URLSearchParams("status=CLOSED")), "2026-10-07");
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("from")).toBe("2026-10-05");
    expect(params.get("to")).toBe("2026-10-11");
    expect(params.get("status")).toBe("CLOSED");
  });

  test("reportes/index.astro usa la isla en lugar de input type=date", () => {
    const source = readFileSync("src/pages/reportes/index.astro", "utf8");
    expect(source).toContain("<ReportDateRange client:load");
    expect(source).toContain("initialFrom={filters.from");
    expect(source).not.toContain('type="date"');
    expect(source).toContain("href={periodHref(value, filters, today)}");
  });
});
