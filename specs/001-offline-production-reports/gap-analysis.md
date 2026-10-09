# Gap analysis — 001 Plataforma de reportes de producción offline y roles separados

**Spec**: [spec.md](./spec.md) · **Rama analizada**: `redesign/ui-ux` (commit `38b510d`) · **Fecha**: 2026-10-09
**Método**: revisión estática del código (sin ejecución). Cada ✅/🟡 cita evidencia `ruta:línea`.

> **Nota sobre IDs.** La spec no define IDs `CA-XX-NN`. Se usa `CA-<historia>-<escenario>`
> (p. ej. `CA-01-03` = User Story 1, escenario 3). Además de los 31 escenarios se evalúan los FR,
> los casos límite y los criterios de éxito (SC), porque contienen criterios de aceptación adicionales.

**Abreviaturas de rutas de migración** (todas en `supabase/migrations/`):

| Alias | Archivo |
| --- | --- |
| `M-init` | `20260830140000_initial_mvp.sql` |
| `M-snap` | `20260830190000_catalogs_snapshots_and_submission.sql` |
| `M-cancel` | `20260830200100_report_cancellation.sql` |
| `M-demo` | `20260830210000_final_demo_readiness.sql` |
| `M-svc` | `20260831120000_service_role_admin_grants.sql` |
| `M-opwf` | `20260916020525_operator_report_workflow.sql` |
| `M-audit` | `20260927233202_report_audit_visibility_and_snapshots.sql` |
| `M-corr` | `20260928003331_finalized_report_correction_audit.sql` |
| `M-notif` | `20261008165311_notifications.sql` |

## Hechos estructurales que condicionan muchos criterios

1. **Solo existen 3 roles** (`ADMINISTRATOR`, `OPERATOR`, `VIEWER`): `src/lib/types.ts:1`, `M-init:6`. No hay distinción entre administrador raíz y coordinador.
2. **Solo existen 3 estados de reporte** (`DRAFT`, `SUBMITTED`, `CANCELLED`): `src/lib/types.ts:2`, `M-init:7`, `supabase/migrations/20260830200000_add_cancelled_status.sql:1`. No existe "Cerrado (aprobado)" ni campos de aprobador.
3. **No existe la entidad "Cambio"** (producto/formato/lote) dentro del reporte. No hay tabla, API ni UI.
4. **No hay mecanismo de tiempo real** (Supabase Realtime, SSE, WebSocket, presence). Las páginas se renderizan en servidor. Lo único que hace polling son las notificaciones, cada 30 s (`src/components/notifications/notification-store.ts:20,134`).
5. **El modo offline solo cubre la edición de campos de un borrador ya abierto.** Se guarda en IndexedDB (`src/lib/offline-report-store.ts:171-245`, `src/components/ReportEditor.tsx:192-242`). La navegación offline cae en `offline.html` (`public/sw.js:68-72`). Paradas, creación, envío y cancelación exigen conexión (`src/components/StopManager.tsx:31-32,103`, `src/components/ReportEditor.tsx:188`).
6. **Las asignaciones no tienen turno ni vigencia**: `operator_machine_assignments` es `(operator_id, machine_id, active)` (`M-init:29-37`).

---

## 1. Tabla de criterios de aceptación (escenarios)

### User Story 1 — Operario registra su turno, incluso sin conexión (P1)

