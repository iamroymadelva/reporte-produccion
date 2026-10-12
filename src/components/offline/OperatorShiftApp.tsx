import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldLabel, Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import PlatformModal from "../PlatformModal";
import StopEventsTable from "../StopEventsTable";
import StopSummary from "../StopSummary";
import { getConnectivitySnapshot } from "@/lib/connectivity";
import { formatDate } from "@/lib/format";
import { reportFormToPayload, REPORT_EDITABLE_FIELDS, type ReportEditableField } from "@/lib/report-fields";
import { REQUIRED_REPORT_FIELDS, localDateTime, type ReportFieldErrors } from "@/lib/report-validation";
import { assignmentsForNow, currentShiftAt, isOffShift, parseIntervalMs } from "@/lib/shifts";
import { isActiveStop, stopDuration } from "@/lib/stop-events";
import * as actions from "@/lib/offline/actions";
import { isConnectionDown, useConnectivityState } from "@/lib/offline/hooks";
import { pendingCount, subscribeOutbox } from "@/lib/offline/outbox";
import { useOperatorPresence } from "../realtime/useOperatorPresence";
import { resolveCurrentUser, type CurrentUser } from "@/lib/offline/snapshot";
import { runExclusive, sendDirectIfAllowed } from "@/lib/offline/sync-client";
import type { OfflineSnapshot } from "@/lib/offline/types";
import OfflineIndicator from "./OfflineIndicator";
import { cn } from "@/lib/utils";
import { useLogoutGuard } from "./LogoutGuard";

/**
 * Ayuda rápida del operario. El texto está incrustado aquí a propósito: viaja con la página /turno, funciona sin
 * conexión y no hace ninguna llamada de red. La ayuda completa (con capturas) está en /ayuda y necesita conexión.
 */
export const OPERATOR_QUICK_TIPS: ReadonlyArray<{ title: string; text: string }> = [
  { title: "Iniciar el reporte", text: "Elige tu máquina y pulsa «Iniciar reporte». Solo puedes tener un reporte abierto a la vez." },
  { title: "Paradas", text: "Si la máquina se detiene, pulsa «Iniciar parada». Cuando arranque, elige la categoría y pulsa «Cerrar parada». Si la iniciaste por error, pulsa «Cancelar parada»." },
  { title: "Cambios", text: "Si cambia el producto, el formato o el lote, anótalo en «Cambios». Elige el «Tipo de cambio», escribe qué cambió (por ejemplo, «de lote 120 a lote 121») y pulsa «Registrar cambio». La hora la pone el sistema. No es una parada: la parada mide cuánto tiempo estuvo detenida la máquina; el cambio solo se anota." },
  { title: "Enviar el reporte", text: "Antes de enviar, cierra las paradas, ponles categoría a todas y llena los datos de producción. Después pulsa «Enviar reporte». Ya no podrás cambiarlo." },
  { title: "Sin conexión", text: "Si se va el internet, sigue trabajando. Todo se guarda en este dispositivo. Cuando vuelva, pulsa «Confirmar y subir». Nada se sube hasta que tú lo confirmes." },
  { title: "Me equivoqué", text: "Un cambio registrado no se puede borrar ni editar: explícalo en «Observaciones» y avisa a tu coordinador. Si te equivocaste en un dato del reporte ya enviado, avisa a tu coordinador: él lo corrige con motivo." },
];

function QuickHelpPanel() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section aria-label="Ayuda rápida" className="rounded-2xl border bg-card text-card-foreground" data-testid="quick-help">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-4 py-2 text-left text-base font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
        >
          <span className="flex items-center gap-2"><CircleHelp className="size-5 shrink-0 text-primary" aria-hidden="true" />¿Necesitas ayuda?</span>
          <ChevronDown className={cn("size-5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="space-y-3 border-t px-4 py-4">
        <ul className="space-y-3 text-sm">
          {OPERATOR_QUICK_TIPS.map((tip) => <li key={tip.title}><p className="font-semibold">{tip.title}</p><p className="text-muted-foreground">{tip.text}</p></li>)}
        </ul>
        <p className="text-sm text-muted-foreground">Con internet, tienes la guía completa con imágenes en <a className="inline-flex min-h-11 items-center font-semibold text-primary underline" href="/ayuda" data-astro-reload>Ayuda</a>.</p>
      </div>
    </section>
  );
}

