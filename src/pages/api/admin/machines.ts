import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { redirectWithMessage } from "../../../lib/http";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const supabase = createSupabaseServerClient(request, cookies);
  if (form.get("intent") === "delete") {
    const { count, error: referenceError } = await supabase.from("production_reports").select("id", { count: "exact", head: true }).eq("machine_id", id);
    if (referenceError) return redirect(redirectWithMessage("/administracion/maquinas", "error", referenceError.message), 303);
    if ((count ?? 0) > 0) return redirect(redirectWithMessage("/administracion/maquinas", "error", "No se puede eliminar porque existen reportes históricos que la referencian. Desactívala en su lugar."), 303);
    const { error: assignmentsError } = await supabase.from("operator_machine_assignments").delete().eq("machine_id", id);
    if (assignmentsError) return redirect(redirectWithMessage("/administracion/maquinas", "error", assignmentsError.message), 303);
    const { error } = await supabase.from("machines").delete().eq("id", id);
    if (error) return redirect(redirectWithMessage("/administracion/maquinas", "error", error.message), 303);
    return redirect(redirectWithMessage("/administracion/maquinas", "ok", "Máquina eliminada."), 303);
  }
  const values = {
    code: String(form.get("code") ?? "").trim(),
    name: String(form.get("name") ?? "").trim(),
    description: String(form.get("description") ?? "").trim() || null,
    active: id ? form.has("active") : true,
  };
  if (!values.code || !values.name) return redirect(redirectWithMessage("/administracion/maquinas", "error", "Código y nombre son obligatorios."), 303);

  const result = id
    ? await supabase.from("machines").update(values).eq("id", id)
    : await supabase.from("machines").insert(values);

  if (result.error) return redirect(redirectWithMessage("/administracion/maquinas", "error", result.error.message), 303);
  return redirect(redirectWithMessage("/administracion/maquinas", "ok", "Máquina guardada."), 303);
};
