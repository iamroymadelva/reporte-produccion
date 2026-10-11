import type { APIRoute } from "astro";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { isManager, isRoot } from "../../../../lib/auth";
import { json, redirectWithMessage } from "../../../../lib/http";
import { canManage, OFFLINE_RISK_MESSAGE, parseAssignments, userRpcErrorMessage, validatePasswordPair } from "../../../../lib/user-admin";
import type { AppRole } from "../../../../lib/types";

const path = "/administracion/usuarios";
const validRoles = new Set<AppRole>(["ROOT", "ADMINISTRATOR", "OPERATOR", "VIEWER"]);
// Solo se admiten estas intenciones; cualquier otra se rechaza antes de tocar datos.
const validIntents = new Set(["update", "reactivate", "remove", "reset_password"]);

export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  const auth = locals.auth ?? null;
  if (!isManager(auth)) return json({ error: "No tienes permisos de administración." }, 403);
  const fail = (message: string) => redirect(redirectWithMessage(path, "error", message), 303);
  const done = (message: string) => redirect(redirectWithMessage(path, "ok", message), 303);
  if (!params.id) return fail("Usuario inválido.");
  const targetId = params.id;
  const actorId = auth!.user.id;

  const form = await request.formData();
  const rawIntent = form.get("intent");
  if (rawIntent !== null && !validIntents.has(String(rawIntent))) return json({ error: "Acción no válida." }, 400);
  const intent = rawIntent === null ? "update" : String(rawIntent);

  // Matriz de gestión: solo ROOT gestiona a ROOT, coordinadores y auditores; el coordinador solo a operarios
  // y no puede asignar ningún rol distinto de OPERATOR en ninguna ruta (actualizar, reactivar, retirar o restablecer).
  const admin = createSupabaseAdminClient();
  const { data: target, error: targetError } = await admin.from("profiles").select("role, active, removed_at, removed_by").eq("id", targetId).maybeSingle();
  if (targetError || !target) return fail("No fue posible consultar el usuario.");
  const requestedRole = String(form.get("role") ?? "OPERATOR") as AppRole;
  if (!validRoles.has(requestedRole)) return fail("Datos de usuario inválidos.");
  if (!canManage(auth!.profile.role, target.role as AppRole, requestedRole)) {
    return fail("Solo el administrador raíz puede gestionar este usuario.");
  }
  const confirmedOfflineRisk = form.get("confirm_offline_risk") === "1";
  // T113: solo ROOT puede forzar la desactivación pese a FR-005a; para cualquier otro actor se rechaza sin tocar datos.
  const forceReason = String(form.get("force_reason") ?? "").trim();
  if (forceReason && !isRoot(auth)) return json({ error: "Solo el administrador raíz puede forzar la desactivación." }, 403);
  const forceProfile = forceReason ? { force_reason: forceReason } : {};

  if (intent === "reset_password") {
    const password = String(form.get("password") ?? "");
    const passwordError = validatePasswordPair(password, String(form.get("password_confirm") ?? ""));
    if (passwordError) return fail(passwordError);
    if (target.removed_at) return fail("El usuario está retirado. Reactívalo antes de restablecer su contraseña.");

    const { error: passwordUpdateError } = await admin.auth.admin.updateUserById(targetId, { password });
    if (passwordUpdateError) return fail("No fue posible restablecer la contraseña.");
    const { error: auditError } = await admin.rpc("manage_user_assignments", {
      p_target: targetId,
      p_actor: actorId,
      p_profile: { audit_action: "PASSWORD_RESET" },
      p_assignments: null,
    });
    if (auditError) return fail("La contraseña se restableció, pero no fue posible registrar la auditoría. Notifica al administrador raíz.");
    return done("Contraseña restablecida.");
  }

  if (intent === "reactivate") {
    const profile = target;
    if (profile.active || !profile.removed_at || !profile.removed_by) return fail("El usuario no está formalmente retirado o ya fue reactivado.");

    const { data: authUserData, error: authUserError } = await admin.auth.admin.getUserById(targetId);
    if (authUserError || !authUserData.user || authUserData.user.id !== targetId) return fail("No fue posible consultar la identidad existente del usuario.");

    const parsed = parseAssignments(form);
    if ("error" in parsed) return fail(parsed.error);
    const assignments = profile.role === "OPERATOR" ? parsed.assignments : [];

    const { error: unbanError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });
    if (unbanError) return fail("No fue posible restaurar el acceso del usuario.");

    const { error: updateError } = await admin.rpc("manage_user_assignments", {
      p_target: targetId,
      p_actor: actorId,
      p_profile: { active: true, audit_action: "REACTIVATE_USER" },
      p_assignments: assignments,
    });
    if (updateError) {
      const { error: banCompensationError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
      return fail(banCompensationError
        ? "No fue posible reactivar el usuario y se requiere verificar su acceso antes de reintentar."
        : userRpcErrorMessage(updateError, "No fue posible reactivar el usuario. Los cambios fueron revertidos."));
    }
    return done("Usuario reactivado.");
  }

  if (intent === "remove") {
    if (targetId === actorId) return fail("No puedes retirar tu propio usuario.");
    if (!confirmedOfflineRisk) return fail(OFFLINE_RISK_MESSAGE);
    try {
      const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
      if (banError) throw banError;

      const { error: updateError } = await admin.rpc("manage_user_assignments", {
        p_target: targetId,
        p_actor: actorId,
        p_profile: { audit_action: "REMOVE_USER", ...forceProfile },
        p_assignments: [],
      });
      if (updateError) {
        await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });
        return fail(userRpcErrorMessage(updateError, "No fue posible retirar el usuario."));
      }
      return done("Usuario retirado y acceso revocado.");
    } catch {
      return fail("No fue posible retirar el usuario.");
    }
  }

  // intent === "update" (el correo ya no se edita: el usuario es inmutable y el correo es sintético).
  // Un usuario retirado solo se recupera con "Reactivar" (que también restaura el acceso de Auth).
  if (target.removed_at) return fail("El usuario está retirado. Usa Reactivar.");
  const fullName = String(form.get("full_name") ?? "").trim();
  const jobTitle = String(form.get("job_title") ?? "").trim() || null;
  const active = form.has("active");
  if (!fullName) return fail("Datos de usuario inválidos.");
  if (targetId === actorId && (!active || requestedRole !== auth!.profile.role)) return fail("No puedes desactivar ni cambiar tu propio rol.");
  // Desactivar (FR-005a) exige reconocer el riesgo de datos sin conexión; reactivar o editar no.
  if (!active && target.active !== false && !confirmedOfflineRisk) return fail(OFFLINE_RISK_MESSAGE);
  const parsed = parseAssignments(form, { validity: "opt-in" });
  if ("error" in parsed) return fail(parsed.error);

  try {
    const { error: updateError } = await admin.rpc("manage_user_assignments", {
      p_target: targetId,
      p_actor: actorId,
      p_profile: { full_name: fullName, job_title: jobTitle, role: requestedRole, active, audit_action: "UPDATE", ...forceProfile },
      p_assignments: requestedRole === "OPERATOR" && active ? parsed.assignments : [],
    });
    if (updateError) return fail(userRpcErrorMessage(updateError, "No fue posible completar la actualización del usuario."));
    return done("Usuario actualizado.");
  } catch {
    return fail("No fue posible completar la actualización del usuario.");
  }
};
