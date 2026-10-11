/// <reference types="bun" />
import { currentShiftAt, type ShiftDefinition } from "../../src/lib/shifts";
import { validateReportForSubmission } from "../../src/lib/report-validation";

type Json = Record<string, any>;
type Row = Record<string, any>;

export interface FakeServerOptions {
  userId: string;
  shifts: ShiftDefinition[];
  assignments: Array<{ machine_id: string; shift_id: string }>;
  categoryIds: string[];
  changeTypeIds: string[];
  /** Hora del servidor (por defecto, la real). */
  now?: () => Date;
}

/**
 * Servidor simulado que aplica las reglas de contracts/sync-protocol.md (apply_sync_operation) en memoria:
 * idempotencia por operationId, un reporte activo, solapamientos, categoría al cerrar, horas del dispositivo, etc.
 * También atiende las rutas en línea (POST /api/reports, /stops, PATCH /api/reports/:id...) traduciéndolas a la
 * misma lógica.
 */
export class FakeSyncServer {
  reports = new Map<string, Row>();
  stops = new Map<string, Row>();
  changes = new Map<string, Row>();
  log = new Map<string, { status: string; code?: string }>();
  calls: Array<{ url: string; method: string; body: any }> = [];
  batches: string[][] = [];
  deviceStatuses: Json[] = [];
  /** Auditorías de inicio de sesión sin conexión recibidas (POST /api/offline/login-audit, Phase 8). */
  loginAudits: Json[] = [];
  /** Respuesta de GET /api/auth/session-info y marca de POST /api/auth/logout. */
  sessionInfo: Json | null = null;
  signedOut = false;
  /** Respuesta forzada: 401/403/500 o corte de red. */
  mode: { unauthorized: boolean; forbidden: boolean; networkDown: boolean; cutAfter: number | null } = {
    unauthorized: false, forbidden: false, networkDown: false, cutAfter: null,
  };
  snapshot: Json | null = null;
  private version = 0;
  private folio = 0;

  constructor(private options: FakeServerOptions) {}

