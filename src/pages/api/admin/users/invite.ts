import type { APIRoute } from "astro";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { redirectWithMessage } from "../../../../lib/http";
import type { AppRole } from "../../../../lib/types";

const validRoles = new Set<AppRole>(["ADMINISTRATOR", "OPERATOR", "VIEWER"]);

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const fullName = String(form.get("full_name") ?? "").trim();
  const role = String(form.get("role") ?? "OPERATOR") as AppRole;
  if (!email || !fullName || !validRoles.has(role)) return redirect(redirectWithMessage("/administracion/usuarios", "error", "Completa los datos de la invitación."), 303);

  try {
    const admin = createSupabaseAdminClient();
    const redirectTo = new URL("/auth/confirmar", request.url).toString();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    });
    if (error) throw error;
    if (!data.user) throw new Error("Supabase no devolvió el usuario invitado.");

    const { error: profileError } = await admin
      .from("profiles")
      .update({ full_name: fullName, role, active: true })
      .eq("id", data.user.id);
    if (profileError) throw profileError;

    return redirect(redirectWithMessage("/administracion/usuarios", "ok", "Invitación enviada."), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible invitar al usuario.";
    return redirect(redirectWithMessage("/administracion/usuarios", "error", message), 303);
  }
};