| ID | Criterio (resumido) | Estado | Evidencia | Gap |
| --- | --- | --- | --- | --- |
| CA-01-01 | Operario con máquina asignada pulsa "Iniciar reporte" → reporte activo para esa máquina/turno, con inicio y autor | 🟡 | `src/pages/api/reports/index.ts:5-33`; `src/pages/reportes/index.astro:125-140`; validación de asignación `M-cancel:93-103`; RLS `M-init:610-624`; autor y folio `M-demo:52-87` | La asignación no está ligada a un turno (`M-init:29-37`) y el turno no se fija al crear (`shift_id` lo llena el operario después). `started_at` no se registra automáticamente al iniciar. |
| CA-01-02 | Sin máquina asignada → no puede iniciar y se le indica pedir asignación al coordinador | 🟡 | El selector solo lista máquinas asignadas (`src/pages/reportes/index.astro:64-71,130-132`); la BD rechaza con "La máquina no está asignada al Operador" (`M-cancel:97-102`) | No hay mensaje que indique "solicita una asignación a tu coordinador": el selector simplemente queda vacío. |
| CA-01-03 | Registrar parada (inicio → fin + categoría), duración calculada, sin solapamientos | ✅ | Inicio/cierre `src/pages/api/reports/[id]/stops/index.ts:6-36`, `.../[stopId]/close.ts:6-26`; duración `M-opwf:76-80`; no solapamiento (GiST) `M-init:141-146`; una abierta por reporte `M-init:137-139`; `fin ≥ inicio` `M-init:133` | La categoría se elige al iniciar, no al cerrar, aunque se puede cambiar mientras está activa (`.../[stopId]/category.ts`). Solo funciona online. |
| CA-01-04 | Registrar un cambio (producto/formato/otro) con hora, tipo y descripción | ❌ | — | No existe la entidad "Cambio" ni el catálogo "tipos de cambio". |
| CA-01-05 | Sin conexión: producción, paradas y cambios se guardan en el dispositivo con el aviso "Sin conexión — guardado en este dispositivo", sin bloqueos | 🟡 | Campos del reporte en IndexedDB `src/components/ReportEditor.tsx:192-242`; texto "Puedes seguir editando. Los cambios se guardan en este dispositivo." `src/components/ReportEditor.tsx:868-870`; banner "Sin conexión" `src/components/ConnectionStatus.astro:142-143` | Las paradas se bloquean offline (`src/components/StopManager.tsx:103`). No existen los cambios. Si se recarga o se navega offline, aparece `offline.html` (`public/sw.js:68-72`). |
| CA-01-06 | Sin conexión, iniciar reporte nuevo → se crea localmente como pendiente | ❌ | — | La creación es un `POST` de formulario al servidor (`src/pages/reportes/index.astro:125`). No hay creación local ni outbox para reportes nuevos. |
| CA-01-07 | Al reconectar: resumen de lo pendiente (reportes, paradas, cambios, envíos) y nada se sube hasta "Confirmar y subir" | 🟡 | No hay reenvío automático al reconectar (`src/components/ReportEditor.tsx:431`); aviso con botón "Guardar ahora" `src/components/ReportEditor.tsx:420-430,882-897` | El aviso es por reporte, no hay resumen global. Además, cualquier edición nueva estando online dispara el autosave (`src/components/ReportEditor.tsx:517-536,596-599`), que sube todo lo pendiente sin confirmación (`:276-299`). |
| CA-01-08 | Al confirmar: se sube, cada elemento se marca sincronizado y se informa el resultado | 🟡 | PATCH con concurrencia optimista `src/pages/api/reports/[id].ts:54-93`; limpieza de la revisión confirmada `src/lib/offline-report-store.ts:417-482`; estado "Guardado en servidor" `src/components/ReportEditor.tsx:832-833` | Solo aplica a los campos del reporte (paradas, reportes nuevos y envíos no son encolables). |
| CA-01-09 | Posponer la subida: los datos permanecen y se vuelve a ofrecer | 🟡 | Persistencia por usuario en IndexedDB `src/lib/offline-report-store.ts:186-206`; el aviso reaparece en cada reconexión `src/components/ReportEditor.tsx:420-430` | No hay acción explícita de "posponer". Al editar online se sube todo implícitamente (ver CA-01-07). |
| CA-01-10 | Enviar → estado "Enviado" y el operario ya no puede editar | ✅ | `src/pages/api/reports/[id]/submit.ts:6-43`; transición y bloqueo `M-cancel:54-69`; RLS de update solo para `DRAFT` `M-cancel:220-234`; paradas solo en `DRAFT` `M-opwf:35-39` | — (envío solo online, ver FR-012) |

### User Story 2 — Coordinador supervisa en tiempo real (P1)

| ID | Criterio (resumido) | Estado | Evidencia | Gap |
| --- | --- | --- | --- | --- |
| CA-02-01 | Iniciar, actualizar, enviar o cancelar un reporte se refleja en el tablero sin recargar | ❌ | — (el tablero es SSR: `src/pages/dashboard.astro:32-43`) | No hay tiempo real. Solo las notificaciones hacen polling cada 30 s (envío, cancelación, inicio de parada: `M-notif:84-92,149-157`), y el tablero no se actualiza. |
| CA-02-02 | Ver operarios con sesión y conexión activas, y offline con pendientes | ❌ | — | No hay presencia, heartbeat ni registro de pendientes en el servidor. |
| CA-02-03 | Filtrar por rango de fechas y opcionalmente máquina, turno, operario y estado | 🟡 | `src/lib/report-filters.ts:53-125` (período día/semana/mes + estado + parada activa); UI `src/pages/reportes/index.astro:144-181` | No hay rango libre (desde/hasta) ni filtros por máquina, turno u operario. |
| CA-02-04 | "Descargar Excel" con reportes, paradas, cambios e indicadores, respetando los filtros | 🟡 | `src/pages/api/reports/export.ts:26-140` (mismos filtros, `:53`); hojas `src/lib/report-export.ts:163,215,247`; métricas `export.ts:65-70` | No hay cambios (la entidad no existe). Los filtros heredan las limitaciones de CA-02-03. |
| CA-02-05 | "Aprobar y cerrar" un reporte enviado → "Cerrado (aprobado)" con aprobador y fecha visibles | ❌ | — | No hay estado de cierre/aprobación, campos de aprobador, API ni UI. |
| CA-02-06 | No se puede aprobar un reporte activo, cancelado o con conflicto, y se indica el motivo | ❌ | — | Depende de CA-02-05. |
| CA-02-07 | Corregir un reporte enviado o cerrado indicando motivo → historial con anterior, nuevo, autor, fecha y motivo | 🟡 | Corrección por admin `src/pages/reportes/[id].astro:50,163-181`, `src/pages/api/reports/[id].ts:42-52`; auditoría por campo `M-corr:3-37`; paradas `M-audit:125-146` | No hay campo de motivo en la API (`[id].ts`) ni en `report_audit_log` (`M-init:150-158`). |

