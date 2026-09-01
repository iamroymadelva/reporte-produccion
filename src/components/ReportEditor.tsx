import { useCallback, useEffect, useRef, useState } from "react";
import PlatformModal from "./PlatformModal";
import {
  getConnectivitySnapshot,
  guardedMutationFetch,
  subscribeConnectivity,
  type ConnectivityState,
} from "../lib/connectivity";

type Option = { id: string; code: string; name: string };
type Shift = { id: string; name: string | null; start_time: string; end_time: string };
type Report = Record<string, string | number | null> & { id: string };

interface Props {
  report: Report;
  lines: Option[];
  clients: Option[];
  products: Option[];
  dosifierTypes: Option[];
  shifts: Shift[];
  canSubmit: boolean;
  adminCorrection: boolean;
}

const numericFields = new Set(["weight", "g_min", "programmed_hours", "units_produced", "waste"]);
const percentageFields = new Set(["process_performance", "operator_performance"]);
const timestampFields = new Set(["started_at", "ended_at"]);

function localDateTime(value: string | number | null) {
  if (!value) return "";
  const date = new Date(String(value));
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialForm(report: Report) {
  const result: Record<string, string> = {};
  const fields = [
    "report_date", "production_order", "line_id", "client_id", "client_name", "lot", "shift_id",
    "product_id", "product_name", "weight", "g_min", "dosifier_type_id", "started_at", "ended_at",
    "programmed_hours", "units_produced", "waste", "process_performance", "operator_performance", "observations",
  ];
  for (const field of fields) {
    const value = report[field];
    if (timestampFields.has(field)) result[field] = localDateTime(value);
    else if (percentageFields.has(field) && value !== null && value !== "") result[field] = String(Number(value) * 100);
    else result[field] = value === null || value === undefined ? "" : String(value);
  }
  return result;
}

function payload(form: Record<string, string>) {
  return Object.fromEntries(Object.entries(form).map(([key, value]) => {
    if (!value) return [key, null];
    if (numericFields.has(key)) return [key, Number(value)];
    if (percentageFields.has(key)) return [key, Number(value) / 100];
    if (timestampFields.has(key)) return [key, new Date(value).toISOString()];
    return [key, value];
  }));
}

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es-CO");
}

function shiftLabel(shift: Shift) {
  const range = `${shift.start_time.slice(0, 5)} - ${shift.end_time.slice(0, 5)}`;
  return shift.name ? `${shift.name} · ${range}` : range;
}

