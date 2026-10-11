/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import StatusBadge from "../src/components/StatusBadge";
import StopIndicator from "../src/components/StopIndicator";
import { hasActiveStop, reportStatusVariant } from "../src/lib/report-status";

const stop = (overrides: { ended_at?: string | null; cancelled_at?: string | null } = {}) => ({
  ended_at: null,
  cancelled_at: null,
  ...overrides,
});

describe("reportStatusVariant", () => {
  test("maps each report status to its badge variant", () => {
    expect(reportStatusVariant("DRAFT")).toBe("draft");
    expect(reportStatusVariant("SUBMITTED")).toBe("submitted");
    expect(reportStatusVariant("CLOSED")).toBe("closed");
    expect(reportStatusVariant("CANCELLED")).toBe("cancelled");
  });
});

describe("hasActiveStop", () => {
  test("is true only for a stop that is neither closed nor cancelled", () => {
    expect(hasActiveStop({ report_stop_events: [stop()] })).toBe(true);
    expect(hasActiveStop({ report_stop_events: [stop({ ended_at: "2026-09-15T10:00:00Z" }), stop()] })).toBe(true);
  });

  test("ignores closed and cancelled stops", () => {
    expect(hasActiveStop({ report_stop_events: [stop({ ended_at: "2026-09-15T10:00:00Z" })] })).toBe(false);
    expect(hasActiveStop({ report_stop_events: [stop({ cancelled_at: "2026-09-15T10:00:00Z" })] })).toBe(false);
    expect(hasActiveStop({ report_stop_events: [stop({ ended_at: "2026-09-15T10:00:00Z", cancelled_at: "2026-09-15T10:00:00Z" })] })).toBe(false);
  });

  test("handles reports without stop data", () => {
    expect(hasActiveStop({ report_stop_events: [] })).toBe(false);
    expect(hasActiveStop({ report_stop_events: null })).toBe(false);
    expect(hasActiveStop({})).toBe(false);
    expect(hasActiveStop(null)).toBe(false);
  });
});

describe("StatusBadge", () => {
  test("renders the Spanish label with the matching variant", () => {
    const draft = renderToStaticMarkup(<StatusBadge status="DRAFT" />);
    expect(draft).toContain("Activo");
    expect(draft).toContain('data-variant="draft"');
    const submitted = renderToStaticMarkup(<StatusBadge status="SUBMITTED" />);
    expect(submitted).toContain("Enviado");
    expect(submitted).toContain('data-variant="submitted"');
    const closed = renderToStaticMarkup(<StatusBadge status="CLOSED" />);
    expect(closed).toContain("Cerrado (aprobado)");
    expect(closed).toContain('data-variant="closed"');
    const cancelled = renderToStaticMarkup(<StatusBadge status="CANCELLED" />);
    expect(cancelled).toContain("Cancelado");
    expect(cancelled).toContain('data-variant="cancelled"');
  });
});

describe("StopIndicator", () => {
  test("shows Parada activa or En operación and keeps the report data attributes", () => {
    const active = renderToStaticMarkup(<StopIndicator active variant="inline" reportId="r1" current />);
    expect(active).toContain("Parada activa");
    expect(active).toContain('data-stop-report-id="r1"');
    expect(active).toContain('data-current-report="true"');
    const idle = renderToStaticMarkup(<StopIndicator active={false} />);
    expect(idle).toContain("En operación");
    expect(idle).toContain('data-active="false"');
  });

  test("uses the real data-current-report attribute for the color variants (active, not current)", () => {
    const html = renderToStaticMarkup(<StopIndicator active variant="inline" reportId="r1" current={false} />);
    expect(html).toContain('data-current-report="false"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain("data-[active=true]:data-[current-report=false]:text-stop-text");
    expect(html).toContain("data-[current-report=true]:text-primary-foreground");
    expect(html).not.toContain("data-[current=");
    expect(html).not.toContain("orange");
  });

  test("badge variant uses stop tokens instead of fixed orange colors", () => {
    const html = renderToStaticMarkup(<StopIndicator active />);
    expect(html).toContain("text-stop-text");
    expect(html).not.toContain("orange");
  });
});
