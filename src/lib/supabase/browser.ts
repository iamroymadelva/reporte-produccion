import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase para el navegador (contracts/realtime.md). Solo se usa para Realtime (postgres_changes y presencia):
 * los datos se vuelven a pedir siempre a las rutas /api, que aplican rol y RLS en el servidor. Un único cliente por
 * pestaña, que reutiliza las cookies de sesión de @supabase/ssr y se desconecta al cerrar sesión.
 */
let client: SupabaseClient | null = null;
let logoutHooked = false;

export function getBrowserSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Falta configurar PUBLIC_SUPABASE_URL o PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  client = createBrowserClient(url, key) as unknown as SupabaseClient;
  hookLogout();
  return client;
}

/** Cierra todos los canales y el socket, y olvida el cliente (se vuelve a crear en el próximo uso). */
export function disconnectBrowserSupabase() {
  const current = client;
  client = null;
  if (!current) return;
  try { void current.removeAllChannels(); } catch { /* sin canales */ }
  try { current.realtime.disconnect(); } catch { /* ya desconectado */ }
}

/** Solo para pruebas. */
export function resetBrowserSupabaseForTests() {
  client = null;
}

/** Desconecta al enviar el formulario de cierre de sesión o al descargar la página (sin tocar los datos locales). */
function hookLogout() {
  if (logoutHooked || typeof document === "undefined") return;
  logoutHooked = true;
  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement | null;
    const action = form?.getAttribute?.("action") ?? "";
    if (action.endsWith("/api/auth/logout")) disconnectBrowserSupabase();
  }, true);
  window.addEventListener("pagehide", () => disconnectBrowserSupabase());
}
