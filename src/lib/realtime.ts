import { getBrowserSupabase } from "./supabase/browser";

/**
 * Tiempo real (contracts/realtime.md, SC-005): suscripción a postgres_changes con respaldo por polling.
 * El payload del evento NUNCA se renderiza: solo dispara la recarga del fragmento autorizado (endpoint /api).
 * Si la suscripción no llega a SUBSCRIBED en 5 s, o pasa a CHANNEL_ERROR/TIMED_OUT, se consulta cada 8 s hasta reconectar.
 */
export const SUBSCRIBE_TIMEOUT_MS = 5_000;
export const POLL_INTERVAL_MS = 8_000;
export const PRESENCE_HEARTBEAT_MS = 30_000;
export const PRESENCE_CHANNEL = "plant-presence";

export type LiveMode = "connecting" | "live" | "polling";

export interface RealtimeChannelSpec {
  /** Nombre del canal de Realtime (único por suscripción). */
  name: string;
  table: string;
  schema?: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  /** Filtro de postgres_changes, p. ej. `report_id=eq.<uuid>`. */
  filter?: string;
}

/** Subconjunto del cliente de Supabase que necesita este módulo (permite simularlo en las pruebas). */
export interface RealtimeChannelLike {
  on(type: string, filter: Record<string, unknown>, callback: (payload: unknown) => void): RealtimeChannelLike;
  subscribe(callback?: (status: string, error?: unknown) => void): unknown;
  track?(payload: Record<string, unknown>): unknown;
  presenceState?(): Record<string, unknown[]>;
}
export interface RealtimeClientLike {
  channel(name: string, options?: Record<string, unknown>): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): unknown;
  auth?: { getSession(): Promise<{ data: { session: { access_token?: string } | null } }> };
  realtime?: { setAuth?(token?: string | null): unknown };
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}
const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as never),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as never),
};

export interface SubscribeOptions {
  client?: RealtimeClientLike;
  /** Espera entre el último evento y la recarga (500 ms tablero, 1 s listas). */
  debounceMs?: number;
  subscribeTimeoutMs?: number;
  pollIntervalMs?: number;
  onModeChange?: (mode: LiveMode) => void;
  /** Filtra los eventos (p. ej. por los filtros activos de la lista); por omisión todos cuentan. El payload nunca se renderiza. */
  accept?: (payload: unknown) => boolean;
  timers?: Timers;
}

export interface LiveSubscription {
  unsubscribe(): void;
  mode(): LiveMode;
}

/** Aplica el token de la sesión al socket de Realtime antes de unirse a los canales (RLS de postgres_changes). */
export async function ensureRealtimeAuth(client: RealtimeClientLike) {
  try {
    const { data } = (await client.auth?.getSession()) ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (token) await client.realtime?.setAuth?.(token);
  } catch { /* sin sesión local: Realtime rechazará el canal y entrará el polling */ }
}

/**
 * Suscribe `channels` a postgres_changes. Cada evento (con debounce) llama a `onChange`; mientras no haya conexión
 * en vivo, `pollFn` se ejecuta al entrar al respaldo y luego cada 8 s. Al volver a SUBSCRIBED el polling se detiene y se
 * hace una recarga final (para recuperar lo ocurrido mientras tanto). `unsubscribe` elimina canales y temporizadores.
 */
export function subscribeWithFallback(
  channels: RealtimeChannelSpec[],
  onChange: () => void,
  pollFn: () => void | Promise<void>,
  options: SubscribeOptions = {},
): LiveSubscription {
  const timers = options.timers ?? realTimers;
  const debounceMs = options.debounceMs ?? 500;
  const subscribeTimeoutMs = options.subscribeTimeoutMs ?? SUBSCRIBE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  let client: RealtimeClientLike | null = null;
  let disposed = false;
  let mode: LiveMode = "connecting";
  let debounceTimer: unknown = null;
  let timeoutTimer: unknown = null;
  let pollTimer: unknown = null;
  const created: RealtimeChannelLike[] = [];
  const healthy = new Set<string>();

  const setMode = (next: LiveMode) => {
    if (mode === next) return;
    mode = next;
    options.onModeChange?.(next);
  };
  const runPoll = () => { try { void Promise.resolve(pollFn()).catch(() => undefined); } catch { /* el siguiente ciclo reintenta */ } };
  const startPolling = () => {
    if (disposed || pollTimer !== null) return;
    setMode("polling");
    runPoll();
    pollTimer = timers.setInterval(runPoll, pollIntervalMs);
  };
  const stopPolling = () => {
    if (pollTimer !== null) { timers.clearInterval(pollTimer); pollTimer = null; }
  };
  const clearTimeoutTimer = () => {
    if (timeoutTimer !== null) { timers.clearTimeout(timeoutTimer); timeoutTimer = null; }
  };
  const schedule = () => {
    if (disposed) return;
    if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
    debounceTimer = timers.setTimeout(() => { debounceTimer = null; if (!disposed) onChange(); }, debounceMs);
  };
  const onStatus = (name: string, status: string) => {
    if (disposed) return;
    if (status === "SUBSCRIBED") {
      healthy.add(name);
      if (healthy.size === channels.length) {
        const recovered = mode === "polling";
        clearTimeoutTimer();
        stopPolling();
        setMode("live");
        if (recovered) schedule();
      }
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      healthy.delete(name);
      clearTimeoutTimer();
      startPolling();
    }
  };

  // Si en 5 s no están todas las suscripciones, se usa el respaldo (el cliente sigue intentando unirse).
  timeoutTimer = timers.setTimeout(() => { timeoutTimer = null; if (healthy.size < channels.length) startPolling(); }, subscribeTimeoutMs);

  void (async () => {
    try {
      client = options.client ?? (getBrowserSupabase() as unknown as RealtimeClientLike);
      await ensureRealtimeAuth(client);
    } catch {
      startPolling();
      return;
    }
    if (disposed) return;
    try {
    for (const spec of channels) {
      const channel = client.channel(spec.name);
      created.push(channel);
      channel
        .on("postgres_changes", { event: spec.event ?? "*", schema: spec.schema ?? "public", table: spec.table, ...(spec.filter ? { filter: spec.filter } : {}) }, (payload) => { if (!options.accept || options.accept(payload)) schedule(); })
        .subscribe((status) => onStatus(spec.name, status));
    }
    } catch {
      startPolling();
    }
  })();

  return {
    mode: () => mode,
    unsubscribe() {
      if (disposed) return;
      disposed = true;
      clearTimeoutTimer();
      stopPolling();
      if (debounceTimer !== null) { timers.clearTimeout(debounceTimer); debounceTimer = null; }
      for (const channel of created) { try { void client?.removeChannel(channel); } catch { /* ya cerrado */ } }
      created.length = 0;
    },
  };
}

