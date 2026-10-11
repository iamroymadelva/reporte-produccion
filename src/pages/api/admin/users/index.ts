import type { APIRoute } from "astro";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { isManager } from "../../../../lib/auth";
import { json, redirectWithMessage } from "../../../../lib/http";
import { canManage, normalizeUsername, parseAssignments, syntheticEmail, USERNAME_PATTERN, userRpcErrorMessage, validatePasswordPair } from "../../../../lib/user-admin";
import type { AppRole } from "../../../../lib/types";

const path = "/administracion/usuarios";
const validRoles = new Set<AppRole>(["ROOT", "ADMINISTRATOR", "OPERATOR", "VIEWER"]);

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const auth = locals.auth ?? null;
  const fail = (message: string) => redirect(redirectWithMessage(path, "error", message), 303);
  if (!isManager(auth)) return json({ error: "No tienes permisos de administración." }, 403);

  const form = await request.formData();
  const username = normalizeUsername(form.get("username"));
  const fullName = String(form.get("full_name") ?? "").trim();
  const jobTitle = String(form.get("job_title") ?? "").trim() || null;
  const roleValue = String(form.get("role") ?? "OPERATOR") as AppRole;
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("password_confirm") ?? "");

  if (!validRoles.has(roleValue)) return fail("El rol no es válido.");
  // Matriz de gestión: el coordinador solo crea operarios; ROOT puede crear cualquier rol.
  if (!canManage(auth!.profile.role, "OPERATOR", roleValue)) {
    return json({ error: "Solo el administrador raíz puede crear este rol." }, 403);
  }
  if (!USERNAME_PATTERN.test(username)) return fail("El usuario debe tener entre 3 y 32 caracteres: letras minúsculas, números, punto, guion o guion bajo.");
  if (!fullName) return fail("Completa el nombre del usuario.");
  const passwordError = validatePasswordPair(password, confirmation);
  if (passwordError) return fail(passwordError);
  const parsed = parseAssignments(form);
  if ("error" in parsed) return fail(parsed.error);
  const assignments = roleValue === "OPERATOR" ? parsed.assignments : [];

  const admin = createSupabaseAdminClient();
  const { data: existing, error: lookupError } = await admin.from("profiles").select("id, active, removed_at").eq("username", username).maybeSingle();
  if (lookupError) return fail("No fue posible verificar si el usuario ya existe. Intenta nuevamente.");
  if (existing) {
    const retired = !existing.active || Boolean(existing.removed_at);
    return fail(retired
      ? "Este nombre de usuario pertenece a un usuario retirado. Reactiva el usuario existente en lugar de crear uno nuevo."
      : "Ya existe un usuario con este nombre de usuario.");
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: syntheticEmail(username),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username },
  });
  if (createError || !created?.user) {
    const duplicate = /already|registered|exists|duplicate/i.test(createError?.message ?? "");
    return fail(duplicate ? "Ya existe un usuario con este nombre de usuario." : "No fue posible crear el usuario.");
  }

  const { error: rpcError } = await admin.rpc("manage_user_assignments", {
    p_target: created.user.id,
    p_actor: auth!.user.id,
    p_profile: { full_name: fullName, job_title: jobTitle, role: roleValue, active: true, audit_action: "USER_CREATED" },
    p_assignments: assignments,
  });
  if (rpcError) {
    // Compensación: sin perfil configurado no debe quedar una identidad de acceso huérfana.
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(userRpcErrorMessage(rpcError, "No fue posible completar la configuración del usuario."));
  }

  return redirect(redirectWithMessage(path, "ok", "Usuario creado."), 303);
};
