import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificationList } from "./NotificationList";
import { useNotifications, type NotificationFilter } from "./use-notifications";

function Inbox({ filter }: { filter: NotificationFilter }) {
  const { items, count, cursor, error, busy, loaded, online, markRead, markAllRead, retry, loadMore } = useNotifications(filter);
  const loading = busy && !items.length;

  return <section aria-label="Bandeja de notificaciones" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <p className="text-sm text-muted-foreground">{online ? `${count} sin leer` : "Sin conexión"}</p>
      {count > 0 && online && <Button variant="ghost" size="sm" type="button" onClick={() => void markAllRead()}>Marcar todas como leídas</Button>}
    </div>
    {!online && <p role="status" className="m-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">Conéctate para consultar y marcar notificaciones.</p>}
    {error && <div role="alert" className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-text">
      {error} <button type="button" className="font-medium underline" onClick={() => void retry()}>Reintentar</button>
    </div>}
    {loading ? <div className="space-y-4 p-4" role="status" aria-label="Cargando notificaciones">
      {[0, 1, 2].map((row) => <div key={row} className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-full" /></div>)}
    </div> : <NotificationList items={items} onRead={(id) => void markRead(id)} />}
    {loaded && !loading && !items.length && !error && <p className="p-8 text-center text-sm text-muted-foreground">No hay notificaciones {filter === "unread" ? "sin leer" : "todavía"}.</p>}
    {cursor && <div className="border-t p-3 text-center">
      <Button type="button" variant="outline" onClick={() => void loadMore()} disabled={busy}>Cargar más</Button>
    </div>}
  </section>;
}

export default function NotificationsPanel() {
  const [tab, setTab] = useState<NotificationFilter>("all");
  return <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationFilter)} className="gap-4">
    <TabsList>
      <TabsTrigger value="all">Todas</TabsTrigger>
      <TabsTrigger value="unread">No leídas</TabsTrigger>
    </TabsList>
    <TabsContent value="all"><Inbox filter="all" /></TabsContent>
    <TabsContent value="unread"><Inbox filter="unread" /></TabsContent>
  </Tabs>;
}
