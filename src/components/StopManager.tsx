import { useEffect, useRef, useState } from "react";
import StopEventsTable from "./StopEventsTable";
import PlatformModal from "./PlatformModal";
import StopSummary from "./StopSummary";
import { isActiveStop, REPORT_STOPS_CHANGED, stopDuration, type StopEvent } from "../lib/stop-events";
import { getConnectivitySnapshot, guardedMutationFetch, subscribeConnectivity, type ConnectivityState } from "../lib/connectivity";

type Category = { id: string; code: string; name: string };
type Action = "start" | "close" | "category" | "cancel";
interface Props { reportId: string; stops: StopEvent[]; categories: Category[] }

export default function StopManager({ reportId, stops, categories }: Props) {
  const [events, setEvents] = useState(stops);
  const openStop = events.find(isActiveStop);
  const [categoryId, setCategoryId] = useState("");
  const [modal, setModal] = useState<Action | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const cancellationReasonRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectivityState>("online");
  const connectionUnavailable = connectionState === "offline" || connectionState === "unreachable";
  const disabled = working || connectionUnavailable;
  const selectedCategory = categories.find((category) => category.id === categoryId);

  useEffect(() => {
    setConnectionState(getConnectivitySnapshot().state);
    return subscribeConnectivity((snapshot) => setConnectionState(snapshot.state));
  }, []);

  const startedAt = openStop?.started_at;
  useEffect(() => {
    if (!startedAt) { setElapsedSeconds(0); return; }
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const elapsed = stopDuration(elapsedSeconds);

  const performAction = async (action: Action) => {
    if (workingRef.current || connectionUnavailable) return;
    if (action !== "start" && !openStop) return;
    if ((action === "start" || action === "category") && !selectedCategory) return;
    if (action === "cancel" && !cancelReason.trim()) return;
    workingRef.current = true;
    setWorking(true);
    setModal(null);
    setError("");
    try {
      const url = `/api/reports/${reportId}/stops${action === "start" ? "" : `/${openStop!.id}/${action}`}`;
      const payload = action === "start" || action === "category" ? { stop_category_id: categoryId }
        : action === "cancel" ? { reason: cancelReason.trim() } : undefined;
      const response = await guardedMutationFetch(url, {
        method: action === "category" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const body = await response.json();
      if (!response.ok || !body.stop) throw new Error(body.error ?? "No fue posible guardar la parada.");
      const confirmed = body.stop as StopEvent;
      const next = action === "start" ? [...events, confirmed] : events.map((stop) => stop.id === confirmed.id ? confirmed : stop);
      setEvents(next);
      setCategoryId("");
      setCancelReason("");
      // Keep the editor mounted so stop actions do not interrupt pending drafts.
      window.dispatchEvent(new CustomEvent(REPORT_STOPS_CHANGED, { detail: { reportId, active: next.some(isActiveStop) } }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No fue posible guardar la parada.");
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  };

  const categorySelect = (active: boolean) => (
    <label>
      <span className="field-label">{active ? "Cambiar categoría" : "Categoría"}</span>
      <select className="field-control" value={categoryId} disabled={disabled} onChange={(event) => setCategoryId(event.target.value)}>
        <option value="">Selecciona una categoría</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.code} · {category.name}</option>)}
      </select>
    </label>
  );

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-bold">Paradas de máquina</h2><p className="text-sm text-slate-500">Cada parada se registra de forma independiente.</p></div>
        {openStop && <span className="rounded-full bg-red-100 px-4 py-2 text-sm font-bold text-red-800">Parada activa</span>}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {connectionUnavailable && <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Iniciar, detener, cancelar o cambiar la categoría de una parada requiere conexión. El contador de una parada activa continúa.</p>}
      {openStop ? (
        <div className="mt-5 rounded-2xl border-2 border-red-200 bg-red-50 p-5">
          <p className="font-bold text-red-900">{openStop.stop_category?.code} · {openStop.stop_category?.name}</p>
          <p className="mt-1 text-sm text-red-800">Inició: {new Date(openStop.started_at).toLocaleString("es-CO")}</p>
          <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-red-700">Duración en curso</p>
          <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-red-950">{elapsed}</p>
          {openStop.description && <p className="mt-2 text-sm text-red-800">{openStop.description}</p>}
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            {categorySelect(true)}
            <button className="button-secondary" type="button" disabled={disabled || !categoryId || categoryId === openStop.stop_category?.id} onClick={() => setModal("category")}>Cambiar categoría</button>
          </div>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button className="button-danger" type="button" disabled={disabled} onClick={() => setModal("close")}>Detener</button>
            <button className="button-secondary" type="button" disabled={disabled} onClick={() => { setCancelReason(""); setModal("cancel"); }}>Cancelar parada</button>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          {categorySelect(false)}
          <button className="button-primary" type="button" disabled={disabled || !categoryId} onClick={() => setModal("start")}>Iniciar parada</button>
        </div>
      )}
      <div className="mt-6"><StopSummary stops={events} /></div>
      <div className="mt-6"><StopEventsTable stops={events} chronologicalOnly /></div>
      {modal === "start" && <PlatformModal title="¿Iniciar esta parada?" cancelLabel="Cancelar" confirmLabel="Iniciar parada" confirmDisabled={disabled} onCancel={() => setModal(null)} onConfirm={() => void performAction("start")}>
        <p>Categoría: <strong>{selectedCategory?.name}</strong></p>
      </PlatformModal>}
      {modal === "category" && <PlatformModal title="¿Cambiar categoría de la parada?" cancelLabel="Cancelar" confirmLabel="Cambiar categoría" confirmDisabled={disabled} onCancel={() => setModal(null)} onConfirm={() => void performAction("category")}>
        <p>De: <strong>{openStop?.stop_category?.name}</strong></p><p>A: <strong>{selectedCategory?.name}</strong></p><p>El contador continuará sin reiniciarse.</p>
      </PlatformModal>}
      {modal === "close" && <PlatformModal title="¿Detener esta parada?" cancelLabel="Cancelar" confirmLabel="Detener parada" confirmDisabled={disabled} onCancel={() => setModal(null)} onConfirm={() => void performAction("close")}>
        <p>Categoría: <strong>{openStop?.stop_category?.name}</strong></p><p>Tiempo transcurrido: <strong className="font-mono">{elapsed}</strong></p>
      </PlatformModal>}
      {modal === "cancel" && <PlatformModal title="¿Cancelar esta parada?" cancelLabel="Cancelar" confirmLabel="Confirmar cancelación" destructive confirmDisabled={disabled || !cancelReason.trim()} initialFocusRef={cancellationReasonRef} onCancel={() => setModal(null)} onConfirm={() => void performAction("cancel")}>
        <p>Categoría: <strong>{openStop?.stop_category?.name}</strong></p><p>La parada quedará en el historial como Cancelada y no contará en los totales.</p>
        <label className="mt-5 block"><span className="field-label">Motivo de cancelación</span><textarea ref={cancellationReasonRef} className="field-control min-h-28" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} required /></label>
      </PlatformModal>}
    </section>
  );
}
