# Gap analysis (re-ejecución final) — 001 Plataforma de reportes de producción offline y roles separados

**Spec**: [spec.md](./spec.md) · **Rama analizada**: `redesign/ui-ux` (HEAD `2009791` + árbol de trabajo con las Fases 1–10 sin confirmar) · **Fecha**: 2026-10-10
**Método**: revisión del código y de los contratos contra la spec, **más ejecución**: `bun run db:test` (pgTAP), `bun test`, `bunx astro check`, `bun run build`, los smokes contra el servidor local y Supabase local (con Realtime real por WebSocket), y una pasada en **Chrome 154 real** (headless, CDP) a 375 px. Las cifras y salidas literales están en [`evidence/final.txt`](./evidence/final.txt). Esta versión sustituye al análisis inicial del 2026-10-09 (que partía de 3 roles, sin offline, sin aprobación ni auditoría completa).

> **Notación.** `CA-<historia>-<escenario>` identifica los 31 escenarios de aceptación (la spec no define IDs); además se evalúan los FR, los casos límite y los criterios de éxito (SC).
>
> | Marca | Significado |
> | --- | --- |
> | ✅ | Implementado y verificado por pruebas automáticas (pgTAP, `bun test`) o por los smokes. |
> | ⚠ | Implementado, pero con un residuo **justificado** en la fila (límite de verificación, limitación aceptada o margen estrecho). No es un incumplimiento. |
> | ❓ | No verificable por código: es una métrica de negocio o de uso. |
> | ❌ | No cumple. **Objetivo de esta fase: 0.** |
>
> **Salvedad global.** Todo lo que depende del navegador o del dispositivo (Cache Storage, IndexedDB tras reiniciar, service worker real, tableta, Realtime en el navegador) se verificó con happy-dom + fake-indexeddb, con los smokes (que ejecutan el cliente real sobre un servidor local) y, solo en 375 px/accesibilidad, con Chrome real. **Nada de lo offline se ha probado en una tableta real**: sigue en [`release-checklist.md`](./release-checklist.md) (secciones B, D, E, F) y debe cumplirse antes de usar el modo offline en planta.

**Abreviaturas de pruebas**: `pgTAP:<archivo>` = `supabase/tests/<archivo>.test.sql`; `bun:<archivo>` = `tests/<archivo>.test.ts(x)`.

## 1. Tabla de criterios de aceptación (escenarios)

### User Story 1 — Operario registra su turno, incluso sin conexión (P1)

| ID | Criterio (resumido) | Estado | Evidencia | Residuo |
| --- | --- | --- | --- | --- |
| CA-01-01 | Operario con máquina asignada inicia reporte → activo para esa máquina/turno, con inicio y autor | ✅ | `POST /api/reports`, `/turno` (`OperatorShiftApp`); pgTAP:`report_shift_assignment`, pgTAP:`active_report_limits`, pgTAP:`shift_resolution`; bun:`report-workflow-api`, bun:`operator-shift-app` | — |
| CA-01-02 | Sin máquina asignada no puede iniciar y se le indica pedir asignación | ✅ | Mensaje «Solicita una asignación a tu coordinador» (`OperatorShiftApp`, API `NO_ASSIGNMENT` 422); bun:`operator-shift-app`, bun:`report-workflow-api` | — |
| CA-01-03 | Parada (inicio → fin + categoría), duración calculada, sin solapamientos | ✅ | pgTAP:`critical_constraints`, pgTAP:`device_time_events`; bun:`operator-shift-app`; categoría opcional al iniciar y obligatoria al cerrar (`prepare_stop_event`) | — |
| CA-01-04 | Registrar un cambio (producto/formato/otro) con hora, tipo y descripción | ✅ | `report_change_events` + `change_types`; `POST /api/reports/[id]/changes`; sección «Cambios» de `/turno`; pgTAP:`change_events`; bun:`sync-full-shift` | — |
| CA-01-05 | Sin conexión: producción, paradas y cambios se guardan en el dispositivo con «Sin conexión — guardado en este dispositivo» | ✅ | `OfflineIndicator`; outbox en IndexedDB (`src/lib/offline/*`); bun:`offline-outbox`, bun:`sync-full-shift`, bun:`operator-shift-app`; smokes 7b y 8 | Verificado en happy-dom, no en tableta (checklist B.2) |
| CA-01-06 | Sin conexión, iniciar reporte nuevo → se crea localmente como pendiente | ✅ | Operación `CREATE_REPORT` en la outbox con `id` cliente; bun:`sync-full-shift`; `smoke-offline-e2e` | — |
| CA-01-07 | Al reconectar: resumen de pendientes y nada se sube hasta «Confirmar y subir» | ✅ | `PendingSyncSummary`; bun:`sync-client` («Principio III: nada se sube sin confirmar»); sin escrituras de red con pendientes | — |
| CA-01-08 | Al confirmar: se sube, cada elemento se marca sincronizado y se informa el resultado | ✅ | `POST /api/sync/batch` → `apply_sync_operation`; bun:`sync-batch-api`, bun:`sync-client`, pgTAP:`sync_operation`; smoke 7b (6 aplicadas, 0 duplicadas) | — |
| CA-01-09 | Posponer: los datos permanecen y se vuelve a ofrecer | ✅ | `postpone()` conserva todo; se re-ofrece en cada reconexión/apertura; bun:`sync-client` | — |
| CA-01-10 | Enviar → «Enviado» y el operario ya no puede editar | ✅ | pgTAP:`operator_workflow`, pgTAP:`rls_matrix`; bun:`report-workflow-api` (submit) | — |

