import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NotificationItem } from "@/lib/notifications";

const absoluteFormat = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" });
const relativeFormat = new Intl.RelativeTimeFormat("es-CO", { numeric: "auto" });

/** Tiempo relativo en es-CO ("hace 5 minutos"); pasadas 7 días muestra la fecha. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (!Number.isFinite(diff)) return "";
  const seconds = Math.round(diff / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "ahora";
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relativeFormat.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return relativeFormat.format(Math.round(seconds / 86_400), "day");
  return absoluteFormat.format(new Date(iso));
}

type Props = {
  items: NotificationItem[];
  onRead: (id: string) => void;
  /** Se invoca al navegar a un recurso (p. ej. para cerrar el popover). */
  onNavigate?: () => void;
  className?: string;
};

export function NotificationList({ items, onRead, onNavigate, className }: Props) {
  return <ul className={cn("divide-y", className)} aria-live="polite">
    {items.map((item) => {
      const unread = !item.readAt;
      return <li key={item.id} className={cn("flex gap-3 px-4 py-3", unread && "bg-accent/40")}>
        <span aria-hidden="true" className={cn("mt-2 size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")} />
        <div className="min-w-0 flex-1">
          <a
            href={item.href}
            className="block text-sm font-semibold text-foreground hover:underline"
            onClick={() => { onRead(item.id); onNavigate?.(); }}
          >
            {item.title}
            {unread && <span className="sr-only"> (sin leer)</span>}
          </a>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
          <time dateTime={item.updatedAt} title={absoluteFormat.format(new Date(item.updatedAt))} className="mt-1 block text-xs text-muted-foreground">
            {formatRelativeTime(item.updatedAt)}
          </time>
        </div>
        {unread && <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={() => onRead(item.id)} aria-label={`Marcar como leída: ${item.title}`}>
          <Check className="size-4" />
        </Button>}
      </li>;
    })}
  </ul>;
}
