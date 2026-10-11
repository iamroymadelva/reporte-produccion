import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, FileClock, Lock, OctagonAlert, TriangleAlert, XCircle } from "lucide-react";
import StatusBadge from "../StatusBadge";
import StopIndicator from "../StopIndicator";
import LiveStatus from "./LiveStatus";
import { useLiveSubscription } from "./useLiveSubscription";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { RealtimeChannelSpec, SubscribeOptions } from "@/lib/realtime";

export interface DashboardKpis {
  DRAFT: number; SUBMITTED: number; CLOSED: number; CANCELLED: number; ACTIVE_STOP: number; OFF_SHIFT: number; OPEN_CONFLICTS?: number;
}
interface MachineRef { id?: string; code: string; name: string }
export interface DashboardSummary {
  range: { from: string; to: string };
  kpis: DashboardKpis;
  machinesStopped: Array<{ reportId: string; folio: string | null; machine: MachineRef | null; operator: string | null; since: string | null }>;
  offShiftReports: Array<{ reportId: string; folio: string | null; machine: MachineRef | null; operator: string | null; createdAt: string }>;
  recent: Array<{
    id: string; folio: string | null; status: string; createdAt: string; machine: MachineRef | null; operator: string | null;
    productionOrder: string | null; approver: string | null; approvedAt: string | null; isOffShift: boolean; activeStop: boolean;
  }>;
}

interface Props {
  /** Fecha operativa (AAAA-MM-DD) del rango mostrado. */
  date: string;
  initial?: Pick<DashboardSummary, "kpis" | "recent"> | null;
  /** Solo para pruebas: cliente de Realtime y temporizadores simulados. */
  realtime?: SubscribeOptions;
  /** Solo para pruebas: ruta del resumen. */
  summaryUrl?: string;
}

export const DASHBOARD_CHANNELS: RealtimeChannelSpec[] = [
  { name: "dashboard-reports", table: "production_reports" },
  { name: "dashboard-stops", table: "report_stop_events" },
  { name: "dashboard-quarantine", table: "sync_quarantine" },
];

const machineLabel = (machine: MachineRef | null) => (machine ? `${machine.code} · ${machine.name}` : "—");

