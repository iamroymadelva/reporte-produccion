/// <reference types="bun" />

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { clickElement, dialog, dialogButton, hourInput, minuteInput, pickDateTime, typeInto } from "./helpers/datetime-picker";

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
const { parseLocalDateTime, formatLocalDateTime, displayLocalDateTime } = await import("../src/lib/local-datetime");

let container: HTMLElement;
let root: Root;
let emitted: string[];
let fetchCalls: string[];

type HarnessProps = { initial?: string; min?: string; max?: string; name?: string; disabled?: boolean; timeFormat?: "24h" | "12h"; userId?: string };
function Harness({ initial = "", min, max, name, disabled, timeFormat, userId }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <DateTimePicker
      label="Hora inicio" value={value} min={min} max={max} name={name} disabled={disabled} timeFormat={timeFormat} userId={userId} data-report-field="started_at"
      onChange={(next) => { emitted.push(next); setValue(next); }}
    />
  );
}
const mount = async (element: React.ReactNode) => {
  await act(async () => { root.render(element); await new Promise((resolve) => setTimeout(resolve, 20)); });
};
const wait = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const trigger = () => document.querySelector<HTMLButtonElement>('[data-slot="date-time-picker"]')!;
const open = async () => { await clickElement(browser, trigger()); await wait(); };
const dayButtons = () => [...dialog()!.querySelectorAll<HTMLButtonElement>("td button")];
const pressKey = async (element: Element, key: string) => {
  await act(async () => { element.dispatchEvent(new browser.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as never); });
};

beforeAll(() => { Object.assign(globalThis, browserGlobals); });
beforeEach(() => {
  Object.assign(globalThis, browserGlobals);
  emitted = [];
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => { fetchCalls.push(String(input)); throw new Error("sin red"); }) as unknown as typeof fetch;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ""; });

describe("helpers del valor local", () => {
  test("el formato es exactamente YYYY-MM-DDTHH:mm y se valida", () => {
    expect(formatLocalDateTime(new Date(2026, 9, 9), 8, 5)).toBe("2026-10-09T08:05");
    expect(parseLocalDateTime("2026-10-09T18:37")).toMatchObject({ hours: 18, minutes: 37 });
    expect(parseLocalDateTime("2026-02-30T10:00")).toBeNull();
    expect(parseLocalDateTime("2026-10-09T24:00")).toBeNull();
    expect(parseLocalDateTime("2026-10-09 10:00")).toBeNull();
    expect(parseLocalDateTime("")).toBeNull();
    expect(displayLocalDateTime("2026-10-09T18:37")).toBe("09/10/2026 18:37");
  });
});