### User Story 3 — Auditor revisa reportes e historial (P2)

| ID | Criterio (resumido) | Estado | Evidencia | Gap |
| --- | --- | --- | --- | --- |
| CA-03-01 | El auditor abre cualquier reporte y ve detalle e historial en orden cronológico | 🟡 | Detalle e historial `src/pages/reportes/[id].astro:71-79,218-247`; RLS de auditoría para VIEWER `M-audit:11-23` | La RLS solo deja al VIEWER ver reportes `SUBMITTED` (`M-init:608,649`), no activos ni cancelados. El orden es descendente (`[id].astro:76`). El historial no registra las ediciones de campos en borrador (ver FR-029). |
| CA-03-02 | Las modificaciones aparecen en el historial del auditor sin recargar | ❌ | — | No hay tiempo real. |
| CA-03-03 | Excel con los reportes filtrados y una hoja aparte con el historial de cambios | 🟡 | El VIEWER puede exportar (`src/pages/api/reports/export.ts:29`, botón `src/pages/reportes/index.astro:192-194`) | No hay hoja de historial: solo existen las hojas de producción, detalle de paradas y catálogo (`src/lib/report-export.ts:163,215,247`). |
| CA-03-04 | Cualquier intento del auditor de crear, editar, cancelar, cerrar o eliminar es rechazado por cualquier vía | ✅ | API `src/pages/api/reports/[id].ts:20`, `.../submit.ts:8`, `.../cancel.ts:7`, `.../stops/index.ts:8`, `src/pages/api/catalogs/frequent.ts:7`; middleware admin `src/middleware.ts:40-49`; RLS sin políticas de escritura para VIEWER `M-init:544-700`; auditoría sin escritura `M-audit:2`; RPC frecuente excluye VIEWER `M-snap:166-169` | — |

### User Story 4 — Administración con jerarquía raíz (P2)

| ID | Criterio (resumido) | Estado | Evidencia | Gap |
| --- | --- | --- | --- | --- |
| CA-04-01 | El admin raíz crea coordinador o auditor con usuario y contraseña inicial → puede iniciar sesión con ese rol | 🟡 | Invitación con rol `src/pages/api/admin/users/invite.ts:52-88`; UI `src/pages/administracion/usuarios.astro:49-53` | No hay rol raíz: cualquier ADMINISTRATOR crea cualquier rol. El alta es por invitación de correo, sin usuario ni contraseña inicial. |
| CA-04-02 | Un coordinador no puede crear, editar ni desactivar coordinadores, auditores ni al raíz | ❌ | — (`src/pages/api/admin/users/[id].ts:112-158` acepta cualquier rol destino) | Cualquier ADMINISTRATOR edita, degrada o retira a otro ADMINISTRATOR. |
| CA-04-03 | El coordinador gestiona operarios, máquinas, asignaciones y catálogos → se aplica y queda en el historial administrativo | 🟡 | Máquinas `src/pages/api/admin/machines.ts`; turnos `.../shifts.ts`; categorías `.../stop-categories.ts`; catálogos `.../catalogs/[catalog].ts`; usuarios y asignaciones `.../users/[id].ts`, RPC `M-notif:185-245` | El historial administrativo solo registra eliminaciones de catálogo (`M-demo:141-182`) y el retiro o reactivación de usuarios (`M-notif:237-242`). Altas y ediciones no quedan registradas, y no hay UI para consultar `administrative_audit_log`. |
| CA-04-04 | Al eliminar una categoría en uso, se desactiva y el histórico conserva su valor | 🟡 | El borrado falla por la FK `restrict` (`M-init:125`) y se muestra "Desactívala en su lugar" (`src/pages/api/admin/stop-categories.ts:17-23`); se puede desactivar con `active` (`:29`) | No se desactiva automáticamente: el usuario recibe un error y debe desactivarla a mano. |
| CA-04-05 | Una categoría sin uso se elimina definitivamente tras confirmación explícita | ✅ | Diálogo de confirmación `src/components/DestructiveAction.astro:30-43`, uso `src/pages/administracion/paradas.astro:69`; borrado `src/pages/api/admin/stop-categories.ts:17-24`; RLS `M-demo:200-201` | — |
| CA-04-06 | Un usuario desactivado no puede iniciar sesión | ✅ | `src/lib/auth.ts:23` (perfil inactivo → sin sesión) + `src/middleware.ts:30-38`; retiro con ban `src/pages/api/admin/users/[id].ts:92` | Menor: el login (`src/pages/api/auth/login.ts:15-21`) "acepta" y redirige de vuelta sin mensaje específico. |

