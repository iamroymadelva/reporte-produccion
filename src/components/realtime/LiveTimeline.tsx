import { useCallback, useRef, useState } from "react";
import LiveStatus from "./LiveStatus";
import { useLiveSubscription } from "./useLiveSubscription";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { RealtimeChannelSpec, SubscribeOptions } from "@/lib/realtime";
import { describeAuditRows, offlineBadgeLabel, type AuditCatalogs, type ReportAuditRow } from "@/lib/report-audit";

interface Props {
  reportId: string;
  initialAudit: ReportAuditRow[];
  initialStops: Array<{ id: string; started_at: string }>;
  /** Catálogos para nombrar los valores del historial: { campo: [[id, etiqueta], ...] }. */
  catalogs: Record<string, Array<[string, string]>>;
  initialError?: string | null;
  /** Solo para pruebas. */
  realtime?: SubscribeOptions;
  timelineUrl?: string;
}

/** Suscripciones por reporte (contracts/realtime.md, Detalle): reportes por `id`, el resto por `report_id`. */
export function timelineChannels(reportId: string): RealtimeChannelSpec[] {
  return [
    { name: `timeline-report-${reportId}`, table: "production_reports", filter: `id=eq.${reportId}` },
    { name: `timeline-stops-${reportId}`, table: "report_stop_events", filter: `report_id=eq.${reportId}` },
    { name: `timeline-changes-${reportId}`, table: "report_change_events", filter: `report_id=eq.${reportId}` },
    { name: `timeline-audit-${reportId}`, table: "report_audit_log", filter: `report_id=eq.${reportId}` },
  ];
}

/**
 * T103: historial en vivo para managers y auditores. Cada evento dispara un refetch de /api/reports/[id]/timeline
 * (el payload del evento no se renderiza); sin Realtime, polling cada 8 s.
 */
export default function LiveTimeline({ reportId, initialAudit, initialStops, catalogs, initialError = null, realtime = {}, timelineUrl }: Props) {
  const [audit, setAudit] = useState<ReportAuditRow[]>(initialAudit);
  const [stops, setStops] = useState(initialStops);
  const [error, setError] = useState<string | null>(initialError);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const url = timelineUrl ?? `/api/reports/${reportId}/timeline`;

  const load = useCallback(async () => {
    if (inFlight.current) { queued.current = true; return; }
    inFlight.current = true;
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { window.location.assign("/iniciar-sesion"); return; }
      if (!response.ok) { setError("No fue posible actualizar el historial; se reintentará."); return; }
      const body = await response.json() as { audit?: ReportAuditRow[]; stops?: Array<{ id: string; started_at: string }> };
      setAudit(body.audit ?? []);
      setStops(body.stops ?? []);
      setError(null);
    } catch {
      setError("No fue posible actualizar el historial; se reintentará.");
    } finally {
      inFlight.current = false;
      if (queued.current) { queued.current = false; void load(); }
    }
  }, [url]);

  const mode = useLiveSubscription(timelineChannels(reportId), load, { debounceMs: 500, ...realtime });
  const maps: AuditCatalogs = Object.fromEntries(Object.entries(catalogs).map(([key, pairs]) => [key, new Map(pairs)]));
  const entries = describeAuditRows(audit, { catalogs: maps, stops });

  return (
    <Card className="gap-0 rounded-2xl p-5" aria-labelledby="report-audit-title" data-live-timeline>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="report-audit-title" className="text-base font-semibold leading-none">Historial del reporte</h2>
        <LiveStatus mode={mode} />
      </div>
      {error && <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="mt-4 space-y-3" aria-live="polite">
        {entries.map((entry) => (
          <article key={String(entry.id ?? `${entry.changedAt}-${entry.title}`)} className="rounded-xl bg-muted/50 p-4 text-sm" data-audit-entry>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-bold text-foreground">{entry.title}{entry.stopNumber ? ` · Parada #${entry.stopNumber}` : ""}</h3>
              <time className="text-muted-foreground" dateTime={entry.changedAt}>{formatDateTime(entry.changedAt)}</time>
            </div>
            <p className="mt-1 text-muted-foreground"><span className="font-semibold text-foreground">Actor:</span> {entry.actor}{entry.actorRoleLabel ? ` · ${entry.actorRoleLabel}` : ""}</p>
            {entry.reason && <p className="mt-1 text-muted-foreground"><span className="font-semibold text-foreground">Motivo:</span> {entry.reason}</p>}
            {entry.capturedOffline && <p className="mt-2"><Badge variant="outline">{offlineBadgeLabel(entry)}</Badge></p>}
            <div className="mt-3 space-y-3">
              {entry.details.map((detail, index) => (
                <div key={index} className="grid gap-2 border-t border-border pt-3 min-[420px]:grid-cols-2">
                  <p className="font-semibold text-foreground min-[420px]:col-span-2">{detail.label}</p>
                  {detail.previous !== undefined && <dl><dt className="text-xs uppercase tracking-wide text-muted-foreground">Valor anterior</dt><dd className="mt-1 break-words text-foreground">{detail.previous}</dd></dl>}
                  {detail.next !== undefined && <dl><dt className="text-xs uppercase tracking-wide text-muted-foreground">Valor nuevo</dt><dd className="mt-1 break-words text-foreground">{detail.next}</dd></dl>}
                </div>
              ))}
            </div>
          </article>
        ))}
        {entries.length === 0 && <p className="text-sm text-muted-foreground">No hay movimientos registrados.</p>}
      </div>
    </Card>
  );
}
