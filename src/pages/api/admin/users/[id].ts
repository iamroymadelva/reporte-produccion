import type { APIRoute } from "astro";
import { createSupabaseAdminClient } from "../../../../lib/supabase/server";
import { redirectWithMessage } from "../../../../lib/http";
import type { AppRole } from "../../../../lib/types";

const validRoles = new Set<AppRole>(["ADMINISTRATOR", "OPERATOR", "VIEWER"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function emailBelongsToAnotherUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
  currentUserId: string,
) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    if (data.users.some((user) => user.id !== currentUserId && user.email?.trim().toLowerCase() === email)) return true;
    if (data.users.length < perPage) return false;
  }
}

export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  if (!params.id) return redirect(redirectWithMessage("/administracion/usuarios", "error", "Usuario inválido."), 303);
  const form = await request.formData();
  if (form.get("intent") === "remove") {
    if (params.id === locals.auth?.user.id) {
      return redirect(redirectWithMessage("/administracion/usuarios", "error", "No puedes retirar tu propio usuario Administrador."), 303);
    }
    try {
      const admin = createSupabaseAdminClient();
      const { data: activeAssignments, error: readError } = await admin
        .from("operator_machine_assignments")
        .select("machine_id")
        .eq("operator_id", params.id)
        .eq("active", true);
      if (readError) throw readError;

      const { error: banError } = await admin.auth.admin.updateUserById(params.id, { ban_duration: "876000h" });
      if (banError) throw banError;

      try {
        const { error: disableError } = await admin.from("operator_machine_assignments").update({ active: false }).eq("operator_id", params.id);
        if (disableError) throw disableError;
        const { error: profileError } = await admin.from("profiles").update({
          active: false,
          removed_at: new Date().toISOString(),
          removed_by: locals.auth!.user.id,
        }).eq("id", params.id);
        if (profileError) throw profileError;
        const { error: auditError } = await admin.from("administrative_audit_log").insert({
          action: "REMOVE_USER",
          entity_type: "profiles",
          entity_id: params.id,
          performed_by: locals.auth!.user.id,
          details: { disabled_assignment_count: activeAssignments?.length ?? 0 },
        });
        if (auditError) throw auditError;
      } catch (databaseError) {
        await admin.auth.admin.updateUserById(params.id, { ban_duration: "none" });
        if (activeAssignments?.length) {
          await admin.from("operator_machine_assignments").upsert(
            activeAssignments.map(({ machine_id }) => ({ operator_id: params.id, machine_id, active: true })),
            { onConflict: "operator_id,machine_id" },
          );
        }
        throw databaseError;
      }

      return redirect(redirectWithMessage("/administracion/usuarios", "ok", "Usuario retirado y acceso revocado."), 303);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible retirar el usuario.";
      return redirect(redirectWithMessage("/administracion/usuarios", "error", message), 303);
    }
  }
  const fullName = String(form.get("full_name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const jobTitle = String(form.get("job_title") ?? "").trim() || null;
  const role = String(form.get("role") ?? "OPERATOR") as AppRole;
  const active = form.has("active");
  const machineIds = form.getAll("machine_ids").map(String);

  if (!fullName || !emailPattern.test(email) || !validRoles.has(role)) return redirect(redirectWithMessage("/administracion/usuarios", "error", "Datos de usuario inválidos."), 303);
  if (params.id === locals.auth?.user.id && (!active || role !== "ADMINISTRATOR")) {
    return redirect(redirectWithMessage("/administracion/usuarios", "error", "No puedes desactivar ni retirar tu propio rol de Administrador."), 303);
  }

  const admin = createSupabaseAdminClient();
  const { data: authUserData, error: authUserError } = await admin.auth.admin.getUserById(params.id);
  const originalEmail = authUserData.user?.email?.trim().toLowerCase();
  if (authUserError || !originalEmail) {
    return redirect(redirectWithMessage("/administracion/usuarios", "error", "No fue posible consultar el correo actual del usuario."), 303);
  }

  const emailChanged = email !== originalEmail;
  if (emailChanged) {
    let duplicateEmail = false;
    try {
      duplicateEmail = await emailBelongsToAnotherUser(admin, email, params.id);
    } catch {
      return redirect(redirectWithMessage("/administracion/usuarios", "error", "No fue posible verificar la disponibilidad del correo."), 303);
    }
    if (duplicateEmail) {
      return redirect(redirectWithMessage("/administracion/usuarios", "error", "El correo ya está registrado por otro usuario."), 303);
    }

    const { error: emailError } = await admin.auth.admin.updateUserById(params.id, { email, email_confirm: true });
    if (emailError) {
      return redirect(redirectWithMessage("/administracion/usuarios", "error", "No fue posible actualizar el correo del usuario."), 303);
    }
  }

  try {
    const { error: profileError } = await admin.from("profiles").update({ full_name: fullName, job_title: jobTitle, role, active }).eq("id", params.id);
    if (profileError) throw profileError;

    const { error: disableError } = await admin.from("operator_machine_assignments").update({ active: false }).eq("operator_id", params.id);
    if (disableError) throw disableError;

    if (role === "OPERATOR" && machineIds.length > 0) {
      const assignments = machineIds.map((machineId) => ({
        operator_id: params.id,
        machine_id: machineId,
        active: true,
        created_by: locals.auth!.user.id,
      }));
      const { error: assignmentError } = await admin.from("operator_machine_assignments").upsert(assignments, { onConflict: "operator_id,machine_id" });
      if (assignmentError) throw assignmentError;
    }

    return redirect(redirectWithMessage("/administracion/usuarios", "ok", "Usuario actualizado."), 303);
  } catch {
    let message = "No fue posible completar la actualización del usuario.";
    if (emailChanged) {
      const { error: rollbackError } = await admin.auth.admin.updateUserById(params.id, { email: originalEmail, email_confirm: true });
      if (rollbackError) {
        message = "No fue posible completar la actualización y el correo debe verificarse antes de reintentar.";
      }
    }
    return redirect(redirectWithMessage("/administracion/usuarios", "error", message), 303);
  }
};
