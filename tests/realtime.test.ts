/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { flattenPresence, listenPresence, presenceStatus, subscribeWithFallback, trackPresence, type LiveMode } from "../src/lib/realtime";
import { FakeRealtimeClient, FakeTimers, flush } from "./helpers/fake-realtime";

const channels = [
  { name: "a", table: "production_reports" },
  { name: "b", table: "report_stop_events", filter: "report_id=eq.r1" },
];

async function start(options: Record<string, unknown> = {}) {
  const client = new FakeRealtimeClient();
  const timers = new FakeTimers();
  const calls = { change: 0, poll: 0 };
  const modes: LiveMode[] = [];
  const subscription = subscribeWithFallback(channels, () => { calls.change++; }, () => { calls.poll++; }, {
    client, timers, onModeChange: (mode) => modes.push(mode), ...options,
  });
  await flush();
  return { client, timers, calls, modes, subscription };
}

describe("subscribeWithFallback (T099)", () => {
  test("crea un canal por suscripción con el filtro de postgres_changes", async () => {
    const { client } = await start();
    expect(client.channels.map((c) => c.name)).toEqual(["a", "b"]);
    expect(client.byName("a").handlers[0].filter).toEqual({ event: "*", schema: "public", table: "production_reports" });
    expect(client.byName("b").handlers[0].filter).toEqual({ event: "*", schema: "public", table: "report_stop_events", filter: "report_id=eq.r1" });
  });

  test("varios eventos seguidos producen un solo refetch tras el debounce (500 ms por omisión)", async () => {
    const { client, timers, calls } = await start();
    client.setAll("SUBSCRIBED");
    client.byName("a").emit(); client.byName("b").emit(); client.byName("a").emit();
    timers.advance(499);
    expect(calls.change).toBe(0);
    timers.advance(1);
    expect(calls.change).toBe(1);
    expect(calls.poll).toBe(0);
  });

  test("el debounce configurable (1 s para listas) se respeta", async () => {
    const { client, timers, calls } = await start({ debounceMs: 1000 });
    client.setAll("SUBSCRIBED");
    client.byName("a").emit();
    timers.advance(999);
    expect(calls.change).toBe(0);
    timers.advance(1);
    expect(calls.change).toBe(1);
  });

  test("accept descarta los eventos que no afectan (el payload nunca se usa para pintar)", async () => {
    const { client, timers, calls } = await start({ accept: (payload: any) => payload?.new?.machine_id === "m1" });
    client.setAll("SUBSCRIBED");
    client.byName("a").emit({ new: { machine_id: "m2" } });
    timers.advance(2000);
    expect(calls.change).toBe(0);
    client.byName("a").emit({ new: { machine_id: "m1" } });
    timers.advance(500);
    expect(calls.change).toBe(1);
  });

  test("sin SUBSCRIBED en 5 s activa el polling cada 8 s (con una consulta inmediata)", async () => {
    const { timers, calls, modes } = await start();
    timers.advance(4999);
    expect(calls.poll).toBe(0);
    timers.advance(1);
    expect(modes).toEqual(["polling"]);
    expect(calls.poll).toBe(1);
    timers.advance(7999);
    expect(calls.poll).toBe(1);
    timers.advance(1);
    expect(calls.poll).toBe(2);
    timers.advance(8000);
    expect(calls.poll).toBe(3);
  });

  test("con todos los canales SUBSCRIBED antes de 5 s no hay polling", async () => {
    const { client, timers, calls, modes } = await start();
    client.setAll("SUBSCRIBED");
    expect(modes).toEqual(["live"]);
    timers.advance(60_000);
    expect(calls.poll).toBe(0);
    expect(timers.pending).toBe(0);
  });

  test("CHANNEL_ERROR o TIMED_OUT activa el polling al instante; al reconectar se detiene y se recarga una vez", async () => {
    for (const failure of ["CHANNEL_ERROR", "TIMED_OUT"]) {
      const { client, timers, calls, modes } = await start();
      client.setAll("SUBSCRIBED");
      client.byName("b").setStatus(failure);
      expect(modes).toEqual(["live", "polling"]);
      expect(calls.poll).toBe(1);
      timers.advance(8000);
      expect(calls.poll).toBe(2);
      client.byName("b").setStatus("SUBSCRIBED");
      expect(modes).toEqual(["live", "polling", "live"]);
      const polls = calls.poll;
      timers.advance(30_000);
      expect(calls.poll).toBe(polls); // el polling se detuvo
      expect(calls.change).toBe(1); // recarga final para recuperar lo perdido (debounce incluido)
    }
  });

  test("si el cliente de Realtime no se puede crear o falla al unirse, cae al polling", async () => {
    const timers = new FakeTimers();
    let polls = 0;
    const broken = { channel() { throw new Error("sin WebSocket"); }, removeChannel() { return null; } };
    subscribeWithFallback(channels, () => undefined, () => { polls++; }, { timers, client: broken });
    await flush();
    expect(polls).toBe(1);
    timers.advance(8000);
    expect(polls).toBe(2);
  });

  test("unsubscribe elimina canales y temporizadores, y no vuelve a llamar", async () => {
    const { client, timers, calls, subscription } = await start();
    client.setAll("SUBSCRIBED");
    client.byName("a").emit();
    subscription.unsubscribe();
    expect([...client.removedNames].sort()).toEqual(["a", "b"]);
    expect(timers.pending).toBe(0);
    timers.advance(60_000);
    expect(calls.change).toBe(0);
    expect(calls.poll).toBe(0);
    client.byName("a").setStatus("CHANNEL_ERROR"); // un error tardío no reactiva el polling
    expect(timers.pending).toBe(0);
  });

  test("unsubscribe antes de que arranque la suscripción asíncrona no crea canales", async () => {
    const client = new FakeRealtimeClient();
    const timers = new FakeTimers();
    const subscription = subscribeWithFallback(channels, () => undefined, () => undefined, { client, timers });
    subscription.unsubscribe();
    await flush();
    expect(client.channels).toHaveLength(0);
    expect(timers.pending).toBe(0);
  });

  test("aplica el token de la sesión al socket antes de unirse a los canales", async () => {
    const client = new FakeRealtimeClient() as FakeRealtimeClient & { auth: any; realtime: any };
    const applied: unknown[] = [];
    client.auth = { getSession: async () => ({ data: { session: { access_token: "tok" } } }) };
    client.realtime = { setAuth: (token: unknown) => { applied.push(token); } };
    subscribeWithFallback(channels, () => undefined, () => undefined, { client, timers: new FakeTimers() });
    await flush();
    expect(applied).toEqual(["tok"]);
    expect(client.channels).toHaveLength(2);
  });
});