interface Props {
  /** Pausa antes de guardar los campos de producción (ms). */
  autosaveDelayMs?: number;
  /** Publica la presencia del operario en Realtime (T102). Se desactiva en pruebas sin Realtime. */
  presence?: boolean;
}

type Form = Record<ReportEditableField, string>;
const TIMESTAMPS = new Set<ReportEditableField>(["started_at", "ended_at"]);
const requiredFields = new Set<string>(REQUIRED_REPORT_FIELDS.map(({ field }) => field));

function formFrom(values: Record<string, unknown> | null | undefined): Form {
  const form = {} as Form;
  for (const field of REPORT_EDITABLE_FIELDS) {
    const value = values?.[field];
    form[field] = TIMESTAMPS.has(field) ? localDateTime(value) : value === null || value === undefined ? "" : String(value);
  }
  return form;
}

const optionLabel = (item: { code: string; name: string }) => `${item.code} · ${item.name}`;

export default function OperatorShiftApp({ autosaveDelayMs = 600, presence = true }: Props) {
  const [session, setSession] = useState<CurrentUser | null>(null);
  const connection = useConnectivityState();
  const offline = isConnectionDown(connection);

  useEffect(() => {
    let active = true;
    void resolveCurrentUser().then((result) => {
      if (!active) return;
      setSession(result);
      // En línea y sin sesión válida: a iniciar sesión (los datos locales no se tocan).
      if (result.status === "unauthorized") window.location.assign("/iniciar-sesion");
    });
    return () => { active = false; };
  }, []);

  if (!session || session.status === "unauthorized") {
    return <main className="mx-auto max-w-2xl p-4"><p role="status" className="text-muted-foreground">Cargando turno…</p></main>;
  }
  if (session.status === "no-snapshot") {
    return <main className="mx-auto max-w-2xl p-4"><Alert variant="warning"><AlertTitle>Necesitas conexión para iniciar sesión</AlertTitle><AlertDescription>Inicia sesión con conexión al menos una vez en este dispositivo para descargar tus máquinas y catálogos; después podrás trabajar sin conexión. Si ya lo hiciste, <a className="font-semibold underline" href="/iniciar-sesion" data-astro-reload>inicia sesión</a> con tu usuario y contraseña (también funciona sin conexión).</AlertDescription></Alert></main>;
  }
  if (session.status === "forbidden") {
    return <main className="mx-auto max-w-2xl p-4"><Alert variant="destructive"><AlertTitle>Pantalla solo para operarios</AlertTitle><AlertDescription>{session.message} <a className="font-semibold underline" href="/dashboard" data-astro-reload>Ir al inicio</a></AlertDescription></Alert></main>;
  }
  return <Shift userId={session.userId} snapshot={session.snapshot} offline={offline} autosaveDelayMs={autosaveDelayMs} presence={presence} />;
}

