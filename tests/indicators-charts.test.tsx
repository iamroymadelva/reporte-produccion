/// <reference types="bun" />
// T019/T024: tarjetas de gráficas (sin medir geometría de Recharts; happy-dom no hace layout).
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { ReactElement } from "react";
import type { Root } from "react-dom/client";

const browser = new Window({ url: "http://localhost:4321/indicadores" });
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true, Node: browser.Node, Element: browser.Element,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  ResizeObserver: ResizeObserverStub,
});
const { createRoot } = await import("react-dom/client");
const { default: AreaChartCard } = await import("../src/components/indicators/AreaChartCard");
const { default: MachineBarCard } = await import("../src/components/indicators/MachineBarCard");
const { default: CategoryDonutCard } = await import("../src/components/indicators/CategoryDonutCard");

let root: Root | undefined;
let container: HTMLDivElement;

const mount = async (element: ReactElement) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
};

beforeAll(() => { Object.assign(globalThis, { document: browser.document, window: browser }); });
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  container?.remove();
});

const EMPTY_MSG = "[data-chart-empty]";

describe("AreaChartCard (T019)", () => {
  test("serie vacía o todo ceros: mensaje de sin datos y sin gráfico", async () => {
    for (const daily of [[], [{ date: "2026-10-18", seconds: 0 }, { date: "2026-10-19", seconds: 0 }]]) {
      await mount(<AreaChartCard daily={daily} />);
      expect(container.querySelector(EMPTY_MSG)?.textContent).toBe("No hay paradas registradas en este periodo.");
      expect(container.querySelector('[role="img"]')).toBeNull();
      expect(container.textContent).toContain("Horas de parada por día");
      await act(async () => { root!.unmount(); });
      container.remove();
    }
  });

  test("con datos: título y contenedor con role/aria-label", async () => {
    await mount(<AreaChartCard daily={[{ date: "2026-10-18", seconds: 3600 }, { date: "2026-10-19", seconds: 0 }]} />);
    expect(container.querySelector(EMPTY_MSG)).toBeNull();
    expect(container.textContent).toContain("Horas de parada por día");
    const img = container.querySelector('[role="img"]');
    expect(img?.getAttribute("aria-label")).toBe("Gráfica de área: horas de parada por día en el periodo");
  });
});

describe("MachineBarCard (T019)", () => {
  test("lista vacía: mensaje de sin datos y sin gráfico", async () => {
    await mount(<MachineBarCard machines={[]} />);
    expect(container.querySelector(EMPTY_MSG)?.textContent).toBe("No hay paradas por máquina en este periodo.");
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.textContent).toContain("Horas de parada por máquina");
  });

  test("con datos: título y contenedor con role/aria-label", async () => {
    await mount(<MachineBarCard machines={[{ machineId: "m1", code: "EMP-01", name: "Empacadora 1", seconds: 7200 }]} />);
    expect(container.querySelector(EMPTY_MSG)).toBeNull();
    expect(container.textContent).toContain("Horas de parada por máquina");
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Gráfica de barras: horas de parada por máquina");
  });
});

describe("CategoryDonutCard (T024)", () => {
  test("leyenda con «Sin categoría» y «Otras», horas y porcentaje sin decimales", async () => {
    await mount(
      <CategoryDonutCard
        categories={[
          { kind: "category", categoryId: "c1", name: "Mecánica", seconds: 3600 },
          { kind: "uncategorized", categoryId: null, name: null, seconds: 1800 },
          { kind: "other", categoryId: null, name: null, seconds: 1800 },
        ]}
      />,
    );
    const items = Array.from(container.querySelectorAll("[data-category-legend] li")).map((li) => li.textContent ?? "");
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("Mecánica");
    expect(items[0]).toMatch(/1,0 h · 50\s%/);
    expect(items[1]).toContain("Sin categoría");
    expect(items[1]).toMatch(/0,5 h · 25\s%/);
    expect(items[2]).toContain("Otras");
    expect(items[2]).toMatch(/0,5 h · 25\s%/);
    expect(container.textContent).not.toMatch(/\d,\d+\s%/);
  });

  test("lista vacía: mensaje sin paradas por categoría", async () => {
    await mount(<CategoryDonutCard categories={[]} />);
    expect(container.querySelector(EMPTY_MSG)?.textContent).toBe("No hay paradas por categoría en este periodo.");
    expect(container.querySelector("[data-category-legend]")).toBeNull();
  });
});
