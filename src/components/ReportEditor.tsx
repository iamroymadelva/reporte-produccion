import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldLabel, Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import OfflineDraftNotice from "./OfflineDraftNotice";
import CorrectionDialog, { type CorrectionSummaryItem } from "./CorrectionDialog";
import PlatformModal from "./PlatformModal";
import { ACTIVE_STOP_SUBMISSION_ERROR, REQUIRED_REPORT_FIELDS, localDateTime, validateReportForSubmission, type ReportFieldErrors } from "../lib/report-validation";
import { REPORT_STOPS_CHANGED } from "../lib/stop-events";
import { reportFieldLabels } from "../lib/report-audit";
import {
  getConnectivitySnapshot,
  guardedMutationFetch,
  subscribeConnectivity,
  type ConnectivityState,
} from "../lib/connectivity";
import {
  REPORT_EDITABLE_FIELDS,
  reportFormToPayload,
  type ReportEditableField,
} from "../lib/report-fields";

type Option = { id: string; code: string; name: string };
type Shift = { id: string; name: string | null; start_time: string; end_time: string };
type Report = Record<string, unknown> & { id: string };
type ReportForm = Record<ReportEditableField, string>;
type SaveState =
  | "idle"
  | "server-saving"
  | "server-saved"
  | "server-error"
  | "review";
type ReviewReason = "server-changed" | "finalized" | null;

interface Props {
  report: Report;
  lines: Option[];
  clients: Option[];
  products: Option[];
  dosifierTypes: Option[];
  shifts: Shift[];
  canSubmit: boolean;
  adminCorrection: boolean;
  machineLabel?: string;
  hasActiveStop?: boolean;
}

const percentageFields = new Set<ReportEditableField>(["process_performance", "operator_performance"]);
const timestampFields = new Set<ReportEditableField>(["started_at", "ended_at"]);
const SERVER_SAVE_DEBOUNCE_MS = 800;
const requiredFields = new Set<string>(REQUIRED_REPORT_FIELDS.map(({ field }) => field));

function initialForm(values: Record<string, unknown>): ReportForm {
  const result = {} as ReportForm;
  for (const field of REPORT_EDITABLE_FIELDS) {
    const value = values[field];
    if (timestampFields.has(field)) result[field] = localDateTime(value);
    else if (percentageFields.has(field) && value !== null && value !== "" && value !== undefined) {
      result[field] = String(Number(value) * 100);
    } else result[field] = value === null || value === undefined ? "" : String(value);
  }
  return result;
}

function shiftLabel(shift: Shift) {
  const range = `${shift.start_time.slice(0, 5)} - ${shift.end_time.slice(0, 5)}`;
  return shift.name ? `${shift.name} · ${range}` : range;
}

