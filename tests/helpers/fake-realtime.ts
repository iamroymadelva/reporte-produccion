/// <reference types="bun" />
import type { RealtimeChannelLike, RealtimeClientLike, Timers } from "../../src/lib/realtime";

/** Reloj manual: `advance(ms)` dispara temporizadores e intervalos en orden, sin esperar de verdad. */
export class FakeTimers implements Timers {
  now = 0;
  private nextId = 1;
  private items = new Map<number, { at: number; fn: () => void; every?: number }>();
  setTimeout = (fn: () => void, ms: number) => { const id = this.nextId++; this.items.set(id, { at: this.now + ms, fn }); return id; };
  clearTimeout = (handle: unknown) => { this.items.delete(handle as number); };
  setInterval = (fn: () => void, ms: number) => { const id = this.nextId++; this.items.set(id, { at: this.now + ms, fn, every: ms }); return id; };
  clearInterval = (handle: unknown) => { this.items.delete(handle as number); };
  get pending() { return this.items.size; }
  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, item] of this.items) if (item.at <= target && item.at < nextAt) { nextAt = item.at; nextId = id; }
      if (nextId === null) break;
      const item = this.items.get(nextId)!;
      this.now = item.at;
      if (item.every) item.at += item.every; else this.items.delete(nextId);
      item.fn();
    }
    this.now = target;
  }
}

export class FakeChannel implements RealtimeChannelLike {
  handlers: Array<{ type: string; filter: Record<string, unknown>; callback: (payload: unknown) => void }> = [];
  statusCallback: ((status: string) => void) | null = null;
  tracked: Array<Record<string, unknown>> = [];
  presence: Record<string, unknown[]> = {};
  removed = false;
  constructor(readonly name: string, readonly options: Record<string, unknown> | undefined) {}
  on(type: string, filter: Record<string, unknown>, callback: (payload: unknown) => void) { this.handlers.push({ type, filter, callback }); return this; }
  subscribe(callback?: (status: string) => void) { this.statusCallback = callback ?? null; return this; }
  track(payload: Record<string, unknown>) { this.tracked.push(payload); return Promise.resolve("ok"); }
  presenceState() { return this.presence; }
  setStatus(status: string) { this.statusCallback?.(status); }
  emit(payload: unknown = { new: {} }) { for (const handler of this.handlers.filter((h) => h.type === "postgres_changes")) handler.callback(payload); }
  sync(state: Record<string, unknown[]>) { this.presence = state; for (const handler of this.handlers.filter((h) => h.type === "presence")) handler.callback({}); }
}

export class FakeRealtimeClient implements RealtimeClientLike {
  channels: FakeChannel[] = [];
  removedNames: string[] = [];
  channel(name: string, options?: Record<string, unknown>) { const channel = new FakeChannel(name, options); this.channels.push(channel); return channel; }
  removeChannel(channel: RealtimeChannelLike) { (channel as FakeChannel).removed = true; this.removedNames.push((channel as FakeChannel).name); return Promise.resolve("ok"); }
  byName(name: string) { return this.channels.find((channel) => channel.name === name)!; }
  setAll(status: string) { for (const channel of this.channels) channel.setStatus(status); }
}

/** Deja que corran las microtareas pendientes (la suscripción arranca de forma asíncrona). */
export const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
