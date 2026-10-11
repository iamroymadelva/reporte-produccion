import { describe, expect, test } from "bun:test";
import { buildStopNumberMap, describeAuditRows, offlineBadgeLabel, type ReportAuditRow } from "../src/lib/report-audit";

const base = {
  id: 1,
  changed_at: "2026-09-27T15:00:00Z",
  changed_by: "actor-id",
  user: { full_name: "Administrador Local" },
};

describe("human-readable report audit", () => {
  test("renders report fields and relationship snapshots without backend names", () => {
    const rows: ReportAuditRow[] = [
      { ...base, field_name: "production_order", old_value: "AP1555", new_value: "AP1556" },
      {
        ...base,
        id: 2,
        field_name: "shift_id",
        old_value: { id: "old", label: "Turno 1 · 06:00 - 14:00" },
        new_value: { id: "new", label: "Turno 2 · 14:00 - 22:00" },
      },
    ];

    const entries = describeAuditRows(rows);
    expect(entries[0]).toMatchObject({
      title: "Corrección del reporte",
      actor: "Administrador Local",
      details: [{ label: "O.P.", previous: "AP1555", next: "AP1556" }],
    });
    expect(entries[1].details[0]).toEqual({
      label: "Turno",
      previous: "Turno 1 · 06:00 - 14:00",
      next: "Turno 2 · 14:00 - 22:00",
    });
  });

  test("resolves legacy relationship ids and preserves unresolved ids", () => {
    const rows: ReportAuditRow[] = [
      { ...base, field_name: "line_id", old_value: "line-old", new_value: "line-new" },
      { ...base, id: 2, field_name: "dosifier_type_id", old_value: null, new_value: "missing-id" },
    ];
    const entries = describeAuditRows(rows, {
      catalogs: { line_id: new Map([["line-old", "L01 · Línea 1"], ["line-new", "L02 · Línea 2"]]) },
    });

    expect(entries[0].details[0]).toEqual({ label: "Área / Línea", previous: "L01 · Línea 1", next: "L02 · Línea 2" });
    expect(entries[1].details[0].next).toBe("missing-id");
  });

  test("renders existing report status and cancellation events meaningfully", () => {
    const entries = describeAuditRows([
      { ...base, field_name: "status", old_value: "DRAFT", new_value: "CANCELLED" },
      { ...base, id: 2, field_name: "cancellation_reason", old_value: null, new_value: "Orden cancelada" },
    ]);

    expect(entries[0]).toMatchObject({
      title: "Reporte cancelado",
      details: [{ label: "Estado", previous: "Activo", next: "Cancelado" }],
    });
    expect(entries[1]).toMatchObject({
      title: "Datos de cancelación actualizados",
      details: [{ label: "Motivo de cancelación", previous: "—", next: "Orden cancelada" }],
    });
  });

  test("classifies category changes and retains chronological stop numbers", () => {
    const rows: ReportAuditRow[] = [{
      ...base,
      field_name: "stop_event.update",
      old_value: {
        id: "stop-two",
        started_at: "2026-09-27T11:00:00Z",
        ended_at: null,
        duration_seconds: null,
        stop_category_id: "quality",
        stop_category: { id: "quality", code: "8", name: "CALIDAD" },
      },
      new_value: {
        id: "stop-two",
        started_at: "2026-09-27T11:00:00Z",
        ended_at: null,
        duration_seconds: null,
        stop_category_id: "adjustment",
        stop_category: { id: "adjustment", code: "4", name: "AJUSTE" },
      },
    }];

    const entries = describeAuditRows(rows, {
      stops: [{ id: "stop-one", started_at: "2026-09-27T10:00:00Z" }],
    });
    expect(entries[0]).toMatchObject({
      title: "Cambio de categoría",
      stopNumber: 2,
      details: [{ label: "Categoría", previous: "8 · CALIDAD", next: "4 · AJUSTE" }],
    });
  });

  test("classifies stop lifecycle events and shows cancellation reasons", () => {
    const cancelled = describeAuditRows([{
      ...base,
      field_name: "stop_event.update",
      old_value: { id: "stop", started_at: "2026-09-27T10:00:00Z", ended_at: null, cancelled_at: null, cancellation_reason: null, duration_seconds: null, stop_category_id: "8" },
      new_value: { id: "stop", started_at: "2026-09-27T10:00:00Z", ended_at: "2026-09-27T10:01:00Z", cancelled_at: "2026-09-27T10:01:00Z", cancellation_reason: "Inicio accidental", duration_seconds: null, stop_category_id: "8" },
    }], { catalogs: { stop_category_id: new Map([["8", "8 · CALIDAD"]]) } })[0];
    expect(cancelled.title).toBe("Parada cancelada");
    expect(cancelled.details).toContainEqual({ label: "Motivo de cancelación", previous: "—", next: "Inicio accidental" });

    const inserted = describeAuditRows([{ ...base, field_name: "stop_event.insert", old_value: null, new_value: { id: "new-stop", started_at: "2026-09-27T10:00:00Z", stop_category_id: "8" } }])[0];
    const deleted = describeAuditRows([{ ...base, field_name: "stop_event.delete", old_value: { id: "old-stop", started_at: "2026-09-27T09:00:00Z", stop_category_id: "8" }, new_value: null }])[0];
    expect(inserted.title).toBe("Parada iniciada");
    expect(deleted.title).toBe("Parada eliminada");
  });

  test("builds stop numbering from current and deleted historical rows", () => {
    const rows: ReportAuditRow[] = [{
      ...base,
      field_name: "stop_event.delete",
      old_value: { id: "deleted", started_at: "2026-09-27T09:00:00Z" },
      new_value: null,
    }];
    const numbers = buildStopNumberMap([{ id: "current", started_at: "2026-09-27T10:00:00Z" }], rows);
    expect(numbers.get("deleted")).toBe(1);
    expect(numbers.get("current")).toBe(2);
  });
});

