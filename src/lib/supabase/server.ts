import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";

function publicConfiguration() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Falta configurar PUBLIC_SUPABASE_URL o PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  return { url, key };
}

export function createSupabaseServerClient(request: Request, cookies: AstroCookies) {
  const { url, key } = publicConfiguration();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "");
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, options);
        }
      },
    },
  });
}

export function createSupabaseAdminClient() {
  const { url } = publicConfiguration();
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
