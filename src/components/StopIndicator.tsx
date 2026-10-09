import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STOP_ACTIVE_LABEL, STOP_IDLE_LABEL } from "../lib/report-status";

interface Props {
  /** true cuando el reporte tiene una parada activa (ver hasActiveStop). */
  active: boolean;
  variant?: "badge" | "inline";
  /** Permite que el script de reportes/[id] actualice el indicador al cambiar las paradas. */
  reportId?: string;
  /** El indicador está sobre el chip del reporte actual (fondo primario). */
  current?: boolean;
  className?: string;
}

/**
 * Indicador de parada de máquina. "badge" para tablas y encabezados, "inline" para
 * listas compactas. Conserva data-stop-report-id / data-current-report para el script
 * de reportes/[id].astro, que alterna data-active y el texto de [data-stop-label].
 */
export default function StopIndicator({ active, variant = "badge", reportId, current = false, className }: Props) {
  const label = active ? STOP_ACTIVE_LABEL : STOP_IDLE_LABEL;
  const dataAttributes = {
    "data-stop-report-id": reportId,
    "data-current-report": reportId ? String(current) : undefined,
    "data-active": String(active),
  };

  if (variant === "badge") {
    return (
      <Badge
        variant={active ? "stop" : "submitted"}
        className={cn(!active && "before:size-1.5 before:rounded-full before:bg-current before:content-['']", className)}
        {...dataAttributes}
      >
        <span data-stop-label>{label}</span>
      </Badge>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold",
        "data-[active=true]:data-[current-report=false]:text-stop-text",
        "data-[active=false]:data-[current-report=false]:text-success-text",
        "data-[current-report=true]:text-primary-foreground",
        className,
      )}
      {...dataAttributes}
      data-current-report={reportId ? String(current) : "false"}
    >
      <span className="size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
      <span data-stop-label>{label}</span>
    </span>
  );
}
