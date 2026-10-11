import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isConnectionDown, useConnectivityState, usePendingSummary, useSyncState } from "@/lib/offline/hooks";
import { discardOperation } from "@/lib/offline/outbox";
import { resolveCurrentUser } from "@/lib/offline/snapshot";
import { confirmAndUpload, postpone, startSyncMonitor, type PendingSummary, type UploadOutcome } from "@/lib/offline/sync-client";
import type { OperationType, OutboxOperation } from "@/lib/offline/types";

interface Props {
  /** Usuario autenticado. Si falta (página /turno), se resuelve con el snapshot local. */
  userId?: string | null;
}

const TYPE_LABELS: Record<OperationType, string> = {
  CREATE_REPORT: "Inicio de reporte", SAVE_REPORT_FIELDS: "Datos de producción", START_STOP: "Inicio de parada",
  CLOSE_STOP: "Cierre de parada", SET_STOP_CATEGORY: "Cambio de categoría de parada", CANCEL_STOP: "Cancelación de parada",
  ADD_CHANGE: "Cambio registrado", SUBMIT_REPORT: "Envío del reporte", CANCEL_REPORT: "Cancelación del reporte",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function formatAge(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "menos de 1 minuto";
  if (minutes < 60) return plural(minutes, "minuto", "minutos");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, "hora", "horas");
  return plural(Math.floor(hours / 24), "día", "días");
}

export function countLines(counts: PendingSummary["counts"]) {
  const lines: string[] = [];
  const add = (count: number, one: string, many: string) => { if (count > 0) lines.push(plural(count, one, many)); };
  add(counts.reportsNew, "reporte nuevo", "reportes nuevos");
  add(counts.fieldSaves, "guardado de datos de producción", "guardados de datos de producción");
  add(counts.stopsStarted, "parada iniciada", "paradas iniciadas");
  add(counts.stopsClosed, "parada cerrada", "paradas cerradas");
  add(counts.categoryChanges, "cambio de categoría de parada", "cambios de categoría de parada");
  add(counts.stopsCancelled, "parada cancelada", "paradas canceladas");
  add(counts.changes, "cambio de producción", "cambios de producción");
  add(counts.submits, "envío de reporte", "envíos de reporte");
  add(counts.reportCancels, "cancelación de reporte", "cancelaciones de reporte");
  return lines;
}

function outcomeAlert(outcome: UploadOutcome | null) {
  if (!outcome || outcome.status === "nothing") return null;
  if (outcome.status === "complete" && outcome.conflicts + outcome.rejected === 0) {
    return { variant: "success" as const, title: "Datos subidos", text: `Se subieron ${plural(outcome.applied + outcome.duplicates, "operación", "operaciones")} correctamente.` };
  }
  if (outcome.status === "complete") {
    return { variant: "warning" as const, title: "Subida terminada con avisos", text: "Algunos datos no se pudieron aplicar. Revisa abajo; siguen guardados en este dispositivo." };
  }
  if (outcome.status === "partial" || outcome.status === "network-error") {
    return { variant: "warning" as const, title: "Subida interrumpida", text: `Se subieron ${outcome.applied + outcome.duplicates}; quedan ${outcome.remaining} pendientes en este dispositivo. Puedes reintentar.` };
  }
  return { variant: "destructive" as const, title: "No se pudo subir", text: outcome.message ?? "Intenta de nuevo." };
}

function ProblemItem({ operation, onDiscard }: { operation: OutboxOperation; onDiscard: (operation: OutboxOperation) => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="rounded-lg border p-3 text-sm" data-testid="sync-problem">
      <p className="font-semibold">{TYPE_LABELS[operation.type]} · {operation.state === "conflict" ? "En conflicto" : "Rechazado"}</p>
      <p className="mt-1 text-muted-foreground">{operation.resultMessage ?? "El servidor no pudo aplicar esta operación."}</p>
      <p className="mt-1 text-xs text-muted-foreground">Capturado: {new Date(operation.capturedAt).toLocaleString("es-CO")}</p>
      {confirming ? (
        <div className="mt-3 space-y-2">
          <p className="font-semibold text-destructive-text">¿Descartar estos datos de este dispositivo? Esta acción no se puede deshacer.</p>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" size="sm" className="min-h-11" onClick={() => onDiscard(operation)}>Sí, descartar</Button>
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setConfirming(false)}>Conservar</Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="mt-3 min-h-11" onClick={() => setConfirming(true)}>Descartar…</Button>
      )}
    </li>
  );
}

/**
 * Resumen de pendientes (T083, FR-016): contadores por tipo, antigüedad, aviso de más de 7 días y los resultados de
 * conflicto o rechazo. "Confirmar y subir" es la ÚNICA vía para subir; "Posponer" conserva todo.
 */
