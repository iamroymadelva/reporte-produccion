import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { json, redirectWithMessage } from "../../../lib/http";

export const POST: APIRoute = async ({ request, cookies, locals, redirect }) => {
  const auth = locals.auth;
  if (!auth || auth.profile.role !== "OPERATOR") return json({ error: "Solo un Operario puede crear reportes." }, 403);

  const form = await request.formData();
  const machineId = String(form.get("machine_id") ?? "");
  const reportDate = String(form.get("report_date") ?? "") || null;
  if (!machineId) return redirect(redirectWithMessage("/reportes", "error", "Selecciona una máquina."), 303);

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase
    .from("production_reports")
    .insert({
      machine_id: machineId,
      report_date: reportDate,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    })
    .select("id")
    .single();

  if (error) {
    const message = error.code === "23505"
      ? "La máquina ya tiene un reporte en borrador."
      : error.message;
    return redirect(redirectWithMessage("/reportes", "error", message), 303);
  }

  return redirect(`/reportes/${data.id}`, 303);
};
