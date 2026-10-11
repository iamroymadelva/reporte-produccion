import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getConnectivitySnapshot, subscribeConnectivity, type ConnectivityState } from "../connectivity";
import { subscribeOutbox } from "./outbox";
import { getPendingSummary, getSyncState, subscribeSyncState, type PendingSummary, type SyncUiState } from "./sync-client";

/** Estado de la interfaz de sincronización del usuario (resumen abierto, subiendo, sesión vencida...). */
export function useSyncState(userId: string | null | undefined): SyncUiState {
  return useSyncExternalStore(
    subscribeSyncState,
    () => getSyncState(userId ?? ""),
    () => getSyncState(userId ?? ""),
  );
}

export function useConnectivityState(): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>("online");
  useEffect(() => {
    setState(getConnectivitySnapshot().state);
    return subscribeConnectivity((snapshot) => setState(snapshot.state));
  }, []);
  return state;
}

export const isConnectionDown = (state: ConnectivityState) => state === "offline" || state === "unreachable";

/** Resumen de pendientes del usuario; se recalcula en cada cambio de la outbox o de la subida. */
export function usePendingSummary(userId: string | null | undefined): { summary: PendingSummary | null; refresh: () => void } {
  const [summary, setSummary] = useState<PendingSummary | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!userId) return;
    const unsubscribeOutbox = subscribeOutbox((changed) => { if (!changed || changed === userId) refresh(); });
    const unsubscribeState = subscribeSyncState(refresh);
    return () => { unsubscribeOutbox(); unsubscribeState(); };
  }, [userId, refresh]);

  useEffect(() => {
    if (!userId) { setSummary(null); return; }
    let active = true;
    getPendingSummary(userId).then((next) => { if (active) setSummary(next); }).catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [userId, tick]);

  return { summary, refresh };
}