### User Story 2 — Coordinador supervisa en tiempo real (P1)

| ID | Criterio (resumido) | Estado | Evidencia | Residuo |
| --- | --- | --- | --- | --- |
| CA-02-01 | Iniciar, actualizar, enviar o cancelar se refleja en el tablero sin recargar | ✅ | `LiveDashboard`/`LiveReportList`/`LiveTimeline` (`postgres_changes` + respaldo por sondeo 8 s); pgTAP:`realtime_publication`; bun:`live-dashboard`, bun:`live-islands`, bun:`realtime`; smoke 9 con Realtime real: 0,35–3,2 s | Verificado con cliente WebSocket real en Node; la isla en un navegador real queda en la checklist F |
| CA-02-02 | Ver operarios con conexión activa y, sin conexión, con pendientes (si ya llegó al servidor) | ⚠ | `PresenceList` + `useOperatorPresence` (`plant-presence`): «En línea», «En línea con pendientes», «Sin conexión» con la última vez; bun:`live-islands`; smoke 9 | El servidor guarda los pendientes de los dispositivos (`device_sync_status`, `user_last_contact`) pero **la lista no muestra el último conteo de un operario ya desconectado**; solo se ve en el diálogo de desactivación. Es información indicativa por diseño (SECURITY §8) y la spec lo condiciona a «cuando ya llegó al servidor» |
| CA-02-03 | Filtrar por rango de fechas y opcionalmente máquina, turno, operario y estado | ✅ | `src/lib/report-filters.ts`; bun:`report-filters`; UI `/reportes` (Desde, Hasta, Máquina, Turno, Operario, Estado, parada activa, fuera de turno) | — |
| CA-02-04 | «Descargar Excel» con reportes, paradas, cambios e indicadores, respetando los filtros | ✅ | `GET /api/reports/export` (mismos filtros); hojas SEGUIMIENTO PRODUCCIÓN, DETALLE PARADAS, CAMBIOS, HISTORIAL, CATÁLOGO PARADAS; bun:`report-export` | — |
| CA-02-05 | «Aprobar y cerrar» → «Cerrado (aprobado)» con aprobador y fecha visibles | ✅ | `approve_report`, `ApprovalPanel`; pgTAP:`approval`; bun:`report-workflow-api`; columnas de aprobación en lista, detalle y Excel | — |
| CA-02-06 | No se puede aprobar un reporte activo, cancelado o con conflicto; se indica el motivo | ✅ | `NOT_SUBMITTED`/`OPEN_CONFLICT`; pgTAP:`approval`; aviso en `ApprovalPanel` (bun:`a11y-phase10`) | — |
| CA-02-07 | Corregir enviado o cerrado con motivo → historial con anterior, nuevo, autor, fecha y motivo | ✅ | `correct_report` (motivo ≥ 5), `CorrectionDialog`; pgTAP:`correct_report`; bun:`report-workflow-api`, bun:`a11y-phase10` | — |

### User Story 3 — Auditor revisa reportes e historial (P2)

