import type { APIRoute } from "astro";
import { adminCatalogErrorMessage } from "../../../lib/admin-catalog-errors";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { redirectWithMessage } from "../../../lib/http";
import { deleteOrDeactivateCatalogItem } from "../../../lib/admin-catalog-delete";

const path = "/administracion/tipos-cambio";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const supabase = createSupabaseServerClient(request, cookies);
  if (form.get("intent") === "reactivate") {
    if (!id) return redirect(redirectWithMessage(path, "error", "Tipo de cambio inválido."), 303);
    const { data, error } = await supabase.from("change_types").update({ active: true }).eq("id", id).eq("active", false).select("id").maybeSingle();
    if (error) return redirect(redirectWithMessage(path, "error", "No fue posible reactivar el tipo de cambio."), 303);
    if (!data) return redirect(redirectWithMessage(path, "error", "El tipo de cambio no existe o ya está activo."), 303);
    return redirect(redirectWithMessage(path, "ok", "Tipo de cambio reactivado."), 303);
  }
  if (form.get("intent") === "delete") {
    const result = await deleteOrDeactivateCatalogItem(supabase, "change_types", id, { label: "Tipo de cambio" });
    return redirect(redirectWithMessage(path, result.ok ? "ok" : "error", result.message), 303);
  }
  const values = {
    code: String(form.get("code") ?? "").trim(),
    name: String(form.get("name") ?? "").trim(),
    active: id ? form.has("active") : true,
  };
  if (!values.code || !values.name) return redirect(redirectWithMessage(path, "error", "Código y nombre son obligatorios."), 303);

  const result = id
    ? await supabase.from("change_types").update(values).eq("id", id)
    : await supabase.from("change_types").insert(values);
  if (result.error) {
    const duplicate = result.error.code === "23505" ? "Ya existe un tipo de cambio con este código o nombre." : null;
    return redirect(redirectWithMessage(path, "error", duplicate ?? adminCatalogErrorMessage(result.error, "No fue posible guardar el tipo de cambio.")), 303);
  }
  return redirect(redirectWithMessage(path, "ok", "Tipo de cambio guardado."), 303);
};
