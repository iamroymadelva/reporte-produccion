import type { APIRoute } from "astro";
import { redirectWithMessage } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const neutralMessage = "Si existe una cuenta con ese correo, recibirás instrucciones para restablecer tu contraseña.";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();

  if (email) {
    const supabase = createSupabaseServerClient(request, cookies);
    const redirectTo = new URL("/auth/confirmar", request.url).toString();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  }

  return redirect(redirectWithMessage("/recuperar-contrasena", "ok", neutralMessage), 303);
};