| ID | Criterio (resumido) | Estado | Evidencia | Residuo |
| --- | --- | --- | --- | --- |
| CA-03-01 | El auditor abre cualquier reporte y ve detalle e historial cronológico | ✅ | RLS del VIEWER en todos los estados (`20261010000700_target_rls`); `GET /api/reports/[id]/timeline`; pgTAP:`report_audit_visibility`, pgTAP:`viewer_read_only`; bun:`report-timeline-api` | — |
| CA-03-02 | Las modificaciones aparecen en el historial del auditor sin recargar | ✅ | `LiveTimeline` (suscripción filtrada por `report_id`); bun:`live-islands`; smoke 9 (auditor recibe la auditoría) | Igual que CA-02-01: navegador real en checklist F |
| CA-03-03 | Excel con los reportes filtrados y una hoja aparte con el historial de cambios | ✅ | Hoja HISTORIAL; bun:`report-export`; medido en `scripts/measure-sc006.ts` (7 203 filas) | — |
| CA-03-04 | Cualquier intento del auditor de crear, editar, cancelar, cerrar o eliminar es rechazado | ✅ | pgTAP:`viewer_read_only`, pgTAP:`rls_matrix`; bun:`role-access`, bun:`viewer-ui-guard`, bun:`report-workflow-api` | — |

### User Story 4 — Administración con jerarquía raíz (P2)

| ID | Criterio (resumido) | Estado | Evidencia | Residuo |
| --- | --- | --- | --- | --- |
| CA-04-01 | El raíz crea coordinador o auditor con usuario y contraseña inicial → puede iniciar sesión con ese rol | ✅ | `POST /api/admin/users` (`USER_CREATED`); bun:`user-admin`, bun:`login`; pgTAP:`user_management_matrix` | — |
| CA-04-02 | Un coordinador no puede crear, editar ni desactivar coordinadores, auditores ni al raíz | ✅ | Matriz en `manage_user_assignments` + API; pgTAP:`user_management_matrix`; bun:`user-admin` (403 por solicitud directa); navegación por rol (bun:`ui-shell`) | — |
| CA-04-03 | El coordinador gestiona operarios, máquinas, asignaciones y catálogos → aplica y queda en el historial administrativo | ✅ | `/api/admin/**`; `private.audit_admin_entity` (migración `20261012000200`); pgTAP:`full_audit`, pgTAP:`admin_audit_root_only`; bun:`admin-audit-api` | — |
| CA-04-04 | Eliminar una categoría en uso la desactiva y el histórico conserva su valor | ✅ | `delete_or_deactivate`; pgTAP:`catalog_delete_or_deactivate`; mensaje «desactivada (en uso)» | — |
| CA-04-05 | Una categoría sin uso se elimina definitivamente tras confirmación explícita | ✅ | Mismo RPC + `DestructiveAction`; pgTAP:`catalog_delete_or_deactivate` | — |
| CA-04-06 | Un usuario desactivado no puede iniciar sesión | ✅ | Perfil inactivo → sin contexto (`src/lib/auth.ts`), baneo en Auth al retirar; bun:`login`, bun:`user-admin`; smoke 8 (`session-info` 403 `INACTIVE`) | — |

### User Story 5 — Inicio de sesión seguro y separación de roles (P1)

| ID | Criterio (resumido) | Estado | Evidencia | Residuo |
| --- | --- | --- | --- | --- |
| CA-05-01 | Sin sesión, cualquier pantalla redirige al login | ✅ | `src/middleware.ts`; bun:`role-access`, bun:`prerender-guard` | — |
| CA-05-02 | Credenciales incorrectas → mensaje genérico; tras 5 fallos, bloqueo de 15 min | ✅ | `login_check_allowed`/`login_register_result`; pgTAP:`login_lockout`; bun:`login` | — |
| CA-05-03 | El operario no accede a administración, reportes ajenos ni exportación | ✅ | bun:`role-access` (rol × ruta), pgTAP:`rls_matrix`, bun:`report-export` (403) | — |
| CA-05-04 | Cualquier acción no permitida por solicitud directa es rechazada sin modificar datos | ✅ | RLS + RPC `security definer` + checks de API; pgTAP:`rls_matrix`, pgTAP:`viewer_read_only`, pgTAP:`user_management_matrix`, pgTAP:`sync_cross_user_replay`; bun:`role-access`, bun:`user-admin`, bun:`sync-batch-api` | — |

