import type { APIRoute } from "astro";
import { redirectWithMessage } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  if (!locals.auth) {
    return redirect(redirectWithMessage("/iniciar-sesion", "error", "La sesión no es válida o ya expiró."), 303);
  }

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const passwordConfirm = String(form.get("password_confirm") ?? "");

  if (password.length < 8) {
    return redirect(redirectWithMessage("/configurar-contrasena", "error", "La contraseña debe tener al menos 8 caracteres."), 303);
  }
  if (password !== passwordConfirm) {
    return redirect(redirectWithMessage("/configurar-contrasena", "error", "Las contraseñas no coinciden."), 303);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return redirect(redirectWithMessage("/configurar-contrasena", "error", "No fue posible guardar la contraseña. Intenta nuevamente."), 303);
  }

  return redirect("/dashboard", 303);
};
