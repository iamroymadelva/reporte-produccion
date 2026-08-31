import { useMemo, useState } from "react";

export type StopEvent = {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  description: string | null;
  stop_category: { id: string; code: string; name: string } | null;
};

type SortKey = "sequence" | "duration" | "started_at" | "ended_at" | "category";
type Direction = "asc" | "desc";

interface Props {
  stops: StopEvent[];
}

function duration(seconds: number | null) {
  if (seconds === null) return "En curso";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours ? `${hours} h ` : ""}${minutes ? `${minutes} min ` : ""}${rest} s`;
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value)).replace(/\s+/g, " ");
}

export default function StopEventsTable({ stops }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("sequence");
  const [direction, setDirection] = useState<Direction>("asc");

  const rows = useMemo(() => {
    const numbered = [...stops]
      .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id))
      .map((stop, index) => ({ ...stop, sequence: index + 1 }));

    return numbered.sort((a, b) => {
      let comparison = 0;
      if (sortKey === "sequence") comparison = a.sequence - b.sequence;
      if (sortKey === "duration") comparison = (a.duration_seconds ?? Number.POSITIVE_INFINITY) - (b.duration_seconds ?? Number.POSITIVE_INFINITY);
      if (sortKey === "started_at") comparison = a.started_at.localeCompare(b.started_at);
      if (sortKey === "ended_at") comparison = (a.ended_at ?? "9999").localeCompare(b.ended_at ?? "9999");
      if (sortKey === "category") {
        const aCode = Number(a.stop_category?.code);
        const bCode = Number(b.stop_category?.code);
        comparison = Number.isFinite(aCode) && Number.isFinite(bCode)
          ? aCode - bCode
          : (a.stop_category?.code ?? "").localeCompare(b.stop_category?.code ?? "", "es", { numeric: true });
      }
      return direction === "asc" ? comparison : -comparison;
    });
  }, [stops, sortKey, direction]);

  const changeSort = (key: SortKey) => {
    if (sortKey === key) setDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setDirection("asc");
    }
  };

  const heading = (key: SortKey, label: string) => (
    <button className="flex min-h-11 items-center gap-1 font-semibold hover:text-emerald-700" type="button" onClick={() => changeSort(key)}>
      {label}<span aria-hidden="true">{sortKey === key ? direction === "asc" ? "↑" : "↓" : "↕"}</span>
    </button>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b text-slate-500">
          <tr>
            <th className="p-3">{heading("sequence", "#")}</th>
            <th className="p-3">{heading("category", "Categoría")}</th>
            <th className="p-3">{heading("started_at", "Inicio")}</th>
            <th className="p-3">{heading("ended_at", "Final")}</th>
            <th className="p-3">{heading("duration", "Duración")}</th>
            <th className="p-3">Descripción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((stop) => (
            <tr key={stop.id} className="border-b last:border-0">
              <td className="p-3 font-semibold">{stop.sequence}</td>
              <td className="p-3 font-medium">{stop.stop_category?.code} · {stop.stop_category?.name}</td>
              <td className="p-3">{dateTime(stop.started_at)}</td>
              <td className="p-3">{dateTime(stop.ended_at)}</td>
              <td className="p-3">{duration(stop.duration_seconds)}</td>
              <td className="p-3">{stop.description || "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="p-5 text-center text-slate-500" colSpan={6}>No hay paradas registradas.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
