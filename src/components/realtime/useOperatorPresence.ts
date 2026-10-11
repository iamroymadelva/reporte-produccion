import { useEffect, useRef } from "react";
import { trackPresence, type PresencePayload, type RealtimeClientLike, type Timers } from "@/lib/realtime";

interface PresenceInput {
  userId: string;
  fullName: string;
  pendingCount: number;
}

/**
 * T102: el OPERATOR publica su presencia en `plant-presence` con `{userId, fullName, pendingCount,
 * lastSeen}` (mínimo: la máquina y el reporte se obtienen del servidor, nunca de este payload falsificable): al conectar, cada vez que cambia algún valor y cada 30 s. Sin conexión no hay canal (el servidor lo
 * mostrará "Sin conexión"). `enabled=false` desactiva la publicación (p. ej. en pruebas sin Realtime).
 */
export function useOperatorPresence(input: PresenceInput, options: { enabled?: boolean; client?: RealtimeClientLike; timers?: Timers; heartbeatMs?: number } = {}) {
  const enabled = options.enabled ?? true;
  const latest = useRef(input);
  latest.current = input;
  const tracker = useRef<ReturnType<typeof trackPresence> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const handle = trackPresence(
      (): PresencePayload => ({ ...latest.current, lastSeen: new Date().toISOString() }),
      { client: options.client, timers: options.timers, heartbeatMs: options.heartbeatMs },
    );
    tracker.current = handle;
    return () => { handle.stop(); tracker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, input.userId]);

  useEffect(() => { tracker.current?.update(); }, [input.pendingCount, input.fullName]);
}
