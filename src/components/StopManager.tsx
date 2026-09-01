import { useEffect, useMemo, useState } from "react";
import StopEventsTable, { type StopEvent } from "./StopEventsTable";

type Category = { id: string; code: string; name: string };
interface Props {
  reportId: string;
  stops: StopEvent[];
  categories: Category[];
}

export default function StopManager({ reportId, stops, categories }: Props) {
  const openStop = useMemo(() => stops.find((stop) => !stop.ended_at), [stops]);
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!openStop) {
      setElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(openStop.started_at).getTime()) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [openStop]);

  const elapsed = useMemo(() => {
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [elapsedSeconds]);

  const start = async () => {
    if (working) return;
    if (!categoryId) {
      setError("Selecciona una categoría.");
      return;
    }
    setWorking(true);
    setError("");
    const response = await fetch(`/api/reports/${reportId}/stops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stop_category_id: categoryId, description }),
    });
    const body = await response.json();
    if (!response.ok) {
      setWorking(false);
      setError(body.error ?? "No fue posible iniciar la parada.");
      return;
    }
    window.location.reload();
  };

  const close = async () => {
    if (!openStop || working) return;
    setWorking(true);
    setError("");
    const response = await fetch(`/api/reports/${reportId}/stops/${openStop.id}/close`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setWorking(false);
      setError(body.error ?? "No fue posible cerrar la parada.");
      return;
    }
    window.location.reload();
  };

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Paradas de máquina</h2>
          <p className="text-sm text-slate-500">Cada parada se registra de forma independiente.</p>
        </div>
        {openStop && <span className="rounded-full bg-red-100 px-4 py-2 text-sm font-bold text-red-800">Parada abierta</span>}
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}

      {openStop ? (
        <div className="mt-5 rounded-2xl border-2 border-red-200 bg-red-50 p-5">
          <p className="font-bold text-red-900">{openStop.stop_category?.code} · {openStop.stop_category?.name}</p>
          <p className="mt-1 text-sm text-red-800">Inició: {new Date(openStop.started_at).toLocaleString("es-CO")}</p>
          <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-red-700">Duración en curso</p>
          <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-red-950">{elapsed}</p>
          {openStop.description && <p className="mt-2 text-sm text-red-800">{openStop.description}</p>}
          <button className="button-danger mt-5 w-full sm:w-auto" type="button" disabled={working} aria-busy={working} onClick={() => void close()}>
            {working ? "Cerrando…" : "STOP · Cerrar parada"}
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label>
            <span className="field-label">Categoría</span>
            <select className="field-control" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Selecciona una categoría</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.code} · {category.name}</option>)}
            </select>
          </label>
          <label>
            <span className="field-label">Descripción opcional</span>
            <input className="field-control" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <button className="button-primary w-full md:w-auto" type="button" disabled={working} aria-busy={working} onClick={() => void start()}>
            {working ? "Iniciando…" : "START · Iniciar parada"}
          </button>
        </div>
      )}

      <div className="mt-6"><StopEventsTable stops={stops} /></div>
    </section>
  );
}
