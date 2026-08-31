import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { json } from "../../../lib/http";

const allowedFields = new Set([
  "report_date", "production_order", "line_id", "client_id", "client_name", "lot", "shift_id",
  "product_id", "product_name", "weight", "g_min", "dosifier_type_id", "started_at", "ended_at",
  "programmed_hours", "units_produced", "waste", "process_performance",
  "operator_performance", "observations",
]);

export const PATCH: APIRoute = async ({ request, cookies, locals, params }) => {
  if (!locals.auth || !params.id) return json({ error: "No autorizado." }, 401);
  const incoming = await request.json().catch(() => null);
  if (!incoming || typeof incoming !== "object") return json({ error: "Datos inválidos." }, 400);

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!allowedFields.has(key)) continue;
    if (key === "client_name" || key === "product_name") {
      updates[key] = typeof value === "string" && value.trim() ? value.trim() : null;
    } else {
      updates[key] = value === "" ? null : value;
    }
  }

  if (Object.keys(updates).length === 0) return json({ ok: true });

  const supabase = createSupabaseServerClient(request, cookies);
  const { data, error } = await supabase
    .from("production_reports")
    .update(updates)
    .eq("id", params.id)
    .select("id, updated_at")
    .single();

  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, report: data });
};
