/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { indexedDB } from "fake-indexeddb";
import { act } from "react";
import type { Root } from "react-dom/client";

// T106: pasada de accesibilidad de los diálogos de corrección y aprobación (etiquetas, ayudas, estados).
const browser = new Window({ url: "http://localhost:4321/reportes/test" });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, indexedDB,
  IS_REACT_ACT_ENVIRONMENT: true,
  Node: browser.Node, Element: browser.Element, KeyboardEvent: browser.KeyboardEvent,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
browser.HTMLElement.prototype.scrollIntoView = function () {};

const { createRoot } = await import("react-dom/client");
const { default: CorrectionDialog } = await import("../src/components/CorrectionDialog");
const { default: ApprovalPanel } = await import("../src/components/ApprovalPanel");

let root: Root;
let container: HTMLDivElement;
const setValue = async (field: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new browser.Event("input", { bubbles: true }) as any);
  });
};

beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); document.body.innerHTML = ""; });

describe("CorrectionDialog (T106)", () => {
  const changes = [{ field: "lot", label: "Lote", previous: "L1", next: "L2" }];

  test("el motivo tiene etiqueta visible, ayuda asociada y el botón se habilita con 5 caracteres", async () => {
    await act(async () => { root.render(<CorrectionDialog changes={changes} onCancel={() => undefined} onConfirm={() => undefined} />); });
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(document.body.textContent).toContain("Motivo de la corrección (obligatorio)");
    const hint = document.getElementById(textarea.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("al menos 5 caracteres");
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Guardar corrección")!;
    expect(save.disabled).toBe(true);
    await setValue(textarea, "abc");
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(save.disabled).toBe(true);
    await setValue(textarea, "Error de digitación");
    expect(textarea.getAttribute("aria-invalid")).toBeNull();
    expect(save.disabled).toBe(false);
  });

  test("sin cambios muestra el estado vacío y no permite guardar; el error se anuncia como alerta", async () => {
    await act(async () => { root.render(<CorrectionDialog changes={[]} error="No se pudo guardar." onCancel={() => undefined} onConfirm={() => undefined} />); });
    expect(document.body.textContent).toContain("No hay cambios por guardar.");
    expect(document.querySelector("[role=alert]")?.textContent).toContain("No se pudo guardar.");
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Guardar corrección")!;
    expect(save.disabled).toBe(true);
  });
});

describe("ApprovalPanel (T106)", () => {
  test("Enviado: el aviso de bloqueo se anuncia como estado y deshabilita el botón", async () => {
    await act(async () => { root.render(<ApprovalPanel reportId="r1" status="SUBMITTED" isManager approvalBlockedReason="Hay un conflicto de sincronización abierto." />); });
    expect(document.querySelector("[role=status]")?.textContent).toContain("conflicto de sincronización");
    const approve = [...document.querySelectorAll("button")].find((b) => b.textContent === "Aprobar y cerrar")!;
    expect(approve.disabled).toBe(true);
  });

  test("Cerrado muestra quién aprobó y cuándo; el auditor (no manager) no ve acciones sobre un Enviado", async () => {
    await act(async () => { root.render(<ApprovalPanel reportId="r1" status="CLOSED" isManager={false} approverName="Coordinador Uno" approvedAt="2026-10-10T15:00:00Z" />); });
    expect(document.body.textContent).toContain("Aprobado por Coordinador Uno");
    await act(async () => { root.render(<ApprovalPanel reportId="r1" status="SUBMITTED" isManager={false} />); });
    expect(document.querySelectorAll("button").length).toBe(0);
  });

  test("DRAFT fuera de turno: cancelar exige motivo y la ayuda queda asociada", async () => {
    await act(async () => { root.render(<ApprovalPanel reportId="r1" status="DRAFT" isManager isOffShift />); });
    const open = [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancelar (abierto fuera de turno)")!;
    await act(async () => { open.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(document.getElementById(textarea.getAttribute("aria-describedby")!)?.textContent).toContain("obligatorio");
    const confirm = [...document.querySelectorAll("button")].find((b) => b.textContent === "Confirmar cancelación")!;
    expect(confirm.disabled).toBe(true);
    await setValue(textarea, "Turno terminado");
    expect(confirm.disabled).toBe(false);
  });
});
