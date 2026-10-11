/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// public/sw.js se ejecuta en un entorno simulado (self, caches, fetch) para probar la actualización segura (MAJOR-3):
// un fallo al precachear CUALQUIER shell (/turno, /consulta-offline, /acceso-offline) hace fallar la instalación (queda
// el worker anterior) y la caché anterior solo se borra cuando la nueva ya contiene TODOS los shells. El respaldo sin
// red es por ruta (Phase 8: v5).
const code = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

type Listener = (event: any) => void;
class FakeCache {
  entries = new Map<string, Response>();
  async addAll(urls: string[]) { for (const url of urls) this.entries.set(url, await fetchStub(url)); }
  async put(request: string | { url: string }, response: Response) { this.entries.set(typeof request === "string" ? request : new URL(request.url).pathname, response); }
  async match(request: string | { url: string }) {
    const key = typeof request === "string" ? request : new URL(request.url).pathname;
    return this.entries.get(key)?.clone();
  }
}
let stores: Map<string, FakeCache>;
let network: Map<string, { status: number; body?: string }>;
let fetchCalls: string[];
let skipWaitingCalls: number;

async function fetchStub(input: unknown): Promise<Response> {
  const url = typeof input === "string" ? input : (input as { url: string }).url;
  const path = url.startsWith("http") ? new URL(url).pathname : url;
  fetchCalls.push(path);
  const entry = network.get(path);
  if (!entry) throw new TypeError("Failed to fetch");
  const response = new Response(entry.body ?? "", { status: entry.status });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

function loadWorker() {
  const listeners: Record<string, Listener> = {};
  const caches = {
    open: async (name: string) => { if (!stores.has(name)) stores.set(name, new FakeCache()); return stores.get(name)!; },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: unknown) => { for (const cache of stores.values()) { const hit = await cache.match(request as string); if (hit) return hit; } return undefined; },
  };
  const self = {
    addEventListener: (type: string, listener: Listener) => { listeners[type] = listener; },
    location: { origin: "http://localhost" },
    clients: { claim: async () => undefined },
    skipWaiting: () => { skipWaitingCalls += 1; return Promise.resolve(); },
  };
  new Function("self", "caches", "fetch", code)(self, caches, fetchStub);
  return listeners;
}

const run = async (listener: Listener | undefined, event: Record<string, unknown> = {}) => {
  let promise: Promise<unknown> = Promise.resolve();
  await listener?.({ ...event, waitUntil: (p: Promise<unknown>) => { promise = p; } });
  return promise;
};

const shellHtml = '<html><astro-island component-url="/_astro/OperatorShiftApp.abc.js" renderer-url="/_astro/client.def.js"></astro-island><link rel="stylesheet" href="/_astro/turno.css.css"></html>';
const overviewHtml = '<html><astro-island component-url="/_astro/OfflineOverview.jkl.js" renderer-url="/_astro/client.def.js"></astro-island>consulta</html>';
const loginHtml = '<html><script type="module" src="/_astro/LoginCard.mno.js"></script>acceso</html>';
const SHELLS = ["/turno", "/consulta-offline", "/acceso-offline"];
const baseNetwork = () => new Map([
  ["/offline.html", { status: 200, body: "offline" }],
  ["/manifest.webmanifest", { status: 200 }],
  ["/icons/icon-192.png", { status: 200 }], ["/icons/icon-512.png", { status: 200 }], ["/icons/apple-touch-icon-180.png", { status: 200 }],
  ["/turno", { status: 200, body: shellHtml }],
  ["/consulta-offline", { status: 200, body: overviewHtml }],
  ["/acceso-offline", { status: 200, body: loginHtml }],
  ["/_astro/OfflineOverview.jkl.js", { status: 200, body: "export default 3" }],
  ["/_astro/LoginCard.mno.js", { status: 200, body: "export default 4" }],
  ["/_astro/OperatorShiftApp.abc.js", { status: 200, body: 'import"./chunk.ghi.js";export default 1' }],
  ["/_astro/client.def.js", { status: 200, body: "export default 2" }],
  ["/_astro/turno.css.css", { status: 200, body: "body{}" }],
  ["/_astro/chunk.ghi.js", { status: 200, body: "export const x=1" }],
]);

beforeEach(() => {
  stores = new Map(); network = baseNetwork(); fetchCalls = []; skipWaitingCalls = 0;
});