---

## 1b. Requisitos funcionales (FR)

| ID | Requisito (resumido) | Estado | Evidencia | Residuo |
| --- | --- | --- | --- | --- |
| FR-001 | Usuario y contraseña para cualquier pantalla o dato; identificador = nombre de usuario | ✅ | Login por `username`; bun:`login`; `/iniciar-sesion` | — |
| FR-001a | Sin invitación ni recuperación por correo; alta y restablecimiento por un administrador y auditados | ✅ | Rutas `recovery`, `invite`, `/recuperar-contrasena` eliminadas (404); `USER_CREATED`, `PASSWORD_RESET`; bun:`user-admin` | — |
| FR-002 | Exactamente cuatro roles | ✅ | `app_role` (`ROOT`, `ADMINISTRATOR`, `OPERATOR`, `VIEWER`); pgTAP:`roles_root_invariant` | — |
| FR-003 | Permisos aplicados en el servidor | ✅ | RLS + RPC + middleware; pgTAP:`rls_matrix`; bun:`role-access` | — |
| FR-004 | Bloqueo de 15 min tras 5 fallos + mensajes no reveladores | ✅ | pgTAP:`login_lockout`; bun:`login`; `resolve_login_email` no revela existencia | — |
| FR-005 | Siempre existe al menos un raíz activo | ✅ | Trigger diferido `profiles_ensure_active_root`; pgTAP:`roles_root_invariant` | — |
| FR-005a | No desactivar con reporte activo o pendientes informados; último contacto; solo el raíz fuerza con motivo | ✅ | `manage_user_assignments`, `user_last_contact`, `report_device_sync_status`; pgTAP:`user_management_matrix`, pgTAP:`offline_flags_forced`; bun:`user-admin` (`force_reason`), bun:`sync-client` (aviso de pendientes) | La presencia **no** alimenta esta regla (SECURITY §8) |
| FR-006 | Login offline para quien inició sesión con conexión en ese dispositivo en ≤ 7 días | ✅ | `offline-auth.ts`, `/acceso-offline`; bun:`offline-auth` (ventana de 7 días), bun:`offline-login-ui`; smoke 8 | Probado en happy-dom; tableta real en checklist E.19–E.22 |
| FR-006a | Mismas credenciales, bloqueo 5/15 min, contraseña nunca legible | ✅ | Verificador PBKDF2-SHA-256 600 000 it.; bun:`offline-auth` («verificador», «bloqueo local») | — |
| FR-006b | Revalidar identidad, estado y rol al reconectar antes de subir | ✅ | `GET /api/auth/session-info`, compuerta de login en línea; bun:`offline-auth` («revalidación»), bun:`session-info-api`; smoke 8 | — |
| FR-006c | Sesión offline con el último rol verificado, registrada en auditoría | ✅ | Sesión local limitada al rol; `record_offline_login`; pgTAP:`offline_login_audit`; bun:`offline-login-audit-api` | — |
| FR-007 | Iniciar reporte solo para máquina asignada en el turno vigente | ✅ | Asignaciones por turno y vigencia; pgTAP:`report_shift_assignment`; bun:`shifts` | — |
| FR-007a | Un reporte activo por operario y por máquina, también offline | ✅ | Índices únicos parciales; pgTAP:`active_report_limits`; validación local en `src/lib/offline/validation.ts` | — |
| FR-007b | Turno y fecha operativa asignados automáticamente, también offline; el operario no los escribe | ✅ | `private.current_shift_at`; pgTAP:`shift_resolution`; bun:`shifts` | — |
| FR-008 | Registrar producción, paradas (con categoría al cerrar como máximo) y cambios | ✅ | `/turno`; pgTAP:`change_events`, pgTAP:`device_time_events`; bun:`operator-shift-app` | — |
| FR-008a | Horas del dispositivo, hora de llegada guardada, revisión si > 5 min, no editables | ✅ | `prepare_stop_event`/`prepare_change_event`; pgTAP:`device_time_events` | — |
| FR-009 | Sin solapamientos, sin fin < inicio, sin envío con parada abierta | ✅ | pgTAP:`critical_constraints`; `src/lib/offline/validation.ts`; bun:`operator-shift-app` | — |
| FR-010 | Enviar o cancelar (motivo) los propios activos; no editar enviados, cerrados ni cancelados | ✅ | pgTAP:`operator_workflow`, pgTAP:`report_cancellation`; bun:`report-workflow-api` | — |
| FR-010a | Operario cancela siempre; coordinador/raíz solo si abierto fuera de turno (2 h), con motivo y conexión; auditor no | ✅ | `cancel_report`; pgTAP:`cancellation_rules`; bun:`report-workflow-api` (cancel); `ApprovalPanel` | — |
| FR-011 | El operario ve solo sus reportes | ✅ | pgTAP:`rls_matrix` | — |
| FR-011a | Solo elementos de catálogo activos; el operario no crea ni modifica catálogos | ✅ | Ruta `frequent` y RPC eliminados (migración `20261013000200`); selects de `/turno`; pgTAP:`critical_constraints` (la función fue eliminada) | — |
| FR-012 | Todo FR-007..010 sin conexión | ✅ | Acciones offline (`actions.ts`): iniciar, parar, cambiar, datos, enviar, cancelar; bun:`sync-full-shift` («turno completo offline»), `smoke-offline-e2e` | Happy-dom/smoke; tableta real en checklist B.2 |
| FR-013 | Lo capturado offline sobrevive a cierre, reinicio y expiración de sesión | ⚠ | IndexedDB por usuario con `navigator.storage.persist()`; bun:`offline-outbox`, bun:`shared-device` (fake-indexeddb) | La supervivencia al **reinicio real del dispositivo** y la cuota de almacenamiento (iOS/Safari puede borrar sitios sin uso) no se han probado en un navegador real; mitigado con aviso de 7 días e instalación como PWA (checklist B.8) |
| FR-014 | Mostrar siempre el estado de conexión y el nº de pendientes | ✅ | `OfflineIndicator` en la barra del operario y en `/turno`; bun:`operator-shift-app`, bun:`ui-shell` | Coordinadores/auditores ven el banner de conexión global |
| FR-015 | Resumen al reconectar; nada se sube sin confirmación del autor | ✅ | bun:`sync-client` (Principio III) | — |
| FR-016 | Posponer; conservar y volver a ofrecer | ✅ | `postpone()`; bun:`sync-client` | — |
| FR-017 | Subida idempotente; sin duplicados ni pérdidas | ✅ | `operationId` + `sync_operation_log`; pgTAP:`sync_replay_idempotent`; bun:`sync-batch-api`, bun:`sync-client`; smoke 7b (reenvío → `duplicate`) | — |
| FR-018 | Conflicto: conservar servidor y local, avisar al operario y notificar al coordinador | ✅ | `sync_quarantine`, `SYNC_CONFLICT`/`OFFLINE_DATA_REVIEW`; pgTAP:`sync_operation`, pgTAP:`notifications`; bun:`sync-quarantine-api` | — |
| FR-019 | Pendientes aislados por usuario | ✅ | Claves por `userId`; bun:`shared-device`, bun:`offline-outbox`; pgTAP:`sync_cross_user_replay` | Aislamiento lógico; el dispositivo debe ser gestionado (SECURITY §11) |
| FR-020 | Coordinador y auditor consultan offline lo último descargado, con su hora; acciones que requieren conexión deshabilitadas | ✅ | `/consulta-offline`, `GET /api/offline/overview`; bun:`offline-overview`, bun:`offline-overview-api`; smoke 8 | Tableta real en checklist E.25 |
| FR-021 | Coordinador ve todos los reportes por estado con autoactualización | ✅ | `LiveDashboard` (KPI DRAFT/SUBMITTED/CLOSED/CANCELLED), `LiveReportList`; bun:`live-dashboard` | El tablero muestra la fecha operativa de hoy; la lista admite cualquier rango |
| FR-022 | Ver operarios conectados y máquinas en parada ahora | ⚠ | Máquinas en parada (`machinesStopped`) y `PresenceList`; bun:`live-dashboard`, bun:`live-islands` | Igual que CA-02-02 (sin último conteo de pendientes de un operario desconectado) |
| FR-023 | Filtros: rango, máquina, turno, operario, estado; fecha operativa | ✅ | bun:`report-filters` | — |
| FR-024 | Aprobar enviado → «Cerrado (aprobado)» | ✅ | pgTAP:`approval` | — |
| FR-024a | Aprobador y fecha en detalle, listados y Excel | ✅ | Columnas `approver_full_name`/`approved_at`; `ApprovalPanel`; bun:`report-export`; check `production_reports_approval_consistency` | — |
| FR-024b | Solo enviados sin conflictos, y con conexión | ✅ | pgTAP:`approval`; `OPEN_CONFLICT` | — |
| FR-025 | Corregir enviados o cerrados con motivo obligatorio | ✅ | pgTAP:`correct_report`; bun:`a11y-phase10` | — |
| FR-025a | Un reporte activo solo lo edita su operario autor | ✅ | RLS sin `UPDATE` de managers; `PATCH` de manager → 403; pgTAP:`rls_matrix`; bun:`report-workflow-api` | — |
| FR-026 | CRUD + desactivar/reactivar de operarios, máquinas, asignaciones y catálogos (incl. tipos de cambio) | ✅ | `/api/admin/**` incl. `change-types`; bun:`user-admin`; pgTAP:`catalog_uniqueness` | — |
| FR-027 | En uso → desactivar; sin uso → borrar con confirmación | ✅ | pgTAP:`catalog_delete_or_deactivate` | — |
| FR-028 | Solo el raíz gestiona coordinadores y auditores | ✅ | pgTAP:`user_management_matrix`; bun:`user-admin` | — |
| FR-029 | Registrar toda creación y modificación con autor, rol, campo, valores, motivo e indicador offline | ✅ | `audit_report_entity`, `audit_admin_entity`; pgTAP:`full_audit`, pgTAP:`offline_flags_forced`; bun:`report-audit` | No se auditan lecturas, exportaciones ni inicios de sesión en línea (no los exige la spec; ver SECURITY §11) |
| FR-029a | Historial administrativo solo para el raíz, con filtros | ✅ | `/administracion/historial`, `GET /api/admin/audit`; pgTAP:`admin_audit_root_only`; bun:`admin-audit-api` | — |
| FR-030 | Historial inalterable | ✅ | Sin `INSERT/UPDATE/DELETE` para `authenticated`; pgTAP:`report_audit_visibility`, pgTAP:`admin_audit_root_only` | `service_role` y superusuarios conservan acceso (inherente) |
| FR-031 | Auditor ve todos los reportes e historial con autoactualización | ✅ | pgTAP:`viewer_read_only`; `LiveTimeline` | — |
| FR-032 | Auditor no crea, edita, cierra, cancela ni elimina | ✅ | Ver CA-03-04 | — |
| FR-033 | Excel para coordinador/raíz/auditor con paradas, cambios, indicadores e historial | ✅ | bun:`report-export`; SC-006 | — |
| FR-034 | Operarios no exportan | ✅ | bun:`report-export` (403), `role-access` | — |