  private now() { return (this.options.now ?? (() => new Date()))(); }
  private touch() { this.version += 1; return new Date(Date.UTC(2026, 9, 9, 0, 0, 0) + this.version * 1000).toISOString(); }
  private json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    this.calls.push({ url, method, body });
    if (this.mode.networkDown) throw new TypeError("Failed to fetch");
    if (url === "/api/health") return new Response(null, { status: 204, headers: { "X-Server-Time": this.now().toISOString() } });
    if (url === "/api/auth/logout" && method === "POST") { this.signedOut = true; return new Response(null, { status: 204 }); }
    if (this.mode.unauthorized) return this.json({ error: "Debes iniciar sesión." }, 401);
    if (this.mode.forbidden) return this.json({ error: "Usuario inactivo." }, 403);
    if (url === "/api/auth/session-info") {
      return this.json(this.sessionInfo ?? { userId: this.options.userId, username: "op1", fullName: "Operario Uno", role: "OPERATOR", active: true, offlineLoginWindow: "7 days", signInAt: this.now().toISOString(), serverTime: this.now().toISOString() });
    }
    if (url === "/api/offline/login-audit" && method === "POST") {
      if (this.loginAudits.some((entry) => entry.operationId === body.operationId)) return this.json({ status: "duplicate" });
      this.loginAudits.push({ userId: this.options.userId, ...body });
      return this.json({ status: "applied" });
    }
    if (url === "/api/device-status" && method === "POST") { this.deviceStatuses.push(body); return new Response(null, { status: 204 }); }
    if (url === "/api/offline/snapshot") return this.json(this.snapshot ?? this.buildSnapshot());
    if (url === "/api/sync/batch" && method === "POST") return this.batch(body.operations as Json[]);
    return this.online(url, method, body);
  };

  private buildSnapshot() {
    const active = [...this.reports.values()].find((report) => report.status === "DRAFT") ?? null;
    return {
      profile: { id: this.options.userId, full_name: "Operario Uno", role: "OPERATOR", job_title: null },
      settings: { offShiftGrace: "02:00:00", offlineLoginWindow: "7 days" },
      shifts: this.options.shifts, assignments: [], catalogs: {}, activeReport: active
        ? { ...active, report_stop_events: [...this.stops.values()].filter((s) => s.report_id === active.id), report_change_events: [...this.changes.values()].filter((c) => c.report_id === active.id) }
        : null,
      serverTime: this.now().toISOString(), fetchedAt: this.now().toISOString(),
    };
  }

  private batch(operations: Json[]) {
    const ordered = [...operations].sort((a, b) => a.seq - b.seq);
    this.batches.push(ordered.map((operation) => operation.operationId));
    const results: Json[] = [];
    const failed = new Set<string>();
    for (const operation of ordered) {
      if (this.mode.cutAfter !== null && results.length >= this.mode.cutAfter) break;
      const reportId = operation.payload?.reportId as string | undefined;
      if (operation.type !== "CREATE_REPORT" && reportId && failed.has(reportId)) {
        results.push({ operationId: operation.operationId, status: "rejected", code: "DEPENDENCY_FAILED", message: "No se aplicó porque el reporte no pudo crearse." });
        continue;
      }
      const result = this.apply(operation);
      results.push({ operationId: operation.operationId, ...result });
      if (operation.type === "CREATE_REPORT" && result.status === "rejected" && reportId) failed.add(reportId);
    }
    if (results.length === 0 && ordered.length > 0) return this.json({ error: "No fue posible sincronizar." }, 500);
    return this.json({ results, serverTime: this.now().toISOString() });
  }

  private rejected(code: string, message: string) { return { status: "rejected", code, message }; }
  private timeError(value: string | undefined, captured: string | undefined) {
    if (!value) return null;
    const t = Date.parse(value);
    if (t > this.now().getTime() + 5 * 60_000) return this.rejected("VALIDATION", "La hora del dispositivo está en el futuro.");
    if (captured && t > Date.parse(captured) + 5 * 60_000) return this.rejected("VALIDATION", "La hora registrada es posterior a la captura.");
    return null;
  }

  apply(operation: Json): Json {
    const previous = this.log.get(operation.operationId);
    if (previous) return { status: "duplicate", previousStatus: previous.status };
    if (operation.userId !== this.options.userId) return this.rejected("FORBIDDEN", "La operación no pertenece a la sesión actual.");
    const result = this.applyCore(operation);
    if (result.status !== "duplicate") this.log.set(operation.operationId, { status: result.status, code: result.code });
    return result;
  }

  private reportEntity(report: Row) { return { type: "report", id: report.id, folio: report.folio, updatedAt: report.updated_at }; }

  private applyCore(operation: Json): Json {
    const p = operation.payload as Json;
    const captured = operation.capturedAt as string;
    if (Date.parse(captured) > this.now().getTime() + 5 * 60_000) return this.rejected("VALIDATION", "La hora del dispositivo está en el futuro.");
    if (operation.type === "CREATE_REPORT") {
      const timeError = this.timeError(p.startedAt, captured);
      if (timeError) return timeError;
      const existing = this.reports.get(p.reportId);
      if (existing) return { status: "duplicate", entity: this.reportEntity(existing) };
      const shift = currentShiftAt(this.options.shifts, p.startedAt);
      if (!shift) return this.rejected("VALIDATION", "No hay un turno activo para la hora de inicio del reporte.");
      if ([...this.reports.values()].some((report) => report.status === "DRAFT")) return this.rejected("ACTIVE_REPORT_EXISTS", "Ya tienes un reporte activo.");
      if ([...this.reports.values()].some((report) => report.status === "DRAFT" && report.machine_id === p.machineId)) return this.rejected("MACHINE_BUSY", "La máquina ya tiene un reporte activo.");
      if (!this.options.assignments.some((a) => a.machine_id === p.machineId && a.shift_id === shift.shiftId)) return this.rejected("NO_ASSIGNMENT", "Esta máquina no está asignada a tu turno. Solicita una asignación a tu coordinador.");
      this.folio += 1;
      const report: Row = {
        id: p.reportId, folio: `RPT-2026-${String(this.folio).padStart(6, "0")}`, created_by: operation.userId, machine_id: p.machineId,
        status: "DRAFT", started_at: p.startedAt, shift_id: shift.shiftId, report_date: shift.operationalDate, updated_at: this.touch(),
        origin: operation.capturedOffline ? "offline" : "online", captured_offline: Boolean(operation.capturedOffline),
      };
      this.reports.set(report.id, report);
      return { status: "applied", entity: this.reportEntity(report) };
    }

    const stopReportId = (): string | undefined => this.stops.get(p.stopId)?.report_id ?? p.reportId;
    const report = this.reports.get(operation.type === "CLOSE_STOP" || operation.type === "SET_STOP_CATEGORY" || operation.type === "CANCEL_STOP" ? stopReportId()! : p.reportId);
    if (!report || report.created_by !== operation.userId) return this.rejected("NOT_FOUND", "Reporte no encontrado.");
    // Reenvío tras una respuesta perdida (espejo de sync_apply_core): lo idéntico ya aplicado es duplicate.
    if (operation.type === "SUBMIT_REPORT" && (report.status === "SUBMITTED" || report.status === "CLOSED")) {
      return { status: "duplicate", entity: this.reportEntity(report) };
    }
    if (operation.type === "SAVE_REPORT_FIELDS" && report.status !== "DRAFT") {
      const fields = { ...(p.fields as Json) };
      delete fields.report_date; delete fields.shift_id;
      if (Object.keys(fields).length && Object.entries(fields).every(([key, value]) => report[key] === value)) {
        return { status: "duplicate", entity: this.reportEntity(report) };
      }
    }
    if (operation.type === "START_STOP" && this.stops.get(p.stopId)?.report_id === report.id) {
      return { status: "duplicate", entity: { type: "stop", id: p.stopId } };
    }
    if (operation.type === "ADD_CHANGE" && this.changes.get(p.changeId)?.report_id === report.id) {
      return { status: "duplicate", entity: { type: "change", id: p.changeId } };
    }
    const replayStop = this.stops.get(p.stopId);
    if (replayStop && (
      (operation.type === "CLOSE_STOP" && replayStop.ended_at === p.endedAt && !replayStop.cancelled_at && (!p.categoryId || p.categoryId === replayStop.category_id))
      || (operation.type === "SET_STOP_CATEGORY" && replayStop.category_id && replayStop.category_id === p.categoryId)
      || (operation.type === "CANCEL_STOP" && replayStop.cancelled_at)
    )) {
      return { status: "duplicate", entity: { type: "stop", id: replayStop.id } };
    }
    if (report.status !== "DRAFT") {
      if (operation.type === "CANCEL_REPORT" && report.status === "CANCELLED") return { status: "duplicate", entity: this.reportEntity(report) };
      return { status: "conflict", code: report.status === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_NOT_DRAFT", message: "El reporte ya no está en borrador.", server: report };
    }

    switch (operation.type) {
      case "SAVE_REPORT_FIELDS": {
        const fields = { ...(p.fields as Json) };
        delete fields.report_date; delete fields.shift_id;
        const same = Object.entries(fields).every(([key, value]) => report[key] === value);
        if (same) return { status: "duplicate", entity: this.reportEntity(report) };
        if (operation.baseVersion && report.updated_at !== operation.baseVersion) {
          return { status: "conflict", code: "REPORT_CHANGED", message: "El reporte cambió en el servidor.", server: report };
        }
        Object.assign(report, fields, { updated_at: this.touch() });
        return { status: "applied", entity: this.reportEntity(report) };
      }
      case "START_STOP": {
        const timeError = this.timeError(p.startedAt, captured);
        if (timeError) return timeError;
        if (p.categoryId && !this.options.categoryIds.includes(p.categoryId)) return this.rejected("VALIDATION", "Selecciona una categoría de parada activa.");
        const existing = this.stops.get(p.stopId);
        if (existing) return { status: "duplicate", entity: { type: "stop", id: existing.id } };
        const reportStops = [...this.stops.values()].filter((stop) => stop.report_id === report.id && !stop.cancelled_at);
        if (reportStops.some((stop) => !stop.ended_at)) return this.rejected("STOP_ALREADY_OPEN", "Este reporte ya tiene una parada abierta.");
        const start = Date.parse(p.startedAt);
        if (reportStops.some((stop) => start < Date.parse(stop.ended_at))) return this.rejected("STOP_OVERLAP", "La parada se solapa con otra.");
        this.stops.set(p.stopId, {
          id: p.stopId, report_id: report.id, started_at: p.startedAt, ended_at: null, category_id: p.categoryId ?? null,
          cancelled_at: null, description: p.description ?? null, captured_offline: Boolean(operation.capturedOffline),
        });
        return { status: "applied", entity: { type: "stop", id: p.stopId } };
      }
      case "CLOSE_STOP": {
        const stop = this.stops.get(p.stopId);
        if (!stop) return this.rejected("NOT_FOUND", "La parada no existe en el servidor.");
        const timeError = this.timeError(p.endedAt, captured);
        if (timeError) return timeError;
        if (stop.ended_at) {
          return stop.ended_at === p.endedAt ? { status: "duplicate", entity: { type: "stop", id: stop.id } } : this.rejected("VALIDATION", "La parada ya está cerrada.");
        }
        if (Date.parse(p.endedAt) < Date.parse(stop.started_at)) return this.rejected("VALIDATION", "La hora de fin no puede ser anterior al inicio.");
        const category = p.categoryId ?? stop.category_id;
        if (!category) return this.rejected("CATEGORY_REQUIRED", "Selecciona la categoría de la parada antes de cerrarla.");
        stop.category_id = category; stop.ended_at = p.endedAt;
        return { status: "applied", entity: { type: "stop", id: stop.id } };
      }
      case "SET_STOP_CATEGORY": {
        const stop = this.stops.get(p.stopId);
        if (!stop || stop.ended_at || stop.cancelled_at) return this.rejected("VALIDATION", "La parada ya no está abierta.");
        stop.category_id = p.categoryId;
        return { status: "applied", entity: { type: "stop", id: stop.id } };
      }
      case "CANCEL_STOP": {
        const stop = this.stops.get(p.stopId);
        if (!stop || stop.ended_at || stop.cancelled_at) return this.rejected("VALIDATION", "La parada ya no está abierta.");
        stop.cancelled_at = captured;
        return { status: "applied", entity: { type: "stop", id: stop.id } };
      }
      case "ADD_CHANGE": {
        const timeError = this.timeError(p.occurredAt, captured);
        if (timeError) return timeError;
        if (!this.options.changeTypeIds.includes(p.changeTypeId)) return this.rejected("VALIDATION", "Selecciona un tipo de cambio activo.");
        const existing = this.changes.get(p.changeId);
        if (existing) return { status: "duplicate", entity: { type: "change", id: existing.id } };
        this.changes.set(p.changeId, { id: p.changeId, report_id: report.id, change_type_id: p.changeTypeId, description: p.description, occurred_at: p.occurredAt, captured_offline: Boolean(operation.capturedOffline) });
        return { status: "applied", entity: { type: "change", id: p.changeId } };
      }
      case "SUBMIT_REPORT": {
        const stops = [...this.stops.values()].filter((stop) => stop.report_id === report.id && !stop.cancelled_at);
        if (stops.some((stop) => !stop.ended_at)) return this.rejected("VALIDATION", "No puedes enviar el reporte mientras haya una parada activa.");
        if (stops.some((stop) => !stop.category_id)) return this.rejected("CATEGORY_REQUIRED", "No se puede enviar un reporte con paradas sin categoría.");
        if (Object.keys(validateReportForSubmission(report)).length) return this.rejected("VALIDATION", "Faltan campos obligatorios.");
        report.status = "SUBMITTED"; report.updated_at = this.touch();
        return { status: "applied", entity: this.reportEntity(report) };
      }
      case "CANCEL_REPORT": {
        if (!String(p.reason ?? "").trim()) return this.rejected("VALIDATION", "Debes indicar el motivo de cancelación.");
        report.status = "CANCELLED"; report.updated_at = this.touch();
        return { status: "applied", entity: this.reportEntity(report) };
      }
      default:
        return this.rejected("VALIDATION", "Tipo de operación no soportado.");
    }
  }

  /** Rutas en línea (T075) traducidas a la misma lógica. El origen es siempre "online". */
  private online(url: string, method: string, body: Json | undefined): Response {
    const operation = (type: string, payload: Json, extra: Json = {}) => ({
      operationId: crypto.randomUUID(), userId: this.options.userId, seq: 0, type, capturedAt: this.now().toISOString(),
      capturedOffline: false, payload, ...extra,
    });
    const respond = (result: Json, okBody: Json, okStatus = 200) => {
      if (result.status === "applied") return this.json({ ok: true, ...okBody }, okStatus);
      if (result.status === "duplicate") return this.json({ ok: true, duplicate: true, ...okBody }, 200);
      return this.json({ error: result.message, code: result.code }, result.status === "conflict" ? 409 : 409);
    };
    let match: RegExpMatchArray | null;
    if (method === "POST" && url === "/api/reports") {
      const result = this.apply(operation("CREATE_REPORT", { reportId: body!.id, machineId: body!.machine_id, startedAt: body!.started_at }));
      const report = this.reports.get(body!.id);
      return respond(result, { report }, 201);
    }
    if ((match = url.match(/^\/api\/reports\/([^/]+)\/stops$/)) && method === "POST") {
      const result = this.apply(operation("START_STOP", { reportId: match[1], stopId: body!.id, categoryId: body!.stop_category_id, description: body!.description, startedAt: body!.started_at }));
      return respond(result, { stop: this.stops.get(body!.id) }, 201);
    }
    if ((match = url.match(/^\/api\/reports\/([^/]+)\/stops\/([^/]+)\/close$/)) && method === "POST") {
      const result = this.apply(operation("CLOSE_STOP", { reportId: match[1], stopId: match[2], endedAt: body!.ended_at, categoryId: body!.stop_category_id }));
      return respond(result, { stop: this.stops.get(match[2]) });
    }
    if ((match = url.match(/^\/api\/reports\/([^/]+)\/changes$/)) && method === "POST") {
      const result = this.apply(operation("ADD_CHANGE", { reportId: match[1], changeId: body!.id, changeTypeId: body!.change_type_id, description: body!.description, occurredAt: body!.occurred_at }));
      return respond(result, { change: this.changes.get(body!.id) }, 201);
    }
    if ((match = url.match(/^\/api\/reports\/([^/]+)\/submit$/)) && method === "POST") {
      return respond(this.apply(operation("SUBMIT_REPORT", { reportId: match[1] })), {});
    }
    if ((match = url.match(/^\/api\/reports\/([^/]+)$/)) && method === "PATCH") {
      const { _base_updated_at, ...fields } = body!;
      const result = this.apply(operation("SAVE_REPORT_FIELDS", { reportId: match[1], fields }, { baseVersion: _base_updated_at }));
      if (result.status === "conflict") return this.json({ error: result.message, code: "REPORT_CONFLICT" }, 409);
      return respond(result, { report: { id: match[1], updated_at: this.reports.get(match[1])?.updated_at } });
    }
    return this.json({ error: "Ruta no simulada." }, 404);
  }
}
