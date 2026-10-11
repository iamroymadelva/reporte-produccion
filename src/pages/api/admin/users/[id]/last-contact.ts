import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { isManager } from "../../../../../lib/auth";
import { json } from "../../../../../lib/http";

/** FR-005a: último contacto, pendientes y reporte activo del usuario (la matriz de gestión la aplica la RPC). */
export const GET: APIRoute = async ({ params, request, cookies, locals }) => {
  if (!isManager(locals.auth ?? null)) return json({ error: "No tienes permisos de administración." }, 403);
  if (!params.id) return json({ error: "Usuario inválido." }, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("user_last_contact", { p_user: params.id });
  if (error) {
    if (error.code === "42501") return json({ error: "No tienes permisos para gestionar este usuario." }, 403);
    if (error.code === "P0002") return json({ error: "Usuario no encontrado." }, 404);
    return json({ error: "No fue posible consultar el último contacto." }, 500);
  }
  return json(data);
};
