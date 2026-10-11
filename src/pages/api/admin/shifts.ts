import type { APIRoute } from "astro";
import { adminCatalogErrorMessage } from "../../../lib/admin-catalog-errors";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { redirectWithMessage } from "../../../lib/http";
import { deleteOrDeactivateCatalogItem } from "../../../lib/admin-catalog-delete";

const path = "/administracion/turnos";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const supabase = createSupabaseServerClient(request, cookies);
  if (form.get("intent") === "reactivate") {
    if (!id) return redirect(redirectWithMessage(path, "error", "Turno inválido."), 303);
    const { data, error } = await supabase.from("shifts").update({ active: true }).eq("id", id).eq("active", false).select("id").maybeSingle();
    if (error) return redirect(redirectWithMessage(path, "error", "No fue posible reactivar el turno."), 303);
    if (!data) return redirect(redirectWithMessage(path, "error", "El turno no existe o ya está activo."), 303);
    return redirect(redirectWithMessage(path, "ok", "Turno reactivado."), 303);
  }
  if (form.get("intent") === "delete") {
    const result = await deleteOrDeactivateCatalogItem(supabase, "shifts", id, { label: "Turno" });
    return redirect(redirectWithMessage(path, result.ok ? "ok" : "error", result.message), 303);
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
