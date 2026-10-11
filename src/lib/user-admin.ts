import type { AppRole } from "./types";

/** Dominio del correo sintético de autenticación: el usuario nunca lo ve ni lo edita (R1). */
export const SYNTHETIC_EMAIL_DOMAIN = "usuarios.reporte-produccion.invalid";
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const MIN_PASSWORD_LENGTH = 8;
export const PENDING_DATA_MESSAGE = "El usuario tiene datos pendientes de subir o un reporte activo";
export const OFFLINE_RISK_MESSAGE = "Marca \"Entiendo que puede haber datos en dispositivos sin conexión\" para continuar.";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function syntheticEmail(username: string) {
  return `${username}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

/** Devuelve un mensaje de error o null si la contraseña es válida y está confirmada. */
export function validatePasswordPair(password: string, confirmation: string) {
  if (password.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password !== confirmation) return "La confirmación de la contraseña no coincide.";
  return null;
}

/** Matriz de gestión: ROOT gestiona todo; el coordinador (ADMINISTRATOR) solo operarios y solo con rol OPERATOR. */
export function canManage(actorRole: AppRole | null | undefined, targetRole: AppRole | null | undefined, newRole: AppRole = targetRole ?? "OPERATOR") {
  if (actorRole === "ROOT") return true;
  return actorRole === "ADMINISTRATOR" && targetRole === "OPERATOR" && newRole === "OPERATOR";
}

export function creatableRoles(actorRole: AppRole | null | undefined): AppRole[] {
  if (actorRole === "ROOT") return ["OPERATOR", "ADMINISTRATOR", "VIEWER", "ROOT"];
  if (actorRole === "ADMINISTRATOR") return ["OPERATOR"];
  return [];
}

export interface AssignmentInput {
  machine_id: string;
  shift_id: string;
  /** Ausente = la RPC conserva la vigencia existente de una asignación conservada (o usa el valor por defecto en una nueva). */
  valid_from?: string | null;
  valid_to?: string | null;
}

/**
 * Lee `assignments` (`machine_id:shift_id`) y la vigencia común `valid_from`/`valid_to` del formulario.
 * Con `validity: "opt-in"` (edición) la vigencia solo se envía si el formulario marca `apply_validity=1`;
 * sin ese permiso explícito no se envían claves de vigencia y las asignaciones conservadas no cambian.
 */
export function parseAssignments(form: FormData, { validity = "always" }: { validity?: "always" | "opt-in" } = {}): { assignments: AssignmentInput[] } | { error: string } {
  const sendValidity = validity === "always" || form.get("apply_validity") === "1";
  const validFrom = String(form.get("valid_from") ?? "").trim() || null;
  const validTo = String(form.get("valid_to") ?? "").trim() || null;
  if (sendValidity && ((validFrom && !datePattern.test(validFrom)) || (validTo && !datePattern.test(validTo)))) return { error: "La vigencia de las asignaciones no es válida." };
  if (sendValidity && validFrom && validTo && validTo < validFrom) return { error: "La vigencia hasta no puede ser anterior a la vigencia desde." };
  const seen = new Set<string>();
  const assignments: AssignmentInput[] = [];
  for (const raw of form.getAll("assignments").map(String)) {
    const [machineId, shiftId, ...rest] = raw.split(":");
    if (rest.length > 0 || !machineId || !shiftId || !uuidPattern.test(machineId) || !uuidPattern.test(shiftId)) return { error: "Las asignaciones no son válidas." };
    const key = `${machineId}:${shiftId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push(sendValidity ? { machine_id: machineId, shift_id: shiftId, valid_from: validFrom, valid_to: validTo } : { machine_id: machineId, shift_id: shiftId });
  }
  return { assignments };
}

interface RpcErrorLike { code?: string | null; message?: string | null }

/** Traduce los errores de manage_user_assignments a mensajes para el usuario. */
export function userRpcErrorMessage(error: RpcErrorLike | null | undefined, fallback: string) {
  const text = `${error?.message ?? ""}`;
  if (error?.code === "P0004" || text.includes("USER_HAS_PENDING_DATA")) return `${PENDING_DATA_MESSAGE}.`;
  if (error?.code === "22023" && text.includes("Force reason")) return "El motivo debe tener al menos 10 caracteres.";
  if (error?.code === "42501") return "No tienes permisos para gestionar este usuario.";
  if (text.includes("Only active machines")) return "Selecciona únicamente máquinas activas.";
  if (text.includes("Only active shifts")) return "Selecciona únicamente turnos activos.";
  if (text.includes("Invalid validity range")) return "La vigencia hasta no puede ser anterior a la vigencia desde.";
  if (text.includes("Only active operators")) return "Solo los operarios activos pueden tener asignaciones.";
  if (error?.code === "23514") return "Debe existir al menos un administrador raíz activo.";
  return fallback;
}
