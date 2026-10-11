import { useCallback, useRef } from "react";
import LiveStatus from "./LiveStatus";
import { useLiveSubscription } from "./useLiveSubscription";
import type { RealtimeChannelSpec, SubscribeOptions } from "@/lib/realtime";
import { rowMayMatchReportFilters, type ReportFilters } from "@/lib/report-filters";

interface Props {
  filters: ReportFilters;
  /** Id del contenedor del listado que se reemplaza (renderizado por el servidor, sin islas dentro). */
  containerId?: string;
  /** Solo para pruebas. */
  realtime?: SubscribeOptions;
  pageUrl?: string;
}

export const LIST_CHANNELS: RealtimeChannelSpec[] = [
  { name: "list-reports", table: "production_reports" },
  // El indicador de parada del listado depende de las paradas, que no tocan la fila del reporte.
  { name: "list-stops", table: "report_stop_events" },
];

/**
 * T101: refresca la página actual del listado cuando llega un evento que podría afectar a los filtros activos
 * (debounce de 1 s). Re-pide el HTML de la misma URL (que aplica rol, filtros y RLS en el servidor, sin cache) y
 * reemplaza solo el contenedor del listado; el payload del evento nunca se renderiza.
 */
export default function LiveReportList({ filters, containerId = "report-list-live", realtime = {}, pageUrl }: Props) {
  const inFlight = useRef(false);
  const queued = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) { queued.current = true; return; }
    inFlight.current = true;
    try {
      const response = await fetch(pageUrl ?? `${window.location.pathname}${window.location.search}`, {
        credentials: "same-origin", cache: "no-store", headers: { Accept: "text/html" }, redirect: "manual",
      });
      if (!response.ok) return; // sesión vencida o redirección: la navegación normal se encarga
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const next = doc.getElementById(containerId);
      const current = document.getElementById(containerId);
      if (next && current) current.innerHTML = next.innerHTML;
    } catch { /* sin red: el siguiente evento o ciclo reintenta */ } finally {
      inFlight.current = false;
      if (queued.current) { queued.current = false; void refresh(); }
    }
  }, [containerId, pageUrl]);

  const mode = useLiveSubscription(LIST_CHANNELS, refresh, {
    debounceMs: 1_000,
    accept: (payload) => rowMayMatchReportFilters(filters, payload),
    ...realtime,
  });
  return <LiveStatus mode={mode} />;
}