## 1c. Casos límite

| Caso | Estado | Evidencia | Residuo |
| --- | --- | --- | --- |
| Reporte activo mientras el operario está offline: nadie más lo modifica | ✅ | FR-025a; pgTAP:`rls_matrix` | — |
| «Abierto fuera de turno» cancelado por el coordinador con datos pendientes → conservar adjuntos y notificar | ✅ | `apply_sync_operation` envía a `sync_quarantine` y notifica; pgTAP:`sync_operation`; bun:`sync-quarantine-api` | — |
| Mismo operario en dos dispositivos | ✅ | Versión base (`_base_updated_at`) y cuarentena; pgTAP:`sync_operation`; bun:`sync-batch-api` | — |
| Asignación revocada durante el offline → se sube marcado «capturado sin conexión» y en revisión | ✅ | `captured_offline`, cuarentena; pgTAP:`offline_flags_forced`, pgTAP:`sync_operation` | — |
| Desactivar un usuario con datos pendientes | ✅ | FR-005a; sesión cerrada y datos conservados al reconectar (smoke 8); reactivación temporal para subir | — |
| Contraseña cambiada mientras el dispositivo estaba offline | ✅ | Revalidación: se exige iniciar sesión en línea antes de subir; bun:`offline-auth` | — |
| Login offline sin habilitación previa → mensaje claro | ✅ | «Necesitas conexión para entrar»; bun:`offline-auth`, bun:`offline-login-ui` | — |
| Sesión expirada al volver la conexión → conservar y re-login | ✅ | 401 conserva todo; bun:`sync-client`, bun:`sync-batch-api` | — |
| Dispositivo compartido | ✅ | bun:`shared-device`; pgTAP:`sync_cross_user_replay` | — |
| Cierre de sesión con pendientes → advertir y confirmar | ✅ | `LogoutGuard`; bun:`shared-device` | — |
| Subida parcialmente fallida | ✅ | Lotes de ≤ 50 ordenados por `seq`; lo aceptado queda `synced`; bun:`sync-client`, bun:`sync-batch-api` | — |
| Parada abierta al terminar el turno / paradas sin categoría → no enviar | ✅ | `validate_production_report`; pgTAP:`operator_workflow`; validación local | — |
| Paradas solapadas o con fin < inicio, online y offline | ✅ | pgTAP:`critical_constraints`; `validation.ts` | — |
| Reloj desajustado: conservar la hora capturada + hora de llegada | ✅ | `received_at`, `clock_skew_review`; pgTAP:`device_time_events`; rechazo de horas futuras | — |
| Datos pendientes de más de 7 días → aviso persistente | ✅ | Alerta en el resumen que se ofrece al iniciar y en el indicador (`· +7 d`, con texto para lectores de pantalla); bun:`sync-client` | — |
| Exportación sin resultados → informar en vez de archivo vacío | ✅ | `204` + mensaje «No hay reportes…»; bun:`report-export` | — |
| Último administrador raíz no se puede desactivar | ✅ | Trigger diferido; pgTAP:`roles_root_invariant` | — |

