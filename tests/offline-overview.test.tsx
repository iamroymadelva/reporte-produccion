/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import type { Root } from "react-dom/client";
import { USER_A, USER_B, activate, freshIndexedDb, installBrowser } from "./helpers/offline-env";

// T090 (FR-020, R10): /consulta-offline muestra en solo lectura el último resumen descargado, marcado con su hora,
// y deshabilita exportar, corregir, aprobar, cancelar y administrar ("Requiere conexión"). happy-dom + fake-indexeddb.
const browser = installBrowser("http://localhost:4321/consulta-offline");
const { createRoot } = await import("react-dom/client");
const { default: OfflineOverview } = await import("../src/components/offline/OfflineOverview");
const auth = await import("../src/lib/offline/offline-auth");
const db = await import("../src/lib/offline/db");
const sync = await import("../src/lib/offline/sync-client");

const FETCHED_AT = "2026-10-10T19:35:00.000Z"; // 14:35 en America/Bogota
// Sesión local relativa al reloj real: caduca a las 12 h, así que no puede depender de una fecha fija.
const SESSION_STARTED_AT = new Date(Date.now() - 60_000).toISOString();
const COORD = { userId: USER_B, role: "ADMINISTRATOR" as const, username: "coord1", fullName: "Coordinador Uno", startedAt: SESSION_STARTED_AT, offline: true as const };
const OPERATOR = { userId: USER_A, role: "OPERATOR" as const, username: "op1", fullName: "Operario Uno", startedAt: SESSION_STARTED_AT, offline: true as const };

function overviewBody(userId = USER_B) {
  return {
    userId, fetchedAt: FETCHED_AT, serverTime: FETCHED_AT,
    kpis: { date: "2026-10-10", DRAFT: 2, SUBMITTED: 3, CLOSED: 1, CANCELLED: 0, ACTIVE_STOP: 1, OFF_SHIFT: 0 },
    reports: [
      {
        id: "r1", folio: "RPT-2026-000007", status: "SUBMITTED", report_date: "2026-10-10", production_order: "OP-77",
        machine: { id: "m1", code: "M-01", name: "Envasadora" }, operator: "Operario Uno", approver: null, approved_at: null,
        is_off_shift: false, active_stop: false, created_at: FETCHED_AT, stops_count: 1, stops_minutes: 12,
        stops: [{ id: "s1", started_at: FETCHED_AT, ended_at: FETCHED_AT, cancelled_at: null, category: "Aseo", description: null }],
        changes: [{ id: "c1", occurred_at: FETCHED_AT, type: "Cambio de producto", description: "Formato nuevo" }],
      },
      {
        id: "r2", folio: "RPT-2026-000008", status: "DRAFT", report_date: "2026-10-10", production_order: "OP-78",
        machine: { id: "m2", code: "M-02", name: "Llenadora" }, operator: "Operario Dos", approver: null, approved_at: null,
        is_off_shift: true, active_stop: true, created_at: FETCHED_AT, stops_count: 0, stops_minutes: 0, stops: [], changes: [],
      },
    ],
  };
}

let root: Root;
let container: HTMLDivElement;
let online: boolean;
let sessionInfo: Record<string, unknown> | null;
let calls: string[];
const text = () => document.body.textContent ?? "";
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const eventually = async (expected: string) => {
  for (let attempt = 0; attempt < 80 && !text().includes(expected); attempt += 1) await wait(25);
  expect(text()).toContain(expected);
};
const buttons = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent?.trim().startsWith(label));
async function mount() { await act(async () => { root.render(<OfflineOverview />); }); }