export default function PendingSyncSummary({ userId: userIdProp }: Props) {
  const [resolved, setResolved] = useState<string | null>(null);
  const userId = userIdProp ?? resolved;
  const connection = useConnectivityState();
  const state = useSyncState(userId);
  const { summary } = usePendingSummary(userId);
  const down = isConnectionDown(connection);
  const [error, setError] = useState("");

  useEffect(() => {
    if (userIdProp) return;
    let active = true;
    void resolveCurrentUser().then((current) => { if (active && current.status === "ok") setResolved(current.userId); });
    return () => { active = false; };
  }, [userIdProp]);

  useEffect(() => {
    if (!userId) return;
    return startSyncMonitor(userId);
  }, [userId]);

  if (!userId || !summary) return null;
  const open = state.offerOpen && (summary.pending > 0 || summary.problems.length > 0 || state.lastOutcome !== null);
  const lines = countLines(summary.counts);
  const result = outcomeAlert(state.lastOutcome);

  const upload = async () => {
    setError("");
    try {
      await confirmAndUpload(userId);
    } catch {
      setError("No fue posible subir. Tus datos siguen guardados en este dispositivo.");
    }
  };
  const discard = async (operation: OutboxOperation) => {
    try { await discardOperation(userId, operation.operationId, { confirmed: true }); }
    catch { setError("No fue posible descartar esta operación."); }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) postpone(userId); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[min(calc(100vw-1rem),34rem)] overflow-y-auto" data-testid="pending-sync-summary">
        <DialogHeader>
          <DialogTitle>Datos pendientes de subir</DialogTitle>
          <DialogDescription>
            Nada se sube sin tu confirmación. Revisa el resumen y elige «Confirmar y subir» cuando estés listo.
          </DialogDescription>
        </DialogHeader>

        {summary.hasStale && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Pendientes con más de {formatAge(summary.staleThresholdMs)}</AlertTitle>
            <AlertDescription>Hay datos sin subir desde hace mucho. Súbelos cuanto antes: pueden quedar en revisión del coordinador.</AlertDescription>
          </Alert>
        )}
        {state.authRequired && (
          <Alert variant="warning" role="alert">
            <AlertTitle>Tu sesión venció</AlertTitle>
            <AlertDescription>
              Tus datos siguen guardados aquí. <a className="font-semibold underline" href="/iniciar-sesion" data-astro-reload>Inicia sesión</a> para subirlos.
            </AlertDescription>
          </Alert>
        )}
        {state.loginRequired && !state.inactive && (
          <Alert variant="warning" role="alert" data-testid="login-required">
            <AlertTitle>Inicia sesión en línea para subir</AlertTitle>
            <AlertDescription>
              {state.message} <a className="font-semibold underline" href="/iniciar-sesion?reauth=1" data-astro-reload>Iniciar sesión</a>
            </AlertDescription>
          </Alert>
        )}
        {state.inactive && (
          <Alert variant="destructive" role="alert" data-testid="session-closed">
            <AlertTitle>Sesión cerrada</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
        {state.forbidden && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>No se puede sincronizar</AlertTitle>
            <AlertDescription>Tu usuario no tiene permiso para subir. Tus datos siguen guardados en este dispositivo; avisa a tu coordinador.</AlertDescription>
          </Alert>
        )}
        {down && (
          <Alert variant="info" role="status">
            <AlertDescription>Sin conexión. Podrás subir cuando vuelva la conexión.</AlertDescription>
          </Alert>
        )}

        {summary.pending > 0 ? (
          <section aria-label="Pendientes">
            <ul className="list-inside list-disc space-y-1 text-base" data-testid="sync-counts">
              {lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
            {summary.oldestAgeMs !== null && (
              <p className="mt-3 text-sm text-muted-foreground">La captura más antigua es de hace {formatAge(summary.oldestAgeMs)}.</p>
            )}
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">No hay datos pendientes de subir.</p>
        )}

        {result && (
          <Alert variant={result.variant} role="status">
            <AlertTitle>{result.title}</AlertTitle>
            <AlertDescription>{result.text}</AlertDescription>
          </Alert>
        )}
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}

        {summary.problems.length > 0 && (
          <section aria-label="Datos por revisar">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Por revisar ({summary.problems.length})</h3>
            <ul className="space-y-2">
              {summary.problems.map((operation) => <ProblemItem key={operation.operationId} operation={operation} onDiscard={(item) => void discard(item)} />)}
            </ul>
          </section>
        )}

        <DialogFooter className="gap-2 sm:flex-row">
          <Button type="button" variant="outline" size="lg" onClick={() => postpone(userId)}>{summary.pending === 0 ? "Cerrar" : "Posponer"}</Button>
          <Button type="button" size="lg" aria-busy={state.uploading} disabled={summary.pending === 0 || down || state.uploading || state.forbidden || state.loginRequired || state.inactive} onClick={() => void upload()}>
            {state.uploading ? "Subiendo…" : "Confirmar y subir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
