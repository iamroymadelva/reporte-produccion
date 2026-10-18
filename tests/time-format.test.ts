/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { activate, freshIndexedDb, installBrowser } from "./helpers/offline-env";

// Preferencia de formato de hora: conversión 12↔24 h, lista cerrada, copia local por usuario y lectura sin red.
const browser = installBrowser();
const { displayLocalDateTime, to12Hour, to24Hour, periodLabel } = await import("../src/lib/local-datetime");
const tf = await import("../src/lib/time-format");
const { getMeta } = await import("../src/lib/offline/db");
const { formatDateTime } = await import("../src/lib/format");

beforeEach(() => {
  activate(browser);
  freshIndexedDb();
  tf.resetTimeFormatCache();
});

describe("conversión 12 h ↔ 24 h", () => {
  test("medianoche y mediodía: 12 a. m. = 00:00 y 12 p. m. = 12:00", () => {
    expect(to24Hour(12, "AM")).toBe(0);
    expect(to24Hour(12, "PM")).toBe(12);
    expect(to12Hour(0)).toEqual({ hour: 12, period: "AM" });
    expect(to12Hour(12)).toEqual({ hour: 12, period: "PM" });
  });

  test("00:30 y 23:59 y el resto de las horas van y vienen sin pérdida", () => {
    expect(to12Hour(0)).toEqual({ hour: 12, period: "AM" });
    expect(to12Hour(23)).toEqual({ hour: 11, period: "PM" });
    expect(to24Hour(11, "PM")).toBe(23);
    expect(to24Hour(1, "AM")).toBe(1);
    expect(to24Hour(1, "PM")).toBe(13);
    for (let hours = 0; hours < 24; hours += 1) {
      const { hour, period } = to12Hour(hours);
      expect(hour).toBeGreaterThanOrEqual(1);
      expect(hour).toBeLessThanOrEqual(12);
      expect(to24Hour(hour, period)).toBe(hours);
    }
    expect(periodLabel("AM")).toBe("a. m.");
    expect(periodLabel("PM")).toBe("p. m.");
  });

  test("displayLocalDateTime: 24 h por defecto y 12 h con a. m./p. m.", () => {
    expect(displayLocalDateTime("2026-10-09T18:37")).toBe("09/10/2026 18:37");
    expect(displayLocalDateTime("2026-10-09T18:37", "24h")).toBe("09/10/2026 18:37");
    expect(displayLocalDateTime("2026-10-09T18:37", "12h")).toBe("09/10/2026 06:37 p. m.");
    expect(displayLocalDateTime("2026-10-09T00:30", "12h")).toBe("09/10/2026 12:30 a. m.");
    expect(displayLocalDateTime("2026-10-09T12:00", "12h")).toBe("09/10/2026 12:00 p. m.");
    expect(displayLocalDateTime("2026-10-09T23:59", "12h")).toBe("09/10/2026 11:59 p. m.");
    expect(displayLocalDateTime("", "12h")).toBe("");
    expect(displayLocalDateTime("basura", "12h")).toBe("");
  });

  test("formatDateTime (helper central) conserva el valor por defecto y respeta la preferencia si se le pasa", () => {
    const iso = "2026-10-09T23:37:00.000Z"; // 18:37 en Bogotá
    expect(formatDateTime(iso, "24h")).toContain("18:37");
    expect(formatDateTime(iso, "12h")).toMatch(/6:37.*p\.?\s?m/i);
    expect(formatDateTime(iso)).toBe(formatDateTime(iso, undefined));
    expect(formatDateTime(null, "12h")).toBe("—");
  });
});

describe("lista cerrada del formato de hora", () => {
  test("solo 24h y 12h son válidos; lo demás cae en 24 h", () => {
    expect(tf.TIME_FORMATS).toEqual(["24h", "12h"]);
    expect(tf.isTimeFormat("24h")).toBe(true);
    expect(tf.isTimeFormat("12h")).toBe(true);
    for (const bad of ["12", "24", "AM", "", null, undefined, 12, {}, "12H", " 12h"]) expect(tf.isTimeFormat(bad)).toBe(false);
    expect(tf.normalizeTimeFormat("basura")).toBe("24h");
    expect(tf.normalizeTimeFormat(undefined)).toBe("24h");
    expect(tf.normalizeTimeFormat("12h")).toBe("12h");
    expect(tf.DEFAULT_TIME_FORMAT).toBe("24h");
  });
});

describe("copia local por usuario (IndexedDB meta)", () => {
  test("sin preferencia guardada: 24 h", async () => {
    expect(await tf.loadTimeFormat("user-a")).toBe("24h");
  });

  test("guardar y leer por usuario sin mezclar usuarios de un dispositivo compartido", async () => {
    await tf.storeTimeFormat("user-a", "12h");
    await tf.storeTimeFormat("user-b", "24h");
    expect(tf.timeFormatKey("user-a")).toBe("timeFormat:user-a");
    expect(await getMeta<string>("timeFormat:user-a")).toBe("12h");
    expect(await getMeta<string>("timeFormat:user-b")).toBe("24h");
    tf.resetTimeFormatCache();
    expect(await tf.loadTimeFormat("user-a")).toBe("12h");
    expect(await tf.loadTimeFormat("user-b")).toBe("24h");
    expect(await tf.loadTimeFormat("user-c")).toBe("24h");
  });

  test("se lee sin ninguna petición de red", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => { calls.push(String(input)); throw new Error("sin red"); }) as unknown as typeof fetch;
    await tf.storeTimeFormat("user-a", "12h");
    tf.resetTimeFormatCache();
    expect(await tf.loadTimeFormat("user-a")).toBe("12h");
    expect(calls).toEqual([]);
  });

  test("un valor corrupto en el almacén local se ignora (24 h)", async () => {
    const { setMeta } = await import("../src/lib/offline/db");
    await setMeta("timeFormat:user-a", "25h");
    expect(await tf.loadTimeFormat("user-a")).toBe("24h");
  });

  test("al cargar cualquier página autenticada, el servidor copia SU preferencia a IndexedDB", async () => {
    await tf.syncTimeFormatFromBody({ dataset: { userId: "user-a", timeFormat: "12h" } as DOMStringMap });
    expect(await getMeta<string>("timeFormat:user-a")).toBe("12h");
    await tf.syncTimeFormatFromBody({ dataset: { userId: "user-b", timeFormat: "basura" } as DOMStringMap });
    expect(await getMeta<string>("timeFormat:user-b")).toBe("24h");
    // Sin sesión (páginas públicas) no escribe nada.
    await tf.syncTimeFormatFromBody({ dataset: {} as DOMStringMap });
    expect(await getMeta<string>("timeFormat:undefined")).toBeUndefined();
  });
});