describe("presencia (T102)", () => {
  const meta = (userId: string, pendingCount: number, lastSeen: string) => ({ userId, fullName: userId.toUpperCase(), pendingCount, lastSeen });

  test("estados: En línea, En línea con pendientes y Sin conexión", () => {
    expect(presenceStatus(meta("u", 0, "t"))).toBe("ONLINE");
    expect(presenceStatus(meta("u", 3, "t"))).toBe("ONLINE_PENDING");
    expect(presenceStatus(null)).toBe("OFFLINE");
  });

  test("flattenPresence deja el payload más reciente por usuario e ignora basura", () => {
    const flat = flattenPresence({ k1: [meta("u1", 0, "2026-10-10T10:00:00Z"), meta("u1", 2, "2026-10-10T10:05:00Z")], k2: [{ nope: true }, meta("u2", 0, "2026-10-10T10:01:00Z")] });
    expect(flat.map((p) => [p.userId, p.pendingCount]).sort()).toEqual([["u1", 2], ["u2", 0]]);
  });

  test("listenPresence usa un canal privado, solo escucha (nunca track) y sale limpiamente", async () => {
    const client = new FakeRealtimeClient();
    let seen: any[] = [];
    const stop = listenPresence((list) => { seen = list; }, { client });
    await flush();
    const channel = client.byName("plant-presence");
    expect(channel.options).toEqual({ config: { private: true } });
    channel.sync({ k: [meta("u1", 1, "t")] });
    expect(seen[0]).toMatchObject({ userId: "u1", pendingCount: 1 });
    expect(channel.tracked).toHaveLength(0);
    stop();
    expect(channel.removed).toBe(true);
  });

  test("trackPresence publica al conectar, al actualizar y cada 30 s; stop limpia", async () => {
    const client = new FakeRealtimeClient();
    const timers = new FakeTimers();
    let pending = 0;
    const handle = trackPresence(() => meta("u1", pending, "x"), { client, timers });
    await flush();
    const channel = client.byName("plant-presence");
    expect(channel.options).toEqual({ config: { private: true, presence: { key: "u1" } } });
    expect(channel.handlers.map((h) => h.type)).toEqual(["presence"]); // habilita la presencia en el join
    channel.setStatus("SUBSCRIBED");
    expect(channel.tracked).toHaveLength(1);
    pending = 2;
    handle.update();
    expect(channel.tracked).toHaveLength(2);
    expect(channel.tracked[1]).toMatchObject({ userId: "u1", pendingCount: 2 });
    timers.advance(30_000);
    expect(channel.tracked).toHaveLength(3);
    handle.stop();
    expect(channel.removed).toBe(true);
    expect(timers.pending).toBe(0);
    timers.advance(60_000);
    expect(channel.tracked).toHaveLength(3);
  });

  test("trackPresence no publica antes de SUBSCRIBED ni después de un error del canal", async () => {
    const client = new FakeRealtimeClient();
    const timers = new FakeTimers();
    const handle = trackPresence(() => meta("u1", 0, "x"), { client, timers });
    await flush();
    const channel = client.byName("plant-presence");
    handle.update();
    expect(channel.tracked).toHaveLength(0);
    channel.setStatus("SUBSCRIBED");
    channel.setStatus("CHANNEL_ERROR");
    handle.update();
    expect(channel.tracked).toHaveLength(1);
    handle.stop();
  });
});
