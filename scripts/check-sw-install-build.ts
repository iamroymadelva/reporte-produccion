/**
 * Comprueba public/sw.js (v5) contra el BUILD real (.vercel/output/static): ejecuta el evento install con un fetch que
 * sirve los archivos construidos y verifica que los tres shells y todos sus /_astro quedan en la caché simulada.
 *   bun scripts/check-sw-install-build.ts   (después de `bun run build`)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", ".vercel", "output", "static");
const code = readFileSync(join(import.meta.dir, "..", "public", "sw.js"), "utf8");
const entries = new Map<string, Response>();
const cache = {
  async addAll(urls: string[]) { for (const url of urls) entries.set(url, await serve(url)); },
  async put(request: string | { url: string }, response: Response) { entries.set(typeof request === "string" ? request : new URL(request.url).pathname, response); },
  async match(request: string) { return entries.get(request)?.clone(); },
};
async function serve(input: unknown): Promise<Response> {
  const path = String(input).split("?")[0];
  const file = /\.[a-z0-9]+$/i.test(path) ? join(root, path) : join(root, path, "index.html");
  if (!existsSync(file)) return new Response("", { status: 404 });
  const response = new Response(readFileSync(file), { status: 200 });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}
const listeners: Record<string, (event: any) => void> = {};
const self = { addEventListener: (type: string, listener: (event: any) => void) => { listeners[type] = listener; }, location: { origin: "http://localhost" }, clients: { claim: async () => undefined }, skipWaiting: async () => undefined };
new Function("self", "caches", "fetch", code)(self, { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined }, serve);
let installing: Promise<unknown> = Promise.resolve();
listeners.install({ waitUntil: (promise: Promise<unknown>) => { installing = promise; } });
await installing;
const keys = [...entries.keys()];
const assets = keys.filter((key) => key.startsWith("/_astro/"));
console.log(`cacheados: ${keys.length} (${assets.length} /_astro)`);
for (const shell of ["/turno", "/consulta-offline", "/acceso-offline"]) {
  if (!entries.has(shell)) throw new Error(`falta ${shell}`);
  const html = await entries.get(shell)!.clone().text();
  const refs = [...new Set(html.match(/\/_astro\/[A-Za-z0-9_.\-]+\.(?:js|css)/g) ?? [])];
  const missing = refs.filter((ref) => !entries.has(ref));
  console.log(`${shell}: ${refs.length} referencias /_astro, faltan ${missing.length}`);
  if (missing.length) throw new Error(`faltan ${missing.join(", ")}`);
}
const html = keys.filter((key) => !key.startsWith("/_astro/") && !key.startsWith("/icons/") && key !== "/manifest.webmanifest").sort();
console.log("HTML cacheado:", html.join(", "));
if (html.join(",") !== "/acceso-offline,/consulta-offline,/offline.html,/turno") throw new Error("HTML inesperado en la caché");
console.log("SW INSTALL OK contra el build real");
