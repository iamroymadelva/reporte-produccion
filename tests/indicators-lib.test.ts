import { describe, expect, test } from "bun:test";
import { formatAvgApprovalHours, formatHours, formatRatioPercent, isIndicatorsRangeKey, resolveIndicatorsRange } from "../src/lib/indicators";

const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("resolveIndicatorsRange", () => {
  test("7d cruza de mes", () => {
    expect(resolveIndicatorsRange("7d", "2026-10-03")).toEqual({ key: "7d", from: "2026-09-27", to: "2026-10-03", days: 7 });
  });
  test("30d", () => {
    expect(resolveIndicatorsRange("30d", "2026-10-19")).toEqual({ key: "30d", from: "2026-09-20", to: "2026-10-19", days: 30 });
  });
  test("90d cruza de año", () => {
    expect(resolveIndicatorsRange("90d", "2026-02-10")).toEqual({ key: "90d", from: "2025-11-13", to: "2026-02-10", days: 90 });
  });
  test("2026-03-01 no es bisiesto", () => {
    expect(resolveIndicatorsRange("7d", "2026-03-01").from).toBe("2026-02-23");
    expect(resolveIndicatorsRange("30d", "2026-03-01").from).toBe("2026-01-31");
  });
});

describe("isIndicatorsRangeKey", () => {
  test("acepta válidos", () => {
    for (const k of ["7d", "30d", "90d"]) expect(isIndicatorsRangeKey(k)).toBe(true);
  });
  test("rechaza inválidos", () => {
    for (const k of ["15d", "30D", "", null, undefined, "toString"]) expect(isIndicatorsRangeKey(k)).toBe(false);
  });
});

describe("formatters", () => {
  test("formatHours", () => {
    expect(norm(formatHours(45000))).toBe("12,5 h");
    expect(norm(formatHours(0))).toBe("0,0 h");
  });
  test("formatRatioPercent", () => {
    expect(norm(formatRatioPercent(0.846))).toBe("85 %");
    expect(formatRatioPercent(null)).toBe("—");
  });
  test("formatAvgApprovalHours", () => {
    expect(formatAvgApprovalHours(null)).toBe("—");
    expect(norm(formatAvgApprovalHours(45000))).toBe("12,5 h");
  });
});