describe("DateTimePicker", () => {
  test("muestra el valor en 24 horas con nombre accesible y sin abrir red", async () => {
    await mount(<Harness initial="2026-10-09T18:37" />);
    expect(trigger().textContent).toContain("09/10/2026 18:37");
    expect(trigger().textContent).not.toMatch(/a\.? ?m|p\.? ?m/i);
    expect(trigger().getAttribute("aria-label")).toBe("Hora inicio: 09/10/2026 18:37");
    expect(trigger().getAttribute("data-report-field")).toBe("started_at");
    expect(trigger().className).toContain("h-12"); // 48 px >= 44 px
    expect(fetchCalls).toEqual([]);
  });

  test("vacío muestra el texto de ayuda y 'sin seleccionar' en el nombre accesible", async () => {
    await mount(<Harness />);
    expect(trigger().textContent).toContain("Seleccionar fecha y hora");
    expect(trigger().getAttribute("aria-label")).toBe("Hora inicio: sin seleccionar");
  });

  test("emite un input oculto equivalente cuando hay name", async () => {
    await mount(<Harness initial="2026-10-09T18:37" name="started_at" />);
    const hidden = container.querySelector<HTMLInputElement>('input[type="hidden"][name="started_at"]')!;
    expect(hidden.value).toBe("2026-10-09T18:37");
    await mount(<Harness key="otro" initial="" name="started_at" />);
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="started_at"]')!.value).toBe("");
  });

  test("abre el calendario en español, semana desde el lunes, con navegación etiquetada", async () => {
    await mount(<Harness initial="2026-10-09T18:37" />);
    await open();
    const content = dialog()!;
    expect(content.getAttribute("role")).toBe("dialog");
    expect(content.getAttribute("aria-label")).toBe("Seleccionar Hora inicio");
    expect(content.querySelector("[role='status']")!.textContent!.toLowerCase()).toContain("octubre");
    const weekdays = [...content.querySelectorAll("th")].map((cell) => cell.textContent!.trim().toLowerCase());
    expect(weekdays[0]).toStartWith("lu");
    expect(weekdays[6]).toStartWith("do");
    expect(dialogButton("Ir al mes anterior")).toBeDefined();
    expect(dialogButton("Ir al mes siguiente")).toBeDefined();
    expect(content.textContent).toContain("Hora (24 h)");
    expect(hourInput().getAttribute("aria-label")).toBe("Horas, de 00 a 23");
    expect(minuteInput().getAttribute("aria-label")).toBe("Minutos, de 00 a 59");
    expect(hourInput().value).toBe("18");
    expect(minuteInput().value).toBe("37");
    // Objetivos táctiles de 44 px: botones de acción y celdas.
    expect(dialogButton("Hoy").className).toContain("min-h-11");
    expect(dialogButton("Borrar").className).toContain("min-h-11");
    expect(content.querySelector("button[class*='size-(--cell-size)']")).not.toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("elegir un día conserva la hora y emite YYYY-MM-DDTHH:mm", async () => {
    await mount(<Harness initial="2026-10-09T18:37" />);
    await open();
    const day = dayButtons().find((button) => /\b15 de octubre/.test(button.getAttribute("aria-label") ?? ""))!;
    await clickElement(browser, day);
    expect(emitted).toEqual(["2026-10-15T18:37"]);
    expect(trigger().getAttribute("aria-label")).toBe("Hora inicio: 15/10/2026 18:37");
  });

  test("elegir un día sin valor previo usa la hora actual del dispositivo", async () => {
    await mount(<Harness />);
    await open();
    await clickElement(browser, dayButtons().find((button) => !button.closest("td")!.hasAttribute("data-outside"))!);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatch(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);
  });

  test("escribir hora y minutos en 24 h emite el valor", async () => {
    await mount(<Harness initial="2026-10-09T08:00" />);
    await open();
    await typeInto(browser, hourInput(), "18");
    await typeInto(browser, minuteInput(), "37");
    expect(emitted.at(-1)).toBe("2026-10-09T18:37");
    await typeInto(browser, hourInput(), "23");
    await typeInto(browser, minuteInput(), "59");
    expect(emitted.at(-1)).toBe("2026-10-09T23:59");
  });

  test("horas fuera de 00-23 o minutos fuera de 00-59 no se emiten", async () => {
    await mount(<Harness initial="2026-10-09T08:00" />);
    await open();
    await typeInto(browser, hourInput(), "25");
    await typeInto(browser, minuteInput(), "75");
    expect(emitted).toEqual([]);
    expect(hourInput().getAttribute("aria-invalid")).toBe("true");
    expect(minuteInput().getAttribute("aria-invalid")).toBe("true");
  });

  test("las flechas del teclado suben y bajan la hora con vuelta de 23 a 00", async () => {
    await mount(<Harness initial="2026-10-09T23:59" />);
    await open();
    await pressKey(hourInput(), "ArrowUp");
    expect(emitted.at(-1)).toBe("2026-10-09T00:59");
    await pressKey(minuteInput(), "ArrowDown");
    expect(emitted.at(-1)).toBe("2026-10-09T00:58");
    await pressKey(minuteInput(), "ArrowUp");
    await pressKey(minuteInput(), "ArrowUp");
    expect(emitted.at(-1)).toBe("2026-10-09T00:00");
  });

  test("Hoy fija la fecha de hoy conservando la hora; Borrar vacía el valor y cierra", async () => {
    await mount(<Harness initial="2026-01-02T07:15" />);
    await open();
    await clickElement(browser, dialogButton("Hoy"));
    expect(emitted.at(-1)).toBe(formatLocalDateTime(new Date(), 7, 15));
    await clickElement(browser, dialogButton("Borrar"));
    await wait();
    expect(emitted.at(-1)).toBe("");
    expect(trigger().textContent).toContain("Seleccionar fecha y hora");
    expect(dialog()).toBeNull();
  });

  test("Hoy sin valor previo usa la hora actual", async () => {
    await mount(<Harness />);
    await open();
    await clickElement(browser, dialogButton("Hoy"));
    expect(emitted.at(-1)!.slice(0, 10)).toBe(formatLocalDateTime(new Date(), 0, 0).slice(0, 10));
  });

  test("respeta min y max: días fuera de rango deshabilitados y hora fuera de rango rechazada", async () => {
    await mount(<Harness initial="2026-10-09T10:00" min="2026-10-05T08:00" max="2026-10-12T20:00" />);
    await open();
    const byDay = (day: number) => dayButtons().find((button) => new RegExp(`\\b${day} de octubre`).test(button.getAttribute("aria-label") ?? ""))!;
    expect(byDay(4).disabled).toBe(true);
    expect(byDay(13).disabled).toBe(true);
    expect(byDay(5).disabled).toBe(false);
    expect(byDay(12).disabled).toBe(false);
    await typeInto(browser, hourInput(), "23");
    await typeInto(browser, minuteInput(), "00");
    expect(emitted.at(-1)).toBe("2026-10-09T23:00"); // dentro del rango (el máximo es el día 12)
    expect(dialog()!.querySelector("[role='alert']")).toBeNull();
    // 12 de octubre 23:00 supera el máximo (20:00): no se emite.
    const before = emitted.length;
    await clickElement(browser, byDay(12));
    expect(emitted).toHaveLength(before);
    expect(dialog()!.querySelector("[role='alert']")!.textContent).toContain("12/10/2026 20:00");
    // Un valor dentro del rango sí se emite y limpia el aviso.
    await typeInto(browser, hourInput(), "18");
    expect(emitted.at(-1)).toBe("2026-10-09T18:00");
    expect(dialog()!.querySelector("[role='alert']")).toBeNull();
    // El límite inferior se aplica a la hora del primer día.
    await typeInto(browser, hourInput(), "07");
    await clickElement(browser, byDay(5));
    expect(dialog()!.querySelector("[role='alert']")!.textContent).toContain("05/10/2026 08:00");
  });

  test("deshabilitado no se abre", async () => {
    await mount(<Harness initial="2026-10-09T10:00" disabled />);
    expect(trigger().disabled).toBe(true);
    await open();
    expect(dialog()).toBeNull();
  });

  test("pickDateTime (helper de pruebas) llega a cualquier mes y deja el valor exacto", async () => {
    await mount(<Harness initial="2026-10-09T10:00" />);
    await pickDateTime(browser as never, trigger(), "2026-08-03T06:05");
    expect(emitted.at(-1)).toBe("2026-08-03T06:05");
    expect(trigger().textContent).toContain("03/08/2026 06:05");
  });

  test("el selector no hace ninguna petición de red (funciona sin conexión)", async () => {
    await mount(<Harness initial="2026-10-09T10:00" />);
    await pickDateTime(browser as never, trigger(), "2026-11-20T21:45");
    expect(emitted.at(-1)).toBe("2026-11-20T21:45");
    expect(fetchCalls).toEqual([]);
  });
});
