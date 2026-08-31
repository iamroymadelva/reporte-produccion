import type { APIRoute } from "astro";
import { adminCatalogErrorMessage } from "../../../lib/admin-catalog-errors";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { redirectWithMessage } from "../../../lib/http";

const path = "/administracion/turnos";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const supabase = createSupabaseServerClient(request, cookies);
  if (form.get("intent") === "delete") {
    const { error } = await supabase.from("shifts").delete().eq("id", id);
    if (error) {
      const message = error.code === "23503" ? "No se puede eliminar porque existen reportes históricos que lo referencian. Desactívalo en su lugar." : "No fue posible eliminar el turno.";
      return redirect(redirectWithMessage(path, "error", message), 303);
    }
    return redirect(redirectWithMessage(path, "ok", "Turno eliminado."), 303);
  }
  const startTime = String(form.get("start_time") ?? "");
  const endTime = String(form.get("end_time") ?? "");
  if (!startTime || !endTime) return redirect(redirectWithMessage(path, "error", "Las horas de inicio y final son obligatorias."), 303);

  const values = {
    name: String(form.get("name") ?? "").trim() || null,
    start_time: startTime,
    end_time: endTime,
    active: id ? form.has("active") : true,
  };
  const result = id
    ? await supabase.from("shifts").update(values).eq("id", id)
    : await supabase.from("shifts").insert(values);

  if (result.error) return redirect(redirectWithMessage(path, "error", adminCatalogErrorMessage(result.error, "No fue posible guardar el turno.")), 303);
  return redirect(redirectWithMessage(path, "ok", "Turno guardado."), 303);
};