describe("service worker v5", () => {
  test("usa la versión v5 y no activa solo (sin skipWaiting automático)", async () => {
    expect(code).toContain('const CACHE_VERSION = "v5"');
    const listeners = loadWorker();
    await run(listeners.install);
    expect(skipWaitingCalls).toBe(0);
  });

  test("instala los tres shells (/turno, /consulta-offline, /acceso-offline) con sus recursos /_astro, incluidos los chunks importados", async () => {
    const listeners = loadWorker();
    await run(listeners.install);
    const cache = [...stores.values()].find((entry) => entry.entries.has("/turno"))!;
    expect(cache).toBeDefined();
    for (const path of [...SHELLS, "/_astro/OperatorShiftApp.abc.js", "/_astro/client.def.js", "/_astro/turno.css.css", "/_astro/chunk.ghi.js",
      "/_astro/OfflineOverview.jkl.js", "/_astro/LoginCard.mno.js", "/offline.html"]) {
      expect(cache.entries.has(path)).toBe(true);
    }
    // El único HTML guardado son los shells y offline.html (nunca SSR autenticado ni /api).
    const html = [...cache.entries.keys()].filter((key) => !key.startsWith("/_astro/") && !key.startsWith("/icons/") && key !== "/manifest.webmanifest");
    expect(html.sort()).toEqual(["/acceso-offline", "/consulta-offline", "/offline.html", "/turno"]);
  });

  test("si /consulta-offline o /acceso-offline no se pueden cachear la instalación FALLA (queda el worker anterior)", async () => {
    for (const shell of ["/consulta-offline", "/acceso-offline"]) {
      network = baseNetwork();
      network.set(shell, { status: 500 });
      await expect(run(loadWorker().install)).rejects.toBeDefined();
      network = baseNetwork();
      network.delete(shell);
      await expect(run(loadWorker().install)).rejects.toBeDefined();
    }
  });

  test("si falla un recurso /_astro de la consulta o del acceso la instalación FALLA", async () => {
    for (const asset of ["/_astro/OfflineOverview.jkl.js", "/_astro/LoginCard.mno.js"]) {
      network = baseNetwork();
      network.set(asset, { status: 500 });
      await expect(run(loadWorker().install)).rejects.toBeDefined();
    }
  });

  test("si /turno no se puede cachear la instalación FALLA (queda el worker anterior)", async () => {
    network.set("/turno", { status: 500 });
    const listeners = loadWorker();
    await expect(run(listeners.install)).rejects.toBeDefined();
  });

  test("si falla la red al bajar /turno la instalación FALLA", async () => {
    network.delete("/turno");
    const listeners = loadWorker();
    await expect(run(listeners.install)).rejects.toBeDefined();
  });

  test("si un recurso /_astro necesario no se puede cachear la instalación FALLA", async () => {
    network.set("/_astro/client.def.js", { status: 500 });
    const listeners = loadWorker();
    await expect(run(listeners.install)).rejects.toBeDefined();
  });

  test("al activar no se borra la caché anterior si la nueva no contiene TODOS los shells", async () => {
    const listeners = loadWorker();
    const old = new FakeCache();
    old.entries.set("/turno", new Response("shell viejo"));
    stores.set("reporte-produccion-static-v4", old);
    stores.set("reporte-produccion-static-v5", new FakeCache()); // la nueva está vacía (sin shells)
    await run(listeners.activate);
    expect(stores.has("reporte-produccion-static-v4")).toBe(true);
    const partial = new FakeCache(); // solo /turno: faltan la consulta y el acceso
    partial.entries.set("/turno", new Response("shell nuevo"));
    stores.set("reporte-produccion-static-v5", partial);
    await run(listeners.activate);
    expect(stores.has("reporte-produccion-static-v4")).toBe(true);
  });

  test("al activar con los tres shells en la nueva caché se borran solo las cachés antiguas de la aplicación", async () => {
    const listeners = loadWorker();
    stores.set("reporte-produccion-static-v4", new FakeCache());
    stores.set("otra-app-cache", new FakeCache());
    const fresh = new FakeCache();
    for (const shell of SHELLS) fresh.entries.set(shell, new Response("shell nuevo"));
    stores.set("reporte-produccion-static-v5", fresh);
    await run(listeners.activate);
    expect(stores.has("reporte-produccion-static-v4")).toBe(false);
    expect(stores.has("otra-app-cache")).toBe(true);
    expect(stores.has("reporte-produccion-static-v5")).toBe(true);
  });

  test("sin red, la navegación se respalda por ruta: /turno y /reportes* → turno; consulta → consulta; acceso, login e inicio → acceso; el resto → offline.html", async () => {
    const listeners = loadWorker();
    await run(listeners.install);
    network = new Map(); // sin red
    const navigate = async (path: string) => {
      let result: Response | undefined;
      listeners.fetch({
        request: { method: "GET", mode: "navigate", url: `http://localhost${path}` },
        respondWith: (promise: Promise<Response>) => { result = undefined; (listeners as any).pending = promise.then((r) => { result = r; }); },
      });
      await (listeners as any).pending;
      return result!.text();
    };
    expect(await navigate("/turno")).toContain("astro-island");
    expect(await navigate("/reportes")).toContain("astro-island");
    expect(await navigate("/reportes/123")).toContain("astro-island");
    expect(await navigate("/consulta-offline")).toBe(overviewHtml);
    for (const path of ["/iniciar-sesion", "/acceso-offline", "/", "/dashboard"]) expect(await navigate(path)).toBe(loginHtml);
    expect(await navigate("/administracion")).toBe("offline");
    expect(await navigate("/notificaciones")).toBe("offline");
  });

  test("nunca cachea /api/** ni HTML SSR", async () => {
    const listeners = loadWorker();
    await run(listeners.install);
    network.set("/reportes/1", { status: 200, body: "html autenticado" });
    let responded = false;
    listeners.fetch({ request: { method: "GET", mode: "navigate", url: "http://localhost/reportes/1" }, respondWith: (p: Promise<Response>) => { responded = true; void p; } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(responded).toBe(true);
    const cached = [...stores.values()].flatMap((cache) => [...cache.entries.keys()]);
    expect(cached.some((key) => key.startsWith("/api/") || key === "/reportes/1")).toBe(false);
    let apiHandled = false;
    listeners.fetch({ request: { method: "GET", mode: "cors", url: "http://localhost/api/offline/snapshot" }, respondWith: () => { apiHandled = true; } });
    expect(apiHandled).toBe(false);
  });
});