## 1d. Criterios de éxito (SC)

| ID | Estado | Evidencia / razón |
| --- | --- | --- |
| SC-001 (iniciar reporte < 30 s) | ❓ | Métrica de uso. `/turno` inicia con un toque tras elegir máquina; requiere medición con operarios reales. |
| SC-002 (parada < 20 s) | ❓ | Métrica de uso. «Iniciar parada» es un toque (`min-h-14`); requiere medición con operarios reales. |
| SC-003 (100 % de un turno offline subido sin pérdidas ni duplicados) | ⚠ | bun:`sync-full-shift` y `smoke-offline-e2e` (reporte + paradas + cambio + campos + envío: subida completa, reenvío = `duplicate`). Falta la prueba en tableta real (checklist B.2–B.4). |
| SC-004 (0 subidas no confirmadas) | ✅ | bun:`sync-client` («Principio III: nada se sube sin confirmar»): sin escrituras de red con pendientes. |
| SC-005 (cambios visibles en < 10 s) | ✅ | smoke 9 con Realtime real: 0,35–3,2 s hasta el coordinador y el auditor; respaldo por sondeo de 8 s (bun:`live-islands`). |
| SC-006 (Excel de un mes < 30 s) | ⚠ | Medido (`evidence/final.txt`): mes sembrado de 900 reportes / 5 400 paradas / 2 700 cambios / 7 200 filas de historial → **17,7–25,8 s** (HTTP 200, 791 KiB) contra `astro dev` local. Cumple, pero el **margen es estrecho** y es dev, no producción en Vercel. Seguimiento: optimizar consultas del export si en la tableta/planta real se acerca al límite. |
| SC-007 (100 % de acciones prohibidas rechazadas) | ✅ | pgTAP:`rls_matrix`, `viewer_read_only`, `user_management_matrix`; bun:`role-access`, `user-admin`. |
| SC-008 (100 % de modificaciones auditadas) | ✅ | pgTAP:`full_audit`; `audit_admin_entity`. |
| SC-009 (−80 % de tiempo de consolidación) | ❓ | Métrica de negocio. |
| SC-010 (90 % completa el primer reporte sin ayuda) | ❓ | Métrica de usabilidad. |
| SC-011 (100 % de cerrados muestran aprobador y fecha) | ✅ | Check `production_reports_approval_consistency`; lista, detalle y Excel. |
| SC-012 (login offline < 15 s; rechazo de no habilitados) | ⚠ | PBKDF2 de 600 000 it. medido en Chrome 154 real de escritorio: **0,77–0,82 s**; no habilitados → «Necesitas conexión para entrar» (bun:`offline-auth`). **No medido en una tableta de gama baja** (el estrangulamiento de CPU de DevTools no afecta a WebCrypto nativo): checklist E.20. |