/* ------------------------------------------------------------------ Presencia (plant-presence) */

export interface PresencePayload {
  userId: string;
  fullName: string;
  pendingCount: number;
  lastSeen: string;
}

export type PresenceStatus = "ONLINE" | "ONLINE_PENDING" | "OFFLINE";

export function presenceStatus(payload: Pick<PresencePayload, "pendingCount"> | null | undefined): PresenceStatus {
  if (!payload) return "OFFLINE";
  return payload.pendingCount > 0 ? "ONLINE_PENDING" : "ONLINE";
}

export const presenceLabels: Record<PresenceStatus, string> = {
  ONLINE: "En línea",
  ONLINE_PENDING: "En línea con pendientes",
  OFFLINE: "Sin conexión",
};

/** Aplana `presenceState()` ({ clave: [payload, ...] }) en una lista de payloads, el más reciente por usuario. */
export function flattenPresence(state: Record<string, unknown[]> | undefined): PresencePayload[] {
  const byUser = new Map<string, PresencePayload>();
  for (const metas of Object.values(state ?? {})) {
    for (const meta of metas ?? []) {
      const item = meta as Partial<PresencePayload>;
      if (!item || typeof item.userId !== "string") continue;
      const previous = byUser.get(item.userId);
      if (!previous || String(item.lastSeen ?? "") >= String(previous.lastSeen ?? "")) {
        byUser.set(item.userId, {
          userId: item.userId, fullName: String(item.fullName ?? ""),
          pendingCount: Number(item.pendingCount ?? 0), lastSeen: String(item.lastSeen ?? ""),
        });
      }
    }
  }
  return [...byUser.values()];
}

/** Managers y auditores: solo escuchan. `onSync` recibe los operarios presentes. Devuelve la función para salir. */
export function listenPresence(
  onSync: (present: PresencePayload[]) => void,
  options: { client?: RealtimeClientLike; onStatus?: (status: string) => void } = {},
): () => void {
  let disposed = false;
  let client: RealtimeClientLike | null = null;
  let channel: RealtimeChannelLike | null = null;
  void (async () => {
    try {
      client = options.client ?? (getBrowserSupabase() as unknown as RealtimeClientLike);
      await ensureRealtimeAuth(client);
    } catch { options.onStatus?.("CHANNEL_ERROR"); return; }
    if (disposed) return;
    const joined = client.channel(PRESENCE_CHANNEL, { config: { private: true } });
    channel = joined;
    joined
      .on("presence", { event: "sync" }, () => onSync(flattenPresence(joined.presenceState?.())))
      .subscribe((status) => options.onStatus?.(status));
  })();
  return () => {
    disposed = true;
    if (channel) { try { void client?.removeChannel(channel); } catch { /* ya cerrado */ } channel = null; }
  };
}

/**
 * Operarios: publican su presencia (`track`) al conectar, cuando cambia algún valor (`update`) y cada 30 s.
 * Devuelve `{ update, stop }`; `update` reemplaza el payload vigente.
 */
export function trackPresence(
  initial: () => PresencePayload,
  options: { client?: RealtimeClientLike; heartbeatMs?: number; timers?: Timers } = {},
): { update(): void; stop(): void } {
  const timers = options.timers ?? realTimers;
  let disposed = false;
  let subscribed = false;
  let client: RealtimeClientLike | null = null;
  let channel: RealtimeChannelLike | null = null;
  let heartbeat: unknown = null;
  const send = () => {
    if (disposed || !subscribed || !channel?.track) return;
    try { void Promise.resolve(channel.track({ ...initial(), lastSeen: new Date().toISOString() })).catch(() => undefined); } catch { /* reintenta el siguiente ciclo */ }
  };
  void (async () => {
    try {
      client = options.client ?? (getBrowserSupabase() as unknown as RealtimeClientLike);
      await ensureRealtimeAuth(client);
    } catch { return; }
    if (disposed) return;
    const joined = client.channel(PRESENCE_CHANNEL, { config: { private: true, presence: { key: initial().userId } } });
    channel = joined;
    // Sin un listener de presencia supabase-js no habilita la presencia en el join y el track no llega al servidor.
    joined.on("presence", { event: "sync" }, () => undefined);
    joined.subscribe((status) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        subscribed = true;
        send();
        if (heartbeat === null) heartbeat = timers.setInterval(send, options.heartbeatMs ?? PRESENCE_HEARTBEAT_MS);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        subscribed = false;
      }
    });
  })();
  return {
    update: send,
    stop() {
      disposed = true;
      if (heartbeat !== null) { timers.clearInterval(heartbeat); heartbeat = null; }
      if (channel) { try { void client?.removeChannel(channel); } catch { /* ya cerrado */ } channel = null; }
    },
  };
}
