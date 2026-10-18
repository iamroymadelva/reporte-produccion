import { roleLabels, type AppRole } from "./types";

export const ADMIN_AUDIT_PAGE_SIZE = 50;

export const adminAuditActionLabels: Record<string, string> = {
  INSERT: "Creación",
  UPDATE: "Modificación",
  DELETE: "Eliminación",
  DEACTIVATE: "Desactivación",
  REACTIVATE: "Reactivación",
  USER_CREATED: "Usuario creado",
  REMOVE_USER: "Usuario retirado",
  REACTIVATE_USER: "Usuario reactivado",
  PASSWORD_RESET: "Contraseña restablecida",
  FORCE_DEACTIVATE: "Desactivación forzada",
  BOOTSTRAP_ROOT: "Administrador raíz inicial",
};

export const adminAuditEntityLabels: Record<string, string> = {
  profiles: "Usuario",
  machines: "Máquina",
  operator_machine_assignments: "Asignación de operario",
  lines: "Área / Línea",
  clients: "Cliente",
  products: "Producto",
  dosifier_types: "Tipo de dosificador",
  shifts: "Turno",
  stop_categories: "Categoría de parada",
  change_types: "Tipo de cambio",
  app_settings: "Configuración",
};

const fieldLabels: Record<string, string> = {
  id: "Id",
  code: "Código",
  name: "Nombre",
  description: "Descripción",
  location: "Ubicación",
  active: "Activo",
  sort_order: "Orden",
  numeric_code: "Código numérico",
  start_time: "Hora de inicio",
  end_time: "Hora de fin",
  username: "Usuario",
  full_name: "Nombre completo",
  job_title: "Cargo",
  role: "Rol",
  removed_at: "Retirado el",
  removed_by: "Retirado por",
  possible_unsynced_data: "Posibles datos sin sincronizar",
  created_by: "Creado por",
  created_at: "Fecha de creación",
  operator_id: "Operario",
  machine_id: "Máquina",
  shift_id: "Turno",
  valid_from: "Vigente desde",
  valid_to: "Vigente hasta",
  off_shift_grace: "Gracia fuera de turno",
  offline_login_window: "Ventana de acceso sin conexión",
  reason: "Motivo",
  pendingCount: "Pendientes por subir",
  pendingDevices: "Dispositivos con pendientes",
  activeReportId: "Reporte activo",
};

export type AdminAuditFilters = {
  from: string | null;
  to: string | null;
  actor: string | null;
  action: string | null;
  entityType: string | null;
  page: number;
  error?: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_]{1,40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseAdminAuditFilters(params: URLSearchParams): AdminAuditFilters {
  const read = (key: string) => (params.get(key) ?? "").trim() || null;
  const filters: AdminAuditFilters = {
    from: read("from"), to: read("to"), actor: read("actor"), action: read("action"), entityType: read("entity_type"), page: 1,
  };
  if (filters.from && !validDate(filters.from)) return { ...filters, error: "La fecha inicial no es válida." };
  if (filters.to && !validDate(filters.to)) return { ...filters, error: "La fecha final no es válida." };
  if (filters.from && filters.to && filters.from > filters.to) {
    return { ...filters, error: "La fecha inicial no puede ser posterior a la final." };
  }
  if (filters.action && !TOKEN_PATTERN.test(filters.action)) return { ...filters, error: "La acción no es válida." };
  if (filters.entityType && !TOKEN_PATTERN.test(filters.entityType)) return { ...filters, error: "La entidad no es válida." };
  if (filters.actor && (filters.actor.length > 80 || /[,()*%\\]/.test(filters.actor))) {
    return { ...filters, error: "El autor no es válido." };
  }
  const rawPage = params.get("page");
  if (rawPage !== null && rawPage !== "") {
    const page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > 100000) return { ...filters, error: "La página no es válida." };
    filters.page = page;
  }
  return filters;
}

/** Inicio del día operativo de Bogotá (UTC-5 fijo, sin horario de verano) como instante UTC. */
function bogotaStart(date: string, addDays = 0) {
  const value = new Date(`${date}T00:00:00-05:00`);
  value.setUTCDate(value.getUTCDate() + addDays);
  return value.toISOString();
}

export const ADMIN_AUDIT_SELECT =
  "id, action, entity_type, entity_id, entity_label, performed_by, actor_role, old_value, new_value, details, performed_at, performer:profiles!administrative_audit_log_performed_by_fkey(full_name, username)";

export type AdminAuditRow = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  performed_by: string | null;
  actor_role: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  performed_at: string;
  performer?: { full_name?: string | null; username?: string | null } | null;
};

type AuditQueryResult = { error: string | null; rows: AdminAuditRow[]; total: number };

/** Consulta paginada. `supabase` es el cliente con la sesión de ROOT (RLS: solo ROOT lee la tabla). */
export async function queryAdminAudit(supabase: any, filters: AdminAuditFilters): Promise<AuditQueryResult> {
  let actorIds: string[] | null = null;
  if (filters.actor) {
    if (UUID_PATTERN.test(filters.actor)) {
      actorIds = [filters.actor];
    } else {
      const { data, error } = await supabase.from("profiles").select("id")
        .or(`username.ilike.%${filters.actor}%,full_name.ilike.%${filters.actor}%`).limit(200);
      if (error) return { error: "No fue posible filtrar por autor.", rows: [], total: 0 };
      const ids: string[] = (data ?? []).map((row: { id: string }) => row.id);
      actorIds = ids;
      if (ids.length === 0) return { error: null, rows: [], total: 0 };
    }
  }
  const fromIndex = (filters.page - 1) * ADMIN_AUDIT_PAGE_SIZE;
  let query = supabase.from("administrative_audit_log").select(ADMIN_AUDIT_SELECT, { count: "exact" });
  if (filters.from) query = query.gte("performed_at", bogotaStart(filters.from));
  if (filters.to) query = query.lt("performed_at", bogotaStart(filters.to, 1));
  if (actorIds) query = query.in("performed_by", actorIds);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  const { data, error, count } = await query
    .order("performed_at", { ascending: false }).order("id", { ascending: false })
    .range(fromIndex, fromIndex + ADMIN_AUDIT_PAGE_SIZE - 1);
  if (error) return { error: "No fue posible consultar el historial administrativo.", rows: [], total: 0 };
  return { error: null, rows: (data ?? []) as AdminAuditRow[], total: count ?? 0 };
}

export type AdminAuditChange = { label: string; previous?: string; next?: string };

function display(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (field === "role" && typeof value === "string") return roleLabels[value as AppRole] ?? value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Cambios legibles (antes/después) de una fila del historial administrativo. */
export function describeAdminChanges(row: Pick<AdminAuditRow, "old_value" | "new_value">): AdminAuditChange[] {
  const previous = row.old_value ?? {};
  const next = row.new_value ?? {};
  const both = Boolean(row.old_value && row.new_value);
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])];
  return keys
    .filter((key) => !both || JSON.stringify(previous[key] ?? null) !== JSON.stringify(next[key] ?? null))
    .map((key) => ({
      label: fieldLabels[key] ?? key,
      ...(row.old_value ? { previous: display(key, previous[key]) } : {}),
      ...(row.new_value ? { next: display(key, next[key]) } : {}),
    }));
}
