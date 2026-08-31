import type { APIRoute } from "astro";
import { adminCatalogErrorMessage } from "../../../lib/admin-catalog-errors";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { redirectWithMessage } from "../../../lib/http";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const supabase = createSupabaseServerClient(request, cookies);
  if (form.get("intent") === "reactivate") {
    if (!id) return redirect(redirectWithMessage("/administracion/paradas", "error", "Categoría de parada inválida."), 303);
    const { data, error } = await supabase.from("stop_categories").update({ active: true }).eq("id", id).eq("active", false).select("id").maybeSingle();
    if (error) return redirect(redirectWithMessage("/administracion/paradas", "error", "No fue posible reactivar la categoría de parada."), 303);
    if (!data) return redirect(redirectWithMessage("/administracion/paradas", "error", "La categoría de parada no existe o ya está activa."), 303);
    return redirect(redirectWithMessage("/administracion/paradas", "ok", "Categoría de parada reactivada."), 303);
  }
  if (form.get("intent") === "delete") {
    const { error } = await supabase.from("stop_categories").delete().eq("id", id);
    if (error) {
      const message = error.code === "23503" ? "No se puede eliminar porque existen reportes históricos que la referencian. Desactívala en su lugar." : "No fue posible eliminar la categoría de parada.";
      return redirect(redirectWithMessage("/administracion/paradas", "error", message), 303);
    }
    return redirect(redirectWithMessage("/administracion/paradas", "ok", "Categoría eliminada."), 303);
  }
  const values = {
    code: String(form.get("code") ?? "").trim(),
    name: String(form.get("name") ?? "").trim(),
    description: String(form.get("description") ?? "").trim() || null,
    active: id ? form.has("active") : true,
  };
  if (!/^\d+$/.test(values.code) || !values.name) return redirect(redirectWithMessage("/administracion/paradas", "error", "El código numérico y el nombre son obligatorios."), 303);

  const result = id
    ? await supabase.from("stop_categories").update(values).eq("id", id)
    : await supabase.from("stop_categories").insert(values);

  if (result.error) return redirect(redirectWithMessage("/administracion/paradas", "error", adminCatalogErrorMessage(result.error, "No fue posible guardar la categoría de parada.")), 303);
  return redirect(redirectWithMessage("/administracion/paradas", "ok", "Categoría guardada."), 303);
};