### User Story 5 — Inicio de sesión seguro y separación de roles (P1)

| ID | Criterio (resumido) | Estado | Evidencia | Gap |
| --- | --- | --- | --- | --- |
| CA-05-01 | Sin sesión, cualquier pantalla redirige al login | ✅ | `src/middleware.ts:30-38`; `src/pages/index.astro:4` | — |
| CA-05-02 | Credenciales incorrectas → mensaje genérico; tras 5 fallos seguidos, bloqueo de 15 min | 🟡 | Mensaje genérico "Credenciales inválidas." `src/pages/api/auth/login.ts:17-19` | No hay contador de intentos ni bloqueo por usuario. Solo el rate limit genérico de Supabase por IP (`supabase/config.toml:196-206`). |
| CA-05-03 | El operario no accede a administración, reportes ajenos ni exportación | ✅ | Admin `src/middleware.ts:40-49`; reportes propios `M-init:607,648`; exportación `src/pages/api/reports/export.ts:29-31`; navegación `src/components/shell/nav-config.ts:60,67-69` | — |
| CA-05-04 | Cualquier acción no permitida por solicitud directa es rechazada sin modificar datos | 🟡 | RLS en todas las tablas `M-init:511-521`; checks en API (ver CA-03-04, CA-05-03); triggers `M-cancel:25-118`, `M-opwf:17-84` | La matriz de la spec no se aplica entre raíz y coordinador (CA-04-02). Los operarios pueden crear clientes y productos (ver "Fuera de spec"). |

---

## 1b. Requisitos funcionales (FR)

