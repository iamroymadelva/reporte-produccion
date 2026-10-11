// Arranca `astro dev` SIEMPRE contra el Supabase local.
// Lee solo `.env` (nunca `.env.local`, que apunta a producción) y pasa las variables
// por el entorno del proceso hijo; Vite da prioridad a las variables de proceso.
import { join } from "node:path";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** Devuelve los nombres de variables Supabase cuyo valor es una URL no local. */
export function findRemoteSupabaseUrls(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([k, v]) => /SUPABASE/i.test(k) && /^https?:\/\//i.test(v) && !isLocalUrl(v))
    .map(([k]) => k);
}

async function main() {
  const root = join(import.meta.dir, "..");
  const file = Bun.file(join(root, ".env"));
  if (!(await file.exists())) {
    console.error("ERROR: no existe .env. Copia .env.example o define el Supabase local en .env.");
    process.exit(1);
  }
  const env = parseEnv(await file.text());
  const url = env.PUBLIC_SUPABASE_URL;
  if (!url) {
    console.error("ERROR: .env no define PUBLIC_SUPABASE_URL.");
    process.exit(1);
  }
  const remote = findRemoteSupabaseUrls(env);
  if (remote.length > 0 || !isLocalUrl(url)) {
    console.error(
      `ERROR: .env apunta a un Supabase NO local (${remote.join(", ") || "PUBLIC_SUPABASE_URL"}).\n` +
        "`bun run dev` solo funciona contra 127.0.0.1/localhost para no tocar producción.\n" +
        "Corrige .env o usa `bun run dev:remote` bajo tu responsabilidad."
    );
    process.exit(1);
  }
  try {
    await fetch(new URL("/auth/v1/health", url), { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`ERROR: Supabase local no responde en ${url}. Ejecuta primero: bun run db:start`);
    process.exit(1);
  }
  console.log(`[dev-local] Usando Supabase local: ${url} (.env.local ignorado)`);
  const proc = Bun.spawn(["bunx", "astro", "dev", ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const stop = () => proc.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.exit(await proc.exited);
}

if (import.meta.main) await main();
