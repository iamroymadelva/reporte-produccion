import { useEffect } from "react";
import { CloudOff, CloudUpload, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { isConnectionDown, useConnectivityState, usePendingSummary } from "@/lib/offline/hooks";
import { offerSummary, startSyncMonitor } from "@/lib/offline/sync-client";

interface Props {
  /** Usuario autenticado. Sin él (p. ej. la sesión aún se resuelve) no hay indicador. */
  userId?: string | null;
  className?: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Indicador global (FR-014, T083): estado de conexión + número de pendientes, siempre visible. También vigila la
 * reconexión del usuario (aviso de pendientes al servidor y oferta del resumen) mientras esté montado.
 */
export default function OfflineIndicator({ userId, className }: Props) {
  const connection = useConnectivityState();
  const { summary } = usePendingSummary(userId);
  const down = isConnectionDown(connection);

  useEffect(() => {
    if (!userId) return;
    return startSyncMonitor(userId);
  }, [userId]);

  if (!userId) return null;
  const pending = summary?.pending ?? 0;
  const problems = summary?.problems.length ?? 0;
  const stale = Boolean(summary?.hasStale);
  const actionable = pending > 0 || problems > 0;

  const full = down
    ? `Sin conexión — guardado en este dispositivo · ${plural(pending, "pendiente", "pendientes")}`
    : pending > 0 ? `${plural(pending, "pendiente", "pendientes")} de subir` : problems > 0 ? `${plural(problems, "dato", "datos")} por revisar` : "En línea";
  const short = down ? `Sin conexión · ${pending}` : pending > 0 ? `${pending} por subir` : problems > 0 ? `${problems} por revisar` : "En línea";
  const staleNote = stale ? " · más de 7 días sin subir" : "";
  const Icon = down ? CloudOff : pending > 0 || problems > 0 ? CloudUpload : Wifi;
  const tone = stale || problems > 0
    ? "border-destructive/30 bg-destructive/10 text-destructive-text"
    : down || pending > 0
      ? "border-warning/30 bg-warning/15 text-warning-text"
      : "border-success/30 bg-success/10 text-success-text";

  const content = <>
    <Icon className="size-4 shrink-0" aria-hidden="true" />
    <span className="hidden sm:inline">{full}</span>
    <span className="sm:hidden">{short}</span>
    {stale && <span className="font-bold"><span aria-hidden="true">· +7 d</span><span className="sr-only">{staleNote}</span></span>}
  </>;
  const classes = cn(
    "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold leading-tight",
    tone,
    className,
  );

  return actionable ? (
    <button
      type="button"
      data-testid="offline-indicator"
      className={cn(classes, "cursor-pointer")}
      aria-label={`${full}${staleNote}. Abrir resumen de pendientes`}
      onClick={() => offerSummary(userId)}
    >{content}</button>
  ) : (
    <span data-testid="offline-indicator" role="status" aria-live="polite" className={classes}>{content}</span>
  );
}