---

## 2. Fuera de spec (en el código pero no en la spec, o en contradicción con ella)

Los 14 elementos del análisis inicial se resolvieron salvo los siguientes, que son **aceptables** o neutros:

| # | Comportamiento | Relación con la spec |
| --- | --- | --- |
| 1 | Cancelación de paradas con motivo por el operario (la parada queda «anulada» sin duración) | No descrita; coherente con FR-029 (queda auditada) y con el Excel (excluida de totales). Aceptado. |
| 2 | Sistema de notificaciones persistentes (campana, página, polling de 30 s) | No descrito; ahora es la vía de aviso de FR-018 (`SYNC_CONFLICT`, `OFFLINE_DATA_REVIEW`, `CLOCK_SKEW_REVIEW`, `REPORT_APPROVED`). Aceptado. |
| 3 | Métricas de rendimiento ocultas al operario | No descrito; sin conflicto. |
| 4 | Borrar una máquina sin referencias elimina sus asignaciones | No descrito; las máquinas con historia se desactivan. Aceptado. |
| 5 | PWA instalable con aviso de nueva versión | Infraestructura necesaria para FR-006/FR-020. Aceptado. |
| 6 | El tablero (`/dashboard`) muestra la fecha operativa de hoy; la API `summary` admite rangos de hasta 366 días | La spec no fija el rango del tablero; la lista `/reportes` cubre cualquier rango. Aceptado. |
| 7 | La página `/configurar-contrasena` y `POST /api/auth/password` (cambio de la propia contraseña) siguen existiendo pero **no hay un enlace en la interfaz** | Fuera de spec (FR-001a solo exige el restablecimiento por un administrador). Se deja sin enlazar; decisión pendiente del responsable. |
| 8 | La presencia es falsificable por el operario | Limitación aceptada y documentada (SECURITY §8); no concede permisos ni alimenta FR-005a. |

