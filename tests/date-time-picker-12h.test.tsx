/// <reference types="bun" />

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { clickElement, dialog, dialogButton, hourInput, minuteInput, typeInto } from "./helpers/datetime-picker";

// Selector de fecha y hora: formato de 12 h (a. m./p. m.), mismo valor interno de 24 h, y diseño que no recorta las acciones.
const browser = new Window({ url: "http://localhost:4321/turno" });
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
const { DateTimePicker } = await import("../src/components/ui/date-time-picker");
const tf = await import("../src/lib/time-format");

let container: HTMLElement;
let root: Root;
let emitted: string[];
let fetchCalls: string[];

type HarnessProps = { initial?: string; timeFormat?: "24h" | "12h"; userId?: string };
function Harness({ initial = "", timeFormat, userId }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return <DateTimePicker label="Hora inicio" value={value} timeFormat={timeFormat} userId={userId} onChange={(next) => { emitted.push(next); setValue(next); }} />;
}
const mount = async (element: React.ReactNode) => {
  await act(async () => { root.render(element); await new Promise((resolve) => setTimeout(resolve, 20)); });
};
const wait = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const trigger = () => document.querySelector<HTMLButtonElement>('[data-slot="date-time-picker"]')!;
const open = async () => { await clickElement(browser, trigger()); await wait(); };
const radioPeriod = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>("[role='radio']")].find((b) => b.textContent === label)!;
const pressKey = async (element: Element, key: string) => {
  await act(async () => { element.dispatchEvent(new browser.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as never); });
};

beforeAll(() => { Object.assign(globalThis, browserGlobals); });
beforeEach(() => {
  Object.assign(globalThis, browserGlobals);
  emitted = [];
  fetchCalls = [];
  tf.resetTimeFormatCache();
  globalThis.fetch = (async (input: RequestInfo | URL) => { fetchCalls.push(String(input)); throw new Error("sin red"); }) as unknown as typeof fetch;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ""; });

