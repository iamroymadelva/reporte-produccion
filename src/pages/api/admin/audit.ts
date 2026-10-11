import type { APIRoute } from "astro";
import { ADMIN_AUDIT_PAGE_SIZE, parseAdminAuditFilters, queryAdminAudit } from "../../../lib/admin-audit";
import { isRoot } from "../../../lib/auth";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

/** Historial administrativo (FR-029a): solo ROOT. Se valida aquí además del middleware y de la RLS. */
export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const auth = locals.auth;
  if (!auth) return respond({ error: "Debes iniciar sesión." }, 401);
  if (!isRoot(auth)) return respond({ error: "Solo el administrador raíz puede ver el historial administrativo." }, 403);

  const filters = parseAdminAuditFilters(new URL(request.url).searchParams);
  if (filters.error) return respond({ error: filters.error }, 400);

  const supabase = createSupabaseServerClient(request, cookies);
  const result = await queryAdminAudit(supabase, filters);
  if (result.error) return respond({ error: result.error }, 500);
  return respond({
    rows: result.rows,
    page: filters.page,
    pageSize: ADMIN_AUDIT_PAGE_SIZE,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / ADMIN_AUDIT_PAGE_SIZE)),
  });
};
