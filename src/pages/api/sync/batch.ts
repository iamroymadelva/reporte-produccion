import type { APIRoute } from "astro";
import { json } from "../../../lib/http";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/** POST /api/sync/batch (contracts/sync-protocol.md): aplica en orden las operaciones offline del operario. */
const OPERATION_TYPES = new Set([
  "CREATE_REPORT", "SAVE_REPORT_FIELDS", "START_STOP", "CLOSE_STOP", "SET_STOP_CATEGORY",
  "CANCEL_STOP", "ADD_CHANGE", "SUBMIT_REPORT", "CANCEL_REPORT",
]);
const MAX_OPERATIONS = 50;
/** Tamaño máximo del cuerpo (~2 MB): se comprueba Content-Length y la longitud real antes de interpretar el JSON. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SyncOperation = {
  operationId: string;
  userId: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  [key: string]: unknown;
};

type SyncResult = { operationId: string; status: string; code?: string; message?: string; [key: string]: unknown };

function noStore(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function isOperation(value: unknown): value is SyncOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const op = value as Record<string, unknown>;
  return typeof op.operationId === "string" && uuidPattern.test(op.operationId)
    && typeof op.userId === "string"
    && typeof op.type === "string" && OPERATION_TYPES.has(op.type)
    && Number.isInteger(op.seq)
    && !!op.payload && typeof op.payload === "object" && !Array.isArray(op.payload);
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const auth = locals.auth;
  // 401: el cliente pide inicio de sesión y conserva toda su información.
  if (!auth) return noStore({ error: "Debes iniciar sesión." }, 401);
  if (auth.profile.role !== "OPERATOR" || auth.profile.active === false) {
    return noStore({ error: "Solo un Operario activo puede sincronizar reportes." }, 403);
  }

  const tooLarge = () => noStore({ error: "El lote es demasiado grande. Envía menos operaciones." }, 413);
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return tooLarge();
  let body: { operations?: unknown } | null = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const operations: unknown = body?.operations;
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_OPERATIONS) {
    return noStore({ error: `Envía entre 1 y ${MAX_OPERATIONS} operaciones.` }, 400);
  }
  if (!operations.every(isOperation)) {
    return noStore({ error: "Alguna operación no tiene la forma esperada (seq entero obligatorio)." }, 400);
  }
  if (new Set(operations.map((op) => op.seq)).size !== operations.length) {
    return noStore({ error: "Los seq de las operaciones no pueden repetirse." }, 400);
  }

  // Orden causal: solo por seq (obligatorio, entero y único).
  const ordered = [...operations].sort((a, b) => a.seq - b.seq);

  const supabase = createSupabaseServerClient(request, cookies);
  const results: SyncResult[] = [];
  const failedReports = new Set<string>();

  for (const op of ordered) {
    const reportId = typeof op.payload.reportId === "string" ? op.payload.reportId : null;

    // Las dependientes de un CREATE_REPORT fallido no se aplican.
    if (op.type !== "CREATE_REPORT" && reportId && failedReports.has(reportId)) {
      results.push({
        operationId: op.operationId, status: "rejected", code: "DEPENDENCY_FAILED",
        message: "No se aplicó porque el reporte no pudo crearse en el servidor.",
      });
      continue;
    }

    if (op.userId !== auth.user.id) {
      results.push({
        operationId: op.operationId, status: "rejected", code: "FORBIDDEN",
        message: "La operación no pertenece a la sesión actual.",
      });
      continue;
    }

    const { data, error } = await supabase.rpc("apply_sync_operation", { op });
    if (error || !data || typeof data !== "object") {
      // Resultado incierto: se detiene el lote; lo no procesado sigue pendiente en el cliente (subida parcial).
      if (results.length === 0) return noStore({ error: "No fue posible sincronizar. Intenta de nuevo." }, 500);
      break;
    }
    const result = { ...(data as Record<string, unknown>), operationId: op.operationId } as SyncResult;
    results.push(result);
    if (op.type === "CREATE_REPORT" && result.status === "rejected" && reportId) failedReports.add(reportId);
  }

  return noStore({ results, serverTime: new Date().toISOString() });
};
