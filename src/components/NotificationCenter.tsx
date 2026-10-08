import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { NotificationItem, NotificationsPage } from "@/lib/notifications";

type Filter = "all" | "unread";

export default function NotificationCenter({ mode = "bell" }: { mode?: "bell" | "page" }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [count, setCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const running = useRef(false);
  const request = useRef<AbortController | null>(null);
  const requestFilter = useRef<Filter>("all");
  const pendingReads = useRef(new Set<string>());

  const fetchPage = useCallback(async (nextCursor: string | null = null, mode: "replace" | "merge" = "replace") => {
    if (!navigator.onLine) { setOnline(false); return; }
    if (requestFilter.current !== filter) {
      request.current?.abort();
      requestFilter.current = filter;
      running.current = false;
    }
    if (running.current) return;
    running.current = true;
    const controller = new AbortController();
    request.current = controller;
    setOnline(true);
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ filter });
      if (nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(`/api/notifications?${params}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("No fue posible cargar las notificaciones.");
      const result = await response.json() as NotificationsPage;
      if (controller.signal.aborted) return;
      setItems((previous) => {
        if (nextCursor) return [...previous, ...result.items];
        if (mode === "replace" || !previous.length) return result.items;
        const seen = new Set(result.items.map((item) => item.id));
        return [...result.items, ...previous.filter((item) => !seen.has(item.id))];
      });
      setCount(result.unreadCount);
      setCursor((previous) => nextCursor || mode === "replace" || !previous ? result.nextCursor : previous);
      if (!nextCursor) setSnapshotAt(result.snapshotAt);
    } catch {
      if (!controller.signal.aborted) setError("No fue posible cargar las notificaciones. Intenta de nuevo.");
    } finally {
      if (request.current === controller) {
        running.current = false;
        setBusy(false);
      }
    }
  }, [filter]);

  useEffect(() => {
    void fetchPage();
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine) void fetchPage(null, "merge"); };
    const offline = () => setOnline(false);
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
    };
  }, [fetchPage]);

  const setRead = async (id: string) => {
    if (!navigator.onLine || pendingReads.current.has(id) || !items.some((item) => item.id === id && !item.readAt)) return;
    pendingReads.current.add(id);
    setError("");
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: true }),
      });
      if (!response.ok) throw new Error();
      setItems((previous) => filter === "unread" ? previous.filter((item) => item.id !== id) : previous.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
      setCount((previous) => Math.max(0, previous - 1));
    } catch { setError("No fue posible marcar el aviso. Intenta de nuevo."); }
    finally { pendingReads.current.delete(id); }
  };

  const readAll = async () => {
    if (!snapshotAt || !navigator.onLine) return;
    setError("");
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ before: snapshotAt }),
      });
      if (!response.ok) throw new Error();
      await fetchPage();
    } catch { setError("No fue posible marcar los avisos. Intenta de nuevo."); }
  };

  const content = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-950">Notificaciones</h2>
          <p className="text-sm text-slate-600">{online ? `${count} sin leer` : "Sin conexión"}</p>
        </div>
        {count > 0 && online && <Button variant="ghost" size="sm" type="button" onClick={() => void readAll()}>Marcar todas</Button>}
      </div>
      {!online && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Conéctate para consultar y marcar notificaciones.</p>}
      {mode === "page" && <div className="flex gap-2" role="group" aria-label="Filtrar notificaciones">
        {(["all", "unread"] as const).map((value) => <Button key={value} type="button" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)} aria-pressed={filter === value}>{value === "all" ? "Todas" : "No leídas"}</Button>)}
      </div>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error} <button type="button" className="underline" onClick={() => void fetchPage()}>Reintentar</button></div>}
      <ul className="divide-y divide-slate-200" aria-live="polite">
        {items.map((item) => <li key={item.id} className="flex gap-2 py-3">
          <div className="min-w-0 flex-1">
            <a href={item.href} className="font-semibold text-brand-800 hover:underline">{item.title}</a>
            <p className="text-sm text-slate-700">{item.body}</p>
            <time dateTime={item.updatedAt} className="text-xs text-slate-500">{new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(item.updatedAt))}</time>
          </div>
          {!item.readAt && <button type="button" onClick={() => void setRead(item.id)} className="grid size-11 shrink-0 place-items-center rounded-lg text-brand-800 hover:bg-brand-50" aria-label={`Marcar como leída: ${item.title}`}><Check className="size-4" /></button>}
        </li>)}
      </ul>
      {!busy && !items.length && !error && <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-600">No hay notificaciones {filter === "unread" ? "sin leer" : "todavía"}.</p>}
      {busy && <p role="status" className="text-sm text-slate-600">Cargando notificaciones…</p>}
      {mode === "page" && cursor && <Button type="button" variant="outline" onClick={() => void fetchPage(cursor)} disabled={busy}>Cargar más</Button>}
      {mode === "bell" && <a className="block border-t pt-3 text-center font-semibold text-brand-800 hover:underline" href="/notificaciones">Ver todas</a>}
    </div>
  );

  if (mode === "page") return <section className="rounded-xl border bg-white p-4 shadow-sm sm:p-6" aria-label="Bandeja de notificaciones">{content}</section>;
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) void fetchPage(null, "merge"); }}>
    <PopoverTrigger asChild><button type="button" className="relative grid size-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" aria-label={online ? `Notificaciones, ${count} sin leer` : "Notificaciones sin conexión"}>
      <Bell className="size-5" aria-hidden="true" />{online && count > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-700 px-1 text-center text-xs font-bold text-white">{count > 99 ? "99+" : count}</span>}
    </button></PopoverTrigger>
    <PopoverContent align="end" className="max-h-[min(70vh,34rem)] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-4">{content}</PopoverContent>
  </Popover>;
}
