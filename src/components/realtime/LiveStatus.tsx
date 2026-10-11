import type { LiveMode } from "@/lib/realtime";

/** Indicador discreto del modo de actualización (contracts/realtime.md, Respaldo). */
export default function LiveStatus({ mode }: { mode: LiveMode }) {
  const label = mode === "live" ? "Actualización en vivo" : mode === "polling" ? "Actualización automática cada 8 s" : "Conectando…";
  return (
    <p role="status" aria-live="polite" data-live-mode={mode} className="text-xs text-muted-foreground">
      <span aria-hidden="true" className={`mr-1.5 inline-block size-2 rounded-full align-middle ${mode === "live" ? "bg-success" : mode === "polling" ? "bg-warning" : "bg-muted-foreground/50"}`} />
      {label}
    </p>
  );
}
