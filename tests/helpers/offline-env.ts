/// <reference types="bun" />
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import { closeOfflineDb } from "../../src/lib/offline/db";
import { resetConnectivityForTests } from "../../src/lib/connectivity";
import type { OfflineSnapshot } from "../../src/lib/offline/types";

/** Instala un DOM de happy-dom y fake-indexeddb como globales (igual que operator-ui.test.tsx). */
const installedGlobals = new WeakMap<object, Record<string, unknown>>();

/** Vuelve a instalar los globales de ESTE navegador (otros archivos de prueba comparten el proceso). */
export function activate(browser: object) {
  Object.assign(globalThis, installedGlobals.get(browser));
  resetConnectivityForTests();
}

export function installBrowser(url = "http://localhost:4321/turno") {
  const browser = new Window({ url });
  const globals = {
    window: browser, document: browser.document, navigator: browser.navigator,
    HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement,
    Event: browser.Event, CustomEvent: browser.CustomEvent, indexedDB: new IDBFactory(),
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: browser.Node, Element: browser.Element, KeyboardEvent: browser.KeyboardEvent, NodeFilter: browser.NodeFilter,
    MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  };
  const { indexedDB: _unused, ...withoutDb } = globals;
  installedGlobals.set(browser, withoutDb);
  Object.assign(globalThis, globals);
  browser.HTMLElement.prototype.scrollIntoView = function () {};
  resetConnectivityForTests();
  return browser;
}

/** Base de datos vacía para cada prueba. */
export function freshIndexedDb() {
  closeOfflineDb();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

export const USER_A = "10000000-0000-4000-8000-00000000000a";
export const USER_B = "10000000-0000-4000-8000-00000000000b";
export const MACHINE_1 = "20000000-0000-4000-8000-000000000001";
export const MACHINE_2 = "20000000-0000-4000-8000-000000000002";
export const CAT_ASEO = "30000000-0000-4000-8000-000000000001";
export const CAT_CORRECTIVO = "30000000-0000-4000-8000-000000000002";
export const CHANGE_PRODUCTO = "40000000-0000-4000-8000-000000000001";
export const OPT = "50000000-0000-4000-8000-000000000001";

export const SHIFTS = [
  { id: "60000000-0000-4000-8000-000000000001", name: "Día", start_time: "06:00:00", end_time: "14:00:00", sort_order: 1 },
  { id: "60000000-0000-4000-8000-000000000002", name: "Tarde", start_time: "14:00:00", end_time: "22:00:00", sort_order: 2 },
  { id: "60000000-0000-4000-8000-000000000003", name: "Noche", start_time: "22:00:00", end_time: "06:00:00", sort_order: 3 },
];

/** Snapshot de trabajo: la máquina 1 está asignada en los tres turnos (siempre hay asignación vigente). */
export function makeSnapshot(userId = USER_A, overrides: Partial<OfflineSnapshot> = {}): OfflineSnapshot {
  const iso = new Date().toISOString();
  return {
    userId,
    fetchedAt: iso,
    serverTime: iso,
    profile: { id: userId, full_name: "Operario Uno", role: "OPERATOR", job_title: null },
    settings: { offShiftGrace: "02:00:00", offlineLoginWindow: "7 days" },
    shifts: SHIFTS,
    assignments: SHIFTS.map((shift, index) => ({
      id: `70000000-0000-4000-8000-00000000000${index + 1}`, machine_id: MACHINE_1, shift_id: shift.id,
      valid_from: "2026-01-01", valid_to: null, machine: { id: MACHINE_1, code: "M-01", name: "Envasadora", active: true },
    })),
    catalogs: {
      stopCategories: [
        { id: CAT_ASEO, code: "8", name: "Aseo", numeric_code: 8 },
        { id: CAT_CORRECTIVO, code: "4", name: "Correctivo", numeric_code: 4 },
      ],
      changeTypes: [{ id: CHANGE_PRODUCTO, code: "PRD", name: "Cambio de producto", sort_order: 1 }],
      clients: [{ id: OPT, code: "C1", name: "Cliente 1", sort_order: 1 }],
      products: [{ id: OPT, code: "P1", name: "Producto 1", sort_order: 1 }],
      lines: [{ id: OPT, code: "L1", name: "Línea 1", sort_order: 1 }],
      dosifierTypes: [{ id: OPT, code: "D1", name: "Dosificador 1", sort_order: 1 }],
    },
    activeReport: null,
    ...overrides,
  };
}

/** Campos obligatorios completos para poder enviar un reporte (report_date y shift_id los fija el sistema). */
export const COMPLETE_FIELDS = {
  product_id: OPT, product_name: "Producto 1", production_order: "OP-1", line_id: OPT, client_id: OPT,
  client_name: "Cliente 1", lot: "L-1", weight: 250, g_min: 40, dosifier_type_id: OPT,
  started_at: "2026-10-09T08:00:00.000Z", ended_at: "2026-10-09T16:00:00.000Z",
  programmed_hours: 8, units_produced: 1200, waste: 3,
};