beforeEach(async () => {
  activate(browser);
  freshIndexedDb();
  sync.resetSyncClientForTests();
  online = false; calls = []; sessionInfo = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (!online) throw new TypeError("Failed to fetch");
    if (url === "/api/health") return new Response(null, { status: 204 });
    if (url === "/api/auth/session-info") {
      return sessionInfo ? new Response(JSON.stringify(sessionInfo), { status: 200 }) : new Response(JSON.stringify({ error: "Debes iniciar sesión." }), { status: 401 });
    }
    if (url === "/api/offline/overview") return new Response(JSON.stringify(overviewBody()), { status: 200 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); sync.resetSyncClientForTests(); });

describe("/consulta-offline (solo lectura)", () => {
  test("sin conexión muestra el último resumen guardado con 'Datos de HH:MM', los KPI y los reportes", async () => {
    await db.idbPut("overview", overviewBody());
    await auth.startLocalSession(COORD);
    await mount();
    await eventually("Datos de 14:35");
    expect(text()).toContain("RPT-2026-000007");
    expect(text()).toContain("RPT-2026-000008");
    expect(text()).toContain("Envasadora");
    expect(text()).toContain("Reportes enviados");
    expect(text()).toContain("Operario Dos");
  });

  test("un reporte abre un detalle de solo lectura con sus paradas y cambios", async () => {
    await db.idbPut("overview", overviewBody());
    await auth.startLocalSession(COORD);
    await mount();
    await eventually("RPT-2026-000007");
    const open = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("RPT-2026-000007"));
    expect(open).toBeDefined();
    await act(async () => { open!.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(text()).toContain("Aseo");
    expect(text()).toContain("Cambio de producto");
    expect(text()).toContain("Formato nuevo");
  });

  test("exportar, corregir, aprobar, cancelar y administrar están deshabilitados y explican 'Requiere conexión'", async () => {
    await db.idbPut("overview", overviewBody());
    await auth.startLocalSession(COORD);
    await mount();
    await eventually("Datos de 14:35");
    for (const label of ["Exportar", "Corregir", "Aprobar", "Cancelar", "Administración"]) {
      const found = buttons(label);
      expect(found.length).toBeGreaterThan(0);
      for (const button of found) {
        expect(button.disabled).toBe(true);
        expect(button.getAttribute("title") ?? button.textContent).toContain("Requiere conexión");
      }
    }
    expect(text()).toContain("Requiere conexión");
  });

  test("sin datos descargados explica que hay que conectarse", async () => {
    await auth.startLocalSession(COORD);
    await mount();
    await eventually("Aún no hay datos descargados; conéctate para descargarlos");
  });

  test("lo guardado por otro usuario del dispositivo no se muestra", async () => {
    await db.idbPut("overview", overviewBody(USER_A)); // resumen de A
    await auth.startLocalSession(COORD); // sesión de B
    await mount();
    await eventually("Aún no hay datos descargados");
    expect(text()).not.toContain("RPT-2026-000007");
  });

  test("sin sesión local ni conexión pide conexión para entrar", async () => {
    await db.idbPut("overview", overviewBody());
    await mount();
    await eventually("Necesitas conexión para entrar");
    expect(text()).not.toContain("RPT-2026-000007");
  });

  test("una sesión local de OPERATOR no puede ver la consulta", async () => {
    await db.idbPut("overview", overviewBody(USER_A));
    await auth.startLocalSession(OPERATOR);
    await mount();
    await eventually("coordinadores y auditores");
    expect(text()).not.toContain("RPT-2026-000007");
  });

  test("en línea descarga el resumen, lo muestra y lo guarda en el almacén 'overview' del usuario", async () => {
    online = true;
    sessionInfo = { userId: USER_B, username: "coord1", fullName: "Coordinador Uno", role: "ADMINISTRATOR", active: true, offlineLoginWindow: "7 days" };
    await mount();
    await eventually("Datos de 14:35");
    expect(calls).toContain("/api/offline/overview");
    const stored = await db.idbGet<any>("overview", USER_B);
    expect(stored.reports).toHaveLength(2);
    expect(stored.fetchedAt).toBe(FETCHED_AT);
  });

  test("en línea un operario no descarga nada", async () => {
    online = true;
    sessionInfo = { userId: USER_A, username: "op1", fullName: "Operario Uno", role: "OPERATOR", active: true, offlineLoginWindow: "7 days" };
    await mount();
    await eventually("coordinadores y auditores");
    expect(calls).not.toContain("/api/offline/overview");
    expect(await db.idbGet("overview", USER_A)).toBeUndefined();
  });
});