| ID | Requisito (resumido) | Estado | Evidencia | Gap |
| --- | --- | --- | --- | --- |
| FR-001 | Usuario y contraseña para cualquier pantalla o dato | ✅ | `src/middleware.ts:30-38`; `M-init:523` (anon sin acceso) | El login usa correo, no nombre de usuario (`src/pages/iniciar-sesion.astro:30-31`). |
| FR-002 | Exactamente 4 roles | ❌ | `src/lib/types.ts:1` (3 roles) | Faltan el administrador raíz y la separación coordinador/raíz. |
| FR-003 | Permisos aplicados en el servidor | 🟡 | RLS `M-init:541-704`; checks en API | Correcto para los 3 roles actuales, pero la matriz de 4 roles no existe. |
| FR-004 | Bloqueo de 15 min tras 5 fallos + mensajes no reveladores | 🟡 | `src/pages/api/auth/login.ts:17-19`; recuperación neutra `src/pages/api/auth/recovery.ts:5` | Sin bloqueo por usuario. |
| FR-005 | Siempre al menos un admin raíz activo | 🟡 | No te puedes retirar ni degradar a ti mismo: `src/pages/api/admin/users/[id].ts:87-89,120-122` | No hay raíz. La garantía es indirecta y no existe en la BD. |
| FR-006 | Login offline para usuarios con login online en ese dispositivo en ≤7 días | ❌ | — | No hay login offline. La navegación offline cae en `offline.html` (`public/sw.js:68-72`). |
| FR-006a | Verificación offline con las mismas credenciales, bloqueo y sin contraseña legible | ❌ | — | — |
| FR-006b | Revalidar identidad, estado y rol al reconectar antes de ofrecer la subida | ❌ | — | `getAuthContext` revalida en cada request (`src/lib/auth.ts:11-26`), pero no hay un paso de revalidación asociado a la subida. |
| FR-006c | Sesión offline con el último rol verificado, registrada en auditoría | ❌ | — | — |
| FR-007 | Iniciar reporte solo para máquina asignada en turno vigente | 🟡 | `M-cancel:93-103`; `M-init:610-624` | La asignación no tiene turno ni vigencia (`M-init:29-37`). |
| FR-008 | Registrar producción, paradas (inicio, fin, categoría, observación) y cambios | 🟡 | Producción `src/lib/report-fields.ts`, `src/components/ReportEditor.tsx`; paradas `src/pages/api/reports/[id]/stops/**` | Faltan los cambios. |
| FR-009 | Sin solapamientos, sin fin < inicio, sin envío con parada abierta | ✅ | `M-init:133,141-146`; `M-opwf:155-157`; `src/pages/api/reports/[id]/submit.ts:23-25` | Validación solo online (offline no aplica, porque las paradas no son offline). |
| FR-010 | Enviar o cancelar (con motivo) los propios activos; no editar enviados, cerrados ni cancelados | ✅ | `src/pages/api/reports/[id]/submit.ts`, `.../cancel.ts:11-27`; `M-cancel:54-85,220-234` | — |
| FR-011 | Operario ve solo sus reportes | ✅ | `M-init:603-609,640-652` | — |
| FR-012 | Todo FR-007..010 offline | 🟡 | Solo campos del reporte: `src/components/ReportEditor.tsx:130-132,184-188` | Iniciar, parar, enviar y cancelar requieren conexión (`src/components/StopManager.tsx:103`, `src/components/ReportEditor.tsx:188`). |
| FR-013 | Lo capturado offline sobrevive al cierre, al reinicio y a la expiración de sesión | ✅ | IndexedDB transaccional por usuario `src/lib/offline-report-store.ts:171-245,332-411`; restauración `src/components/ReportEditor.tsx:442-499`; flush en `pagehide` `:538-554` | Cubre solo lo que hoy puede capturarse offline (campos). |
| FR-014 | Mostrar siempre el estado de conexión y el nº de pendientes | 🟡 | Banner de estado `src/components/ConnectionStatus.astro:126-147`; badge por reporte `src/components/ReportEditor.tsx:822-842` | El banner se oculta cuando está online (`ConnectionStatus.astro:133-136`) y no hay contador global de pendientes. |
| FR-015 | Resumen al reconectar; nada se sube sin confirmación del autor | 🟡 | `src/components/ReportEditor.tsx:420-431,882-897` | Sin resumen global. Hay subida implícita al editar online (`:276-299,596-599`). |
| FR-016 | Posponer; conservar y volver a ofrecer | 🟡 | `src/components/ReportEditor.tsx:420-430` | Sin acción explícita de posponer. |
| FR-017 | Subida idempotente; sin duplicados ni pérdidas | 🟡 | Concurrencia optimista y detección de "ya aplicado" `src/pages/api/reports/[id].ts:54-93`; revisiones `src/lib/offline-report-store.ts:356-367,417-482` | El `operationId` del outbox no se envía al servidor. Solo hay PATCH de campos; no existe una cola de entidades nuevas. |
| FR-018 | Conflicto: conservar las versiones de servidor y local, avisar al operario y notificar al coordinador | 🟡 | 409 `REPORT_CONFLICT`/`REPORT_NOT_DRAFT` `src/pages/api/reports/[id].ts:78-93`; local conservado y en revisión `src/components/ReportEditor.tsx:485-487`; aviso `src/components/OfflineDraftNotice.tsx:47-60` | No se notifica al coordinador (no existe ese tipo en `M-notif:5`). |
| FR-019 | Pendientes aislados por usuario en el dispositivo | ✅ | Clave `[userId, reportId]` `src/lib/offline-report-store.ts:188-201`; lecturas por `authenticatedUserId` `src/components/ReportEditor.tsx:449` | Aislamiento lógico, no cifrado. |
| FR-020 | Coordinador y auditor consultan offline la última información, marcada con su hora | ❌ | — | El SW no cachea páginas ni datos (`public/sw.js:61-87`). |
| FR-021 | Coordinador ve todos los reportes por estado con autoactualización | 🟡 | KPIs por estado (solo hoy) `src/pages/dashboard.astro:34-61`; filtro por estado `src/lib/report-filters.ts:55-58` | Sin autoactualización y sin estado "cerrado". El tablero se limita a hoy. |
| FR-022 | Ver operarios conectados y máquinas en parada ahora | 🟡 | Máquinas en parada: KPI `src/pages/dashboard.astro:41-42,60`, indicador `:143` | Falta la presencia de operarios. |
| FR-023 | Filtros: rango, máquina, turno, operario, estado | 🟡 | `src/lib/report-filters.ts:53-134` | Ver CA-02-03. |
| FR-024 | Aprobar enviado → "Cerrado (aprobado)" | ❌ | — | — |
| FR-024a | Aprobador y fecha en detalle, listados y Excel | ❌ | — | — |
| FR-024b | Solo se aprueban reportes enviados sin conflictos, y con conexión | ❌ | — | — |
| FR-025 | Corregir enviados o cerrados con motivo obligatorio | 🟡 | `src/pages/reportes/[id].astro:50,174`; `M-corr:3-37` | Falta el motivo. |
| FR-026 | CRUD + desactivar/reactivar de operarios, máquinas, asignaciones y catálogos (incl. tipos de cambio) | 🟡 | `src/pages/api/admin/**`; reactivar `.../catalogs/[catalog].ts:20-26`; asignaciones `M-notif:185-245` | Faltan los tipos de cambio. Las asignaciones no tienen turno. |
| FR-027 | En uso → desactivar; sin uso → borrar con confirmación | 🟡 | FK `restrict` + mensaje `src/pages/api/admin/catalogs/[catalog].ts:27-36`; máquinas `src/pages/api/admin/machines.ts:17-26`; usuarios nunca se borran `M-svc:5` | No hay desactivación automática ante "eliminar". |
| FR-028 | Solo el raíz gestiona coordinadores y auditores | ❌ | — | Ver CA-04-02. |
| FR-029 | Registrar toda creación y modificación (reportes, paradas, cambios, admin) con autor, rol, campo, valores, motivo e indicador offline | 🟡 | Paradas (operario y admin) `M-audit:125-146`; correcciones de admin en enviados y cancelados `M-corr:15-36`; admin parcial `M-demo:141-182` | No se auditan: la creación de reportes, las ediciones de campos en borrador (operario **y admin**), ni altas y ediciones administrativas. Faltan las columnas de rol, motivo, indicador offline y hora de llegada (`M-init:150-158`). |
| FR-030 | Historial inalterable | ✅ | `M-audit:2` (sin insert/update/delete para clientes); FK `restrict` `M-audit:4-7`; admin log solo `select` `M-demo:134` | Inmutabilidad a nivel de app; `service_role` conserva acceso. |
| FR-031 | Auditor ve todos los reportes e historial con autoactualización | 🟡 | Historial `src/pages/reportes/[id].astro:218-247` | El VIEWER solo ve `SUBMITTED` (`M-init:608`) y no hay autoactualización. |
| FR-032 | Auditor no puede crear, editar, cerrar, cancelar ni eliminar | ✅ | Ver CA-03-04 | — |
| FR-033 | Excel para coord/raíz/auditor con paradas, cambios, indicadores y hoja de historial | 🟡 | `src/pages/api/reports/export.ts:29`; `src/lib/report-export.ts:163-268` | Faltan la hoja de historial y los cambios. |
| FR-034 | Operarios no exportan | ✅ | `src/pages/api/reports/export.ts:29-31`; botón oculto `src/pages/reportes/index.astro:192` | — |