describe("DateTimePicker en 12 horas", () => {
  test("muestra «06:37 p. m.» y el nombre accesible usa el mismo texto", async () => {
    await mount(<Harness initial="2026-10-09T18:37" timeFormat="12h" />);
    expect(trigger().textContent).toContain("09/10/2026 06:37 p. m.");
    expect(trigger().getAttribute("aria-label")).toBe("Hora inicio: 09/10/2026 06:37 p. m.");
    expect(fetchCalls).toEqual([]);
  });

  test("campo de hora con HH, mm y selector a. m./p. m. accesible", async () => {
    await mount(<Harness initial="2026-10-09T18:37" timeFormat="12h" />);
    await open();
    expect(dialog()!.textContent).toContain("Hora (12 h)");
    expect(dialog()!.querySelector("[role='group']")!.getAttribute("aria-label")).toBe("Hora en formato de 12 horas");
    expect(hourInput().getAttribute("aria-label")).toBe("Horas, de 01 a 12");
    expect(hourInput().value).toBe("06");
    expect(minuteInput().value).toBe("37");
    const group = dialog()!.querySelector("[role='radiogroup']")!;
    expect(group.getAttribute("aria-label")).toBe("a. m. o p. m.");
    expect(radioPeriod("p. m.").getAttribute("aria-checked")).toBe("true");
    expect(radioPeriod("a. m.").getAttribute("aria-checked")).toBe("false");
    expect(radioPeriod("p. m.").className).toContain("min-h-11");
  });

  test("en 24 h no aparece el selector a. m./p. m.", async () => {
    await mount(<Harness initial="2026-10-09T18:37" timeFormat="24h" />);
    await open();
    expect(dialog()!.querySelector("[role='radiogroup']")).toBeNull();
    expect(trigger().textContent).not.toMatch(/a\. m\.|p\. m\./);
  });

  test("12 h y 24 h emiten EXACTAMENTE el mismo valor interno YYYY-MM-DDTHH:mm", async () => {
    await mount(<Harness initial="2026-10-09T08:00" timeFormat="24h" />);
    await open();
    await typeInto(browser, hourInput(), "18");
    await typeInto(browser, minuteInput(), "37");
    const from24 = emitted.at(-1);
    await act(async () => root.unmount());
    root = createRoot(container);
    emitted = [];
    await mount(<Harness key="doce" initial="2026-10-09T08:00" timeFormat="12h" />);
    await open();
    await typeInto(browser, hourInput(), "06");
    await clickElement(browser, radioPeriod("p. m."));
    await typeInto(browser, minuteInput(), "37");
    expect(emitted.at(-1)).toBe(from24 ?? "");
    expect(emitted.at(-1)).toBe("2026-10-09T18:37");
    expect(emitted.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
  });

  test("medianoche y mediodía: 12 a. m. = 00:00 y 12 p. m. = 12:00", async () => {
    await mount(<Harness initial="2026-10-09T10:00" timeFormat="12h" />);
    await open();
    await typeInto(browser, hourInput(), "12"); // 10 a. m. → 12 a. m.
    expect(emitted.at(-1)).toBe("2026-10-09T00:00");
    expect(trigger().textContent).toContain("12:00 a. m.");
    await clickElement(browser, radioPeriod("p. m."));
    expect(emitted.at(-1)).toBe("2026-10-09T12:00");
    expect(trigger().textContent).toContain("12:00 p. m.");
    await clickElement(browser, radioPeriod("a. m."));
    expect(emitted.at(-1)).toBe("2026-10-09T00:00");
  });

  test("00:30 y 23:59 se muestran como 12:30 a. m. y 11:59 p. m. y se editan sin perder la hora", async () => {
    await mount(<Harness initial="2026-10-09T00:30" timeFormat="12h" />);
    expect(trigger().textContent).toContain("12:30 a. m.");
    await open();
    expect(hourInput().value).toBe("12");
    expect(radioPeriod("a. m.").getAttribute("aria-checked")).toBe("true");
    await typeInto(browser, hourInput(), "11");
    await clickElement(browser, radioPeriod("p. m."));
    await typeInto(browser, minuteInput(), "59");
    expect(emitted.at(-1)).toBe("2026-10-09T23:59");
    expect(trigger().textContent).toContain("11:59 p. m.");
  });

  test("cambiar a. m./p. m. conserva minutos y emite la hora de 24 h correcta", async () => {
    await mount(<Harness initial="2026-10-09T18:37" timeFormat="12h" />);
    await open();
    await clickElement(browser, radioPeriod("a. m."));
    expect(emitted.at(-1)).toBe("2026-10-09T06:37");
  });

  test("00 y 13+ no son horas válidas en 12 h: no se emiten y se marcan", async () => {
    await mount(<Harness initial="2026-10-09T08:00" timeFormat="12h" />);
    await open();
    await typeInto(browser, hourInput(), "13");
    expect(emitted).toEqual([]);
    expect(hourInput().getAttribute("aria-invalid")).toBe("true");
    await typeInto(browser, hourInput(), "00");
    expect(emitted).toEqual([]);
    expect(hourInput().getAttribute("aria-invalid")).toBe("true");
  });

  test("las flechas dan la vuelta 12 → 01 sin cambiar el periodo", async () => {
    await mount(<Harness initial="2026-10-09T12:15" timeFormat="12h" />);
    await open();
    await pressKey(hourInput(), "ArrowUp");
    expect(emitted.at(-1)).toBe("2026-10-09T13:15"); // 01:15 p. m.
    await pressKey(hourInput(), "ArrowDown");
    expect(emitted.at(-1)).toBe("2026-10-09T12:15");
  });

  test("elegir un día en 12 h conserva la hora (18:37) y emite el valor de 24 h", async () => {
    await mount(<Harness initial="2026-10-09T18:37" timeFormat="12h" />);
    await open();
    const day = [...dialog()!.querySelectorAll<HTMLButtonElement>("td button")].find((b) => /\b15 de octubre/.test(b.getAttribute("aria-label") ?? ""))!;
    await clickElement(browser, day);
    expect(emitted).toEqual(["2026-10-15T18:37"]);
  });
});

describe("preferencia del usuario sin red", () => {
  test("el selector toma la preferencia de SU usuario de la copia local (sin fetch) y no mezcla usuarios", async () => {
    await tf.storeTimeFormat("user-a", "12h");
    await tf.storeTimeFormat("user-b", "24h");
    await mount(<Harness initial="2026-10-09T18:37" userId="user-a" />);
    expect(trigger().textContent).toContain("06:37 p. m.");
    await mount(<Harness key="b" initial="2026-10-09T18:37" userId="user-b" />);
    expect(trigger().textContent).toContain("18:37");
    expect(trigger().textContent).not.toMatch(/p\. m\./);
    await mount(<Harness key="sin" initial="2026-10-09T18:37" userId="user-sin-preferencia" />);
    expect(trigger().textContent).toContain("18:37"); // por defecto: 24 h
    expect(fetchCalls).toEqual([]);
  });

  test("cambiar la preferencia con el selector montado actualiza el texto al instante", async () => {
    await mount(<Harness initial="2026-10-09T18:37" userId="user-a" />);
    expect(trigger().textContent).toContain("18:37");
    await act(async () => { await tf.storeTimeFormat("user-a", "12h"); });
    expect(trigger().textContent).toContain("06:37 p. m.");
  });
});

describe("diseño del desplegable (sin recortes)", () => {
  test("el contenido limita su altura al espacio disponible, con colisiones controladas", async () => {
    await mount(<Harness initial="2026-10-09T18:37" timeFormat="24h" />);
    await open();
    const content = dialog()!;
    expect(content.className).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(content.className).toContain("flex-col");
    expect(content.className).toContain("overflow-hidden");
    expect(content.className).toContain("max-w-[calc(100vw-1rem)]");
  });

  test("solo el calendario y la hora se desplazan; Hoy / Borrar / Listo están en una barra fija fuera del scroll", async () => {
    await mount(<Harness initial="2026-10-09T18:37" timeFormat="24h" />);
    await open();
    const scroller = dialog()!.querySelector<HTMLElement>('[data-slot="date-time-scroll"]')!;
    const actions = dialog()!.querySelector<HTMLElement>('[data-slot="date-time-actions"]')!;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("min-h-0");
    expect(actions.className).toContain("shrink-0");
    expect(scroller.contains(actions)).toBe(false);
    expect(actions.parentElement).toBe(dialog());
    for (const label of ["Hoy", "Borrar", "Listo"]) {
      expect(actions.contains(dialogButton(label))).toBe(true);
      expect(scroller.contains(dialogButton(label))).toBe(false);
    }
    expect(scroller.querySelector("td button")).not.toBeNull();
  });

  test("celdas de 44 px en móvil/táctil y de 36 px en escritorio (md+, puntero fino); botones táctiles de 44 px", async () => {
    await mount(<Harness initial="2026-10-09T18:37" timeFormat="12h" />);
    await open();
    const calendarRoot = dialog()!.querySelector<HTMLElement>("[class*='--cell-size']")!;
    expect(calendarRoot.className).toContain("[--cell-size:2.75rem]"); // 44 px
    expect(calendarRoot.className).toContain("md:pointer-fine:[--cell-size:2.25rem]"); // 36 px
    for (const label of ["Hoy", "Borrar", "Listo"]) {
      expect(dialogButton(label).className).toContain("min-h-11");
      expect(dialogButton(label).className).toContain("md:pointer-fine:min-h-9");
    }
    expect(hourInput().className).toContain("h-11");
    expect(hourInput().className).toContain("md:pointer-fine:h-9");
  });
});