function Shift({ userId, snapshot, offline, autosaveDelayMs, presence }: { userId: string; snapshot: OfflineSnapshot; offline: boolean; autosaveDelayMs: number; presence: boolean }) {
  const [state, setState] = useState<actions.ShiftState | null>(null);
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReportFieldErrors>({});
  const [machineId, setMachineId] = useState("");
  const [startCategory, setStartCategory] = useState("");
  const [stopCategory, setStopCategory] = useState("");
  const [changeType, setChangeType] = useState("");
  const [changeDescription, setChangeDescription] = useState("");
  const [modal, setModal] = useState<"submit" | "cancel-report" | "cancel-stop" | null>(null);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<Form>(() => formFrom(null));
  const [now, setNow] = useState(() => Date.now());
  const touched = useRef(new Set<ReportEditableField>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedReport = useRef<string | null>(null);
  const logoutForm = useRef<HTMLFormElement>(null);
  const logout = useLogoutGuard(userId, useCallback(() => logoutForm.current?.requestSubmit(), []));

  const refresh = useCallback(async () => {
    const next = await actions.loadShiftState(userId);
    setState(next);
    if (next.report && loadedReport.current !== next.report.id) {
      loadedReport.current = next.report.id;
      touched.current.clear();
      setForm(formFrom(next.report));
    }
    if (!next.report) loadedReport.current = null;
  }, [userId]);

  useEffect(() => {
    void refresh();
    return subscribeOutbox((changed) => { if (!changed || changed === userId) void refresh(); });
  }, [refresh, userId]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const report = state?.report ?? null;
  const active = state?.active ?? null;
  const stops = state?.stops ?? [];
  const openStop = stops.find(isActiveStop) ?? null;
  const blocked = Boolean(active?.blocked);
  const catalogs = snapshot.catalogs;
  const { assignments } = useMemo(
    () => assignmentsForNow(snapshot.assignments, snapshot.shifts, new Date(now)),
    [snapshot, Math.floor(now / 60_000)], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const machines = [...new Map(assignments.map((a) => [a.machine_id, a.machine])).entries()];
  const [pending, setPending] = useState(0);
  useEffect(() => { void pendingCount(userId).then(setPending, () => undefined); }, [userId, state]);
  useOperatorPresence(
    { userId, fullName: snapshot.profile.full_name, pendingCount: pending },
    { enabled: presence && !offline },
  );

  /** Acción + envío directo (si no hay pendientes y hay red) en una sola sección crítica. */
  const run = useCallback(async (perform: (ctx: Parameters<typeof actions.startReport>[0]) => Promise<actions.ActionResult>) => {
    return runExclusive(userId, async () => {
      const ctx = { userId, snapshot, offline: isConnectionDown(getConnectivitySnapshot().state) };
      const result = await perform(ctx);
      if (!result.ok) { setNotice(result.message); return result; }
      setNotice("");
      const direct = await sendDirectIfAllowed(userId, result.operation, result.priorPending);
      if (direct.result === "conflict" || direct.result === "rejected") setNotice(direct.message ?? "El servidor no pudo aplicar este dato. Revisa los pendientes.");
      else if (direct.message) setNotice(direct.message);
      return result;
    });
  }, [userId, snapshot]);

  const flushFields = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!active || touched.current.size === 0) return;
    const picked: Record<string, string> = {};
    for (const field of touched.current) {
      const value = form[field];
      if (TIMESTAMPS.has(field) && value && Number.isNaN(new Date(value).getTime())) continue;
      picked[field] = value;
    }
    touched.current.clear();
    const payload = reportFormToPayload(picked);
    if (Object.keys(payload).length) await run((ctx) => actions.saveReportFields(ctx, active.id, payload));
  }, [active, form, run]);
  const flushRef = useRef(flushFields);
  flushRef.current = flushFields;

  const edit = (updates: Partial<Form>) => {
    setForm((current) => ({ ...current, ...updates }));
    for (const field of Object.keys(updates) as ReportEditableField[]) touched.current.add(field);
    setFieldErrors({});
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current(); }, autosaveDelayMs);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!state) return <main className="mx-auto max-w-3xl p-4"><p role="status" className="text-muted-foreground">Cargando turno…</p></main>;

  const grace = parseIntervalMs(snapshot.settings.offShiftGrace, 2 * 3_600_000);
  const reportShift = active ? currentShiftAt(snapshot.shifts, String(active.created_at ?? active.started_at)) : null;
  const offShift = Boolean(active && reportShift && isOffShift(reportShift.shiftEnd, grace, new Date(now)));
  const elapsed = openStop ? stopDuration(Math.max(0, Math.floor((now - Date.parse(openStop.started_at)) / 1000))) : "";
  const errorFor = (field: ReportEditableField) => fieldErrors[field]
    ? <p id={`field-${field}-error`} className="mt-1 text-sm font-semibold text-destructive">{fieldErrors[field]}</p> : null;
  const fieldProps = (field: ReportEditableField) => ({
    "data-report-field": field,
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `field-${field}-error` : undefined,
    required: requiredFields.has(field),
    disabled: !active || blocked,
    className: fieldErrors[field] ? "border-destructive ring-2 ring-destructive/20" : undefined,
  });

  const input = (field: ReportEditableField, label: string, type = "text", extra: Record<string, string | number> = {}) => (
    <Label className="min-w-0"><FieldLabel>{label}</FieldLabel>
      <Input {...fieldProps(field)} type={type} value={form[field]} onChange={(event) => edit({ [field]: event.target.value })} {...extra} />
      {errorFor(field)}
    </Label>
  );
  const select = (field: ReportEditableField, label: string, options: Array<{ id: string; code: string; name: string }>) => (
    <Label><FieldLabel>{label}</FieldLabel>
      <NativeSelect {...fieldProps(field)} value={form[field]} onChange={(event) => edit({ [field]: event.target.value })}>
        <option value="">Sin seleccionar</option>
        {options.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
      </NativeSelect>
      {errorFor(field)}
    </Label>
  );
  const catalog = (field: "client_name" | "product_name", idField: "client_id" | "product_id", label: string, options: Array<{ id: string; code: string; name: string }>) => (
    <Label><FieldLabel>{label}</FieldLabel>
      <NativeSelect {...fieldProps(field)} value={form[idField]} onChange={(event) => {
        const chosen = options.find((option) => option.id === event.target.value);
        edit({ [idField]: chosen?.id ?? "", [field]: chosen?.name ?? "" } as Partial<Form>);
      }}>
        <option value="">Sin seleccionar</option>
        {options.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
      </NativeSelect>
      {errorFor(field)}
    </Label>
  );

  const beginSubmit = async () => {
    if (!active) return;
    await flushFields();
    const latest = await actions.loadShiftState(userId);
    const { validateSubmit } = await import("@/lib/offline/validation");
    const invalid = validateSubmit({ report: latest.active, stops: latest.stops });
    if (invalid) {
      setNotice(invalid.message);
      if (invalid.fieldErrors) {
        setFieldErrors(invalid.fieldErrors);
        const first = REQUIRED_REPORT_FIELDS.find(({ field }) => invalid.fieldErrors?.[field]);
        if (first) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-report-field="${first.field}"]`)?.focus?.());
      }
      return;
    }
    setNotice("");
    setModal("submit");
  };

  const startReport = async () => { if (machineId) { const result = await run((ctx) => actions.startReport(ctx, machineId)); if (result.ok) setMachineId(""); } };
  const startStop = async () => {
    if (!active) return;
    const result = await run((ctx) => actions.startStop(ctx, active.id, { categoryId: startCategory || null }));
    if (result.ok) setStartCategory("");
  };
  const closeStop = async () => {
    if (!openStop) return;
    const result = await run((ctx) => actions.closeStop(ctx, openStop.id, { categoryId: stopCategory || null }));
    if (result.ok) setStopCategory("");
  };
  const changeCategory = async () => {
    if (!openStop || !stopCategory) return;
    const result = await run((ctx) => actions.setStopCategory(ctx, openStop.id, stopCategory));
    if (result.ok) setStopCategory("");
  };
  const addChange = async () => {
    if (!active) return;
    const result = await run((ctx) => actions.addChange(ctx, active.id, { changeTypeId: changeType, description: changeDescription }));
    if (result.ok) { setChangeType(""); setChangeDescription(""); }
  };
  const confirmModal = async () => {
    const which = modal;
    setModal(null);
    if (which === "submit" && active) await run((ctx) => actions.submitReport(ctx, active.id));
    if (which === "cancel-report" && active) await run((ctx) => actions.cancelReport(ctx, active.id, reason));
    if (which === "cancel-stop" && openStop) await run((ctx) => actions.cancelStop(ctx, openStop.id, reason));
    setReason("");
  };

  const effectiveStopCategory = stopCategory || openStop?.stop_category?.id || "";
  const startFormDisabled = machines.length === 0;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-4 sm:px-6" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Turno de producción</h1>
          <p className="truncate text-sm text-muted-foreground">{snapshot.profile.full_name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OfflineIndicator userId={userId} />
          <a className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium" href="/notificaciones" data-astro-reload>Notificaciones</a>
          <Button type="button" variant="outline" className="min-h-11" onClick={logout.request}>Cerrar sesión</Button>
          <form ref={logoutForm} method="POST" action="/api/auth/logout" data-astro-reload hidden />
        </div>
      </header>
      {logout.dialog}
      <QuickHelpPanel />

      {offline && <Alert variant="info" role="status"><AlertDescription>Sin conexión: todo lo que registres se guarda en este dispositivo y solo se sube cuando confirmes.</AlertDescription></Alert>}
      {notice && <Alert variant="destructive" role="alert"><AlertDescription>{notice}</AlertDescription></Alert>}
      {blocked && <Alert variant="warning" role="alert"><AlertTitle>Reporte con un problema de sincronización</AlertTitle><AlertDescription>{active?.blocked} Abre el indicador de pendientes para revisarlo y descartarlo.</AlertDescription></Alert>}
      {offShift && <Alert variant="warning" role="status"><AlertTitle>Reporte abierto fuera de turno</AlertTitle><AlertDescription>El turno de este reporte ya terminó. Envíalo o cancélalo cuanto antes.</AlertDescription></Alert>}

      {report && !active && (
        <Alert variant="success" role="status">
          <AlertTitle>{report.status === "SUBMITTED" ? "Reporte enviado" : "Reporte cancelado"}</AlertTitle>
          <AlertDescription>{report.folio ?? "Pendiente de subir"} · {report.machine_label}. Ya puedes iniciar otro reporte.</AlertDescription>
        </Alert>
      )}

      {!active && (
        <Card className="rounded-2xl gap-4 p-5">
          <h2 className="text-lg font-bold">Iniciar reporte</h2>
          {startFormDisabled ? (
            <Alert variant="warning"><AlertDescription>Solicita una asignación a tu coordinador. No tienes una máquina asignada en el turno actual.</AlertDescription></Alert>
          ) : (
            <>
              <Label><FieldLabel>Máquina asignada</FieldLabel>
                <NativeSelect data-testid="machine-select" value={machineId} onChange={(event) => setMachineId(event.target.value)}>
                  <option value="">Selecciona una máquina</option>
                  {machines.map(([id, machine]) => <option key={id} value={id}>{machine ? optionLabel(machine) : id}</option>)}
                </NativeSelect>
              </Label>
              <Button type="button" size="lg" className="min-h-12 w-full" disabled={!machineId} onClick={() => void startReport()}>Iniciar reporte</Button>
            </>
          )}
        </Card>
      )}

      {active && (
        <>
          <Card className="rounded-2xl gap-1 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-lg font-bold tabular-nums">{active.folio ?? "Pendiente de subir"}</p>
              <Badge variant={openStop ? "stop" : "draft"}>{openStop ? "Máquina detenida" : "Reporte activo"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{active.machine_label}</p>
          </Card>

          <Card className="rounded-2xl gap-4 p-5">
            <h2 className="text-lg font-bold">Paradas de máquina</h2>
            {openStop ? (
              <div className="rounded-xl border-2 border-destructive/30 bg-destructive/10 p-4">
                <p className="font-bold">{openStop.stop_category ? optionLabel(openStop.stop_category) : "Sin categoría todavía"}</p>
                <p className="text-sm text-muted-foreground">Inició: {new Date(openStop.started_at).toLocaleTimeString("es-CO")}</p>
                <p className="mt-2 font-mono text-3xl font-bold tabular-nums" role="timer" aria-label={`Tiempo de parada ${elapsed}`}>{elapsed}</p>
                <div className="mt-4 grid gap-3">
                  <Label><FieldLabel>Categoría de la parada</FieldLabel>
                    <NativeSelect data-testid="stop-category" value={effectiveStopCategory} disabled={blocked} onChange={(event) => setStopCategory(event.target.value)}>
                      <option value="">Selecciona una categoría</option>
                      {catalogs.stopCategories.map((category) => <option key={category.id} value={category.id}>{optionLabel(category)}</option>)}
                    </NativeSelect>
                  </Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Button type="button" variant="destructive" size="lg" className="min-h-12" disabled={blocked || !effectiveStopCategory} onClick={() => void closeStop()}>Cerrar parada</Button>
                    {openStop.stop_category && <Button type="button" variant="outline" size="lg" className="min-h-12" disabled={blocked || !stopCategory || stopCategory === openStop.stop_category.id} onClick={() => void changeCategory()}>Cambiar categoría</Button>}
                    <Button type="button" variant="outline" size="lg" className="min-h-12" disabled={blocked} onClick={() => { setReason(""); setModal("cancel-stop"); }}>Cancelar parada</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <Label><FieldLabel>Categoría (opcional al iniciar)</FieldLabel>
                  <NativeSelect data-testid="start-category" value={startCategory} disabled={blocked} onChange={(event) => setStartCategory(event.target.value)}>
                    <option value="">Elegir después</option>
                    {catalogs.stopCategories.map((category) => <option key={category.id} value={category.id}>{optionLabel(category)}</option>)}
                  </NativeSelect>
                </Label>
                <Button type="button" size="lg" className="min-h-14 w-full text-base" disabled={blocked} onClick={() => void startStop()}>Iniciar parada</Button>
              </div>
            )}
            <StopSummary stops={stops} />
            <StopEventsTable stops={stops} chronologicalOnly />
          </Card>

          <Card className="rounded-2xl gap-4 p-5">
            <h2 className="text-lg font-bold">Cambios</h2>
            <div className="grid gap-3">
              <Label><FieldLabel>Tipo de cambio</FieldLabel>
                <NativeSelect data-testid="change-type" value={changeType} disabled={blocked} onChange={(event) => setChangeType(event.target.value)}>
                  <option value="">Selecciona un tipo</option>
                  {catalogs.changeTypes.map((type) => <option key={type.id} value={type.id}>{optionLabel(type)}</option>)}
                </NativeSelect>
              </Label>
              <Label><FieldLabel>Descripción</FieldLabel>
                <Textarea data-testid="change-description" maxLength={500} value={changeDescription} disabled={blocked} onChange={(event) => setChangeDescription(event.target.value)} />
              </Label>
              <Button type="button" size="lg" className="min-h-12" disabled={blocked || !changeType || !changeDescription.trim()} onClick={() => void addChange()}>Registrar cambio</Button>
            </div>
            {(state?.changes.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">Aún no registraste cambios en este reporte.</p>}
            {(state?.changes.length ?? 0) > 0 && (
              <ul className="divide-y text-sm">
                {[...state!.changes].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((change) => (
                  <li key={change.id} className="py-2"><span className="font-semibold">{change.change_type_name ?? "Cambio"}</span> · {new Date(change.occurred_at).toLocaleTimeString("es-CO")}<br />{change.description}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="rounded-2xl gap-4 p-5">
            <h2 className="text-lg font-bold">Datos de producción</h2>
            <p className="text-sm text-muted-foreground">Fecha operativa {formatDate(active.report_date)} · el turno y la fecha los asigna el sistema según la hora de inicio. Todos los campos son obligatorios, salvo Observaciones.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {catalog("product_name", "product_id", "Producto", catalogs.products)}
              {input("production_order", "O.P.")}
              {select("line_id", "Área / Línea", catalogs.lines)}
              {catalog("client_name", "client_id", "Cliente", catalogs.clients)}
              {input("lot", "Lote")}
              {input("weight", "Peso (gr)", "number", { min: 0, step: "any", inputMode: "decimal" })}
              {input("g_min", "G/min", "number", { min: 0, step: "any", inputMode: "decimal" })}
              {select("dosifier_type_id", "Tipo de dosificador", catalogs.dosifierTypes)}
              {input("started_at", "Hora inicio", "datetime-local")}
              {input("ended_at", "Hora finalización", "datetime-local")}
              {input("programmed_hours", "Horas programadas", "number", { min: 0, step: "any", inputMode: "decimal" })}
              {input("units_produced", "Unidades producidas", "number", { min: 0, step: 1, inputMode: "numeric" })}
              {input("waste", "Desperdicio", "number", { min: 0, step: "any", inputMode: "decimal" })}
              <Label className="sm:col-span-2"><FieldLabel>Observaciones (opcional)</FieldLabel>
                <Textarea {...fieldProps("observations")} required={false} value={form.observations} onChange={(event) => edit({ observations: event.target.value })} />
              </Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button" variant="destructive" size="lg" className="min-h-12" disabled={blocked} onClick={() => { setReason(""); setModal("cancel-report"); }}>Cancelar reporte</Button>
              <Button type="button" size="lg" className="min-h-12" disabled={blocked} onClick={() => void beginSubmit()}>Enviar reporte</Button>
            </div>
          </Card>
        </>
      )}

      {modal === "submit" && (
        <PlatformModal title="¿Enviar reporte?" cancelLabel="Cancelar" confirmLabel="Enviar reporte" onCancel={() => setModal(null)} onConfirm={() => void confirmModal()}>
          <p>Verifica que la información esté completa. Después de enviarlo no podrás modificarlo.{offline ? " Estás sin conexión: el envío se subirá cuando confirmes." : ""}</p>
        </PlatformModal>
      )}
      {(modal === "cancel-report" || modal === "cancel-stop") && (
        <PlatformModal
          title={modal === "cancel-report" ? "Cancelar reporte" : "¿Cancelar esta parada?"}
          confirmLabel="Confirmar cancelación" destructive confirmDisabled={!reason.trim()}
          onCancel={() => setModal(null)} onConfirm={() => void confirmModal()}
        >
          <p>{modal === "cancel-report" ? "El reporte quedará en solo lectura y la máquina se liberará." : "La parada quedará como cancelada y no contará en los totales."}</p>
          <Label className="mt-4"><FieldLabel>Motivo de cancelación</FieldLabel>
            <Textarea className="min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} required />
          </Label>
        </PlatformModal>
      )}
    </main>
  );
}
