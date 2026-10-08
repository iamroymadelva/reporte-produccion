import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { decodeNotificationCursor, encodeNotificationCursor } from "../../../lib/notifications";

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  if (!locals.auth) return json({ error: "Debes iniciar sesión." }, 401);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? "all";
  if (filter !== "all" && filter !== "unread") return json({ error: "Filtro inválido." }, 400);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor ? decodeNotificationCursor(rawCursor) : null;
  if (rawCursor && !cursor) return json({ error: "Cursor inválido." }, 400);
  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase.rpc("list_notifications", {
    p_filter: filter,
    p_snapshot: cursor?.snapshotAt ?? null,
    p_before_created: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
  });
  if (error || !data) return json({ error: "No fue posible consultar las notificaciones." }, 500);
  const page = data as {
    items: unknown[];
    unreadCount: number;
    snapshotAt: string;
    nextCursor: { createdAt: string; id: string } | null;
  };
  return json({
    items: page.items,
    unreadCount: page.unreadCount,
    snapshotAt: page.snapshotAt,
    nextCursor: page.nextCursor ? encodeNotificationCursor({ ...page.nextCursor, snapshotAt: page.snapshotAt }) : null,
  });
};