## 1c. Casos límite

| Caso | Estado | Evidencia | Gap |
| --- | --- | --- | --- |
| Reporte modificado en servidor durante offline | 🟡 | `src/pages/api/reports/[id].ts:78-93`; `src/components/ReportEditor.tsx:485-487` | No se notifica al coordinador. |
| Asignación revocada durante offline → subir marcado "capturado sin conexión" | ❌ | — | No existe el indicador de origen offline. |
| Usuario desactivado o contraseña cambiada offline | 🟡 | Revalidación por request `src/lib/auth.ts:23` | No existe el flujo "subir solo si un coordinador lo autoriza". |
| Login offline sin habilitación → mensaje claro | ❌ | — | No hay login offline. |
| Sesión expirada al reconectar → conservar y re-login | ✅ | IndexedDB por usuario `src/lib/offline-report-store.ts:188-193`; restauración `src/components/ReportEditor.tsx:449-463` | — |
| Dispositivo compartido | ✅ | Ver FR-019 | — |
| Logout con pendientes → advertir y confirmar | ❌ | `src/components/shell/NavUser.tsx:49-50` (envía el logout sin comprobar) | Sin advertencia. Solo hay `beforeunload` genérico (`src/components/ReportEditor.tsx:556-567`). |
| Subida parcialmente fallida, sin duplicados | 🟡 | PATCH idempotente `src/pages/api/reports/[id].ts:85-87` | Solo hay una operación por reporte; no hay lote multielemento. |
| Parada abierta al terminar turno → no enviar | ✅ | `M-opwf:155-157`; `src/pages/api/reports/[id]/submit.ts:23-25` | — |
| Paradas solapadas o fin < inicio, online y offline | 🟡 | `M-init:133,141-146` | Solo online. |
| Reloj desajustado: conservar la hora capturada + hora de llegada | ❌ | El servidor sobrescribe la hora de la parada con `clock_timestamp()` (`M-opwf:45,56`) | No se guarda la hora de captura ni la de llegada. |
| Pendientes de más de 7 días → aviso persistente al iniciar sesión | ❌ | — | — |
| Exportación sin resultados → informar en vez de archivo vacío | ❌ | `src/pages/api/reports/export.ts:46-60,107-136` (sin chequeo `reports.length === 0`) | Genera un Excel vacío. |
| Último admin raíz no se puede desactivar | 🟡 | `src/pages/api/admin/users/[id].ts:87-89,120-122` | No hay raíz ni garantía en la BD. |

