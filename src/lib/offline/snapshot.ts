/**
 * Snapshot de trabajo del Operario (T079/T081): descarga de GET /api/offline/snapshot, almacenamiento por usuario
 * y reconciliación de la copia local (`entities`) con el servidor. El snapshot jamás se guarda en Cache Storage.
 */
import { idbGet, idbPut } from "./db";
import { clearLocalSession, getLocalSession } from "./offline-auth";
import { countByState, listOperations, replaceEntities } from "./outbox";
import type { CatalogItem, EntityRecord, LocalChange, LocalReport, LocalStop, OfflineSnapshot } from "./types";

export type SnapshotFetch =
  | { status: "ok"; snapshot: OfflineSnapshot }
  | { status: "unauthorized" }
  | { status: "forbidden"; message: string }
  | { status: "offline" }
  | { status: "error"; message: string };

export function normalizeSnapshot(body: any): OfflineSnapshot | null {
  const profile = body?.profile;
  if (!profile || typeof profile.id !== "string") return null;
  const catalogs = body.catalogs ?? {};
  const list = (value: unknown) => (Array.isArray(value) ? value : []) as CatalogItem[];
  const now = new Date().toISOString();
  return {
    userId: profile.id,
    fetchedAt: typeof body.fetchedAt === "string" ? body.fetchedAt : now,
    serverTime: typeof body.serverTime === "string" ? body.serverTime : now,
    profile: { id: profile.id, full_name: profile.full_name ?? "", role: profile.role ?? "OPERATOR", job_title: profile.job_title ?? null },
    settings: {
      offShiftGrace: body.settings?.offShiftGrace ?? null,
      offlineLoginWindow: body.settings?.offlineLoginWindow ?? null,
    },
    shifts: Array.isArray(body.shifts) ? body.shifts : [],
    assignments: Array.isArray(body.assignments) ? body.assignments : [],
    catalogs: {
      stopCategories: list(catalogs.stopCategories),
      changeTypes: list(catalogs.changeTypes),
      clients: list(catalogs.clients),
      products: list(catalogs.products),
      lines: list(catalogs.lines),
      dosifierTypes: list(catalogs.dosifierTypes),
    },
    activeReport: body.activeReport && typeof body.activeReport === "object" ? body.activeReport : null,
  };
}

export async function saveSnapshot(snapshot: OfflineSnapshot) {
  await idbPut("snapshot", snapshot);
}

export async function loadSnapshot(userId: string): Promise<OfflineSnapshot | null> {
  return (await idbGet<OfflineSnapshot>("snapshot", userId)) ?? null;
}

/**
 * Cierre de sesión confirmado (dispositivo compartido): se elimina la sesión local (la identidad verificada con la
 * contraseña sin conexión). Su outbox, copia local y snapshot SE CONSERVAN (aislados por userId) y vuelven cuando ese
 * mismo usuario inicia sesión (en línea, o sin conexión con su contraseña). Sin sesión local, sin conexión no se opera
 * como nadie.
 */
export async function forgetCurrentUser() {
  resetCurrentUserCache();
  await clearLocalSession();
}

