/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { COMPLETE_FIELDS, MACHINE_1, USER_A, freshIndexedDb, activate, installBrowser, makeSnapshot } from "./helpers/offline-env";

const browser = installBrowser();
const outbox = await import("../src/lib/offline/outbox");
const actions = await import("../src/lib/offline/actions");
const { validateReportForSubmission } = await import("../src/lib/report-validation");
const { reportFormToPayload } = await import("../src/lib/report-fields");

const snapshot = makeSnapshot(USER_A);
const T0 = new Date("2026-10-09T15:00:00.000Z");
const ctx = (minutes = 0) => ({ userId: USER_A, snapshot: { ...snapshot, userId: USER_A }, now: new Date(T0.getTime() + minutes * 60_000), offline: true });

beforeEach(() => { activate(browser); freshIndexedDb(); });

// «Hora inicio» y «Hora finalización» las escribe el operario leyendo su reloj o el de pared: no son la hora del dispositivo.
describe("horas manuales del reporte", () => {
  test("la validación de envío acepta horas que no coinciden con el reloj del dispositivo", () => {
    const base = { ...COMPLETE_FIELDS, report_date: "2026-10-09", shift_id: "s1" };
    // Dos días atrás, y una hora de fin varias horas en el futuro respecto del reloj de la prueba.
    expect(validateReportForSubmission({ ...base, started_at: "2020-01-01T08:00:00.000Z", ended_at: "2020-01-01T20:00:00.000Z" })).toEqual({});
    expect(validateReportForSubmission({ ...base, started_at: "2099-01-01T08:00:00.000Z", ended_at: "2099-01-01T16:00:00.000Z" })).toEqual({});
  });

  test("fin igual al inicio es válido y fin anterior al inicio sigue rechazado", () => {
    const base = { ...COMPLETE_FIELDS, report_date: "2026-10-09", shift_id: "s1" };
    expect(validateReportForSubmission({ ...base, started_at: "2026-10-09T08:00:00.000Z", ended_at: "2026-10-09T08:00:00.000Z" })).toEqual({});
    const errors = validateReportForSubmission({ ...base, started_at: "2026-10-09T08:00:00.000Z", ended_at: "2026-10-09T07:59:00.000Z" });
    expect(errors.ended_at).toContain("no puede ser anterior");
  });

  test("guardar horas manuales sin conexión no las compara con el reloj ni las marca", async () => {
    const started = await actions.startReport(ctx(0), MACHINE_1);
    if (!started.ok) throw new Error(started.message);
    const reportId = started.reportId as string;
    // Hora de inicio 3 días atrás y fin 6 horas después de "ahora": ninguna se rechaza por el reloj.
    const fields = { started_at: "2026-10-06T08:00:00.000Z", ended_at: "2026-10-09T21:00:00.000Z" };
    const saved = await actions.saveReportFields(ctx(1), reportId, fields);
    expect(saved.ok).toBe(true);
    const save = (await outbox.listOperations(USER_A)).find((operation) => operation.type === "SAVE_REPORT_FIELDS")!;
    expect(save.payload.fields).toEqual(fields);
    const report = await outbox.getEntity(USER_A, "report", reportId);
    expect(report?.data.started_at).toBe(fields.started_at);
    expect(report?.data.ended_at).toBe(fields.ended_at);
  });

  test("el valor local YYYY-MM-DDTHH:mm se envía como instante sin ajustes de reloj", () => {
    const payload = reportFormToPayload({ started_at: "2026-10-09T18:37", ended_at: "2026-10-09T23:45" });
    expect(payload.started_at).toBe(new Date("2026-10-09T18:37").toISOString());
    expect(payload.ended_at).toBe(new Date("2026-10-09T23:45").toISOString());
  });
});