## 1d. Criterios de éxito (SC)

| ID | Estado | Evidencia / razón |
| --- | --- | --- |
| SC-001 (iniciar reporte < 30 s) | ❓ | Requiere medición en uso. |
| SC-002 (parada < 20 s) | ❓ | Requiere medición en uso. |
| SC-003 (100 % de un turno offline subido sin pérdidas ni duplicados) | ❌ | Paradas, creación y envío no son offline (FR-012). |
| SC-004 (0 subidas no confirmadas) | 🟡 | No hay reenvío automático al reconectar (`src/components/ReportEditor.tsx:431`), pero editar online sube lo pendiente (`:596-599`). |
| SC-005 (cambios visibles en < 10 s) | ❌ | No hay tiempo real. |
| SC-006 (Excel de un mes < 30 s) | ❓ | Requiere carga real. Hay límites de 10 000 paradas y 4 MB (`src/pages/api/reports/export.ts:8-9`). |
| SC-007 (100 % de acciones prohibidas rechazadas) | ❌ | El coordinador puede gestionar coordinadores y auditores (CA-04-02). Los operarios crean catálogos (Fuera de spec). |
| SC-008 (100 % de modificaciones auditadas con autor, fecha y valores) | 🟡 | No se auditan las ediciones de borrador ni las altas y ediciones admin (FR-029). |
| SC-009 (−80 % de tiempo de consolidación) | ❓ | Métrica de negocio. |
| SC-010 (90 % completa el primer reporte sin ayuda) | ❓ | Métrica de usabilidad. |
| SC-011 (100 % de cerrados muestran aprobador y fecha) | ❌ | No existe el estado cerrado. |
| SC-012 (login offline < 15 s; rechazo de no habilitados) | ❌ | No hay login offline. |

---

## 2. Fuera de spec (en el código pero no en la spec, o en contradicción con ella)

| # | Comportamiento | Evidencia | Relación con la spec |
| --- | --- | --- | --- |
| 1 | **Los operarios pueden crear clientes y productos** ("valores frecuentes") desde el editor | `src/pages/api/catalogs/frequent.ts:5-26`; `M-snap:155-199` (permite `OPERATOR`); UI `src/components/ReportEditor.tsx:618,654` | **Contradice** "Operario… nunca puede administrar nada" y FR-026 (catálogos solo los gestiona el coordinador). |
| 2 | **El admin edita borradores de operarios sin auditoría** | Editor habilitado para admin en cualquier estado `src/pages/reportes/[id].astro:50-51`; auditoría solo para `SUBMITTED`/`CANCELLED` `M-corr:15-18` | **Contradice** FR-029/SC-008. |
| 3 | **El auditor (VIEWER) solo ve reportes enviados** | `M-init:608,649`; KPIs ocultos para VIEWER `src/pages/dashboard.astro:57-60` | **Contradice** FR-031 ("todos los reportes"). |
| 4 | **Login por correo + recuperación de contraseña por email + alta por invitación** | `src/pages/api/auth/login.ts:7`; `src/pages/api/auth/recovery.ts`; `src/pages/api/admin/users/invite.ts:67-71`; `src/pages/recuperar-contrasena.astro` | **Contradice** los supuestos (usuario asignado, operarios sin correo, reset hecho por un administrador). |
| 5 | **Límite de 5 borradores por operario y 1 borrador por máquina (global, sin turno)** | `M-cancel:105-112`; índice `M-init:116-118`; UI `src/pages/reportes/index.astro:93,123,128` | Distinto del supuesto "≤ 1 máquina por turno y ≤ 1 reporte activo por máquina y turno": el operario puede tener varias máquinas abiertas a la vez. |
| 6 | **Cancelación de paradas con motivo por el operario** (la parada queda "anulada" sin duración) | `src/pages/api/reports/[id]/stops/[stopId]/cancel.ts`; `M-opwf:1-15,66-74` | No descrito en la spec. |
| 7 | **El admin puede borrar físicamente paradas** (queda auditado) | `M-opwf:114-117`; `M-audit:125-146` | No descrito. Choca con el espíritu de "no se borran, se desactivan". |
| 8 | **El operario no puede cambiar la hora de inicio ni fin de una parada**: el servidor la fija con su reloj | `M-opwf:45,56` | Incompatible con la captura offline de horas que pide la spec (caso "reloj desajustado"). |
| 9 | **Sistema de notificaciones persistentes** (campana, página, polling de 30 s): envíos, cancelaciones, correcciones, inicio de paradas y cambios de asignación | `M-notif:1-323`; `src/components/notifications/**`; `src/pages/notificaciones.astro`; `src/pages/api/notifications/**` | No descrito, aunque podría servir de base para la notificación de conflictos (FR-018). |
| 10 | **Solo el operario puede cancelar un reporte**; el admin no puede | `M-cancel:70-73`; `src/pages/api/reports/[id]/cancel.ts:7` | La spec no define la cancelación por coordinador; queda como decisión implícita. |
| 11 | **Métricas ocultas al operario** (rendimiento teórico/neto y tiempo de parada) | `src/pages/reportes/[id].astro:28,152-157` | No descrito. |
| 12 | **Borrar una máquina elimina sus asignaciones** | `src/pages/api/admin/machines.ts:21` | No descrito (las asignaciones históricas se pierden). |
| 13 | **PWA instalable con banner de nueva versión** | `public/manifest.webmanifest`; `src/components/ConnectionStatus.astro:70-73,157-201` | Infraestructura no descrita (aceptable). |
| 14 | **Tablero limitado al día de hoy** | `src/pages/dashboard.astro:32-43` | La spec no restringe el tablero al día. |

