import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StopEvent } from "../lib/stop-events";

type SortKey = "sequence" | "duration" | "started_at" | "ended_at" | "category";
type Direction = "asc" | "desc";

interface Props {
  stops: StopEvent[];
  chronologicalOnly?: boolean;
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

export default function StopEventsTable({ stops, chronologicalOnly = false }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("sequence");
  const [direction, setDirection] = useState<Direction>("asc");

  const rows = useMemo(() => {
    const numbered = [...stops]
      .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id))
      .map((stop, index) => ({ ...stop, sequence: index + 1 }));

    if (chronologicalOnly) return numbered;
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
  }, [stops, sortKey, direction, chronologicalOnly]);

  const changeSort = (key: SortKey) => {
    if (sortKey === key) setDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setDirection("asc");
    }
  };

  const sortIcon = (key: SortKey) => {
    const Icon = sortKey === key ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return <Icon className="size-3.5" aria-hidden="true" />;
  };

  const heading = (key: SortKey, label: string) => chronologicalOnly ? label : (
    <Button variant="ghost" size="sm" className="-ml-3 min-h-11 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-primary" type="button" onClick={() => changeSort(key)}>
      {label}{sortIcon(key)}
    </Button>
  );

  return (
    <>
      {!chronologicalOnly && <div className="flex gap-2 overflow-x-auto pb-2 md:hidden" role="group" aria-label="Ordenar historial de paradas">
        {([
          ["sequence", "#"],
          ["category", "Categoría"],
          ["started_at", "Inicio"],
          ["ended_at", "Final"],
          ["duration", "Duración"],
        ] as Array<[SortKey, string]>).map(([key, label]) => (
          <Button key={key} variant={sortKey === key ? "secondary" : "outline"} className={sortKey === key ? "border border-primary" : undefined} type="button" aria-pressed={sortKey === key} onClick={() => changeSort(key)}>
            {label}{sortIcon(key)}
          </Button>
        ))}
      </div>}
      <div className="divide-y divide-border md:hidden">
        {rows.map((stop) => (
          <article key={stop.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-bold text-foreground">#{stop.sequence} · {stop.stop_category?.code} · {stop.stop_category?.name}</p>
              <Badge variant={stop.cancelled_at ? "cancelled" : stop.ended_at ? "neutral" : "stop"}>{stop.cancelled_at ? "Cancelada" : duration(stop.duration_seconds)}</Badge>
            </div>
            <dl className="grid gap-2 text-sm">
              <div><dt className="text-muted-foreground">Inicio</dt><dd className="font-medium">{dateTime(stop.started_at)}</dd></div>
              <div><dt className="text-muted-foreground">Final</dt><dd className="font-medium">{dateTime(stop.ended_at)}</dd></div>
              {stop.description && <div><dt className="text-muted-foreground">Descripción</dt><dd className="break-words">{stop.description}</dd></div>}
              {stop.cancelled_at && <div><dt className="text-muted-foreground">Motivo de cancelación</dt><dd className="break-words">{stop.cancellation_reason}</dd></div>}
            </dl>
          </article>
        ))}
        {rows.length === 0 && <p className="p-5 text-center text-muted-foreground">No hay paradas registradas.</p>}
      </div>
      <Table className="min-w-[760px]" container={{ role: "region", "aria-label": "Historial de paradas", tabIndex: 0, className: "hidden md:block" }}>
        <TableHeader>
          <TableRow>
            <TableHead>{heading("sequence", "#")}</TableHead>
            <TableHead>{heading("category", "Categoría")}</TableHead>
            <TableHead>{heading("started_at", "Inicio")}</TableHead>
            <TableHead>{heading("ended_at", "Final")}</TableHead>
            <TableHead>{heading("duration", "Duración")}</TableHead>
            <TableHead>Descripción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((stop) => (
            <TableRow key={stop.id}>
              <TableCell className="font-semibold">{stop.sequence}</TableCell>
              <TableCell className="font-medium">{stop.stop_category?.code} · {stop.stop_category?.name}</TableCell>
              <TableCell>{dateTime(stop.started_at)}</TableCell>
              <TableCell>{dateTime(stop.ended_at)}</TableCell>
              <TableCell>{stop.cancelled_at ? "Cancelada" : duration(stop.duration_seconds)}</TableCell>
              <TableCell>{stop.cancelled_at ? `Motivo de cancelación: ${stop.cancellation_reason}` : stop.description || "—"}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell className="p-5 text-center text-muted-foreground" colSpan={6}>No hay paradas registradas.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </>
  );
}
