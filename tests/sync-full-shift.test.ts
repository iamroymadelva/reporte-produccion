/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { CAT_ASEO, CAT_CORRECTIVO, CHANGE_PRODUCTO, COMPLETE_FIELDS, MACHINE_1, SHIFTS, USER_A, freshIndexedDb, activate, installBrowser, makeSnapshot } from "./helpers/offline-env";
import { FakeSyncServer } from "./helpers/fake-sync-server";

const browser = installBrowser();
const outbox = await import("../src/lib/offline/outbox");
const actions = await import("../src/lib/offline/actions");
const sync = await import("../src/lib/offline/sync-client");

// SC-003: un turno de 12 h completo (1 reporte + 40 paradas + 10 cambios + envío) capturado sin conexión
// llega al servidor exactamente igual, sin duplicados, aunque la subida se repita.
const snapshot = makeSnapshot(USER_A);
const T0 = new Date(Date.now() - 13 * 3_600_000);
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ctx = (minutes: number) => ({ userId: USER_A, snapshot, now: at(minutes), offline: true });

let server: FakeSyncServer;
beforeEach(() => {
  activate(browser);
  freshIndexedDb();
  sync.resetSyncClientForTests();
  server = new FakeSyncServer({
    userId: USER_A, shifts: SHIFTS,
    assignments: SHIFTS.map((shift) => ({ machine_id: MACHINE_1, shift_id: shift.id })),
    categoryIds: [CAT_ASEO, CAT_CORRECTIVO], changeTypeIds: [CHANGE_PRODUCTO],
  });
  globalThis.fetch = server.fetch as typeof fetch;
});

describe("turno completo offline (SC-003)", () => {
  test("1 reporte + 40 paradas + 10 cambios + envío: el servidor coincide exactamente y no hay duplicados", async () => {
    const created = await actions.startReport(ctx(0), MACHINE_1);
    if (!created.ok) throw new Error(created.message);
    const reportId = created.reportId as string;

    const expectedStops: Array<{ id: string; start: string; end: string; category: string }> = [];
    for (let index = 0; index < 40; index += 1) {
      const start = 10 + index * 15;
      const stop = await actions.startStop(ctx(start), reportId, {});
      if (!stop.ok) throw new Error(stop.message);
      const category = index % 2 === 0 ? CAT_ASEO : CAT_CORRECTIVO;
      const closed = await actions.closeStop(ctx(start + 7), (stop as { stopId: string }).stopId, { categoryId: category });
      if (!closed.ok) throw new Error(closed.message);
      expectedStops.push({ id: (stop as { stopId: string }).stopId, start: at(start).toISOString(), end: at(start + 7).toISOString(), category });
      if (index % 4 === 0 && index < 40) {
        const change = await actions.addChange(ctx(start + 8), reportId, { changeTypeId: CHANGE_PRODUCTO, description: `Cambio ${index}` });
        if (!change.ok) throw new Error(change.message);
      }
    }
    // 10 cambios en total: 10 por index % 4 === 0.
    expect((await outbox.listOperations(USER_A)).filter((operation) => operation.type === "ADD_CHANGE")).toHaveLength(10);
    for (let draft = 0; draft < 25; draft += 1) {
      await actions.saveReportFields(ctx(620 + draft), reportId, { lot: `L-${draft}`, units_produced: draft });
    }
    await actions.saveReportFields(ctx(660), reportId, COMPLETE_FIELDS);
    const submit = await actions.submitReport(ctx(700), reportId);
    if (!submit.ok) throw new Error(submit.message);

    const operations = await outbox.listOperations(USER_A);
    // 1 CREATE + 40*2 paradas + 10 cambios + 1 SAVE (fundido) + 1 SUBMIT
    expect(operations).toHaveLength(93);
    expect(operations.filter((operation) => operation.type === "SAVE_REPORT_FIELDS")).toHaveLength(1);
    expect(new Set(operations.map((operation) => operation.seq)).size).toBe(93);

    expect(server.calls.filter((call) => call.url === "/api/sync/batch")).toHaveLength(0);
    const outcome = await sync.confirmAndUpload(USER_A);
    expect(outcome).toMatchObject({ status: "complete", applied: 93, rejected: 0, conflicts: 0, remaining: 0 });
    expect(server.batches.map((batch) => batch.length)).toEqual([50, 43]);

    // Datos del servidor == lo capturado.
    expect(server.reports.size).toBe(1);
    const report = server.reports.get(reportId)!;
    expect(report).toMatchObject({ status: "SUBMITTED", origin: "offline", started_at: COMPLETE_FIELDS.started_at, lot: COMPLETE_FIELDS.lot, units_produced: COMPLETE_FIELDS.units_produced });
    expect(server.stops.size).toBe(40);
    for (const expected of expectedStops) {
      expect(server.stops.get(expected.id)).toMatchObject({ report_id: reportId, started_at: expected.start, ended_at: expected.end, category_id: expected.category, captured_offline: true });
    }
    expect(server.changes.size).toBe(10);

    // Reenviar todo (p. ej. la respuesta se perdió) no duplica nada: el servidor responde duplicate.
    for (let from = 0; from < operations.length; from += 50) {
      const response = await server.fetch("/api/sync/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations: operations.slice(from, from + 50).map((operation) => outbox.buildWireOperation(operation)) }),
      });
      const body = await response.json() as { results: Array<{ status: string }> };
      expect(body.results.every((result) => result.status === "duplicate")).toBe(true);
    }
    expect(server.reports.size).toBe(1);
    expect(server.stops.size).toBe(40);
    expect(server.changes.size).toBe(10);
  });
});