export async function fetchSnapshot(): Promise<SnapshotFetch> {
  let response: Response;
  try {
    response = await fetch("/api/offline/snapshot", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
  } catch {
    return { status: "offline" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (response.status === 403) {
    const body = await response.json().catch(() => null);
    return { status: "forbidden", message: body?.error ?? "Solo un Operario puede usar esta pantalla." };
  }
  if (!response.ok) return { status: "error", message: "No fue posible preparar los datos sin conexión." };
  const snapshot = normalizeSnapshot(await response.json().catch(() => null));
  if (!snapshot) return { status: "error", message: "La respuesta del servidor no es válida." };
  await saveSnapshot(snapshot);
  return { status: "ok", snapshot };
}

function mapActiveReport(userId: string, snapshot: OfflineSnapshot): EntityRecord[] {
  const raw = snapshot.activeReport;
  if (!raw || typeof raw.id !== "string") return [];
  const category = (id: string | null | undefined) => {
    const found = id ? snapshot.catalogs.stopCategories.find((entry) => entry.id === id) : null;
    return found ? { id: found.id, code: found.code, name: found.name } : null;
  };
  const machine = snapshot.assignments.find((assignment) => assignment.machine_id === raw.machine_id)?.machine;
  const { report_stop_events: rawStops, report_change_events: rawChanges, ...row } = raw;
  const report: LocalReport = {
    ...row, id: raw.id, folio: raw.folio ?? null, machine_id: raw.machine_id,
    machine_label: raw.machine_label ?? (machine ? `${machine.code} · ${machine.name}` : ""),
    status: raw.status ?? "DRAFT", started_at: raw.started_at, report_date: raw.report_date ?? null,
    shift_id: raw.shift_id ?? null, server_updated_at: raw.updated_at ?? null,
  };
  const entities: EntityRecord[] = [{ userId, entityType: "report", id: raw.id, reportId: raw.id, data: report, synced: true }];
  for (const stop of (Array.isArray(rawStops) ? rawStops : []) as any[]) {
    const data: LocalStop = {
      id: stop.id, report_id: raw.id, started_at: stop.started_at, ended_at: stop.ended_at ?? null,
      duration_seconds: stop.duration_seconds ?? null, description: stop.description ?? null,
      cancelled_at: stop.cancelled_at ?? null, cancellation_reason: stop.cancellation_reason ?? null,
      stop_category: stop.stop_category ?? category(stop.stop_category_id),
    };
    entities.push({ userId, entityType: "stop", id: stop.id, reportId: raw.id, data, synced: true });
  }
  for (const change of (Array.isArray(rawChanges) ? rawChanges : []) as any[]) {
    const type = snapshot.catalogs.changeTypes.find((entry) => entry.id === change.change_type_id);
    const data: LocalChange = {
      id: change.id, report_id: raw.id, change_type_id: change.change_type_id, change_type_name: type?.name,
      description: change.description, occurred_at: change.occurred_at,
    };
    entities.push({ userId, entityType: "change", id: change.id, reportId: raw.id, data, synced: true });
  }
  return entities;
}

/**
 * Refresca la copia local desde el snapshot. Si el usuario tiene operaciones sin subir (pendientes, en conflicto o
 * rechazadas) la copia local es la autoritativa y NO se toca: el servidor aún no conoce esos datos.
 */
export async function reconcileEntities(userId: string, snapshot: OfflineSnapshot): Promise<boolean> {
  const counts = await countByState(userId);
  if (counts.pending + counts.syncing + counts.conflict + counts.rejected > 0) return false;
  await replaceEntities(userId, mapActiveReport(userId, snapshot));
  return true;
}

export async function hasUnsyncedOperations(userId: string) {
  return (await listOperations(userId)).some((operation) => operation.state !== "synced");
}

export type CurrentUser =
  | { status: "ok"; userId: string; snapshot: OfflineSnapshot; online: boolean }
  | { status: "unauthorized" }
  | { status: "forbidden"; message: string }
  | { status: "no-snapshot" };

let userPromise: Promise<CurrentUser> | null = null;

export function resetCurrentUserCache() {
  userPromise = null;
}

/**
 * Usuario de la pantalla /turno. En línea, el servidor decide (401 → iniciar sesión); si la cookie en línea es de OTRO usuario
 * que la sesión local, se cierra esa cookie y se pide iniciar sesión. Sin conexión solo se opera con la SESIÓN LOCAL creada tras verificar la
 * contraseña (Phase 8): ya no se asume el último usuario del dispositivo.
 */
export function resolveCurrentUser(options: { force?: boolean } = {}): Promise<CurrentUser> {
  if (userPromise && !options.force) return userPromise;
  userPromise = (async (): Promise<CurrentUser> => {
    const local = await getLocalSession();
    const fetched = await fetchSnapshot();
    if (fetched.status === "ok") {
      if (local && local.userId !== fetched.snapshot.userId) {
        // La cookie en línea es de OTRA persona (sesión que quedó abierta en el dispositivo): no se opera como ella
        // mientras haya una sesión local distinta. Se cierra la cookie y se pide iniciar sesión (nada se pierde).
        try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", redirect: "manual" }); } catch { /* sin red */ }
        return { status: "unauthorized" };
      }
      await reconcileEntities(fetched.snapshot.userId, fetched.snapshot);
      return { status: "ok", userId: fetched.snapshot.userId, snapshot: fetched.snapshot, online: true };
    }
    if (fetched.status === "unauthorized") return { status: "unauthorized" };
    if (fetched.status === "forbidden") return { status: "forbidden", message: fetched.message };
    if (!local) return { status: "no-snapshot" };
    if (local.role !== "OPERATOR") {
      return { status: "forbidden", message: "Esta pantalla es solo para operarios. Abre la consulta sin conexión." };
    }
    const stored = await loadSnapshot(local.userId);
    if (stored) return { status: "ok", userId: local.userId, snapshot: stored, online: false };
    return { status: "no-snapshot" };
  })();
  return userPromise;
}
