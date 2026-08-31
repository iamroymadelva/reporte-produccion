import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { json } from "../../../lib/http";

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const auth = locals.auth;
  if (!auth || !["ADMINISTRATOR", "OPERATOR"].includes(auth.profile.role)) {
    return json({ error: "No autorizado para guardar valores frecuentes." }, 403);
  }

  const body = await request.json().catch(() => null);
  const catalog = String(body?.catalog ?? "");
  const name = String(body?.name ?? "").trim();
  if (!name || !["clients", "products"].includes(catalog)) {
    return json({ error: "Valor frecuente inválido." }, 400);
  }

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("save_frequent_catalog_value", {
    target_catalog: catalog,
    entered_name: name,
  });

  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, id: data });
};