export default function LiveDashboard({ date, initial = null, realtime = {}, summaryUrl = "/api/dashboard/summary" }: Props) {
  const [summary, setSummary] = useState<Partial<DashboardSummary> | null>(initial);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const queued = useRef(false);

  const load = useCallback(async () => {
    // Una sola petición a la vez; si llega otro aviso mientras tanto, se repite al terminar.
    if (inFlight.current) { queued.current = true; return; }
    inFlight.current = true;
    try {
      const response = await fetch(`${summaryUrl}?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`, {
        credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" },
      });
      if (response.status === 401) { window.location.assign("/iniciar-sesion"); return; }
      if (!response.ok) { setFailed(true); return; }
      setSummary(await response.json() as DashboardSummary);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      if (queued.current) { queued.current = false; void load(); }
    }
  }, [date, summaryUrl]);

  useEffect(() => { void load(); }, [load]);
  const mode = useLiveSubscription(DASHBOARD_CHANNELS, load, { debounceMs: 500, ...realtime });

  const kpis = summary?.kpis;
  const todayQuery = `from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`;
  const cards = [
    { key: "DRAFT", label: "Reportes en curso", href: `/reportes?${todayQuery}&status=DRAFT`, icon: FileClock, iconClass: "text-warning-text", card: "border-warning/20" },
    { key: "SUBMITTED", label: "Reportes enviados", href: `/reportes?${todayQuery}&status=SUBMITTED`, icon: CheckCircle2, iconClass: "text-success-text", card: "" },
    { key: "CLOSED", label: "Reportes cerrados", href: `/reportes?${todayQuery}&status=CLOSED`, icon: Lock, iconClass: "text-primary", card: "" },
    { key: "CANCELLED", label: "Reportes cancelados", href: `/reportes?${todayQuery}&status=CANCELLED`, icon: XCircle, iconClass: "text-destructive-text", card: "border-destructive/20" },
    { key: "ACTIVE_STOP", label: "Reportes en parada", href: `/reportes?${todayQuery}&stop=active`, icon: OctagonAlert, iconClass: "text-stop-text", card: "border-stop/20" },
    { key: "OFF_SHIFT", label: "Abiertos fuera de turno", href: "/reportes?status=DRAFT&offshift=1", icon: Clock, iconClass: "text-warning-text", card: "border-warning/20" },
  ] as const;
  const conflicts = kpis?.OPEN_CONFLICTS ?? summary?.kpis?.OPEN_CONFLICTS;

  return (
    <div className="space-y-6" data-live-dashboard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LiveStatus mode={mode} />
        {failed && <p role="alert" className="text-xs text-destructive-text">No fue posible actualizar el tablero; se reintentará.</p>}
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6" aria-label="Indicadores de hoy">
        {cards.map((card) => (
          <Card key={card.key} className={`relative gap-0 rounded-2xl py-4 transition-colors hover:bg-muted/40 ${card.card}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium leading-snug">
                <a className="after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50" href={card.href}>{card.label}</a>
              </CardTitle>
              <card.icon className={`h-4 w-4 shrink-0 ${card.iconClass}`} aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" data-kpi={card.key}>{kpis ? kpis[card.key] : "—"}</div>
              <p className="mt-1 text-xs text-muted-foreground">{card.key === "OFF_SHIFT" ? "Abiertos ahora · ver detalle" : "Hoy · ver detalle"}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Atención inmediata">
        <Card className="gap-0 rounded-2xl py-0">
          <CardHeader className="border-b py-4"><CardTitle><h2 className="text-base font-semibold leading-none">Máquinas en parada</h2></CardTitle></CardHeader>
          <CardContent className="p-0">
            {summary?.machinesStopped === undefined ? <p className="p-4 text-sm text-muted-foreground">{failed ? "No se pudo cargar." : "Cargando…"}</p>
              : summary.machinesStopped.length === 0 ? <p className="p-4 text-sm text-muted-foreground" data-empty="stopped">Ninguna máquina en parada.</p>
              : <ul className="divide-y">{summary.machinesStopped.map((item) => (
                <li key={item.reportId} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span><span className="font-semibold">{machineLabel(item.machine)}</span><span className="block text-xs text-muted-foreground">{item.operator ?? "—"} · desde {formatDateTime(item.since)}</span></span>
                  <a className="font-semibold text-primary underline-offset-4 hover:underline" href={`/reportes/${item.reportId}`}>{item.folio ?? "Abrir"}</a>
                </li>))}</ul>}
          </CardContent>
        </Card>
        <Card className="gap-0 rounded-2xl py-0">
          <CardHeader className="border-b py-4"><CardTitle><h2 className="text-base font-semibold leading-none">Abiertos fuera de turno</h2></CardTitle></CardHeader>
          <CardContent className="p-0">
            {summary?.offShiftReports === undefined ? <p className="p-4 text-sm text-muted-foreground">{failed ? "No se pudo cargar." : "Cargando…"}</p>
              : summary.offShiftReports.length === 0 ? <p className="p-4 text-sm text-muted-foreground" data-empty="offshift">Ninguno por ahora.</p>
              : <ul className="divide-y">{summary.offShiftReports.map((item) => (
                <li key={item.reportId} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span><span className="font-semibold">{machineLabel(item.machine)}</span><span className="block text-xs text-muted-foreground">{item.operator ?? "—"} · {formatDateTime(item.createdAt)}</span></span>
                  <a className="font-semibold text-primary underline-offset-4 hover:underline" href={`/reportes/${item.reportId}`}>{item.folio ?? "Abrir"}</a>
                </li>))}</ul>}
          </CardContent>
        </Card>
        <Card className={`gap-0 rounded-2xl py-4 ${conflicts ? "border-destructive/30" : ""}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold leading-none"><h2>Conflictos de sincronización</h2></CardTitle>
            <TriangleAlert className="h-4 w-4 text-warning-text" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums" data-kpi="OPEN_CONFLICTS">{conflicts ?? "—"}</div>
            <p className="mt-1 text-xs text-muted-foreground">Datos capturados sin conexión en revisión</p>
          </CardContent>
        </Card>
      </section>

      <Card className="gap-0 overflow-hidden rounded-2xl py-0">
        <CardHeader className="border-b py-5">
          <CardTitle><h2 className="text-base font-semibold leading-none">Reportes recientes</h2></CardTitle>
          <CardDescription>Últimos reportes con fecha operativa de hoy.</CardDescription>
        </CardHeader>
        {!summary?.recent ? <p className="p-8 text-center text-muted-foreground">{failed ? "No se pudieron cargar los reportes recientes." : "Cargando…"}</p>
          : summary.recent.length === 0 ? <p className="p-8 text-center text-muted-foreground">No hay reportes de producción para hoy.</p>
          : (
            <div className="overflow-x-auto" role="region" aria-label="Reportes recientes" tabIndex={0}>
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="p-3 font-medium">Folio</th><th className="p-3 font-medium">Fecha / hora</th><th className="p-3 font-medium">Máquina</th>
                  <th className="p-3 font-medium">Operario</th><th className="p-3 font-medium">Estado</th><th className="p-3 font-medium">Parada</th>
                </tr></thead>
                <tbody>{summary.recent.map((report) => (
                  <tr key={report.id} className="border-b last:border-0" data-report-id={report.id}>
                    <td className="p-3"><a className="font-mono font-semibold tabular-nums text-primary underline-offset-4 hover:underline" href={`/reportes/${report.id}`}>{report.folio}</a></td>
                    <td className="p-3 text-muted-foreground">{formatDateTime(report.createdAt)}</td>
                    <td className="p-3 font-semibold">{machineLabel(report.machine)}</td>
                    <td className="p-3">{report.operator || "—"}</td>
                    <td className="p-3"><div className="flex flex-wrap gap-1.5"><StatusBadge status={report.status} />{report.isOffShift && <Badge variant="stop">Abierto fuera de turno</Badge>}</div></td>
                    <td className="p-3">{report.activeStop ? <StopIndicator active /> : "—"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}
