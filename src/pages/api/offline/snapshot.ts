import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/** GET /api/offline/snapshot: datos de trabajo del Operario para operar sin conexión (contracts/http-api.md). */
function noStore(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Fecha civil (America/Bogota) desplazada `offsetDays`; sirve para acotar la vigencia de las asignaciones. */
function bogotaDate(offsetDays = 0) {
  const shifted = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
}

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const auth = locals.auth;
  if (!auth) return noStore({ error: "Debes iniciar sesión." }, 401);
  if (auth.profile.role !== "OPERATOR") return noStore({ error: "Solo un Operario puede descargar este paquete." }, 403);

  const supabase = createSupabaseServerClient(request, cookies);
  const today = bogotaDate(0);
  // Un turno nocturno cruza la medianoche: su fecha operativa puede ser la de ayer.
  const yesterday = bogotaDate(-1);
  const catalog = (table: string, columns: string, orderBy = "sort_order") =>
    supabase.from(table).select(columns).eq("active", true).order(orderBy, { ascending: true });

  const [settings, shifts, assignments, stopCategories, changeTypes, clients, products, lines, dosifierTypes, activeReport] =
    await Promise.all([
      supabase.from("app_settings").select("off_shift_grace, offline_login_window").single(),
      supabase.from("shifts").select("id, name, start_time, end_time, sort_order").eq("active", true).order("sort_order", { ascending: true }),
      supabase.from("operator_machine_assignments")
        .select("id, machine_id, shift_id, valid_from, valid_to, machine:machines(id, code, name, active)")
        .eq("operator_id", auth.user.id).eq("active", true)
        .lte("valid_from", today).or(`valid_to.is.null,valid_to.gte.${yesterday}`),
      catalog("stop_categories", "id, code, name, numeric_code", "numeric_code"),
      catalog("change_types", "id, code, name, sort_order"),
      catalog("clients", "id, code, name, sort_order"),
      catalog("products", "id, code, name, sort_order"),
      catalog("lines", "id, code, name, sort_order"),
      catalog("dosifier_types", "id, code, name, sort_order"),
      supabase.from("production_reports")
        .select("*, report_stop_events(*), report_change_events(*)")
        .eq("created_by", auth.user.id).eq("status", "DRAFT").maybeSingle(),
    ]);

  const failure = [settings, shifts, assignments, stopCategories, changeTypes, clients, products, lines, dosifierTypes, activeReport]
    .find((result) => result.error);
  if (failure) {
    console.error("offline snapshot failed", failure.error);
    return noStore({ error: "No fue posible preparar los datos sin conexión." }, 500);
  }

  const now = new Date().toISOString();
  const row = settings.data as { off_shift_grace?: string; offline_login_window?: string } | null;
  return noStore({
    profile: {
      id: auth.profile.id ?? auth.user.id, full_name: auth.profile.full_name,
      role: auth.profile.role, job_title: auth.profile.job_title ?? null,
    },
    settings: { offShiftGrace: row?.off_shift_grace ?? null, offlineLoginWindow: row?.offline_login_window ?? null },
    shifts: shifts.data ?? [],
    assignments: assignments.data ?? [],
    catalogs: {
      stopCategories: stopCategories.data ?? [],
      changeTypes: changeTypes.data ?? [],
      clients: clients.data ?? [],
      products: products.data ?? [],
      lines: lines.data ?? [],
      dosifierTypes: dosifierTypes.data ?? [],
    },
    activeReport: activeReport.data ?? null,
    serverTime: now,
    fetchedAt: now,
  });
};
