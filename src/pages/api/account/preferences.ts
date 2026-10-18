import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { hasAllowedMutationOrigin } from "../../../lib/notifications";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { isTimeFormat } from "../../../lib/time-format";

/**
 * POST /api/account/preferences {time_format: "24h" | "12h"}: preferencia de presentación de la propia persona.
 * Se guarda en `user_metadata.time_format` de Supabase Auth con la sesión del propio usuario (auth.updateUser):
 * no usa la service role y no puede tocar la metadata de otra persona. No concede ningún privilegio: los roles
 * viven en `profiles`/RLS y el trigger `handle_new_user` solo corre al CREAR el usuario (AFTER INSERT).
 */
function noStore(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  if (!locals.auth) return noStore({ error: "Debes iniciar sesión." }, 401);
  if (!hasAllowedMutationOrigin(request)) return noStore({ error: "Origen no permitido." }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return noStore({ error: "Solicitud inválida." }, 400); }
  const timeFormat = body && typeof body === "object" ? (body as { time_format?: unknown }).time_format : undefined;
  if (!isTimeFormat(timeFormat)) return noStore({ error: "Formato de hora no válido. Usa «24h» o «12h»." }, 422);

  const supabase = createSupabaseServerClient(request, cookies);
  const { error } = await supabase.auth.updateUser({ data: { time_format: timeFormat } });
  if (error) return noStore({ error: "No fue posible guardar la preferencia. Intenta nuevamente." }, 500);
  return noStore({ ok: true, time_format: timeFormat });
};
