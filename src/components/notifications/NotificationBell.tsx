import { useState } from "react";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationList } from "./NotificationList";
import { useNotifications } from "./use-notifications";

export function NotificationBell() {
  const { items, count, error, busy, loaded, online, markRead, markAllRead, retry, refresh } = useNotifications("all");
  const [open, setOpen] = useState(false);
  const loading = busy && !items.length;

  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) void refresh(); }}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="relative size-11 md:size-9" aria-label={online ? `Notificaciones, ${count} sin leer` : "Notificaciones sin conexión"}>
        <Bell className="size-5" aria-hidden="true" />
        {online && count > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{count > 99 ? "99+" : count}</span>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Notificaciones</h2>
          <p className="text-xs text-muted-foreground">{online ? `${count} sin leer` : "Sin conexión"}</p>
        </div>
        {count > 0 && online && <Button variant="ghost" size="sm" className="min-h-11" type="button" onClick={() => void markAllRead()}>Marcar todas como leídas</Button>}
      </div>
      {!online && <p role="status" className="m-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">Conéctate para consultar y marcar notificaciones.</p>}
      {error && <div role="alert" className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-text">
        {error} <button type="button" className="font-medium underline" onClick={() => void retry()}>Reintentar</button>
      </div>}
      <ScrollArea className="max-h-[min(60vh,24rem)]">
        {loading ? <div className="space-y-3 p-4" role="status" aria-label="Cargando notificaciones">
          {[0, 1, 2].map((row) => <div key={row} className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></div>)}
        </div> : <NotificationList items={items} onRead={(id) => void markRead(id)} onNavigate={() => setOpen(false)} />}
        {loaded && !loading && !items.length && !error && <p className="p-6 text-center text-sm text-muted-foreground">No hay notificaciones todavía.</p>}
      </ScrollArea>
      <div className="border-t p-2 text-center">
        <a href="/notificaciones" className="block rounded-md py-2 text-sm font-medium text-primary hover:bg-accent" onClick={() => setOpen(false)}>Ver todas</a>
      </div>
    </PopoverContent>
  </Popover>;
}

export default NotificationBell;
