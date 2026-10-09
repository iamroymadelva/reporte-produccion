---
description: "Task list — 001 Plataforma de reportes de producción offline y roles separados"
---

# Tasks: Plataforma de reportes de producción con operación offline y roles separados

**Input**: `specs/001-offline-production-reports/` — plan.md, spec.md (Clarifications 2026-10-09),
research.md (R1–R14), data-model.md, contracts/ (http-api, sync-protocol, database-rpc, realtime),
quickstart.md, gap-analysis.md.

**Tests**: OBLIGATORIAS según la Constitución v1.0.0, Principio IV, en todo cambio de reglas de
acceso, transiciones de estado, auditoría o sincronización. Usar pgTAP en `supabase/tests/` y
`bun test` en `tests/`. Cada test se escribe ANTES de su implementación y debe fallar primero.

**Organización**: las tareas se agrupan por historia de usuario de la spec (US1–US5), siguiendo el
orden de las fases del plan (BD → roles y aprobación → auditoría → offline → tiempo real). Cada
fase indica qué fase del plan (F#) cubre.

**Flujo de ejecución** (CLAUDE.md + Constitución): cada tarea la implementa el agente `executor`.
Cada fase de este documento termina en un **checkpoint GO/NO-GO** del auditor (Opus), con evidencia
de `bun test`, `bun run db:test`, `bunx astro check` y `bun run build`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia de la spec (US1 operario, US2 coordinador, US3 auditor, US4 administración,
  US5 login y roles).
- Rutas relativas a la raíz del repo. Las migraciones usan el prefijo `supabase/migrations/2026101…`.

---

## Phase 1: Setup (infraestructura compartida)

**Purpose**: dejar el entorno listo y aplicar el hotfix de seguridad previo (plan "F0").

- [ ] T001 Verificar que `bun run db:reset`, `bun run db:test`, `bun test`, `bunx astro check` y `bun run build` pasan en `redesign/ui-ux` antes de empezar, y guardar la salida como línea base en `specs/001-offline-production-reports/evidence/baseline.txt`
- [ ] T002 [P] Hotfix F0: en `src/components/ReportEditor.tsx` (líneas ~276-299 y ~596-599), no programar el autosave al servidor mientras `localPendingRef.current` sea verdadero. Los pendientes solo se suben con el botón "Guardar ahora". Añadir el test en `tests/operator-ui.test.tsx`: con pendientes locales y conexión restaurada, editar un campo NO llama a `PATCH /api/reports/:id`
- [ ] T003 [P] Crear el helper de pruebas pgTAP `supabase/tests/helpers/auth_as.sql` con funciones para simular sesión (`set local role authenticated` + `request.jwt.claims`) por rol (`ROOT`, `ADMINISTRATOR`, `VIEWER`, `OPERATOR`), reutilizables en todos los tests nuevos

**Checkpoint**: línea base verde y hotfix F0 con test → GO.

---

## Phase 2: Foundational — Base de datos (plan F1) ⚠️ BLOQUEA TODO LO DEMÁS

**Purpose**: esquema objetivo, helpers, RLS objetivo y ajustes mínimos de la app para que siga
compilando y pasando las pruebas. Detalle en data-model.md y database-rpc.md.

### Tests (escribir primero; deben fallar)

- [ ] T004 [P] pgTAP `supabase/tests/roles_root_invariant.test.sql`: existe el valor `ROOT` en `app_role`; desactivar o degradar al último ROOT activo falla al hacer commit; con dos ROOT se puede desactivar uno
- [ ] T005 [P] pgTAP `supabase/tests/shift_resolution.test.sql`: `private.current_shift_at` para Día (06-14), Tarde (14-22) y Noche (22-06). A las 23:30 del día 9 y a las 05:30 del día 10 devuelve el turno Noche con fecha operativa = día 9; sin turno activo devuelve vacío
- [ ] T006 [P] pgTAP `supabase/tests/active_report_limits.test.sql`: un operario no puede tener 2 reportes `DRAFT`; una máquina no puede tener 2 `DRAFT`; tras enviar o cancelar sí puede iniciar otro en otra máquina asignada del mismo turno; ya no aplica el límite de 5
- [ ] T007 [P] pgTAP `supabase/tests/report_shift_assignment.test.sql`: el `INSERT` de un reporte fija `shift_id` y `report_date` desde `started_at` aunque el cliente envíe otros valores; rechaza la máquina si no hay asignación activa para ese turno y esa vigencia
- [ ] T008 [P] pgTAP `supabase/tests/device_time_events.test.sql`: las paradas conservan el `started_at`/`ended_at` enviados; `received_at` lo fija el servidor; `clock_skew_review` es verdadero si la captura fue online y la diferencia supera 5 min; ningún rol puede hacer `DELETE` de paradas
- [ ] T009 [P] pgTAP `supabase/tests/change_events.test.sql`: el operario inserta cambios solo en su `DRAFT`, con tipo activo y descripción de 1–500 caracteres; los managers y el auditor los leen; nadie los borra
- [ ] T010 [P] pgTAP `supabase/tests/rls_matrix.test.sql`: matriz completa rol × acción de la sección "Matriz RLS objetivo" de data-model.md (SELECT de reportes en todos los estados por VIEWER; sin UPDATE de `DRAFT` por managers; operario sin escritura en catálogos; tablas de auditoría sin escritura para clientes)

### Implementación

- [ ] T011 Migración `supabase/migrations/20261010000100_app_role_root.sql`: `alter type public.app_role add value if not exists 'ROOT';` (solo eso)
- [ ] T012 Migración `supabase/migrations/20261010000200_report_status_closed.sql`: `alter type public.report_status add value if not exists 'CLOSED';` (solo eso)
- [ ] T013 Migración `supabase/migrations/20261010000300_roles_profiles_assignments.sql`: helpers `private.is_manager()` y `private.is_root()`; `profiles.username` (único, regex `^[a-z0-9._-]{3,32}$`, backfill desde la parte local del correo actual, con sufijo numérico si hay colisión) y `profiles.created_by`; trigger diferido `ensure_active_root`; `private.login_attempts`; asignaciones con `id uuid`, `shift_id`, `valid_from`, `valid_to` y la unicidad parcial nueva; migración de datos que expande cada asignación activa a todos los turnos activos; `private.current_shift_at(ts)` (depende de T011)
- [ ] T014 Migración `supabase/migrations/20261010000400_reports_stops_device_time.sql`: columnas de reporte `origin`, `received_at`, `approved_by`, `approved_at`, `approver_full_name` y el check de consistencia de aprobación; nueva versión de `validate_production_report` (fija `shift_id`/`report_date` con `current_shift_at(started_at)`, exige `started_at`, quita el límite de 5, valida la asignación por turno y vigencia); índices `one_active_per_operator`/`one_active_per_machine` en lugar de `production_reports_one_draft_per_machine`; en paradas, columnas `received_at`, `captured_offline`, `clock_skew_review`; `prepare_stop_event` sin sobrescribir horas; elimina la política `stops_delete_by_role` y el grant de DELETE (depende de T012, T013)
- [ ] T015 Migración `supabase/migrations/20261010000500_change_events.sql`: tabla `change_types` (semilla Producto, Formato, Lote, Otro; unicidad normalizada como los demás catálogos), tabla `report_change_events`, trigger `prepare_change_event`, RLS y grants según data-model.md (depende de T014)
- [ ] T016 Migración `supabase/migrations/20261010000600_audit_sync_tables.sql`: columnas nuevas de `report_audit_log` (`entity_type`, `entity_id`, `action`, `actor_role`, `reason`, `captured_offline`, `captured_at`, `received_at`) y de `administrative_audit_log` (`actor_role`, `old_value`, `new_value`); tablas `sync_operation_log` y `sync_quarantine` con RLS; vista `production_report_overview` (`is_off_shift`, `has_open_conflict`, `has_pending_review`, `active_stop`) con `security_invoker` (depende de T015)
- [ ] T017 Migración `supabase/migrations/20261010000700_target_rls.sql`: reescribir TODAS las políticas que comparan `= 'ADMINISTRATOR'` para usar `private.is_manager()`; VIEWER lee reportes, paradas y auditoría en todos los estados; quitar a los managers la política de UPDATE sobre `production_reports` en `DRAFT` (las correcciones pasarán por RPC); `administrative_audit_log` solo lo lee `private.is_root()`; quitar `OPERATOR` de `save_frequent_catalog_value` (revocar el execute) (depende de T016)
- [ ] T018 Actualizar `supabase/seed.sql`: cuentas de desarrollo `root` (ROOT), `coord1` (ADMINISTRATOR), `auditor1` (VIEWER), `op1` y `op2` (OPERATOR), todas con la contraseña `Planta2026!` y correo sintético `<username>@usuarios.reporte-produccion.invalid`, más asignaciones por turno para `op1` y `op2`
- [ ] T019 Adaptar las pruebas pgTAP existentes al nuevo modelo sin debilitar lo que verifican: `supabase/tests/final_demo_readiness.test.sql` (límite de 5 → un activo), `supabase/tests/report_audit_visibility.test.sql` (VIEWER en todos los estados), `supabase/tests/operator_workflow.test.sql` y `supabase/tests/report_cancellation.test.sql` (horas del dispositivo y asignaciones por turno), `supabase/tests/critical_constraints.test.sql`
- [ ] T020 Ajustes mínimos de la app al nuevo esquema, sin funciones nuevas: `src/lib/types.ts` (añadir `ROOT` a `AppRole` y `CLOSED` a `ReportStatus`, con etiquetas "Administrador raíz", "Coordinador", "Operario", "Auditor", "Activo", "Enviado", "Cerrado (aprobado)", "Cancelado"); `src/lib/auth.ts` (helpers `isManager`/`isRoot`); `src/middleware.ts` (admin = ROOT o ADMINISTRATOR); `src/components/StatusBadge.tsx` y `src/lib/report-status.ts` (variante `closed`); `src/pages/reportes/index.astro` y `src/pages/api/reports/index.ts` (enviar `started_at`, no `report_date`; un activo); `src/pages/api/admin/users/[id].ts` (RPC con asignaciones por turno); `src/pages/api/reports/[id]/stops/index.ts` y `.../close.ts` (enviar las horas del dispositivo)
- [ ] T021 [P] Actualizar `docs/DATA_MODEL.md` con las entidades nuevas y modificadas de data-model.md

**Checkpoint F1**: `db:reset` limpio; T004–T010 y las pruebas existentes en verde; `bun test`,
`astro check` y `build` en verde; datos existentes migrados → **GO del auditor** antes de seguir.

---

## Phase 3: User Story 5 — Inicio de sesión seguro y separación estricta de roles (P1) (plan F2)

**Goal**: login por usuario sin correo, bloqueo 5/15, cuatro roles con navegación y protección de
rutas, y rechazo de las acciones prohibidas también por solicitud directa.

**Independent Test**: quickstart §Fase 2 pasos 1–2; para cada rol, comparar pantallas y acciones con
la tabla de roles e intentar cada acción prohibida vía `fetch` directo → 401/403 sin cambios en la BD.

### Tests

- [ ] T022 [P] [US5] pgTAP `supabase/tests/login_lockout.test.sql`: `register_login_result` bloquea al 5.º fallo consecutivo durante 15 min; un éxito reinicia el contador; `check_login_allowed` devuelve falso mientras dure el bloqueo; funciona igual para usuarios inexistentes
- [ ] T023 [P] [US5] bun test `tests/login.test.ts`: `POST /api/auth/login` con credenciales malas, con usuario inexistente o con usuario bloqueado redirige con el MISMO mensaje "Usuario o contraseña incorrectos"; con credenciales correctas, la respuesta incluye `X-Offline-Enroll: 1`
- [ ] T024 [P] [US5] bun test `tests/role-access.test.ts`: para cada rol × ruta protegida (`/administracion/**`, `/api/admin/**`, `/api/reports/export`, `/administracion/historial`), el middleware y la ruta devuelven el código esperado (redirección/403); el OPERATOR recibe 403 al exportar

### Implementación

- [ ] T025 [US5] Migración `supabase/migrations/20261011000100_auth_lockout.sql`: funciones `security definer` `private.check_login_allowed(text)`, `private.register_login_result(text, bool)` y `public.resolve_login_email(text)`, con execute solo para `service_role`
- [ ] T026 [US5] Reescribir `src/pages/api/auth/login.ts`: leer `username`, normalizarlo, `check_login_allowed`, `resolve_login_email`, `signInWithPassword`, `register_login_result`, mensaje genérico único y cabecera `X-Offline-Enroll` en el éxito (depende de T025)
- [ ] T027 [US5] Actualizar `src/pages/iniciar-sesion.astro`: campo "Usuario" (`autocomplete="username"`) en lugar de correo y sin enlace "¿Olvidaste tu contraseña?"
- [ ] T028 [US5] Eliminar la recuperación y la invitación por correo: borrar `src/pages/api/auth/recovery.ts`, `src/pages/recuperar-contrasena.astro`, `src/pages/auth/confirmar.astro`, `supabase/templates/invite.html`, `supabase/templates/recovery.html`; quitar las rutas de `publicPaths` en `src/middleware.ts` y sus referencias en `supabase/config.toml`
- [ ] T029 [US5] Protección por rol en `src/middleware.ts`: `/administracion/historial` y `/api/admin/audit` solo ROOT; el resto de `/administracion/**` y `/api/admin/**` para ROOT o ADMINISTRATOR; `/turno` solo OPERATOR; `/consulta-offline` para managers y VIEWER
- [ ] T030 [P] [US5] Navegación por rol en `src/components/shell/nav-config.ts` (grupo Administración para ROOT y ADMINISTRATOR; "Historial administrativo" solo ROOT; "Tipos de cambio" para managers) y etiquetas de rol en `src/components/shell/NavUser.tsx`

**Checkpoint US5**: T022–T024 en verde y quickstart §Fase 2 pasos 1–2 → **GO**.

---

## Phase 4: User Story 4 — Administración con jerarquía raíz (P2) (plan F2)

**Goal**: el ROOT gestiona coordinadores y auditores; el coordinador gestiona operarios,
asignaciones por turno, máquinas y catálogos (incluidos los tipos de cambio); eliminar significa
desactivar si el elemento está en uso.

**Independent Test**: quickstart §Fase 2 pasos 3 y 8. `root` crea `coord2`; `coord2` crea un
operario con contraseña inicial, le asigna máquina y turno, crea y desactiva categorías; `coord2`
NO puede editar a `root` ni a `auditor1` (403 por solicitud directa).

### Tests

- [ ] T031 [P] [US4] pgTAP `supabase/tests/user_management_matrix.test.sql`: `manage_user_assignments` respeta la matriz de gestión de data-model.md (ADMINISTRATOR solo gestiona OPERATOR; ROOT gestiona todos) y nunca deja 0 ROOT activos
- [ ] T032 [P] [US4] pgTAP `supabase/tests/catalog_delete_or_deactivate.test.sql`: para cada catálogo, `delete_or_deactivate` borra si no hay referencias y desactiva (devuelve `deactivated`) si las hay; los reportes históricos conservan su valor; VIEWER y OPERATOR reciben rechazo
- [ ] T033 [P] [US4] bun test `tests/user-admin.test.ts`: `POST /api/admin/users` crea un usuario con correo sintético y contraseña (cliente admin simulado), rechaza un username duplicado, y un ADMINISTRATOR que intenta crear un ADMINISTRATOR o un VIEWER recibe 403; `intent=reset_password` audita `PASSWORD_RESET`

### Implementación

- [ ] T034 [US4] Migración `supabase/migrations/20261011000200_user_management.sql`: `public.manage_user_assignments(p_target uuid, p_actor uuid, p_profile jsonb, p_assignments jsonb)` (reemplaza `replace_operator_assignments`; asignaciones `{machine_id, shift_id, valid_from, valid_to}`; valida la matriz; notifica `ASSIGNMENTS_CHANGED`; audita `USER_CREATED`/`UPDATE`/`REMOVE_USER`/`REACTIVATE_USER`/`PASSWORD_RESET`), solo para `service_role`
- [ ] T035 [US4] Crear `src/pages/api/admin/users/index.ts` (alta con `auth.admin.createUser({ email: sintético, password, email_confirm: true })` y luego `manage_user_assignments`, con compensación si falla) y eliminar `src/pages/api/admin/users/invite.ts` (depende de T034)
- [ ] T036 [US4] Reescribir `src/pages/api/admin/users/[id].ts`: intents `update`, `reset_password` (`auth.admin.updateUserById({ password })`), `remove` y `reactivate`, todos con chequeo de la matriz actor→objetivo y la RPC nueva; quitar la edición de correo (depende de T034)
- [ ] T037 [US4] Actualizar `src/pages/administracion/usuarios.astro` y `src/components/UserReactivateAction.astro`: columnas Usuario/Nombre/Rol/Estado/Asignaciones; formulario de alta con usuario, contraseña inicial y confirmación; diálogo "Restablecer contraseña"; selector de asignaciones máquina × turno con vigencia; opciones de rol filtradas según el actor (el coordinador solo ve "Operario"); filas de ROOT, coordinadores y auditores sin acciones para el coordinador
- [ ] T038 [US4] Migración `supabase/migrations/20261011000300_catalog_delete_or_deactivate.sql`: `public.delete_or_deactivate(catalog text, item_id uuid)` para machines, lines, clients, products, dosifier_types, shifts, stop_categories y change_types
- [ ] T039 [US4] Usar `delete_or_deactivate` en `src/pages/api/admin/catalogs/[catalog].ts`, `src/pages/api/admin/machines.ts` (quitar el borrado de asignaciones), `src/pages/api/admin/shifts.ts` y `src/pages/api/admin/stop-categories.ts`, con los mensajes "eliminado" / "desactivado porque está en uso" (depende de T038)
- [ ] T040 [P] [US4] Catálogo de tipos de cambio: `src/pages/api/admin/change-types.ts`, `src/pages/administracion/tipos-cambio.astro` (reutilizar `src/components/CatalogAdminPage.astro`), y enlace en `src/pages/administracion/index.astro`
- [ ] T041 [P] [US4] Script de bootstrap del primer ROOT en producción `supabase/bootstrap-root.sql`, con instrucciones en `docs/DEPLOYMENT.md`

**Checkpoint US4**: T031–T033 en verde y quickstart §Fase 2 pasos 3 y 8 → **GO**.

---

## Phase 5: User Story 2 — Coordinador: aprobación, reglas de edición, filtros y Excel (P1) (plan F2 + F3)

**Goal**: aprobar y cerrar; el coordinador no edita reportes activos y solo cancela los "abiertos
fuera de turno"; corrección con motivo; filtros completos; Excel con cambios, historial y
aprobación. El tiempo real del tablero está en la Phase 9.

**Independent Test**: quickstart §Fase 2 pasos 5–6 y §Fase 3 pasos 1, 4 y 5.

### Tests

- [ ] T042 [P] [US2] pgTAP `supabase/tests/approval.test.sql`: `approve_report` solo pasa `SUBMITTED` → `CLOSED` siendo manager; rechaza `DRAFT`, `CANCELLED` y reportes con `sync_quarantine` `OPEN` (`OPEN_CONFLICT`); fija `approved_*`; VIEWER y OPERATOR reciben rechazo
- [ ] T043 [P] [US2] pgTAP `supabase/tests/cancellation_rules.test.sql`: el autor cancela su `DRAFT` con motivo; un manager solo puede cancelar si `is_off_shift`; nadie cancela `SUBMITTED` ni `CLOSED`; VIEWER nunca cancela
- [ ] T044 [P] [US2] pgTAP `supabase/tests/correct_report.test.sql`: `correct_report` exige motivo de al menos 5 caracteres y estado `SUBMITTED`/`CLOSED`; rechaza `DRAFT`; un `UPDATE` directo de un manager sobre `production_reports` se rechaza
- [ ] T045 [P] [US2] bun test `tests/report-filters.test.ts`: `parseReportFilters` con `from`/`to`, `machine`, `shift`, `operator`, `status=CLOSED`, `offshift=1`; los parámetros antiguos `period`/`date`/`month` se traducen a `from`/`to`; un rango inválido da error en español
- [ ] T046 [P] [US2] bun test `tests/report-export.test.ts`: `buildProductionWorkbook` crea las hojas SEGUIMIENTO PRODUCCIÓN, DETALLE PARADAS, CAMBIOS, HISTORIAL y CATÁLOGO PARADAS, más las columnas "Aprobado por" y "Fecha de aprobación"; `GET /api/reports/export` sin resultados responde 204; OPERATOR recibe 403

### Implementación

- [ ] T047 [US2] Migración `supabase/migrations/20261011000400_approval_cancellation.sql`: `public.approve_report(uuid)` y `public.cancel_report(uuid, text)` (fijan `app.change_reason`); ampliar `validate_production_report` con las transiciones `SUBMITTED→CLOSED` (solo por RPC) y la cancelación de managers fuera de turno; notificación `REPORT_APPROVED` en `private.notify_report_change`
- [ ] T048 [US2] Rutas `src/pages/api/reports/[id]/approve.ts` (nueva) y `src/pages/api/reports/[id]/cancel.ts` (reescrita para usar `cancel_report`, permitida al autor y a managers), con los códigos `NOT_SUBMITTED`, `OPEN_CONFLICT` y `NOT_CANCELLABLE` (depende de T047)
- [ ] T049 [US2] `src/pages/api/reports/[id].ts`: `PATCH` solo para el OPERATOR autor sobre `DRAFT`; los managers reciben 403 con el mensaje "Usa Corregir con motivo"
- [ ] T050 [US2] Migración `supabase/migrations/20261011000500_correct_report.sql`: `public.correct_report(report_id, patch, stops, changes, reason)` según database-rpc.md (las paradas y cambios corregidos también pasan por aquí)
- [ ] T051 [US2] Crear `src/pages/api/reports/[id]/correct.ts` y el componente `src/components/CorrectionDialog.tsx` (motivo obligatorio y resumen de los campos cambiados); en `src/components/ReportEditor.tsx`, el modo de corrección del manager solo para `SUBMITTED`/`CLOSED` y guardando por `/correct` (depende de T050)
- [ ] T052 [US2] Crear `src/components/ApprovalPanel.tsx` (botón "Aprobar y cerrar" con el motivo de bloqueo cuando aplica; bloque "Aprobado por … el …") e integrarlo en `src/pages/reportes/[id].astro`; para managers, un reporte `DRAFT` se muestra en solo lectura (sin editor ni `StopManager`), con la acción "Cancelar (abierto fuera de turno)" solo si `is_off_shift`
- [ ] T053 [US2] Mostrar el aprobador y la fecha de aprobación, y el distintivo "Abierto fuera de turno", en los listados de `src/pages/reportes/index.astro` y `src/pages/dashboard.astro` (usar la vista `production_report_overview`)
- [ ] T054 [US2] Reescribir `src/lib/report-filters.ts` (rango libre por fecha operativa + máquina, turno, operario, estado, parada activa y fuera de turno) y su UI en `src/pages/reportes/index.astro` (formulario GET con atajos Día/Semana/Mes y selectores cargados desde los catálogos) (depende de T045)
- [ ] T055 [US2] Actualizar `src/lib/report-export.ts` y `src/pages/api/reports/export.ts`: hojas CAMBIOS (de `report_change_events`) e HISTORIAL (de `report_audit_log` de los reportes filtrados, en orden cronológico), columnas de aprobación, filtros nuevos y respuesta 204 sin resultados; en la UI, mensaje "No hay reportes para los filtros seleccionados" (depende de T054)

**Checkpoint US2**: T042–T046 en verde y quickstart §Fase 2 pasos 5–6 y §Fase 3 pasos 1, 4 y 5 →
**GO**.

---

## Phase 6: User Story 3 — Auditor y auditoría completa (P2) (plan F3)

**Goal**: toda modificación queda auditada (cualquier rol) con rol, motivo e indicador offline; el
auditor ve todos los reportes con su historial cronológico; el historial administrativo completo
queda solo para ROOT.

**Independent Test**: quickstart §Fase 3 pasos 1–3. `auditor1` ve todos los estados y el historial
ascendente con rol y motivo; todos sus intentos de escritura por API o PostgREST son rechazados;
`root` ve `/administracion/historial` y `coord1` no.

### Tests

- [ ] T056 [P] [US3] pgTAP `supabase/tests/full_audit.test.sql`: el `INSERT` y cada `UPDATE` de reporte, parada y cambio, por OPERATOR y por manager vía RPC, generan filas con `actor_role`, `reason` (cuando aplica), `captured_offline`, `captured_at` y `received_at`; ningún cliente puede hacer `INSERT`/`UPDATE`/`DELETE` en `report_audit_log`
- [ ] T057 [P] [US3] pgTAP `supabase/tests/admin_audit_root_only.test.sql`: `INSERT`/`UPDATE`/`DELETE` sobre profiles, machines, assignments, catálogos, shifts y change_types generan filas con `old_value`/`new_value` y sin secretos; solo ROOT las lee; ADMINISTRATOR, VIEWER y OPERATOR reciben 0 filas
- [ ] T058 [P] [US3] pgTAP `supabase/tests/viewer_read_only.test.sql`: VIEWER no puede crear, editar, cancelar, aprobar ni eliminar nada por ninguna tabla ni RPC (cubre FR-032 y SC-007)
- [ ] T059 [P] [US3] bun test `tests/report-audit.test.ts` (ampliar): `describeAuditRows` ordena de forma ascendente y muestra el rol, el motivo, la marca "Capturado sin conexión" y la hora de llegada

### Implementación

- [ ] T060 [US3] Migración `supabase/migrations/20261012000100_full_audit.sql`: trigger `audit_report_entity` en `production_reports`, `report_stop_events` y `report_change_events` (cualquier rol; solo los campos que cambian; lee `app.change_reason`, `app.captured_offline` y `app.captured_at`); elimina `audit_report_correction` y `audit_stop_correction`
- [ ] T061 [US3] Migración `supabase/migrations/20261012000200_admin_audit.sql`: trigger `audit_admin_entity` en las tablas administrativas (reemplaza `audit_administrative_deletion`), con exclusión de campos sensibles
- [ ] T062 [US3] Actualizar `src/lib/report-audit.ts` y la sección de historial de `src/pages/reportes/[id].astro`: orden ascendente, actor + rol, motivo, distintivo "Capturado sin conexión" con la hora de llegada, y entradas de cambios (`entity_type='change'`); visible para managers y VIEWER en todos los estados
- [ ] T063 [US3] Crear `src/pages/api/reports/[id]/timeline.ts` (JSON con el detalle y el historial ascendente, para managers, VIEWER y el autor), que usará la Phase 9
- [ ] T064 [US3] Dashboard y listados para VIEWER en `src/pages/dashboard.astro` y `src/pages/reportes/index.astro`: KPIs y reportes de todos los estados (hoy solo ve los enviados), sin controles de edición
- [ ] T065 [P] [US3] Historial administrativo solo para ROOT: `src/pages/api/admin/audit.ts` (filtros `from`, `to`, `actor`, `action`, `entity_type`, paginado) y `src/pages/administracion/historial.astro`

**Checkpoint US3**: T056–T059 en verde y quickstart §Fase 3 → **GO**.

---

## Phase 7: User Story 1 — Operario: turno completo, también sin conexión (P1) (plan F4a)

**Goal**: el operario inicia, registra producción, paradas y cambios, envía o cancela, online u
offline, desde `/turno`. Nada se sube sin "Confirmar y subir", sin duplicados y aislado por usuario.

**Independent Test**: quickstart §Fase 4a pasos 1–7 (el Independent Test de US1 en spec.md).

### Tests

- [ ] T066 [P] [US1] pgTAP `supabase/tests/sync_operation.test.sql`: `apply_sync_operation` para cada tipo de contracts/sync-protocol.md; la misma `operationId` dos veces → `duplicate` sin filas extra; `userId` ajeno → `rejected FORBIDDEN`; una asignación revocada después de la captura → `applied` con `OFFLINE_DATA_REVIEW`; un reporte cancelado fuera de turno por un manager → `conflict` + `sync_quarantine` y el reporte no se reactiva; solapamiento → `rejected STOP_OVERLAP`
- [ ] T067 [P] [US1] bun test `tests/shifts.test.ts`: `src/lib/shifts.ts` replica `current_shift_at` (turnos que cruzan medianoche, fecha operativa) con los mismos casos que T005
- [ ] T068 [P] [US1] bun test `tests/offline-outbox.test.ts` (fake-indexeddb): migración de IndexedDB v1→v2 sin pérdida de `reportDrafts`; `seq` monótono; aislamiento por `userId`; los estados `conflict`/`rejected` nunca se borran solos; validación offline (un solo activo, sin solapamientos, sin enviar con una parada abierta, campos obligatorios)
- [ ] T069 [P] [US1] bun test `tests/sync-client.test.ts`: con pendientes y reconexión simulada NO se llama a `/api/sync/batch` ni a `PATCH` hasta confirmar (SC-004); "Posponer" conserva todo y lo vuelve a ofrecer; un corte de red tras N resultados deja N `synced` y el resto `pending`; un reintento reutiliza la `operationId` y recibe `duplicate`; un 401 conserva todo y pide login
- [ ] T070 [P] [US1] bun test `tests/operator-shift-app.test.tsx`: flujo completo offline en `OperatorShiftApp` (iniciar, 2 paradas, 1 cambio, datos, envío) que encola las operaciones esperadas con las horas del dispositivo y muestra "Sin conexión — guardado en este dispositivo · N pendientes"; sin asignación vigente muestra "Solicita una asignación a tu coordinador"
- [ ] T071 [P] [US1] bun test `tests/sync-full-shift.test.ts` (SC-003): 1 reporte + 40 paradas + 10 cambios + envío offline, contra un servidor simulado que aplica las reglas → los datos del servidor coinciden exactamente, sin duplicados

### Implementación — servidor

- [ ] T072 [US1] Migración `supabase/migrations/20261013000100_offline_sync.sql`: `public.apply_sync_operation(op jsonb)` (security invoker, cada operación aislada con manejo de excepciones, fija `app.captured_offline`/`app.captured_at`, registra `sync_operation_log`, desvía a `sync_quarantine` y emite las notificaciones `SYNC_CONFLICT`/`OFFLINE_DATA_REVIEW`/`CLOCK_SKEW_REVIEW`) y `public.review_quarantine(uuid, bool, text)`
- [ ] T073 [US1] Crear `src/pages/api/sync/batch.ts` según contracts/sync-protocol.md: valida sesión, rol OPERATOR activo y de 1 a 50 operaciones ordenadas por `seq`; llama a `apply_sync_operation` en orden; las dependientes de un `CREATE_REPORT` fallido devuelven `DEPENDENCY_FAILED` (depende de T072)
- [ ] T074 [P] [US1] Crear `src/pages/api/offline/snapshot.ts`: perfil, turnos, asignaciones vigentes, catálogos activos (categorías de parada, tipos de cambio, clientes, productos, líneas, dosificadores), reporte activo con paradas y cambios, `serverTime` y `fetchedAt`
- [ ] T075 [P] [US1] Rutas online con IDs y horas del cliente: `src/pages/api/reports/index.ts` (JSON `{id?, machine_id, started_at}`, códigos `ACTIVE_REPORT_EXISTS`/`MACHINE_BUSY`/`NO_ASSIGNMENT`), `src/pages/api/reports/[id]/stops/index.ts`, `.../[stopId]/close.ts` y `src/pages/api/reports/[id]/changes.ts` (nueva)
- [ ] T076 [P] [US1] Revisión de la cuarentena por el coordinador: `src/pages/api/sync-quarantine/[id]/review.ts` y el bloque "Datos capturados sin conexión en revisión" en `src/pages/reportes/[id].astro` (solo managers)
- [ ] T077 [US1] Quitar la creación de valores frecuentes del operario: eliminar `src/pages/api/catalogs/frequent.ts`, la lógica de `frequentQuestion` en `src/components/ReportEditor.tsx`, y la función `save_frequent_catalog_value` en una migración `supabase/migrations/20261013000200_drop_frequent_values.sql`; cliente y producto pasan a ser selectores solo de elementos activos (FR-011a)

### Implementación — cliente offline

- [ ] T078 [US1] Crear `src/lib/shifts.ts` (turno vigente y fecha operativa en America/Bogota, espejo de `current_shift_at`) (depende de T067)
- [ ] T079 [US1] Crear `src/lib/offline/db.ts`: IndexedDB `reporte-produccion-offline` v2 con los stores `outbox`, `entities`, `snapshot` (y `offlineCredentials` y `overview` reservados para la Phase 8), migración desde v1 (`reportDrafts` → operaciones `SAVE_REPORT_FIELDS`) y `navigator.storage.persist()`; mover lo reutilizable de `src/lib/offline-report-store.ts`
- [ ] T080 [US1] Crear `src/lib/offline/outbox.ts` (operaciones tipadas de sync-protocol.md, `operationId` con `createClientOperationId`, `seq`, transiciones de estado y aplicación local sobre `entities`) y `src/lib/offline/validation.ts` (las mismas reglas que la BD para el modo offline) (depende de T079)
- [ ] T081 [US1] Crear `src/lib/offline/sync-client.ts`: resumen de pendientes por tipo, `confirmAndUpload()` en lotes de 50 con manejo de `applied`/`duplicate`/`conflict`/`rejected`/corte de red/401, `postpone()`, y refresco del snapshot y de `entities` tras subir; sin autosave mientras haya pendientes (depende de T080)
- [ ] T082 [US1] Crear la isla `src/components/offline/OperatorShiftApp.tsx`: selección de máquina asignada del turno vigente, inicio del reporte, formulario de producción, paradas (iniciar, cerrar, categoría, cancelar), cambios, enviar y cancelar con motivo; siempre escribe primero en IndexedDB; online sin pendientes usa las rutas de T075; reutiliza los componentes de `src/components/ui/*` y `StopEventsTable` (depende de T078, T080)
- [ ] T083 [P] [US1] Crear `src/components/offline/PendingSyncSummary.tsx` (resumen con contadores, aviso si hay pendientes de más de 7 días, botones "Confirmar y subir" y "Posponer", resultados de conflicto o rechazo) y `src/components/offline/OfflineIndicator.tsx` (estado de conexión + número de pendientes, siempre visible en `src/components/shell/TopBar.tsx`) (depende de T081)
- [ ] T084 [US1] Crear la página `src/pages/turno.astro` con `export const prerender = true`, sin datos y montando `OperatorShiftApp` + `PendingSyncSummary` con `client:only="react"`; `src/pages/reportes/[id].astro` y `src/pages/reportes/index.astro` redirigen al OPERATOR con reporte activo propio a `/turno` (depende de T082, T083)
- [ ] T085 [US1] Actualizar `public/sw.js`: precachear `/turno`; en un fallo de navegación, si la ruta es de operario, servir `/turno` en lugar de `offline.html`; subir `CACHE_VERSION` a `v4`; nunca cachear `/api/**` ni el HTML SSR (Principio III)
- [ ] T086 [US1] Logout con pendientes: `src/components/shell/NavUser.tsx` consulta la outbox antes de enviar el formulario de logout y pide confirmación explícita ("Tienes N datos sin subir…"); el aviso persistente de pendientes de más de 7 días se muestra al entrar
- [ ] T087 [US1] Retirar el modo offline antiguo del editor: `src/components/ReportEditor.tsx` y `src/components/OfflineDraftNotice.tsx` quedan solo para la corrección de managers y la vista online; eliminar `src/lib/offline-report-store.ts` una vez migrado (depende de T079, T084)
- [ ] T088 [P] [US1] Actualizar `docs/PWA_OFFLINE.md` y `docs/USER_GUIDE.md` (operario: turno offline, confirmar o posponer, instalar la PWA, riesgo de borrado de datos en iOS)

**Checkpoint US1 (F4a)**: T066–T071 en verde y quickstart §Fase 4a completo en Chrome con red
Offline y en una tableta → **GO**.

---

## Phase 8: Login offline (US1) y consulta offline (US2/US3) (P1/P2) (plan F4b)

**Goal**: un usuario habilitado entra sin conexión con su contraseña (ventana de 7 días, bloqueo
local, revalidación online antes de subir); managers y auditores consultan offline el último
snapshot, marcado con su hora.

**Independent Test**: quickstart §Fase 4b pasos 1–4.

### Tests

- [ ] T089 [P] [US1] bun test `tests/offline-auth.test.ts`: el verificador PBKDF2 (600 000 iteraciones, sal aleatoria) no contiene la contraseña; con la contraseña correcta dentro de la ventana de 7 días entra; si la ventana venció o el usuario no está habilitado muestra "Necesitas conexión para entrar"; 5 fallos bloquean 15 min; al reconectar, sin login online no se ofrece la subida; usuario desactivado → sesión cerrada y pendientes conservados
- [ ] T090 [P] [US2] bun test `tests/offline-overview.test.tsx`: `/consulta-offline` muestra los datos del snapshot con "Datos de HH:MM" y deshabilita exportar, corregir y aprobar

### Implementación

- [ ] T091 [US1] Crear `src/lib/offline/offline-auth.ts`: `enroll(username, password, profile)` tras un login online (se dispara con `X-Offline-Enroll`), `verifyOffline(username, password)`, bloqueo local, `enabledUntil` configurable (7 días por defecto) y una sesión local limitada al rol guardado (depende de T079)
- [ ] T092 [US1] Modo offline de `src/pages/iniciar-sesion.astro`: si `/api/health` falla, valida con `verifyOffline` y navega a `/turno` (OPERATOR) o `/consulta-offline` (manager/VIEWER); además, enrolamiento tras el login online (depende de T091)
- [ ] T093 [US1] Revalidación al reconectar en `src/lib/offline/sync-client.ts`: exigir sesión online válida (login si hace falta) antes de mostrar "Confirmar y subir"; si el perfil está inactivo o cambió el rol, cerrar la sesión local y conservar los pendientes; el primer lote registra `OFFLINE_LOGIN` (acción en `apply_sync_operation`, migración `supabase/migrations/20261013000300_offline_login_audit.sql`) (depende de T091)
- [ ] T094 [P] [US2] Crear `src/pages/api/offline/overview.ts` (KPIs del día + los últimos 200 reportes del rango visto, para managers y VIEWER) y `src/pages/consulta-offline.astro` (prerender + isla `src/components/offline/OfflineOverview.tsx` de solo lectura); guardar el snapshot en `overview` al visitar el dashboard online
- [ ] T095 [US1] `public/sw.js`: precachear `/consulta-offline` e `/iniciar-sesion` (este último sin datos, en modo offline) y servirlos como respaldo según la ruta; subir `CACHE_VERSION` a `v5`

**Checkpoint F4b**: T089–T090 en verde y quickstart §Fase 4b → **GO**.

---

## Phase 9: Tiempo real — tablero, presencia e historial en vivo (US2/US3) (plan F5)

**Goal**: los cambios se ven en menos de 10 s sin recargar; presencia de operarios; polling de
respaldo.

**Independent Test**: quickstart §Fase 5 pasos 1–3.

### Tests

- [ ] T096 [P] [US2] pgTAP `supabase/tests/realtime_publication.test.sql`: las tablas están en `supabase_realtime`; las políticas de `realtime.messages` permiten `track` en `plant-presence` solo a OPERATOR y la lectura a managers y VIEWER
- [ ] T097 [P] [US2] bun test `tests/live-dashboard.test.tsx`: con un cliente Realtime simulado, un evento dispara un refetch con debounce de `/api/dashboard/summary`; con `CHANNEL_ERROR` o sin suscripción en 5 s activa el polling cada 8 s; al reconectar el polling se detiene

### Implementación

- [ ] T098 [US2] Migración `supabase/migrations/20261014000100_realtime_publication.sql`: añadir `production_reports`, `report_stop_events`, `report_change_events`, `report_audit_log` y `sync_quarantine` a `supabase_realtime`, más las políticas del canal privado `plant-presence`
- [ ] T099 [P] [US2] Crear `src/lib/supabase/browser.ts` (un solo `createBrowserClient` por pestaña, que se desconecta en el logout) y `src/lib/realtime.ts` (helper `subscribeWithFallback(channels, onChange, pollFn)`)
- [ ] T100 [US2] Crear `src/pages/api/dashboard/summary.ts` (KPIs por estado del rango, máquinas en parada, reportes fuera de turno y conflictos abiertos) y la isla `src/components/realtime/LiveDashboard.tsx`, integrada en `src/pages/dashboard.astro` (depende de T099)
- [ ] T101 [US2] Lista en vivo en `src/pages/reportes/index.astro`: isla `src/components/realtime/LiveReportList.tsx` que refresca la página actual si un evento cumple los filtros activos (debounce de 1 s) (depende de T099)
- [ ] T102 [US2] Presencia: `src/components/realtime/PresenceList.tsx` (managers y auditores, estados "En línea", "En línea con pendientes" y "Sin conexión") en `src/pages/dashboard.astro`; `track` desde `OperatorShiftApp` con `{userId, fullName, machineId, reportId, pendingCount, lastSeen}` cada 30 s y al cambiar algún valor (depende de T099)
- [ ] T103 [US3] Historial en vivo: isla `src/components/realtime/LiveTimeline.tsx` en `src/pages/reportes/[id].astro` para managers y VIEWER, suscrita por `report_id` y con refetch de `/api/reports/[id]/timeline` (depende de T063, T099)

**Checkpoint F5**: T096–T097 en verde y quickstart §Fase 5 midiendo < 10 s → **GO**.

---

## Phase 10: Polish & cross-cutting

- [ ] T104 [P] Actualizar `docs/SECURITY_AND_ABUSE.md` (4 roles, matriz de gestión, bloqueo, un reporte activo, auditoría completa, offline) y `docs/ARCHITECTURE.md` (login por usuario, sync, Realtime)
- [ ] T105 [P] Actualizar `docs/ADMIN_GUIDE.md` (ROOT y coordinador, alta con contraseña, restablecimiento, asignaciones por turno, aprobación, cuarentena) y `docs/API.md` (rutas de contracts/http-api.md)
- [ ] T106 [P] Pasada de accesibilidad y uso móvil de `/turno`, `PendingSyncSummary`, `ApprovalPanel` y `CorrectionDialog` según `docs/UI_UX_QA.md` (375 px, objetivos táctiles, foco, `aria-live`), con evidencia en `docs/qa/`
- [ ] T107 Volver a ejecutar el gap analysis contra spec.md y actualizar `specs/001-offline-production-reports/gap-analysis.md` (objetivo: 0 ❌ en CA y FR)
- [ ] T108 Ejecución final de quickstart.md completo + `bun test`, `bun run db:test`, `bunx astro check` y `bun run build`, guardando la salida en `specs/001-offline-production-reports/evidence/final.txt` → **GO final del auditor**

---

## Dependencies & Execution Order

### Orden de fases

```text
Phase 1 Setup ──▶ Phase 2 Foundational (F1, BLOQUEA)
                     │
                     ├─▶ Phase 3 US5 login/roles ──▶ Phase 4 US4 administración
                     │                                   │
                     └─▶ Phase 5 US2 aprobación/filtros/Excel (requiere US5)
                                                         │
                         Phase 6 US3 auditoría (requiere US2: correct_report, US4: tablas admin)
                                                         │
                         Phase 7 US1 offline F4a (requiere US5, US2 reglas de cancelación, US3 auditoría)
                                                         │
                         Phase 8 F4b login/consulta offline (requiere Phase 7)
                         Phase 9 F5 tiempo real (requiere Phase 6; puede ir en paralelo con Phases 7–8)
                                                         │
                         Phase 10 Polish (requiere todo)
```

### Dentro de cada fase

1. Primero los tests marcados [P]; deben fallar.
2. Luego las migraciones, después las RPC y rutas API, y al final la UI.
3. Checkpoint GO/NO-GO; con NO-GO se corrige y se repite la verificación.

### Dependencias clave entre tareas

- T011/T012 (`ADD VALUE`) antes que cualquier migración que use `ROOT` o `CLOSED`.
- T013 → T014 → T015 → T016 → T017 (cadena de migraciones F1).
- T020 debe cerrar F1 para que `build` siga en verde.
- T047 → T048; T050 → T051; T054 → T055.
- T072 → T073; T079 → T080 → T081 → T082/T083 → T084 → T087.
- T091 → T092/T093.
- T099 → T100–T103; T063 → T103.

## Parallel Opportunities

- **Phase 2**: T004–T010 (7 archivos pgTAP) en paralelo; T021 en paralelo con las migraciones.
- **Phase 3**: T022–T024 en paralelo; T030 en paralelo con T026–T029.
- **Phase 4**: T031–T033 en paralelo; T040 y T041 en paralelo con T034–T039.
- **Phase 5**: T042–T046 en paralelo; T049 en paralelo con T047/T048.
- **Phase 6**: T056–T059 en paralelo; T065 en paralelo con T060–T064.
- **Phase 7**: T066–T071 en paralelo; T074, T075 y T076 en paralelo con T072/T073; T083 en paralelo con T082.
- **Phase 9**: puede ejecutarla un segundo `executor` en paralelo con las Phases 7–8.

### Ejemplo de reparto en paralelo (Phase 7)

```text
executor A: T066 (pgTAP sync) → T072 → T073
executor B: T067, T068, T078, T079, T080
executor C: T074, T075, T076
Después:   T081 → T082 + T083 (paralelo) → T084 → T085 → T086 → T087
```

## Implementation Strategy

### MVP (lo primero que se puede usar en planta)

Phases 1 + 2 + 3 + 5 (sin Excel nuevo) dan roles correctos, aprobación y reglas de edición sobre
el flujo online actual. Es el primer incremento desplegable y cierra los riesgos de seguridad
(Fuera de spec #1–#4) antes del trabajo offline.

### Entrega incremental

1. F1 → GO → desplegar en staging (solo esquema, sin cambio visible).
2. US5 + US4 → GO → desplegar (login por usuario: comunicar las credenciales nuevas a los usuarios).
3. US2 → GO → desplegar (aprobación, filtros, Excel).
4. US3 → GO → desplegar (auditoría completa).
5. US1 F4a → GO → piloto en planta con 1–2 operarios y tabletas reales.
6. F4b → GO; F5 → GO → despliegue general.

### Notas

- Cada tarea la implementa el `executor`; nadie se aprueba a sí mismo (Constitución, "Flujo de
  desarrollo").
- Commits solo cuando el usuario los pida; nunca en `main`.
- Si una tarea revela una ambigüedad de la spec, detenerse y aclararla antes de seguir.