---

## 3. Resumen

### Conteo por estado

| Conjunto | ✅ Cumple | 🟡 Parcial | ❌ No cumple | ❓ No verificable | Total |
| --- | --- | --- | --- | --- | --- |
| Escenarios de aceptación (CA) | 7 | 16 | 8 | 0 | 31 |
| Requisitos funcionales (FR) | 9 | 20 | 10 | 0 | 39 |
| Casos límite | 3 | 5 | 6 | 0 | 14 |
| Criterios de éxito (SC) | 0 | 2 | 5 | 5 | 12 |

Por historia (CA): US1 2✅/6🟡/2❌ · US2 0✅/3🟡/4❌ · US3 1✅/2🟡/1❌ · US4 2✅/3🟡/1❌ · US5 2✅/2🟡/0❌.

### Top 5 gaps por impacto

1. **El offline no cubre el turno completo (P1, criterio explícito del usuario).** Hoy solo se pueden editar offline los campos de un borrador ya abierto. Faltan: crear reportes, paradas, envío y cancelación offline; login offline (FR-006*); resumen global con "Confirmar y subir" / "Posponer"; y origen offline con hora de llegada. Además, **editar online sube lo pendiente sin confirmación**, lo que viola FR-015/SC-004. Afecta a CA-01-05…09, FR-006…020 y SC-003/004/012.
2. **No hay separación de roles raíz/coordinador (P1).** Solo hay 3 roles, y cualquier ADMINISTRATOR crea, edita o retira a otros administradores y auditores. A esto se suma que el operario puede crear catálogos (Fuera de spec #1). Afecta a FR-002/005/028, CA-04-01/02, CA-05-04 y SC-007.
3. **No existe el flujo de aprobación ni el estado "Cerrado (aprobado)" (P1, US2).** Faltan estado, aprobador, fecha, reglas, UI y columna en Excel. Afecta a CA-02-05/06, FR-024/024a/024b y SC-011. Bloquea también la "corrección de cerrados" de FR-025.
4. **Auditoría incompleta y auditor con visibilidad recortada (P2, pero es la razón de ser del rol).** No se auditan la creación de reportes, las ediciones de borrador (incluidas las del admin) ni las altas y ediciones administrativas. Faltan rol, motivo e indicador offline. El VIEWER solo ve reportes `SUBMITTED` y el Excel no tiene hoja de historial. Afecta a FR-029/031/033, CA-02-07, CA-03-01/03 y SC-008.
5. **No hay tiempo real (P1, US2/US3).** No hay actualización sin recarga del tablero ni del historial, ni presencia de operarios. Afecta a CA-02-01/02, CA-03-02, FR-021/022/031 y SC-005.

**Siguiente en la lista:** la entidad **"Cambio"** (producto/formato/lote) y el catálogo **tipos de cambio** no existen (CA-01-04, FR-008, FR-026, Excel). Las **asignaciones no tienen turno ni vigencia** (FR-007). Los **filtros** no admiten rango libre ni máquina, turno u operario (FR-023).
