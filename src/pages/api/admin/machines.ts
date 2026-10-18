import type { APIRoute } from "astro";
import { adminCatalogErrorMessage } from "../../../lib/admin-catalog-errors";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { isManager } from "../../../lib/auth";
import { json, redirectWithMessage } from "../../../lib/http";
import { deleteOrDeactivateCatalogItem } from "../../../lib/admin-catalog-delete";

const MACHINE_LOCATION_MAX = 120;

export const POST: APIRoute = async ({ request, cookies, redirect, locals }) => {
  // La autorización real vive en la base (RLS); aquí se vuelve a comprobar el rol de gestor.
  if (!locals.auth) return json({ error: "Debes iniciar sesión." }, 401);
  if (!isManager(locals.auth)) return json({ error: "No tienes permisos de administración." }, 403);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const supabase = createSupabaseServerClient(request, cookies);
  if (form.get("intent") === "reactivate") {
    if (!id) return redirect(redirectWithMessage("/administracion/maquinas", "error", "Máquina inválida."), 303);
    const { data, error } = await supabase.from("machines").update({ active: true }).eq("id", id).eq("active", false).select("id").maybeSingle();
    if (error) return redirect(redirectWithMessage("/administracion/maquinas", "error", "No fue posible reactivar la máquina."), 303);
    if (!data) return redirect(redirectWithMessage("/administracion/maquinas", "error", "La máquina no existe o ya está activa."), 303);
    return redirect(redirectWithMessage("/administracion/maquinas", "ok", "Máquina reactivada."), 303);
  }
  if (form.get("intent") === "delete") {
    const result = await deleteOrDeactivateCatalogItem(supabase, "machines", id, { label: "Máquina", feminine: true });
    return redirect(redirectWithMessage("/administracion/maquinas", result.ok ? "ok" : "error", result.message), 303);
  }
  const values = {
    code: String(form.get("code") ?? "").trim(),
    name: String(form.get("name") ?? "").trim(),
    description: String(form.get("description") ?? "").trim() || null,
    location: String(form.get("location") ?? "").trim() || null,
    active: id ? form.has("active") : true,
  };
  if (!values.code || !values.name) return redirect(redirectWithMessage("/administracion/maquinas", "error", "Código y nombre son obligatorios."), 303);
  if (values.location && values.location.length > MACHINE_LOCATION_MAX) {
    return redirect(redirectWithMessage("/administracion/maquinas", "error", `La ubicación no puede superar ${MACHINE_LOCATION_MAX} caracteres.`), 303);
  }

  const result = id
    ? await supabase.from("machines").update(values).eq("id", id)
    : await supabase.from("machines").insert(values);

  if (result.error) return redirect(redirectWithMessage("/administracion/maquinas", "error", adminCatalogErrorMessage(result.error, "No fue posible guardar la máquina.")), 303);
  return redirect(redirectWithMessage("/administracion/maquinas", "ok", "Máquina guardada."), 303);
};
