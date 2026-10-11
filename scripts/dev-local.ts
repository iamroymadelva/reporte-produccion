// Arranca `astro dev` SIEMPRE contra el Supabase local.
// Bun puede cargar .env.local en process.env del padre; por eso el entorno del hijo se construye
// SIN ninguna variable *SUPABASE* heredada y solo con las de `.env`; el entorno final se valida
// y se aborta si alguna apunta a un Supabase remoto.
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

/** Devuelve los nombres de variables Supabase cuyo valor apunta a un host no local (con o sin esquema, http/ws). */
export function findRemoteSupabaseUrls(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([k, v]) => /SUPABASE/i.test(k) && isRemoteValue(v))
    .map(([k]) => k);
}

function isRemoteValue(value: string): boolean {
  const v = value.trim();
  if (!v || v.startsWith("eyJ")) return false; // vacío o JWT (claves)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return !isLocalUrl(v);
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(v) || /supabase\.(co|in|com)/i.test(v)) {
    return !isLocalUrl("http://" + v);
  }
  return false;
}

/** Entorno del hijo: nada heredado que coincida /SUPABASE/i, más las variables de .env. */
export function buildChildEnv(
  parent: Record<string, string | undefined>,
  fileEnv: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) {
    if (v !== undefined && !/SUPABASE/i.test(k)) out[k] = v;
  }
  return { ...out, ...fileEnv };
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
  const childEnv = buildChildEnv(process.env, env);
  const finalRemote = findRemoteSupabaseUrls(childEnv);
  if (finalRemote.length > 0 || !isLocalUrl(childEnv.PUBLIC_SUPABASE_URL ?? "")) {
    console.error(`ERROR: el entorno final apunta a un Supabase NO local (${finalRemote.join(", ") || "PUBLIC_SUPABASE_URL"}).`);
    process.exit(1);
  }
  try {
    await fetch(new URL("/auth/v1/health", url), { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`ERROR: Supabase local no responde en ${url}. Ejecuta primero: bun run db:start`);
    process.exit(1);
  }
  console.log(`[dev-local] Usando Supabase local: ${url} (variables Supabase heredadas del proceso descartadas; solo .env)`);
  const proc = Bun.spawn(["bunx", "astro", "dev", ...process.argv.slice(2)], {
    cwd: root,
    env: childEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const stop = () => proc.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.exit(await proc.exited);
}

if (import.meta.main) await main();
