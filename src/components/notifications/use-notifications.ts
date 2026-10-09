import { useSyncExternalStore } from "react";
import { getNotificationStore, type NotificationFilter } from "./notification-store";

export type { NotificationFilter, NotificationsState } from "./notification-store";

/** Hook compartido: un único polling por filtro para campana, barra inferior y página. */
export function useNotifications(filter: NotificationFilter = "all") {
  const store = getNotificationStore(filter);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return {
    ...state,
    loadMore: () => store.fetchPage(state.cursor),
    retry: () => store.fetchPage(),
    refresh: store.refresh,
    markRead: store.setRead,
    markAllRead: store.readAll,
  };
}
