import type { NotificationItem, NotificationsPage } from "@/lib/notifications";

export type NotificationFilter = "all" | "unread";

export type NotificationsState = {
  items: NotificationItem[];
  count: number;
  cursor: string | null;
  snapshotAt: string | null;
  error: string;
  busy: boolean;
  loaded: boolean;
  online: boolean;
};

const initialState: NotificationsState = {
  items: [], count: 0, cursor: null, snapshotAt: null, error: "", busy: false, loaded: false, online: true,
};

const POLL_MS = 30_000;

/**
 * Store compartido por filtro. Un único polling por filtro mientras haya suscriptores
 * (campana y barra inferior comparten el store "all"). Lógica portada de NotificationCenter.
 */
function createNotificationStore(filter: NotificationFilter) {
  let state = initialState;
  const listeners = new Set<() => void>();
  let running = false;
  let controller: AbortController | null = null;
  let stopPolling: (() => void) | null = null;
  const pendingReads = new Set<string>();
  // Una mutación (marcar leída / todas) invalida cualquier respuesta de listado que ya estuviera en vuelo:
  // se descarta y se reejecuta una carga pendiente al terminar, para no pisar el estado optimista con datos viejos.
  let mutationEpoch = 0;
  let pendingRefresh: "replace" | "merge" | null = null;

  const set = (patch: Partial<NotificationsState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  async function fetchPage(nextCursor: string | null = null, mode: "replace" | "merge" = "replace") {
    if (!navigator.onLine) { set({ online: false }); return; }
    if (running) {
      // Solo las cargas de la primera página se encolan; "replace" prevalece sobre "merge".
      if (!nextCursor) pendingRefresh = pendingRefresh === "replace" || mode === "replace" ? "replace" : "merge";
      return;
    }
    running = true;
    const epoch = mutationEpoch;
    const current = new AbortController();
    controller = current;
    set({ online: true, busy: true, error: "" });
    try {
      const params = new URLSearchParams({ filter });
      if (nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(`/api/notifications?${params}`, { credentials: "same-origin", cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error("No fue posible cargar las notificaciones.");
      const result = await response.json() as NotificationsPage;
      if (current.signal.aborted) return;
      if (epoch !== mutationEpoch) { pendingRefresh = pendingRefresh === "replace" || mode === "replace" ? "replace" : "merge"; return; }
      const previous = state.items;
      let items: NotificationItem[];
      if (nextCursor) items = [...previous, ...result.items];
      else if (mode === "replace" || !previous.length) items = result.items;
      else {
        const seen = new Set(result.items.map((item) => item.id));
        items = [...result.items, ...previous.filter((item) => !seen.has(item.id))];
      }
      set({
        items,
        count: result.unreadCount,
        cursor: nextCursor || mode === "replace" || !state.cursor ? result.nextCursor : state.cursor,
        snapshotAt: nextCursor ? state.snapshotAt : result.snapshotAt,
        loaded: true,
      });
    } catch {
      if (!current.signal.aborted) set({ error: "No fue posible cargar las notificaciones. Intenta de nuevo.", loaded: true });
    } finally {
      if (controller === current) {
        running = false;
        set({ busy: false });
        const next = pendingRefresh;
        pendingRefresh = null;
        if (next) void fetchPage(null, next);
      }
    }
  }

  async function setRead(id: string) {
    if (!navigator.onLine || pendingReads.has(id) || !state.items.some((item) => item.id === id && !item.readAt)) return;
    pendingReads.add(id);
    set({ error: "" });
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: "PATCH", credentials: "same-origin", cache: "no-store", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: true }),
      });
      if (!response.ok) throw new Error();
      mutationEpoch++;
      set({
        items: filter === "unread"
          ? state.items.filter((item) => item.id !== id)
          : state.items.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item),
        count: Math.max(0, state.count - 1),
      });
      syncOthers(store);
    } catch { set({ error: "No fue posible marcar el aviso. Intenta de nuevo." }); }
    finally { pendingReads.delete(id); }
  }

  async function readAll() {
    if (!state.snapshotAt || !navigator.onLine) return;
    set({ error: "" });
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ before: state.snapshotAt }),
      });
      if (!response.ok) throw new Error();
      mutationEpoch++;
      await fetchPage();
      syncOthers(store);
    } catch { set({ error: "No fue posible marcar los avisos. Intenta de nuevo." }); }
  }

  const refresh = () => fetchPage(null, "merge");

  function start() {
    void fetchPage();
    const tick = () => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); };
    const offline = () => set({ online: false });
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);
    window.addEventListener("offline", offline);
    stopPolling = () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
      window.removeEventListener("offline", offline);
      controller?.abort();
      running = false;
      pendingRefresh = null;
      set({ busy: false });
    };
  }

  const store = {
    filter,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { stopPolling?.(); stopPolling = null; }
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initialState,
    isActive: () => listeners.size > 0,
    fetchPage, setRead, readAll, refresh,
  };
  return store;
}

export type NotificationStore = ReturnType<typeof createNotificationStore>;

const stores = new Map<NotificationFilter, NotificationStore>();

export function getNotificationStore(filter: NotificationFilter): NotificationStore {
  let store = stores.get(filter);
  if (!store) {
    store = createNotificationStore(filter);
    stores.set(filter, store);
  }
  return store;
}

/** Tras una mutación, refresca los demás stores activos para mantener coherentes los conteos. */
function syncOthers(origin: NotificationStore) {
  stores.forEach((store) => { if (store !== origin && store.isActive()) void store.refresh(); });
}

/** Solo para pruebas: descarta los stores en memoria. */
export function resetNotificationStores() {
  stores.clear();
}
