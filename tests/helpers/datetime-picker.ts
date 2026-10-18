/// <reference types="bun" />
import { act } from "react";

/** Utilidades para manejar el selector de fecha y hora (DateTimePicker) en pruebas con happy-dom. */
// happy-dom Window: se tipa de forma laxa para aceptar tanto Window como los globales de las pruebas.
type BrowserLike = any;

const wait = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

export async function clickElement(browser: BrowserLike, element: Element) {
  await act(async () => {
    element.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true }) as never);
  });
}

export async function typeInto(browser: BrowserLike, input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new browser.Event("input", { bubbles: true }) as never);
  });
}

export const dialog = () => document.querySelector<HTMLElement>('[data-slot="popover-content"]');
export const hourInput = () => dialog()!.querySelector<HTMLInputElement>('input[aria-label^="Horas"]')!;
export const minuteInput = () => dialog()!.querySelector<HTMLInputElement>('input[aria-label^="Minutos"]')!;
export const dialogButton = (label: string) =>
  [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label
    || button.getAttribute("aria-label") === label)!;

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat("es", { month: "long" }).format(new Date(2026, month, 1)).toLowerCase());

/** Mes visible del calendario como índice absoluto (año*12+mes), leído del título «octubre de 2026». */
function visibleMonthIndex() {
  const caption = dialog()!.querySelector("[role='status']")?.textContent?.toLowerCase() ?? "";
  const text = caption || dialog()!.textContent!.toLowerCase();
  const month = monthNames.findIndex((name) => text.includes(name));
  const year = Number(/(\d{4})/.exec(text)?.[1]);
  return year * 12 + month;
}

/** Abre el selector y deja `value` (YYYY-MM-DDTHH:mm) usando solo la interfaz: calendario y campos de hora. */
export async function pickDateTime(browser: BrowserLike, trigger: Element, value: string) {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  await clickElement(browser, trigger);
  await wait();
  const target = year * 12 + (month - 1);
  for (let guard = 0; guard < 120 && visibleMonthIndex() !== target; guard += 1) {
    await clickElement(browser, dialogButton(visibleMonthIndex() > target ? "Ir al mes anterior" : "Ir al mes siguiente"));
    await wait(5);
  }
  const dayButton = [...dialog()!.querySelectorAll<HTMLButtonElement>("td:not([data-outside]) button")]
    .find((button) => new RegExp(`\\b${day} de ${monthNames[month - 1]}`, "i").test(button.getAttribute("aria-label") ?? ""))!;
  await clickElement(browser, dayButton);
  const [hours, minutes] = timePart.split(":");
  await typeInto(browser, hourInput(), hours);
  await typeInto(browser, minuteInput(), minutes);
  await clickElement(browser, dialogButton("Listo"));
  await wait();
}
