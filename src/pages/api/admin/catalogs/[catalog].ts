import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { redirectWithMessage } from "../../../../lib/http";

const catalogs: Record<string, { table: string; path: string; label: string }> = {
  products: { table: "products", path: "/administracion/productos", label: "Producto" },
  clients: { table: "clients", path: "/administracion/clientes", label: "Cliente" },
  lines: { table: "lines", path: "/administracion/lineas", label: "Área / Línea" },
  dosifier_types: { table: "dosifier_types", path: "/administracion/dosificadores", label: "Tipo de dosificador" },
};

export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const catalog = catalogs[String(params.catalog ?? "")];
  if (!catalog) return new Response("Catálogo no encontrado.", { status: 404 });

  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const supabase = createSupabaseServerClient(request, cookies);
  if (form.get("intent") === "delete") {
    const { error } = await supabase.from(catalog.table).delete().eq("id", id);
    if (error) {
      const message = error.code === "23503"
        ? "No se puede eliminar porque existen reportes históricos que lo referencian. Desactívalo en su lugar."
        : error.message;
      return redirect(redirectWithMessage(catalog.path, "error", message), 303);
    }
    return redirect(redirectWithMessage(catalog.path, "ok", `${catalog.label} eliminado.`), 303);
  }
  const values = {
    code: String(form.get("code") ?? "").trim(),
    name: String(form.get("name") ?? "").trim(),
    active: id ? form.has("active") : true,
  };

  if (!values.code || !values.name) {
    return redirect(redirectWithMessage(catalog.path, "error", "Código y nombre son obligatorios."), 303);
  }

  const result = id
    ? await supabase.from(catalog.table).update(values).eq("id", id)
    : await supabase.from(catalog.table).insert(values);

  if (result.error) return redirect(redirectWithMessage(catalog.path, "error", result.error.message), 303);
  return redirect(redirectWithMessage(catalog.path, "ok", `${catalog.label} guardado.`), 303);
};
