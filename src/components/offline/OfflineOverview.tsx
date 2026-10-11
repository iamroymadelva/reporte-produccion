import { useCallback, useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import StatusBadge from "../StatusBadge";
import { formatDate } from "@/lib/format";
import { isConnectionDown, useConnectivityState } from "@/lib/offline/hooks";
import { NEEDS_CONNECTION_MESSAGE, getLocalSession } from "@/lib/offline/offline-auth";
import { fetchOverview, loadOverview, type OverviewRecord, type OverviewReport } from "@/lib/offline/overview";
import { forgetCurrentUser } from "@/lib/offline/snapshot";

/**
 * Consulta sin conexión (T094, FR-020): resumen de SOLO LECTURA para coordinadores, administradores raíz y auditores.
 * La página que la monta (`/consulta-offline`) es estática y no contiene datos; todo sale de IndexedDB (clave userId) o
 * de GET /api/offline/overview cuando hay conexión. Exportar, corregir, aprobar, cancelar y administrar requieren conexión.
 */
const WRONG_ROLE = "Esta consulta es solo para coordinadores y auditores.";
const NO_DATA = "Aún no hay datos descargados; conéctate para descargarlos";
const REQUIRES_CONNECTION = "Requiere conexión";
const CONTROLS = ["Exportar", "Corregir", "Aprobar", "Cancelar reporte", "Administración"];

type View =
  | { phase: "loading" }
  | { phase: "login" }
  | { phase: "forbidden"; message: string }
  | { phase: "no-data" }
  | { phase: "ready"; overview: OverviewRecord; fromNetwork: boolean };

const clock = new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Bogota" });
const dateTime = new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bogota" });
const hhmm = (iso: string) => clock.format(new Date(iso));
const isViewerOrManager = (role: string | undefined) => role === "ROOT" || role === "ADMINISTRATOR" || role === "VIEWER";

async function loadView(): Promise<View> {
  let response: Response | null = null;
  try {
    response = await fetch("/api/auth/session-info", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    response = null;
  }

  if (response) {
    if (response.status === 401) return { phase: "login" };
    if (response.status === 403) return { phase: "forbidden", message: "Tu usuario no está activo. Avisa a un coordinador." };
    if (response.ok) {
      const info = await response.json().catch(() => null) as { userId?: string; role?: string } | null;
      if (info?.userId) {
        if (!isViewerOrManager(info.role)) return { phase: "forbidden", message: WRONG_ROLE };
        const fetched = await fetchOverview(info.userId);
        if (fetched.status === "ok") return { phase: "ready", overview: fetched.overview, fromNetwork: true };
        if (fetched.status === "unauthorized") return { phase: "login" };
        if (fetched.status === "forbidden") return { phase: "forbidden", message: fetched.message };
        const stored = await loadOverview(info.userId);
        return stored ? { phase: "ready", overview: stored, fromNetwork: false } : { phase: "no-data" };
      }
    }
  }

  // Sin conexión (o sin respuesta útil): solo con la sesión local creada tras verificar la contraseña.
  const local = await getLocalSession();
  if (!local) return { phase: "login" };
  if (!isViewerOrManager(local.role)) return { phase: "forbidden", message: WRONG_ROLE };
  const stored = await loadOverview(local.userId);
  return stored ? { phase: "ready", overview: stored, fromNetwork: false } : { phase: "no-data" };
}

function Controls() {
  return (
    <section aria-label="Acciones que requieren conexión" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {CONTROLS.map((label) => (
          <Button key={label} type="button" variant="outline" size="sm" className="min-h-11" disabled title={REQUIRES_CONNECTION} aria-label={`${label}. ${REQUIRES_CONNECTION}`}>
            {label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{REQUIRES_CONNECTION}: exportar, corregir, aprobar, cancelar y administrar solo están disponibles con conexión.</p>
    </section>
  );
}

function ReportDetail({ report, onBack }: { report: OverviewReport; onBack: () => void }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <Button type="button" variant="ghost" className="min-h-11" onClick={onBack}>← Volver a la lista</Button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{report.folio ?? "Sin folio"}</h2>
          <StatusBadge status={report.status} />
          {report.is_off_shift && <Badge variant="outline">Fuera de turno</Badge>}
          {report.active_stop && <Badge variant="outline">Parada activa</Badge>}
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Máquina</dt><dd>{report.machine ? `${report.machine.code} · ${report.machine.name}` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Operario</dt><dd>{report.operator ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Fecha</dt><dd>{formatDate(report.report_date)}</dd></div>
          <div><dt className="text-muted-foreground">Orden de producción</dt><dd>{report.production_order ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Aprobado por</dt><dd>{report.approver ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Paradas</dt><dd>{report.stops_count} · {report.stops_minutes} min</dd></div>
        </dl>
        <section aria-label="Paradas">
          <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">Paradas</h3>
          {report.stops.length === 0 ? <p className="text-sm text-muted-foreground">Sin paradas.</p> : (
            <ul className="space-y-1 text-sm">
              {report.stops.map((stop) => (
                <li key={stop.id}>{stop.category ?? "Sin categoría"} · {dateTime.format(new Date(stop.started_at))} → {stop.ended_at ? dateTime.format(new Date(stop.ended_at)) : "en curso"}{stop.description ? ` · ${stop.description}` : ""}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Cambios">
          <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">Cambios</h3>
          {report.changes.length === 0 ? <p className="text-sm text-muted-foreground">Sin cambios.</p> : (
            <ul className="space-y-1 text-sm">
              {report.changes.map((change) => (
                <li key={change.id}>{change.type ?? "Cambio"} · {dateTime.format(new Date(change.occurred_at))}{change.description ? ` · ${change.description}` : ""}</li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

const KPI_LABELS: Array<[keyof OverviewRecord["kpis"], string]> = [
  ["DRAFT", "Reportes en curso"], ["SUBMITTED", "Reportes enviados"], ["CLOSED", "Reportes cerrados"],
  ["CANCELLED", "Reportes cancelados"], ["ACTIVE_STOP", "Reportes en parada"], ["OFF_SHIFT", "Fuera de turno"],
];

export default function OfflineOverview() {
  const [view, setView] = useState<View>({ phase: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const connection = useConnectivityState();
  const down = isConnectionDown(connection);

  const load = useCallback(() => {
    let active = true;
    void loadView().then((next) => {
      if (!active) return;
      setView(next);
    }, () => { if (active) setView({ phase: "no-data" }); });
    return () => { active = false; };
  }, []);
  useEffect(() => load(), [load]);

  const leave = async () => {
    await forgetCurrentUser();
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", redirect: "manual" }); } catch { /* sin conexión: solo se cierra la sesión local */ }
    window.location.assign("/iniciar-sesion");
  };

  const shell = (content: React.ReactNode) => (
    <main className="mx-auto max-w-4xl space-y-4 p-4" data-offline-overview>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Consulta sin conexión</h1>
        <div className="flex gap-2">
          <a className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium" href="/dashboard" data-astro-reload>Tablero en línea</a>
          {view.phase !== "login" && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void leave()}>Cerrar sesión</Button>}
        </div>
      </header>
      {content}
    </main>
  );

  if (view.phase === "loading") return shell(<p role="status" className="text-muted-foreground">Cargando consulta…</p>);
  if (view.phase === "login") {
    return shell(
      <Alert variant="warning">
        <AlertTitle>{NEEDS_CONNECTION_MESSAGE}</AlertTitle>
        <AlertDescription>
          Inicia sesión para ver la consulta. <a className="font-semibold underline" href="/iniciar-sesion" data-astro-reload>Iniciar sesión</a>
        </AlertDescription>
      </Alert>,
    );
  }
  if (view.phase === "forbidden") {
    return shell(<Alert variant="destructive"><AlertTitle>Consulta no disponible</AlertTitle><AlertDescription>{view.message}</AlertDescription></Alert>);
  }
  if (view.phase === "no-data") {
    return shell(<><Alert variant="info"><AlertDescription>{NO_DATA}</AlertDescription></Alert><Controls /></>);
  }

  const { overview } = view;
  const report = selected ? overview.reports.find((item) => item.id === selected) ?? null : null;
  return shell(
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm" role="status">
        {down && <WifiOff className="size-4" aria-hidden="true" />}
        <strong>Datos de {hhmm(overview.fetchedAt)}</strong>
        <span className="text-muted-foreground">{down ? "· sin conexión; solo lectura" : view.fromNetwork ? "· actualizado ahora" : "· último resumen guardado"}</span>
        {!down && <Button type="button" variant="outline" size="sm" className="ml-auto min-h-11" onClick={() => { setSelected(null); setView({ phase: "loading" }); load(); }}>Actualizar</Button>}
      </div>
      <Controls />
      {report ? <ReportDetail report={report} onBack={() => setSelected(null)} /> : (
        <>
          <section aria-label="Indicadores del día" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {KPI_LABELS.map(([key, label]) => (
              <Card key={key}><CardContent className="p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{overview.kpis[key]}</p></CardContent></Card>
            ))}
          </section>
          <section aria-label="Reportes recientes">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Últimos {overview.reports.length} reportes</h2>
            {overview.reports.length === 0 ? <p className="text-sm text-muted-foreground">No hay reportes en el resumen.</p> : (
              <ul className="space-y-2">
                {overview.reports.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card p-3 text-left text-sm hover:bg-muted" onClick={() => setSelected(item.id)}>
                      <span className="font-semibold">{item.folio ?? "Sin folio"}</span>
                      <StatusBadge status={item.status} />
                      <span>{item.machine ? `${item.machine.code} · ${item.machine.name}` : "—"}</span>
                      <span className="text-muted-foreground">{item.operator ?? "—"}</span>
                      {item.is_off_shift && <Badge variant="outline">Fuera de turno</Badge>}
                      {item.active_stop && <Badge variant="outline">Parada activa</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>,
  );
}