Resueltos desde el análisis inicial: valores frecuentes creados por operarios (eliminados), edición de borradores por el admin sin auditoría (ya no edita borradores; todo se audita), auditor limitado a `SUBMITTED` (ve todos los estados), login por correo/recuperación/invitación (eliminados), límite de 5 borradores (ahora 1 activo por operario y por máquina), admin que borraba paradas (política eliminada), hora de parada fijada por el servidor (ahora hora del dispositivo), solo el operario cancelaba (ahora también el coordinador fuera de turno).

---

## 3. Resumen

### Conteo por estado

| Conjunto | ✅ Cumple | ⚠ Con residuo justificado | ❓ No verificable | ❌ No cumple | Total |
| --- | --- | --- | --- | --- | --- |
| Escenarios de aceptación (CA) | 30 | 1 | 0 | 0 | 31 |
| Requisitos funcionales (FR) | 46 | 2 | 0 | 0 | 48 |
| Casos límite | 17 | 0 | 0 | 0 | 17 |
| Criterios de éxito (SC) | 5 | 3 | 4 | 0 | 12 |

**Objetivo T107: 0 ❌ en CA y FR — alcanzado.** No hay ningún ❌ en las cuatro tablas.

### Justificación de cada ⚠ restante

1. **CA-02-02 / FR-022** — la lista de presencia muestra «En línea», «En línea con pendientes» y «Sin conexión (última vez…)», pero no el último conteo de pendientes de un operario que ya está desconectado. La spec lo condiciona a «cuando esa información ya llegó al servidor»; el dato existe (`device_sync_status`) y se usa donde decide (diálogo de desactivación, FR-005a). Mostrarlo en la lista es una mejora futura de bajo riesgo.
2. **FR-013** — la persistencia ante reinicio real y cuota de almacenamiento depende del navegador y del sistema operativo; solo verificada con fake-indexeddb. Requiere la prueba en tableta (checklist B.2, B.8).
3. **SC-003** — el turno completo offline está probado de extremo a extremo por simulación y smokes, no en tableta real.
4. **SC-006** — cumple (17,7–25,8 s < 30 s) pero con margen estrecho y medido en desarrollo; riesgo de rendimiento declarado.
5. **SC-012** — cumple en escritorio (≈ 0,8 s); la tableta de gama baja no se midió.

### Verificación pendiente que no cabe en este análisis estático

Todo lo de [`release-checklist.md`](./release-checklist.md) (secciones B–F): tableta/navegador reales, service worker v5 real, modo avión, cookies `sb-*` en producción y publicación/autorización de Realtime en el proyecto remoto. Sin esas pruebas **no se debe usar el modo offline en planta**.