export default function ReportEditor({ report, lines, clients, products, dosifierTypes, shifts, canSubmit, adminCorrection }: Props) {
  const [form, setForm] = useState(() => initialForm(report));
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<"submit" | "cancel" | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [frequentQuestion, setFrequentQuestion] = useState<{ label: string; name: string } | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectivityState>("online");
  const revision = useRef(0);
  const submitting = useRef(false);
  const cancellationReasonRef = useRef<HTMLTextAreaElement>(null);
  const declinedFrequentValues = useRef(new Set<string>());
  const frequentAnswer = useRef<((answer: boolean) => void) | null>(null);
  const connectionUnavailable = connectionState === "offline" || connectionState === "unreachable";

  useEffect(() => {
    setConnectionState(getConnectivitySnapshot().state);
    return subscribeConnectivity((snapshot) => setConnectionState(snapshot.state));
  }, []);

  const askToSaveFrequentValue = (label: string, name: string) => new Promise<boolean>((resolve) => {
    frequentAnswer.current = resolve;
    setFrequentQuestion({ label, name });
  });

  const answerFrequentQuestion = (answer: boolean) => {
    frequentAnswer.current?.(answer);
    frequentAnswer.current = null;
    setFrequentQuestion(null);
  };

  const update = (field: string, value: string) => {
    revision.current += 1;
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setState("idle");
    setMessage("");
  };

  const updateFrequentText = (field: "client_name" | "product_name", idField: "client_id" | "product_id", value: string, options: Option[]) => {
    const exact = options.find((option) => normalized(option.name) === normalized(value));
    revision.current += 1;
    setForm((current) => ({ ...current, [field]: value, [idField]: exact?.id ?? "" }));
    setDirty(true);
    setState("idle");
    setMessage("");
  };

  const save = useCallback(async (force = false, values = form) => {
    if (!dirty && !force) return true;
    const savingRevision = revision.current;
    setState("saving");
    setMessage("");
    try {
      const response = await guardedMutationFetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(values)),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No fue posible guardar.");
      if (savingRevision === revision.current) setDirty(false);
      setState("saved");
      return true;
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "No fue posible guardar.");
      return false;
    }
  }, [dirty, form, report.id]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void save(), 800);
    return () => window.clearTimeout(timer);
  }, [dirty, form, save]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (!submitting.current && (dirty || state === "saving")) event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, state]);

  const prepareFrequentValues = async () => {
    const next = { ...form };
    const candidates = [
      { catalog: "clients", label: "Cliente", nameField: "client_name", idField: "client_id", options: clients },
      { catalog: "products", label: "Producto", nameField: "product_name", idField: "product_id", options: products },
    ];
    try {
      for (const candidate of candidates) {
        const name = next[candidate.nameField].trim();
        if (!name) {
          next[candidate.idField] = "";
          continue;
        }
        const existing = candidate.options.find((option) => normalized(option.name) === normalized(name));
        if (existing) {
          next[candidate.idField] = existing.id;
          continue;
        }
        next[candidate.idField] = "";
        const token = `${candidate.catalog}:${normalized(name)}`;
        if (declinedFrequentValues.current.has(token)) continue;
        const shouldSave = await askToSaveFrequentValue(candidate.label, name);
        if (!shouldSave) {
          declinedFrequentValues.current.add(token);
          continue;
        }
        const response = await guardedMutationFetch("/api/catalogs/frequent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ catalog: candidate.catalog, name }),
        });
        const body = await response.json();
        if (!response.ok || !body.id) throw new Error(body.error ?? `No fue posible guardar ${candidate.label} como frecuente.`);
        next[candidate.idField] = body.id;
        declinedFrequentValues.current.add(token);
      }
      if (JSON.stringify(next) !== JSON.stringify(form)) {
        revision.current += 1;
        setForm(next);
        setDirty(true);
      }
      return next;
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "No fue posible guardar el valor frecuente.");
      return null;
    }
  };

  const saveManually = async () => {
    const prepared = await prepareFrequentValues();
    if (prepared) await save(true, prepared);
  };

  const submit = async () => {
    setModal(null);
    const prepared = await prepareFrequentValues();
    if (!prepared) return;
    submitting.current = true;
    if (!(await save(true, prepared))) {
      submitting.current = false;
      return;
    }
    setState("saving");
    try {
      const response = await guardedMutationFetch(`/api/reports/${report.id}/submit`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No fue posible enviar el reporte.");
      window.location.reload();
    } catch (error) {
      submitting.current = false;
      setState("error");
      setMessage(error instanceof Error ? error.message : "No fue posible enviar el reporte.");
    }
  };

  const cancel = async () => {
    const reason = cancelReason.trim();
    if (!reason) {
      setState("error");
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
      setState("error");
      setMessage(error instanceof Error ? error.message : "No fue posible cancelar el reporte.");
    }
  };

  const select = (field: string, label: string, options: Option[]) => (
    <label>
      <span className="field-label">{label}</span>
      <select className="field-control" value={form[field]} disabled={connectionUnavailable} onChange={(event) => update(field, event.target.value)}>
        <option value="">Sin seleccionar</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.code} · {option.name}</option>)}
      </select>
    </label>
  );

  const input = (field: string, label: string, type = "text", extra: Record<string, string | number> = {}) => (
    <label className="min-w-0">
      <span className="field-label">{label}</span>
      <input className={`field-control ${type === "number" ? "text-lg tabular-nums" : ""}`} type={type} value={form[field]} disabled={connectionUnavailable} onChange={(event) => update(field, event.target.value)} {...extra} />
    </label>
  );

  return (
    <section className="panel">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold">{adminCorrection ? "Corrección administrativa" : "Datos del reporte"}</h2><p className="text-sm text-slate-500">{connectionUnavailable ? "La edición requiere conexión. Los cambios actuales no se guardarán automáticamente." : "Los cambios se guardan automáticamente."}</p></div>
        <p className={`rounded-full px-3 py-2 text-sm font-semibold ${state === "error" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-600"}`} aria-live="polite">
          {connectionUnavailable && dirty ? "Cambios sin guardar" : state === "saving" ? "Guardando…" : state === "saved" ? "Guardado" : state === "error" ? "Error al guardar" : dirty ? "Cambios pendientes" : "Sin cambios"}
        </p>
      </div>
      {message && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{message}</p>}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {input("report_date", "Fecha", "date")}
        {input("production_order", "Orden de producción (O.P.)")}
        {select("line_id", "Área / Línea", lines)}
        <label><span className="field-label">Cliente</span><input className="field-control" list="client-suggestions" value={form.client_name} disabled={connectionUnavailable} onChange={(event) => updateFrequentText("client_name", "client_id", event.target.value, clients)} /><datalist id="client-suggestions">{clients.map((client) => <option key={client.id} value={client.name}>{client.code}</option>)}</datalist></label>
        {input("lot", "Lote")}
        <label><span className="field-label">Turno</span><select className="field-control" value={form.shift_id} disabled={connectionUnavailable} onChange={(event) => update("shift_id", event.target.value)}><option value="">Sin seleccionar</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shiftLabel(shift)}</option>)}</select></label>
        <label><span className="field-label">Producto</span><input className="field-control" list="product-suggestions" value={form.product_name} disabled={connectionUnavailable} onChange={(event) => updateFrequentText("product_name", "product_id", event.target.value, products)} /><datalist id="product-suggestions">{products.map((product) => <option key={product.id} value={product.name}>{product.code}</option>)}</datalist></label>
        {input("weight", "Peso (gr)", "number", { min: 0, step: "any", inputMode: "decimal" })}
        {input("g_min", "G/min", "number", { min: 0, step: "any", inputMode: "decimal" })}
        {select("dosifier_type_id", "Tipo de dosificador", dosifierTypes)}
        {input("started_at", "Hora de inicio", "datetime-local")}
        {input("ended_at", "Hora de finalización", "datetime-local")}
        {input("programmed_hours", "Horas programadas", "number", { min: 0, step: "any", inputMode: "decimal" })}
        {input("units_produced", "Unidades producidas", "number", { min: 0, step: 1, inputMode: "numeric" })}
        {input("waste", "Desperdicio", "number", { min: 0, step: "any", inputMode: "decimal" })}
        {input("process_performance", "Rendimiento del proceso (%)", "number", { step: "any", inputMode: "decimal" })}
        {input("operator_performance", "Rendimiento del Operario (%)", "number", { step: "any", inputMode: "decimal" })}
        <label className="md:col-span-2 xl:col-span-3"><span className="field-label">Observaciones</span><textarea className="field-control min-h-28" value={form.observations} disabled={connectionUnavailable} onChange={(event) => update("observations", event.target.value)} /></label>
      </div>
      <p className="mt-4 text-sm text-slate-500">Cliente y Producto aceptan texto libre; los valores frecuentes aparecen como sugerencias.</p>
      <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        {canSubmit ? <button className="button-danger w-full sm:w-auto" type="button" disabled={connectionUnavailable} onClick={() => { setCancelReason(""); setModal("cancel"); }}>Cancelar reporte</button> : <span />}
        <div className="grid gap-3 sm:flex sm:flex-wrap sm:justify-end">
          <button className="button-secondary w-full sm:w-auto" type="button" disabled={connectionUnavailable} onClick={() => void saveManually()}>Guardar ahora</button>
          {canSubmit && <button className="button-primary w-full sm:w-auto" type="button" disabled={connectionUnavailable} onClick={() => {
            if (!form.ended_at) {
              setState("error");
              setMessage("Debes registrar la hora de finalización antes de enviar el reporte.");
              return;
            }
            setModal("submit");
          }}>Enviar reporte</button>}
        </div>
      </div>
      {modal === "submit" && <PlatformModal title="Enviar reporte" confirmLabel="Enviar reporte" confirmDisabled={connectionUnavailable} onCancel={() => setModal(null)} onConfirm={() => void submit()}>
        <p>Después de enviarlo, el reporte quedará en modo de solo lectura para el Operario y ya no podrá modificarlo.</p>
      </PlatformModal>}
      {modal === "cancel" && <PlatformModal title="Cancelar reporte" confirmLabel="Confirmar cancelación" destructive confirmDisabled={!cancelReason.trim() || connectionUnavailable} initialFocusRef={cancellationReasonRef} onCancel={() => setModal(null)} onConfirm={() => void cancel()}>
        <p>El reporte quedará en modo de solo lectura y la máquina se liberará para un nuevo reporte.</p>
        <label className="mt-5 block"><span className="field-label">Motivo de cancelación</span><textarea ref={cancellationReasonRef} className="field-control min-h-28" value={cancelReason} disabled={connectionUnavailable} onChange={(event) => setCancelReason(event.target.value)} required /></label>
      </PlatformModal>}
      {frequentQuestion && <PlatformModal title={`Guardar ${frequentQuestion.label.toLocaleLowerCase("es-CO")}`} cancelLabel="No guardar" confirmLabel="Guardar como frecuente" confirmDisabled={connectionUnavailable} onCancel={() => answerFrequentQuestion(false)} onConfirm={() => answerFrequentQuestion(true)}>
        <p>“{frequentQuestion.name}” no existe entre los valores frecuentes. ¿Deseas guardarlo para futuros reportes?</p>
      </PlatformModal>}
    </section>
  );
}
