import { useEffect, useRef, useState } from "react";
import { subscribeWithFallback, type LiveMode, type RealtimeChannelSpec, type SubscribeOptions } from "@/lib/realtime";

/**
 * Suscribe la isla a Realtime con respaldo por polling (T099). `refetch` se ejecuta tras cada evento (con debounce) y,
 * en modo respaldo, cada 8 s. Los canales y temporizadores se liberan al desmontar. Devuelve el modo actual.
 */
export function useLiveSubscription(
  channels: RealtimeChannelSpec[],
  refetch: () => void | Promise<void>,
  options: SubscribeOptions = {},
): LiveMode {
  const [mode, setMode] = useState<LiveMode>("connecting");
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const key = JSON.stringify(channels);

  useEffect(() => {
    const call = () => refetchRef.current();
    const subscription = subscribeWithFallback(JSON.parse(key) as RealtimeChannelSpec[], call, call, {
      ...optionsRef.current,
      onModeChange: (next) => { setMode(next); optionsRef.current.onModeChange?.(next); },
      accept: (payload) => optionsRef.current.accept?.(payload) ?? true,
    });
    return () => subscription.unsubscribe();
  }, [key]);

  return mode;
}