export default function ReportEditor({
  report,
  lines,
  clients,
  products,
  dosifierTypes,
  shifts,
  canSubmit,
  adminCorrection,
  machineLabel,
  hasActiveStop = false,
}: Props) {
  const initialValues = initialForm(report);
  const [form, setForm] = useState<ReportForm>(initialValues);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<"submit" | "cancel" | "correct" | null>(null);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectivityState>("online");
  const [reviewReason, setReviewReason] = useState<ReviewReason>(null);
  const [autoSaveRevision, setAutoSaveRevision] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReportFieldErrors>({});
  const [activeStop, setActiveStop] = useState(hasActiveStop);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ reportId: string; active: boolean }>).detail;
      if (detail.reportId === report.id) setActiveStop(detail.active);
    };
    window.addEventListener(REPORT_STOPS_CHANGED, changed);
    return () => window.removeEventListener(REPORT_STOPS_CHANGED, changed);
  }, [report.id]);

  const formRef = useRef(form);
  const dirtyRef = useRef(false);
  const reviewReasonRef = useRef<ReviewReason>(null);
  const connectionUnavailableRef = useRef(false);
  const revision = useRef(0);
  const submitting = useRef(false);
  const cancellationReasonRef = useRef<HTMLTextAreaElement>(null);
  const serverSaveTimer = useRef<number | null>(null);
  const serverSavePromise = useRef<Promise<boolean> | null>(null);
  const serverSaveRequested = useRef(false);
  const forceServerSaveRequested = useRef(false);
  const connectionUnavailable = connectionState === "offline" || connectionState === "unreachable";
  const fieldsDisabled = finalizing || modal !== null || reviewReason !== null || connectionUnavailable;
  const onlineActionDisabled = finalizing || reviewReason !== null || connectionUnavailable;
  // Contrato con el shell: data-unsaved-changes="true" bloquea la navegación cliente mientras haya cambios sin guardar.
  const hasUnsavedChanges = dirty;

  // T087: este editor ya no trabaja sin conexión. El reporte activo del Operario se trabaja en /turno; aquí solo
  // quedan la corrección de managers y la vista en línea, siempre con conexión confirmada.
  const requestServerSave = useCallback((force = false) => {
    serverSaveRequested.current = true;
    if (force) forceServerSaveRequested.current = true;
    if (serverSavePromise.current) return serverSavePromise.current;

    const task = (async () => {
      let completed = true;
      while (serverSaveRequested.current) {
        serverSaveRequested.current = false;
        const forceThisPass = forceServerSaveRequested.current;
        forceServerSaveRequested.current = false;
        if (connectionUnavailableRef.current || reviewReasonRef.current) return false;

        const savingRevision = revision.current;
        const outgoing = reportFormToPayload({ ...formRef.current });
        if (!dirtyRef.current && !forceThisPass) continue;
        setSaveState("server-saving");
        setMessage("");
        try {
          const response = await guardedMutationFetch(`/api/reports/${report.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(outgoing),
          });
          const body = await response.json();
          if (!response.ok) {
            if (body.code === "REPORT_CONFLICT" || body.code === "REPORT_NOT_DRAFT") {
              const reason: ReviewReason = body.code === "REPORT_NOT_DRAFT" ? "finalized" : "server-changed";
              reviewReasonRef.current = reason;
              setReviewReason(reason);
              setSaveState("review");
              setMessage("");
            } else {
              setSaveState("server-error");
              setMessage(body.error ?? "No fue posible guardar en el servidor.");
            }
            return false;
          }
          if (revision.current === savingRevision) {
            dirtyRef.current = false;
            setDirty(false);
            setSaveState("server-saved");
          }
          if (revision.current > savingRevision) {
            if (adminCorrection) setSaveState("idle");
            else if (!connectionUnavailableRef.current) serverSaveRequested.current = true;
          }
        } catch (error) {
          completed = false;
          setSaveState("server-error");
          setMessage(error instanceof Error ? error.message : "No fue posible guardar en el servidor.");
          return false;
        }
      }
      return completed;
    })();

    serverSavePromise.current = task;
    void task.finally(() => {
      if (serverSavePromise.current === task) serverSavePromise.current = null;
    });
    return task;
  }, [adminCorrection, report.id]);

  useEffect(() => {
    setConnectionState(getConnectivitySnapshot().state);
    return subscribeConnectivity((snapshot) => {
      const unavailable = snapshot.state === "offline" || snapshot.state === "unreachable";
      connectionUnavailableRef.current = unavailable;
      setConnectionState(snapshot.state);
      if (unavailable) {
        setAutoSaveRevision(null);
        if (serverSaveTimer.current !== null) {
          window.clearTimeout(serverSaveTimer.current);
          serverSaveTimer.current = null;
        }
      }
    });
  }, []);

  useEffect(() => {
    if (adminCorrection || autoSaveRevision === null || autoSaveRevision !== revision.current || connectionUnavailable || reviewReason !== null) return;
    if (serverSaveTimer.current !== null) window.clearTimeout(serverSaveTimer.current);
    const timer = window.setTimeout(() => {
      if (serverSaveTimer.current === timer) serverSaveTimer.current = null;
      void requestServerSave();
    }, SERVER_SAVE_DEBOUNCE_MS);
    serverSaveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (serverSaveTimer.current === timer) serverSaveTimer.current = null;
    };
  }, [adminCorrection, autoSaveRevision, connectionUnavailable, requestServerSave, reviewReason]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      const unsafe = dirtyRef.current || serverSavePromise.current !== null;
      if (!submitting.current && unsafe) event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);

  const applyEditedForm = (next: ReportForm) => {
    const nextRevision = revision.current + 1;
    revision.current = nextRevision;
    formRef.current = next;
    dirtyRef.current = true;
    setForm(next);
    setDirty(true);
    setMessage("");
    setFieldErrors((current) => {
      const remaining = validateReportForSubmission(next);
      let updated = current;
      for (const requirement of REQUIRED_REPORT_FIELDS) {
        if (current[requirement.field] && !remaining[requirement.field]) {
          if (updated === current) updated = { ...current };
          delete updated[requirement.field];
        }
      }
      return updated;
    });
    setSaveState("idle");
    if (adminCorrection || connectionUnavailableRef.current) setAutoSaveRevision(null);
    else {
      setAutoSaveRevision(nextRevision);
      if (serverSavePromise.current) serverSaveRequested.current = true;
    }
  };

  const update = (field: ReportEditableField, value: string) => {
    applyEditedForm({ ...formRef.current, [field]: value });
  };

  // Corrección de un manager (SUBMITTED/CLOSED): campos distintos del valor guardado, con su etiqueta legible.
  const correctionSummary = (): CorrectionSummaryItem[] => {
    const optionLabel = (options: Option[], id: string) => {
      const option = options.find((item) => item.id === id);
      return option ? `${option.code} · ${option.name}` : id;
    };
    const display = (field: ReportEditableField, value: string) => {
      if (!value) return "—";
      if (field === "line_id") return optionLabel(lines, value);
      if (field === "client_id") return optionLabel(clients, value);
      if (field === "product_id") return optionLabel(products, value);
      if (field === "dosifier_type_id") return optionLabel(dosifierTypes, value);
      if (field === "shift_id") {
        const shift = shifts.find((item) => item.id === value);
        return shift ? shiftLabel(shift) : value;
      }
      if (timestampFields.has(field)) return value.replace("T", " ");
      if (percentageFields.has(field)) return `${value} %`;
      return value;
    };
    return REPORT_EDITABLE_FIELDS
      .filter((field) => formRef.current[field] !== initialValues[field])
      .map((field) => ({
        field,
        label: reportFieldLabels[field] ?? field,
        previous: display(field, initialValues[field]),
        next: display(field, formRef.current[field]),
      }));
  };

  const confirmCorrection = async (reason: string) => {
    const changedForm: Record<string, string> = {};
    for (const field of REPORT_EDITABLE_FIELDS) {
      if (formRef.current[field] !== initialValues[field]) changedForm[field] = formRef.current[field];
    }
    setCorrectionBusy(true);
    setCorrectionError("");
    try {
      const response = await guardedMutationFetch(`/api/reports/${report.id}/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: reportFormToPayload(changedForm), reason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "No fue posible guardar la corrección.");
      dirtyRef.current = false;
      setDirty(false);
      window.location.reload();
    } catch (error) {
      setCorrectionBusy(false);
      setCorrectionError(error instanceof Error ? error.message : "No fue posible guardar la corrección.");
    }
  };

  const saveManually = async () => {
    if (adminCorrection) {
      if (connectionUnavailableRef.current || correctionSummary().length === 0) return;
      setCorrectionError("");
      setModal("correct");
      return;
    }
    if (connectionUnavailableRef.current) return;
    await requestServerSave(true);
  };

  const submit = async () => {
    if (submitting.current || onlineActionDisabled) return;
    setModal(null);
    if (activeStop) { setMessage(ACTIVE_STOP_SUBMISSION_ERROR); return; }
    if (!validateSubmissionFields()) return;
    submitting.current = true;
    setFinalizing(true);
    if (!(await requestServerSave(true)) || dirtyRef.current) {
      submitting.current = false;
      setFinalizing(false);
      return;
    }
    setSaveState("server-saving");
    try {
      const response = await guardedMutationFetch(`/api/reports/${report.id}/submit`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        if (body.fieldErrors) showFieldErrors(body.fieldErrors);
        throw new Error(body.error ?? "No fue posible enviar el reporte.");
      }
      window.location.reload();
    } catch (error) {
      submitting.current = false;
      setFinalizing(false);
      setSaveState("server-error");
      setMessage(error instanceof Error ? error.message : "No fue posible enviar el reporte.");
    }
  };

  const cancel = async () => {
    const reason = cancelReason.trim();
    if (!reason) {
      setSaveState("server-error");
      setMessage("Debes indicar el motivo de cancelación.");
      return;
    }

    setModal(null);
    submitting.current = true;
    try {
      const response = await guardedMutationFetch(`/api/reports/${report.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No fue posible cancelar el reporte.");
      window.location.reload();
    } catch (error) {
      submitting.current = false;
      setSaveState("server-error");
      setMessage(error instanceof Error ? error.message : "No fue posible cancelar el reporte.");
    }
  };

  const showFieldErrors = (errors: ReportFieldErrors) => {
    setFieldErrors(errors);

    const firstInvalid = REQUIRED_REPORT_FIELDS.find(({ field }) => errors[field]);
    if (firstInvalid) {
      setModal(null);
      window.requestAnimationFrame(() => {
        const field = document.querySelector<HTMLElement>(`[data-report-field="${firstInvalid.field}"]`);
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
        field?.focus({ preventScroll: true });
      });
      return false;
    }
    return true;
  };
  const validateSubmissionFields = () => showFieldErrors(validateReportForSubmission(formRef.current));
  const beginSubmit = () => {
    if (activeStop) { setMessage(ACTIVE_STOP_SUBMISSION_ERROR); return; }
    if (!validateSubmissionFields()) return;
    setMessage("");
    setModal("submit");
  };

  const fieldProps = (field: ReportEditableField) => ({
    className: `scroll-mt-40 ${fieldErrors[field] ? "border-destructive ring-2 ring-destructive/20" : ""}`,
    "data-report-field": field,
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `report-field-${field}-error` : undefined,
    required: canSubmit && requiredFields.has(field),
  });
  const fieldError = (field: ReportEditableField) => fieldErrors[field]
    ? <p id={`report-field-${field}-error`} className="mt-1 text-sm font-semibold text-destructive">{fieldErrors[field]}</p> : null;

  const select = (field: ReportEditableField, label: string, options: Option[]) => (
    <Label>
      <FieldLabel>{label}</FieldLabel>
      <NativeSelect {...fieldProps(field)} value={form[field]} disabled={fieldsDisabled} onChange={(event) => update(field, event.target.value)}>
        <option value="">Sin seleccionar</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.code} · {option.name}</option>)}
      </NativeSelect>
      {fieldError(field)}
    </Label>
  );

  const input = (field: ReportEditableField, label: string, type = "text", extra: Record<string, string | number> = {}) => (
    <Label className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <Input
        {...fieldProps(field)}
        className={`scroll-mt-40 ${type === "number" ? "text-lg" : ""} ${fieldErrors[field] ? "border-destructive ring-2 ring-destructive/20" : ""}`}
        type={type}
        value={form[field]}
        disabled={fieldsDisabled}
        data-report-field={field}
        aria-invalid={fieldErrors[field] ? "true" : undefined}
        aria-describedby={fieldErrors[field] ? `report-field-${field}-error` : undefined}
        onChange={(event) => update(field, event.target.value)}
        {...extra}
      />
      {fieldErrors[field] && <p id={`report-field-${field}-error`} className="mt-1 text-sm font-semibold text-destructive">{fieldErrors[field]}</p>}
    </Label>
  );

  // Cliente y Producto: solo elementos activos del catálogo (FR-011a). Se guardan el id y el nombre vigente.
  const catalogSelect = (field: "client_name" | "product_name", idField: "client_id" | "product_id", label: string, options: Option[]) => (
    <Label><FieldLabel>{label}</FieldLabel>
      <NativeSelect
        {...fieldProps(field)}
        value={form[idField]}
        disabled={fieldsDisabled}
        onChange={(event) => {
          const selected = options.find((option) => option.id === event.target.value);
          applyEditedForm({ ...formRef.current, [idField]: selected?.id ?? "", [field]: selected?.name ?? "" });
        }}
      >
        <option value="">Sin seleccionar</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.code} · {option.name}</option>)}
      </NativeSelect>
      {fieldError(field)}
    </Label>
  );
  // Fecha operativa y turno los fija el servidor desde la hora de inicio: el operario solo los ve.
  const readOnlyField = (field: ReportEditableField, label: string, value: string) => (
    <Label className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <Input {...fieldProps(field)} value={value} readOnly aria-readonly="true" />
      {fieldError(field)}
    </Label>
  );
  const timeInput = (field: "started_at" | "ended_at", label: string) => (
    <div>{input(field, label, "datetime-local")}
      <Button variant="outline" className="mt-2" type="button" disabled={fieldsDisabled} onClick={() => update(field, localDateTime(new Date().toISOString()))}>Usar hora actual</Button>
    </div>
  );

  const statusLabel = saveState === "server-saving"
    ? "Guardando en servidor…"
    : saveState === "server-saved"
      ? "Guardado en servidor"
      : saveState === "server-error"
        ? "Error al guardar"
        : saveState === "review"
          ? "Cambios locales pendientes de revisión"
          : dirty
            ? "Cambios pendientes"
            : "Sin cambios";
  const statusError = saveState === "server-error";
  const statusReview = saveState === "review";

  return (
    <>
      {Object.keys(fieldErrors).length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[100] px-3 sm:px-6"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
        >
          <Alert variant="destructive" aria-live="assertive" aria-atomic="true" className="mx-auto max-w-2xl bg-card shadow-xl">
            <AlertTitle>Faltan campos obligatorios</AlertTitle>
            <AlertDescription>Completa los campos resaltados antes de enviar el reporte.</AlertDescription>
          </Alert>
        </div>
      )}
      <OfflineDraftNotice visible={reviewReason !== null} finalized={reviewReason === "finalized"} />
      <Card asChild className="rounded-2xl gap-0 p-5">
      <section data-unsaved-changes={hasUnsavedChanges && !finalizing ? "true" : "false"}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{adminCorrection ? "Corrección administrativa" : "Datos del reporte"}</h2>
            <p className="text-sm text-muted-foreground">
              {adminCorrection
                ? "Los cambios se aplican únicamente al confirmar la corrección con un motivo."
                : connectionUnavailable
                ? "La edición requiere conexión. Los cambios actuales no se guardarán automáticamente."
                : "Los cambios se guardan automáticamente."}
            </p>
          </div>
          <Badge variant={statusError ? "cancelled" : statusReview ? "draft" : "neutral"} className="px-3 py-2 text-sm" aria-live="polite">
            {statusLabel}
          </Badge>
        </div>
        {message && <Alert variant="destructive" role="alert" className="mb-5"><AlertDescription>{message}</AlertDescription></Alert>}
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {canSubmit && <>
            <Label><FieldLabel>Máquina</FieldLabel><Input value={machineLabel ?? ""} readOnly /></Label>
            <Label><FieldLabel>Operario responsable</FieldLabel><Input value={String(report.creator_full_name ?? "")} readOnly /></Label>
          </>}
          {canSubmit ? readOnlyField("report_date", "Fecha", form.report_date) : input("report_date", "Fecha", "date")}
          {catalogSelect("product_name", "product_id", "Producto", products)}
          {input("production_order", "O.P.")}
          {select("line_id", "Área / Línea", lines)}
          {catalogSelect("client_name", "client_id", "Cliente", clients)}
          {input("lot", "Lote")}
          {canSubmit
            ? readOnlyField("shift_id", "Turno", (() => { const current = shifts.find((shift) => shift.id === form.shift_id); return current ? shiftLabel(current) : ""; })())
            : <Label><FieldLabel>Turno</FieldLabel><NativeSelect {...fieldProps("shift_id")} value={form.shift_id} disabled={fieldsDisabled} onChange={(event) => update("shift_id", event.target.value)}><option value="">Sin seleccionar</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shiftLabel(shift)}</option>)}</NativeSelect>{fieldError("shift_id")}</Label>}
          {input("weight", "Peso (gr)", "number", { min: 0, step: "any", inputMode: "decimal" })}
          {input("g_min", "G/min", "number", { min: 0, step: "any", inputMode: "decimal" })}
          {select("dosifier_type_id", "Tipo de dosificador", dosifierTypes)}
          {timeInput("started_at", "Hora inicio")}
          {timeInput("ended_at", "Hora finalización")}
          {input("programmed_hours", "Horas programadas", "number", { min: 0, step: "any", inputMode: "decimal" })}
          {input("units_produced", "Unidades producidas", "number", { min: 0, step: 1, inputMode: "numeric" })}
          {input("waste", "Desperdicio", "number", { min: 0, step: "any", inputMode: "decimal" })}
          {!canSubmit && input("process_performance", "Rendimiento del proceso (%)", "number", { step: "any", inputMode: "decimal" })}
          {!canSubmit && input("operator_performance", "Rendimiento del Operario (%)", "number", { step: "any", inputMode: "decimal" })}
          <Label className="md:col-span-2 xl:col-span-3"><FieldLabel>Observaciones (opcional)</FieldLabel><Textarea className="min-h-28" value={form.observations} disabled={fieldsDisabled} onChange={(event) => update("observations", event.target.value)} /></Label>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Cliente y Producto se eligen de los catálogos activos{canSubmit ? "; la fecha y el turno los asigna el sistema según la hora de inicio." : "."}</p>
        <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          {canSubmit ? <Button variant="destructive" size="lg" className="w-full sm:w-auto" type="button" disabled={onlineActionDisabled} onClick={() => { setCancelReason(""); setModal("cancel"); }}>Cancelar reporte</Button> : <span />}
          <div className="grid gap-3 sm:flex sm:flex-wrap sm:justify-end">
            <Button variant="outline" size="lg" className="w-full sm:w-auto" type="button" disabled={finalizing || reviewReason !== null || connectionUnavailable || (adminCorrection && (!dirty || saveState === "server-saving"))} onClick={() => void saveManually()}>
              {adminCorrection ? "Corregir con motivo" : "Guardar ahora"}
            </Button>
            {canSubmit && <Button size="lg" className="w-full sm:w-auto" type="button" disabled={onlineActionDisabled} onClick={beginSubmit}>Enviar reporte</Button>}
          </div>
        </div>
        {modal === "submit" && <PlatformModal title="¿Enviar reporte?" cancelLabel="Cancelar" confirmLabel="Enviar reporte" confirmDisabled={onlineActionDisabled} onCancel={() => setModal(null)} onConfirm={() => void submit()}>
          <p>Verifica que la información esté completa. Después de enviarlo, no podrás modificarlo.</p>
        </PlatformModal>}
        {modal === "correct" && <CorrectionDialog
          changes={correctionSummary()}
          busy={correctionBusy}
          error={correctionError}
          onCancel={() => { if (!correctionBusy) setModal(null); }}
          onConfirm={(reason) => void confirmCorrection(reason)}
        />}
        {modal === "cancel" && <PlatformModal title="Cancelar reporte" confirmLabel="Confirmar cancelación" destructive confirmDisabled={!cancelReason.trim() || connectionUnavailable} initialFocusRef={cancellationReasonRef} onCancel={() => setModal(null)} onConfirm={() => void cancel()}>
          <p>El reporte quedará en modo de solo lectura y la máquina se liberará para un nuevo reporte.</p>
          <Label className="mt-5"><FieldLabel>Motivo de cancelación</FieldLabel><Textarea ref={cancellationReasonRef} className="min-h-28" value={cancelReason} disabled={connectionUnavailable} onChange={(event) => setCancelReason(event.target.value)} required /></Label>
        </PlatformModal>}
      </section>
      </Card>
    </>
  );
}