describe("chronological audit history with role, reason and offline mark (T059)", () => {
  const rows: ReportAuditRow[] = [
    {
      id: 30, changed_at: "2026-09-27T16:00:00Z", changed_by: "coord", user: { full_name: "Ana Coordinadora" },
      field_name: "lot", old_value: "L1", new_value: "L2", entity_type: "report", action: "UPDATE",
      actor_role: "ADMINISTRATOR", reason: "Lote mal digitado",
    },
    {
      id: 10, changed_at: "2026-09-27T14:00:00Z", changed_by: "op", user: { full_name: "Omar Operario" },
      field_name: "report.insert", old_value: null, new_value: {}, entity_type: "report", action: "INSERT",
      actor_role: "OPERATOR", captured_offline: true, received_at: "2026-09-27T15:30:00Z",
    },
    {
      id: 20, changed_at: "2026-09-27T14:00:00Z", changed_by: "op", user: { full_name: "Omar Operario" },
      field_name: "change_event.insert", old_value: null,
      new_value: { description: "Cambio de bobina", occurred_at: "2026-09-27T13:50:00Z", change_type: { id: "c", code: "CB", name: "Bobina" } },
      entity_type: "change", action: "INSERT", actor_role: "OPERATOR", captured_offline: false,
    },
  ];

  test("orders entries ascending by date, then id, without mutating the input", () => {
    const entries = describeAuditRows(rows);
    expect(entries.map((entry) => entry.id)).toEqual([10, 20, 30]);
    expect(rows.map((row) => row.id)).toEqual([30, 10, 20]);
  });

  test("shows actor, role label and reason", () => {
    const entries = describeAuditRows(rows);
    expect(entries[2]).toMatchObject({
      actor: "Ana Coordinadora", actorRole: "ADMINISTRATOR", actorRoleLabel: "Coordinador", reason: "Lote mal digitado",
    });
    expect(entries[0]).toMatchObject({ actorRoleLabel: "Operario", reason: null });
  });

  test("marks offline capture and exposes the arrival time", () => {
    const entries = describeAuditRows(rows);
    expect(entries[0].capturedOffline).toBe(true);
    expect(entries[0].receivedAt).toBe("2026-09-27T15:30:00Z");
    expect(offlineBadgeLabel(entries[0])).toStartWith("Capturado sin conexión · llegó ");
    expect(offlineBadgeLabel(entries[1])).toBeNull();
    expect(offlineBadgeLabel({ capturedOffline: true, receivedAt: null })).toBe("Capturado sin conexión");
  });

  test("includes change entries with their type and description", () => {
    const change = describeAuditRows(rows)[1];
    expect(change).toMatchObject({ title: "Cambio registrado", entityType: "change" });
    expect(change.details).toContainEqual({ label: "Tipo de cambio", next: "Bobina" });
    expect(change.details).toContainEqual({ label: "Descripción", next: "Cambio de bobina" });
  });

  test("keeps unknown roles readable and tolerates rows without role", () => {
    const entries = describeAuditRows([
      { ...base, field_name: "lot", old_value: "a", new_value: "b", actor_role: "OTRO" },
      { ...base, id: 2, field_name: "lot", old_value: "b", new_value: "c" },
    ]);
    expect(entries[0].actorRoleLabel).toBe("OTRO");
    expect(entries[1].actorRoleLabel).toBeNull();
  });
});
