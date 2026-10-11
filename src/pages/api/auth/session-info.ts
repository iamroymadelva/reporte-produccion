import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/**
 * GET /api/auth/session-info (Phase 8, FR-006b): quién es la sesión en línea. Lo usa el cliente para matricular el
 * verificador offline tras un login y para revalidar identidad, estado y rol al reconectar.
 * 200 → identidad y ventana offline · 401 → sin sesión · 403 {code:"INACTIVE"} → sesión válida con perfil inactivo.
 * Es una ruta "pública" del middleware solo para poder distinguir 401 de 403; nunca devuelve datos sin sesión válida.
 */
function noStore(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const supabase = createSupabaseServerClient(request, cookies);
  const auth = locals.auth;
  if (!auth) {
    const { data } = await supabase.auth.getUser().catch(() => ({ data: null }));
    if (data?.user) {
      const { data: profile } = await supabase.from("profiles").select("active").eq("id", data.user.id).maybeSingle();
      if (!profile || (profile as { active?: boolean }).active === false) {
        return noStore({ error: "Tu usuario está inactivo.", code: "INACTIVE" }, 403);
      }
    }
    return noStore({ error: "Debes iniciar sesión." }, 401);
  }

  const [profile, settings] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", auth.user.id).maybeSingle(),
    supabase.from("app_settings").select("offline_login_window").maybeSingle(),
  ]);
  const username = (profile.data as { username?: string } | null)?.username;
  if (!username) return noStore({ error: "No fue posible identificar al usuario." }, 500);
  return noStore({
    userId: auth.user.id,
    username,
    fullName: auth.profile.full_name,
    role: auth.profile.role,
    active: true,
    // Hora del último inicio de sesión real (Supabase last_sign_in_at): ata la matrícula offline a un login nuevo.
    signInAt: auth.user.last_sign_in_at ?? null,
    offlineLoginWindow: (settings.data as { offline_login_window?: string } | null)?.offline_login_window ?? null,
    serverTime: new Date().toISOString(),
  });
};
