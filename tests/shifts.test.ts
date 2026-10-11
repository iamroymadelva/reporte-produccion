/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { currentShiftAt, isOffShift, parseIntervalMs } from "../src/lib/shifts";

// Mismos casos que supabase/tests/shift_resolution.test.sql (T005): private.current_shift_at en America/Bogota.
const dia = { id: "dia", name: "Día", start_time: "06:00:00", end_time: "14:00:00", sort_order: 1 };
const tarde = { id: "tarde", name: "Tarde", start_time: "14:00:00", end_time: "22:00:00", sort_order: 2 };
const noche = { id: "noche", name: "Noche", start_time: "22:00:00", end_time: "06:00:00", sort_order: 3 };
const all = [dia, tarde, noche];
const at = (iso: string, shifts = all) => currentShiftAt(shifts, iso);

describe("currentShiftAt (espejo de private.current_shift_at)", () => {
  test("las 10:00 pertenecen al turno Día con su fecha operativa y su fin a las 14:00", () => {
    const result = at("2026-10-09T10:00:00-05:00")!;
    expect(result.shiftId).toBe("dia");
    expect(result.operationalDate).toBe("2026-10-09");
    expect(result.shiftEnd.toISOString()).toBe(new Date("2026-10-09T14:00:00-05:00").toISOString());
  });

  test("el inicio es inclusivo y el fin exclusivo", () => {
    expect(at("2026-10-09T06:00:00-05:00")!.shiftId).toBe("dia");
    expect(at("2026-10-09T13:59:59-05:00")!.shiftId).toBe("dia");
    expect(at("2026-10-09T14:00:00-05:00")!.shiftId).toBe("tarde");
    expect(at("2026-10-09T18:30:00-05:00")!.shiftId).toBe("tarde");
    expect(at("2026-10-09T18:30:00-05:00")!.shiftEnd.toISOString()).toBe(new Date("2026-10-09T22:00:00-05:00").toISOString());
    expect(at("2026-10-09T22:00:00-05:00")!.shiftId).toBe("noche");
  });

  test("el turno Noche cruza la medianoche y conserva la fecha operativa del día en que empieza", () => {
    const before = at("2026-10-09T23:30:00-05:00")!;
    expect(before.shiftId).toBe("noche");
    expect(before.operationalDate).toBe("2026-10-09");
    expect(before.shiftEnd.toISOString()).toBe(new Date("2026-10-10T06:00:00-05:00").toISOString());
    const after = at("2026-10-10T05:30:00-05:00")!;
    expect(after.shiftId).toBe("noche");
    expect(after.operationalDate).toBe("2026-10-09");
    expect(after.shiftEnd.toISOString()).toBe(new Date("2026-10-10T06:00:00-05:00").toISOString());
  });

  test("la zona horaria es la de Bogotá, no UTC ni la del dispositivo", () => {
    const result = at("2026-10-10T04:30:00Z")!; // 23:30 en Bogotá
    expect(result.shiftId).toBe("noche");
    expect(result.operationalDate).toBe("2026-10-09");
  });

  test("sin turno activo que contenga la hora devuelve null", () => {
    expect(at("2026-10-09T18:30:00-05:00", [dia, noche])).toBeNull();
    expect(at("2026-10-09T10:00:00-05:00", [dia, noche])!.shiftId).toBe("dia");
    expect(at("2026-10-09T10:00:00-05:00", [])).toBeNull();
  });
});

describe("intervalos de ajustes", () => {
  test("parseIntervalMs entiende HH:MM:SS y días", () => {
    expect(parseIntervalMs("02:00:00", 1)).toBe(7_200_000);
    expect(parseIntervalMs("7 days", 1)).toBe(7 * 86_400_000);
    expect(parseIntervalMs("1 day 02:30:00", 1)).toBe(86_400_000 + 9_000_000);
    expect(parseIntervalMs(null, 123)).toBe(123);
    expect(parseIntervalMs("no es un intervalo", 123)).toBe(123);
  });

  test("isOffShift usa el fin de turno más la gracia", () => {
    const end = new Date("2026-10-09T14:00:00-05:00");
    expect(isOffShift(end, 7_200_000, new Date("2026-10-09T15:59:00-05:00"))).toBe(false);
    expect(isOffShift(end, 7_200_000, new Date("2026-10-09T16:01:00-05:00"))).toBe(true);
  });
});
