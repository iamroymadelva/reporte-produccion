import type { APIRoute } from "astro";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { redirectWithMessage } from "../../../../lib/http";
import type { AppRole } from "../../../../lib/types";

const validRoles = new Set<AppRole>(["ADMINISTRATOR", "OPERATOR", "VIEWER"]);
const existingUserMessage = "Ya existe un usuario con este correo.";
const retiredUserMessage = "Este correo pertenece a un usuario retirado. Reactiva el usuario existente en lugar de crear uno nuevo.";
const lookupErrorMessage = "No fue posible verificar si el correo ya pertenece a otro usuario. Intenta nuevamente.";

type ExistingEmailCheck =
  | { kind: "none" }
  | { kind: "active" }
  | { kind: "retired" }
  | { kind: "lookup-error" };

async function findUserByEmail(admin: ReturnType<typeof createSupabaseAdminClient>, email: string) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find((item) => item.email?.trim().toLowerCase() === email);
    if (user) return user;
    if (data.users.length < perPage) return null;
  }
}

async function classifyExistingEmail(admin: ReturnType<typeof createSupabaseAdminClient>, email: string): Promise<ExistingEmailCheck> {
  try {
    const existingUser = await findUserByEmail(admin, email);
    if (!existingUser) return { kind: "none" };

    const { data: profile, error } = await admin
      .from("profiles")
      .select("active, removed_at")
      .eq("id", existingUser.id)
      .maybeSingle();
    if (error) return { kind: "lookup-error" };
    return profile && (!profile.active || profile.removed_at) ? { kind: "retired" } : { kind: "active" };
  } catch {
    return { kind: "lookup-error" };
  }
}

function messageForExistingEmail(check: ExistingEmailCheck) {
  if (check.kind === "active") return existingUserMessage;
  if (check.kind === "retired") return retiredUserMessage;
  if (check.kind === "lookup-error") return lookupErrorMessage;
  return null;
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const fullName = String(form.get("full_name") ?? "").trim();
  const role = String(form.get("role") ?? "OPERATOR") as AppRole;
  if (!email || !fullName || !validRoles.has(role)) return redirect(redirectWithMessage("/administracion/usuarios", "error", "Completa los datos de la invitación."), 303);

  try {
    const admin = createSupabaseAdminClient();
    const existingCheck = await classifyExistingEmail(admin, email);
    const existingMessage = messageForExistingEmail(existingCheck);
    if (existingMessage) {
      return redirect(redirectWithMessage("/administracion/usuarios", "error", existingMessage), 303);
    }

    const redirectTo = new URL("/auth/confirmar", request.url).toString();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo,
    });
    if (error) {
      const conflictCheck = await classifyExistingEmail(admin, email);
      const conflictMessage = messageForExistingEmail(conflictCheck) ?? "No fue posible invitar al usuario.";
      return redirect(redirectWithMessage("/administracion/usuarios", "error", conflictMessage), 303);
    }
    if (!data.user) return redirect(redirectWithMessage("/administracion/usuarios", "error", "No fue posible invitar al usuario."), 303);

    const { error: profileError } = await admin
      .from("profiles")
      .update({ full_name: fullName, role, active: true })
      .eq("id", data.user.id);
    if (profileError) return redirect(redirectWithMessage("/administracion/usuarios", "error", "No fue posible completar la configuración del usuario."), 303);

    return redirect(redirectWithMessage("/administracion/usuarios", "ok", "Invitación enviada."), 303);
  } catch {
    return redirect(redirectWithMessage("/administracion/usuarios", "error", "No fue posible invitar al usuario."), 303);
  }
};
