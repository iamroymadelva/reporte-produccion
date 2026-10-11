import type { APIRoute } from "astro";
import { createSupabaseAdminClient, createSupabaseServerClient } from "../../../lib/supabase/server";
import { redirectWithMessage } from "../../../lib/http";

/** Mensaje único para cualquier fallo: contraseña errónea, usuario inexistente, bloqueado o inactivo. */
const GENERIC_ERROR = "Usuario o contraseña incorrectos";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const fail = () => redirect(redirectWithMessage("/iniciar-sesion", "error", GENERIC_ERROR), 303);

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!username || !password) return fail();

  try {
    const admin = createSupabaseAdminClient();
    const register = (success: boolean) => admin.rpc("login_register_result", { p_username: username, p_success: success });

    const { data: allowed, error: allowedError } = await admin.rpc("login_check_allowed", { p_username: username });
    // Bloqueado (o error al comprobarlo): no se intenta autenticar ni se cuentan más intentos.
    if (allowedError || allowed !== true) return fail();

    const { data: email, error: emailError } = await admin.rpc("resolve_login_email", { p_username: username });
    if (emailError || typeof email !== "string") return fail();

    const supabase = createSupabaseServerClient(request, cookies);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      await register(false);
      return fail();
    }

    const { data: profile } = await supabase.from("profiles").select("active").eq("id", data.user.id).maybeSingle();
    if (!profile?.active) {
      await supabase.auth.signOut();
      await register(false);
      return fail();
    }

    await register(true);
    return new Response(null, { status: 303, headers: { Location: "/", "X-Offline-Enroll": "1" } });
  } catch {
    return fail();
  }
};
