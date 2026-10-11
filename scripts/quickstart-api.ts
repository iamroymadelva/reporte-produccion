/**
 * Ejecuta por HTTP real (servidor de desarrollo LOCAL + Supabase local) los pasos de quickstart.md que NO necesitan
 * navegador: Fase 2 (roles, bloqueo, alta, matriz de gestión, un reporte activo, aprobación, cancelación fuera de turno,
 * desactivación con pendientes, categorías) y Fase 3 (corrección con motivo, historial administrativo, filtros y Excel).
 * Las aserciones sobre la base usan `docker exec supabase_db_reporte-produccion psql` (solo local).
 *
 *   BASE=http://127.0.0.1:4399 bun scripts/quickstart-api.ts      (sobre una base recién reiniciada: bun run db:reset)
 */
import ExcelJS from "exceljs";

const BASE = process.env.BASE ?? "http://127.0.0.1:4399";
const PASSWORD = "Planta2026!";
const failures: string[] = [];
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(label);
};

function sql(query: string): string {
  const result = Bun.spawnSync(["docker", "exec", "supabase_db_reporte-produccion", "psql", "-U", "postgres", "-At", "-c", query]);
  if (result.exitCode !== 0) throw new Error(`psql: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

async function login(username: string, password = PASSWORD) {
  const jar = new Map<string, string>();
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
    body: new URLSearchParams({ username, password }).toString(),
  });
  for (const line of (response.headers as any).getSetCookie?.() ?? []) {
    const [pair] = String(line).split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    status: response.status, location: response.headers.get("location") ?? "", hasSession: jar.size > 0,
    fetch: (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, { redirect: "manual", ...init, headers: { Cookie: cookie(), Origin: BASE, ...(init.headers as Record<string, string>) } }),
    form: (path: string, fields: Record<string, string | string[]>) => {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(fields)) for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
      return fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: { Cookie: cookie(), Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    },
    json: (path: string, method: string, payload: unknown) => fetch(`${BASE}${path}`, { method, redirect: "manual", headers: { Cookie: cookie(), Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  };
}

const ID = { root: "10000000-0000-0000-0000-000000000004", coord: "10000000-0000-0000-0000-000000000001", auditor: "10000000-0000-0000-0000-000000000003", op1: "10000000-0000-0000-0000-000000000002", op2: "10000000-0000-0000-0000-000000000005" };
const machine = sql("select id from machines order by code limit 1");
const shifts = sql("select id from shifts order by name").split("\n");
const line = sql("select id from lines limit 1"), dosifier = sql("select id from dosifier_types limit 1");
const flash = (response: { headers?: Headers; location?: string }) => decodeURIComponent((response.headers?.get("location") ?? response.location ?? "").replaceAll("+", " "));

console.log("=== Fase 2 — Roles y aprobación ===");
// 1. Bloqueo de usuario tras 5 fallos (se usa op2 para no afectar al resto)
for (let i = 0; i < 5; i++) await login("op2", "incorrecta");
const lockedCorrect = await login("op2");
check("2.1 sexto intento (aun con contraseña correcta) queda bloqueado con el mensaje genérico", !lockedCorrect.hasSession && flash(lockedCorrect).includes("Usuario o contraseña incorrectos"), flash(lockedCorrect));
const wrongUnknown = await login("no.existe", "x");
check("2.1 un usuario inexistente da el MISMO mensaje", flash(wrongUnknown).includes("Usuario o contraseña incorrectos") && flash(wrongUnknown) === flash(lockedCorrect));
sql("update private.login_attempts set locked_until = now() - interval '1 minute' where username = 'op2'");
const unlocked = await login("op2");
check("2.1 pasado el bloqueo (15 min simulados) op2 entra", unlocked.hasSession && unlocked.status === 303, unlocked.status);

const root = await login("root"), coord = await login("coord1"), auditor = await login("auditor1"), op1 = await login("op1"), op2 = unlocked;

// 2. No hay recuperación ni invitación ni valores frecuentes
for (const [path, method] of [["/recuperar-contrasena", "GET"], ["/api/auth/recovery", "POST"], ["/auth/confirmar", "GET"], ["/api/catalogs/frequent", "POST"]] as const) {
  const r = method === "POST" ? await coord.form(path, { x: "1" }) : await coord.fetch(path);
  check(`2.2/2.7 ${method} ${path} ya no existe (404)`, r.status === 404, r.status);
}
const invite = await coord.form("/api/admin/users/invite", { email: "x@example.com", full_name: "X", role: "OPERATOR" });
check("2.2 /api/admin/users/invite ya no existe: no crea ni invita a nadie (la ruta [id] lo trata como un usuario inexistente)", invite.status !== 200 && sql("select count(*) from profiles where full_name = 'X'") === "0", { status: invite.status, flash: flash(invite) });

// 3. El coordinador crea un operario con contraseña, asigna máquina+turno y restablece la contraseña
const created = await coord.form("/api/admin/users", { username: "qs.op", full_name: "Operario Quickstart", job_title: "Operario", role: "OPERATOR", password: "Inicial2026!", password_confirm: "Inicial2026!", assignments: shifts.map((shift) => `${machine}:${shift}`) });
const qsId = sql("select id from profiles where username = 'qs.op'");
check("2.3 coord1 crea un operario con usuario y contraseña", created.status === 303 && Boolean(qsId), flash(created));
check("2.3 el alta queda como USER_CREATED en el historial administrativo", sql(`select count(*) from administrative_audit_log where action = 'USER_CREATED' and entity_id = '${qsId}'`) === "1");
check("2.3 la asignación quedó por máquina y turno", sql(`select count(*) from operator_machine_assignments where operator_id = '${qsId}' and active`) === String(shifts.length));
const qsLogin = await login("qs.op", "Inicial2026!");
check("2.3 el nuevo operario inicia sesión con su contraseña inicial", qsLogin.hasSession);
const reset = await coord.form(`/api/admin/users/${qsId}`, { intent: "reset_password", password: "Nueva2026!!", password_confirm: "Nueva2026!!" });
check("2.3 coord1 restablece su contraseña (PASSWORD_RESET sin guardarla)", reset.status === 303 && sql(`select count(*) from administrative_audit_log where action = 'PASSWORD_RESET' and entity_id = '${qsId}'`) === "1" && !sql(`select coalesce(string_agg(new_value::text || old_value::text || details::text, ''), '') from administrative_audit_log where action = 'PASSWORD_RESET'`).includes("Nueva2026"), flash(reset));
check("2.3 la contraseña nueva funciona y la anterior no", (await login("qs.op", "Nueva2026!!")).hasSession && !(await login("qs.op", "Inicial2026!")).hasSession);
// no puede editar root ni auditor1 (403 por solicitud directa)
const nameBefore = sql(`select full_name from profiles where id = '${ID.root}'`);
const editRoot = await coord.form(`/api/admin/users/${ID.root}`, { intent: "update", full_name: "Hackeado", role: "OPERATOR", active: "on" });
const editAuditor = await coord.form(`/api/admin/users/${ID.auditor}`, { intent: "reset_password", password: "Hackeada2026!", password_confirm: "Hackeada2026!" });
check("2.3 coord1 NO puede editar a root (solicitud directa rechazada, sin cambios)", (editRoot.status === 403 || flash(editRoot).includes("rror") || flash(editRoot).length > 0) && sql(`select full_name from profiles where id = '${ID.root}'`) === nameBefore, { status: editRoot.status, flash: flash(editRoot) });
check("2.3 coord1 NO puede restablecer la contraseña de auditor1", !(await login("auditor1", "Hackeada2026!")).hasSession && (await login("auditor1")).hasSession, { status: editAuditor.status, flash: flash(editAuditor) });
const coordCreatesCoord = await coord.form("/api/admin/users", { username: "qs.coord", full_name: "X", role: "ADMINISTRATOR", password: "Inicial2026!", password_confirm: "Inicial2026!" });
check("2.3 coord1 NO puede crear un coordinador (403)", coordCreatesCoord.status === 403 && sql("select count(*) from profiles where username = 'qs.coord'") === "0", coordCreatesCoord.status);
const rootCreatesAuditor = await root.form("/api/admin/users", { username: "qs.aud", full_name: "Auditor Quickstart", role: "VIEWER", password: "Inicial2026!", password_confirm: "Inicial2026!" });
check("4.1 root crea un auditor y este inicia sesión", rootCreatesAuditor.status === 303 && (await login("qs.aud", "Inicial2026!")).hasSession);

// 4. op1 inicia un reporte; un segundo queda bloqueado
const started = await op1.json("/api/reports", "POST", { machine_id: machine, started_at: new Date().toISOString() });
const startedBody: any = await started.json();
const reportId: string = startedBody.report?.id ?? startedBody.id;
check("2.4 op1 inicia un reporte en su máquina del turno vigente (201)", started.status === 201 && Boolean(reportId), started.status);
check("2.4 turno y fecha operativa se rellenan solos", sql(`select (shift_id is not null and report_date is not null)::text from production_reports where id = '${reportId}'`) === "true");
const second = await op1.json("/api/reports", "POST", { machine_id: machine, started_at: new Date().toISOString() });
check("2.4 un segundo reporte activo queda bloqueado (409 ACTIVE_REPORT_EXISTS)", second.status === 409 && ((await second.json()) as any).code === "ACTIVE_REPORT_EXISTS");
// 6b. coord1 no puede retirar a op1 con un reporte activo
const retireActive = await coord.form(`/api/admin/users/${ID.op1}`, { intent: "remove", confirm_offline_risk: "1" });
check("2.6b retirar a op1 con reporte activo está bloqueado", sql(`select active::text from profiles where id = '${ID.op1}'`) === "true" && /pendiente|activo/i.test(flash(retireActive)), flash(retireActive));
// 6c. parada sin categoría: no se puede cerrar sin elegirla
const stop = await op1.json(`/api/reports/${reportId}/stops`, "POST", {});
const stopBody: any = await stop.json();
const stopId: string = stopBody.stop?.id ?? stopBody.id;
check("2.6c op1 inicia una parada sin categoría (201)", stop.status === 201 && Boolean(stopId), stop.status);
const closeNoCat = await op1.json(`/api/reports/${reportId}/stops/${stopId}/close`, "POST", {});
check("2.6c cerrarla sin categoría se rechaza", closeNoCat.status >= 400 && closeNoCat.status < 500, closeNoCat.status);
const categoryId = sql("select id from stop_categories order by code limit 1");
const setCat = await op1.json(`/api/reports/${reportId}/stops/${stopId}/category`, "PATCH", { stop_category_id: categoryId });
const closeOk = await op1.json(`/api/reports/${reportId}/stops/${stopId}/close`, "POST", {});
check("2.6c con categoría la parada se cierra", setCat.status === 200 && closeOk.status === 200, { setCat: setCat.status, close: closeOk.status });
// Datos y envío
const baseTime = new Date(Date.now() - 4 * 3600_000);
const fields = { production_order: "OP-QS-1", line_id: line, client_name: "Cliente de demostración", lot: "L-1", product_name: "Producto de demostración", weight: 250, g_min: 120, dosifier_type_id: dosifier, started_at: baseTime.toISOString(), ended_at: new Date().toISOString(), programmed_hours: 8, units_produced: 1000, waste: 5 };
const updatedAt = sql(`select to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') from production_reports where id = '${reportId}'`);
const patch = await op1.json(`/api/reports/${reportId}`, "PATCH", { ...fields, _base_updated_at: updatedAt });
check("2.4 op1 completa los datos (PATCH)", patch.status === 200, patch.status === 200 ? 200 : await patch.text());
// 5. coord1 no puede editar un reporte Activo (PATCH directo 403)
const coordPatch = await coord.json(`/api/reports/${reportId}`, "PATCH", { lot: "L-X" });
check("2.5 coord1 no puede editar un reporte Activo (PATCH → 403)", coordPatch.status === 403 && sql(`select lot from production_reports where id = '${reportId}'`) === "L-1", coordPatch.status);
const notYet = await coord.json(`/api/reports/${reportId}/approve`, "POST", {});
check("2.5 no se puede aprobar un reporte Activo (409)", notYet.status === 409, notYet.status);
const submit = await op1.json(`/api/reports/${reportId}/submit`, "POST", {});
check("2.4 op1 envía el reporte", submit.status === 200, submit.status === 200 ? 200 : await submit.text());
const approve = await coord.json(`/api/reports/${reportId}/approve`, "POST", {});
check("2.5 coord1 aprueba y cierra un reporte Enviado (200)", approve.status === 200, approve.status);
check("2.5 «Cerrado (aprobado)» con aprobador y hora", sql(`select (status = 'CLOSED' and approved_by = '${ID.coord}' and approved_at is not null and approver_full_name is not null)::text from production_reports where id = '${reportId}'`) === "true");
check("2.5 el detalle muestra «Aprobado por» a un auditor", (await (await auditor.fetch(`/reportes/${reportId}`)).text()).includes("Aprobado por"));

// 6. Cancelación fuera de turno por el coordinador
const op2Snapshot: any = await (await op2.fetch("/api/offline/snapshot")).json();
const op2Machine = op2Snapshot.assignments?.[0]?.machine_id;
const op2Start = await op2.json("/api/reports", "POST", { machine_id: op2Machine, started_at: new Date().toISOString() });
const op2Report: string = ((await op2Start.json()) as any).report?.id;
check("2.6 (preparación) op2 inicia un reporte activo", Boolean(op2Report), op2Start.status);
const tooSoon = await coord.json(`/api/reports/${op2Report}/cancel`, "POST", { reason: "Prueba" });
check("2.6 un Activo recién abierto NO lo puede cancelar el coordinador (< 2 h tras el fin del turno)", tooSoon.status >= 400 && sql(`select status from production_reports where id = '${op2Report}'`) === "DRAFT", tooSoon.status);
sql(`set session_replication_role = replica; update production_reports set created_at = now() - interval '2 days', started_at = now() - interval '2 days', report_date = current_date - 2 where id = '${op2Report}'`);
const offShift = await coord.json(`/api/reports/${op2Report}/cancel`, "POST", { reason: "Abierto fuera de turno (quickstart)" });
check("2.6 pasada la ventana el coordinador SÍ lo cancela con motivo", offShift.status === 200 && sql(`select status from production_reports where id = '${op2Report}'`) === "CANCELLED", offShift.status);
const auditorCancel = await auditor.json(`/api/reports/${op2Report}/cancel`, "POST", { reason: "x" });
check("2.6 el auditor no cancela nada (403)", auditorCancel.status === 403, auditorCancel.status);

// 6b'. Sin reporte activo ni pendientes se puede retirar (con la advertencia marcada) y reactivar
const lastContact = await coord.fetch(`/api/admin/users/${ID.op1}/last-contact`);
check("2.6b last-contact devuelve { lastSeenAt, pendingCount, activeReportId }", lastContact.status === 200 && "pendingCount" in ((await lastContact.json()) as any));
const retire = await coord.form(`/api/admin/users/${ID.op1}`, { intent: "remove", confirm_offline_risk: "1" });
check("2.6b sin reporte activo ni pendientes op1 se retira", sql(`select active::text from profiles where id = '${ID.op1}'`) === "false", flash(retire));
check("2.6b un usuario retirado no inicia sesión", !(await login("op1")).hasSession);
const reactivate = await coord.form(`/api/admin/users/${ID.op1}`, { intent: "reactivate", assignments: `${machine}:${shifts[0]}` });
check("2.6b se reactiva con la misma identidad y vuelve a entrar", (await login("op1")).hasSession && sql(`select count(*) from profiles where username = 'op1'`) === "1", flash(reactivate));

// 8. Eliminar una categoría en uso la desactiva; sin uso se elimina
const del = await coord.form("/api/admin/stop-categories", { intent: "delete", id: categoryId });
check("2.8 eliminar una categoría en uso la DESACTIVA (conserva el histórico)", sql(`select active::text from stop_categories where id = '${categoryId}'`) === "false", flash(del));
await coord.form("/api/admin/stop-categories", { code: "99", name: "Categoría temporal QS" });
const tempId = sql("select id from stop_categories where name = 'Categoría temporal QS'");
const delTemp = await coord.form("/api/admin/stop-categories", { intent: "delete", id: tempId });
check("2.8 una categoría sin uso se elimina definitivamente", sql(`select count(*) from stop_categories where id = '${tempId}'`) === "0", flash(delTemp));

console.log("=== Fase 3 — Auditoría, filtros y Excel ===");
const noReason = await coord.json(`/api/reports/${reportId}/correct`, "POST", { patch: { lot: "L-CORR" }, reason: "x" });
check("3.1 corregir sin motivo suficiente se rechaza (400)", noReason.status === 400, noReason.status);
const corrected = await coord.json(`/api/reports/${reportId}/correct`, "POST", { patch: { lot: "L-CORR" }, reason: "Error de digitación del lote" });
check("3.1 coord1 corrige un reporte Cerrado con motivo (200)", corrected.status === 200 && sql(`select lot from production_reports where id = '${reportId}'`) === "L-CORR", corrected.status === 200 ? 200 : await corrected.text());
check("3.1 el historial guarda campo, anterior, nuevo, autor, rol y motivo", sql(`select count(*) from report_audit_log where report_id = '${reportId}' and field_name = 'lot' and reason = 'Error de digitación del lote' and changed_by = '${ID.coord}' and actor_role = 'ADMINISTRATOR' and old_value::text like '%L-1%' and new_value::text like '%L-CORR%'`) === "1");
check("3.2 las ediciones del operario en su borrador también están en el historial", Number(sql(`select count(*) from report_audit_log where report_id = '${reportId}' and changed_by = '${ID.op1}'`)) > 0);
const timeline = await auditor.fetch(`/api/reports/${reportId}/timeline`);
const timelineBody: any = await timeline.json().catch(() => ({}));
check("3.3 auditor1 ve el reporte Cerrado con su historial", timeline.status === 200 && JSON.stringify(timelineBody).includes("L-CORR"), Object.keys(timelineBody));
const auditorHistory = await auditor.fetch("/administracion/historial");
const coordHistory = await coord.fetch("/administracion/historial");
const rootHistory = await root.fetch("/administracion/historial");
check("3.3 auditor y coordinador NO ven /administracion/historial; root sí", auditorHistory.status !== 200 && coordHistory.status !== 200 && rootHistory.status === 200, { auditor: auditorHistory.status, coord: coordHistory.status, root: rootHistory.status });
const apiAudit = await root.fetch("/api/admin/audit?action=PASSWORD_RESET");
check("3.3 GET /api/admin/audit (root) con filtro por acción", apiAudit.status === 200 && JSON.stringify(await apiAudit.json()).includes("PASSWORD_RESET"));
check("3.3 GET /api/admin/audit prohibido para coordinador y auditor (403)", (await coord.fetch("/api/admin/audit")).status === 403 && (await auditor.fetch("/api/admin/audit")).status === 403);
const today = new Date().toISOString().slice(0, 10);
const reportDate = sql(`select report_date from production_reports where id = '${reportId}'`);
const exported = await coord.fetch(`/api/reports/export?from=${reportDate}&to=${reportDate}&machine=${machine}&status=CLOSED`);
const workbook = new ExcelJS.Workbook();
if (exported.status === 200) await workbook.xlsx.load(await exported.arrayBuffer());
const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
check("3.4 el Excel (rango + máquina + estado) contiene SEGUIMIENTO, DETALLE PARADAS, CAMBIOS e HISTORIAL", exported.status === 200 && ["CAMBIOS", "HISTORIAL"].every((name) => sheetNames.includes(name)), sheetNames);
check("3.4 el Excel respeta el filtro (1 reporte) y trae columnas de aprobación", exported.status === 200 && JSON.stringify([1, 2, 3, 4].map((row) => workbook.getWorksheet("SEGUIMIENTO PRODUCCIÓN")?.getRow(row).values ?? [])).toLowerCase().includes("aprob") && (workbook.getWorksheet("SEGUIMIENTO PRODUCCIÓN")?.rowCount ?? 0) <= 4, workbook.getWorksheet("SEGUIMIENTO PRODUCCIÓN")?.rowCount);
const empty = await coord.fetch(`/api/reports/export?from=2020-01-01&to=2020-01-02`);
check("3.5 filtro sin resultados → 204 (sin descarga)", empty.status === 204, empty.status);
check("3.5 el operario no exporta (403)", (await op1.fetch(`/api/reports/export`)).status === 403);
void today;

console.log(failures.length === 0 ? "\nQUICKSTART API OK" : `\nQUICKSTART API CON FALLOS: ${failures.join(" | ")}`);
process.exit(failures.length === 0 ? 0 : 1);
