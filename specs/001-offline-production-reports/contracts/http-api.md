# Contrato HTTP (Astro API routes)

Todas las rutas exigen sesión salvo indicación en contrario. Errores JSON: `{ "error": string,
"code"?: string }`. Formularios HTML: redirección 303 con `?ok=`/`?error=` (patrón actual). El
middleware (`src/middleware.ts`) rechaza `/api/admin/**` y `/administracion/**` para roles distintos
de ROOT/ADMINISTRATOR; cada ruta vuelve a validar el rol y la RLS es la barrera final.

Leyenda de cambio: **[NUEVO]**, **[CAMBIA]**, **[SE ELIMINA]**. Fase entre paréntesis.

## Autenticación

| Método y ruta | Roles | Contrato | Cambio |
| --- | --- | --- | --- |
| `POST /api/auth/login` | público | Form `username`, `password`. Usuario bloqueado o credenciales malas → 303 `/iniciar-sesion?error=Usuario o contraseña incorrectos` (mensaje idéntico en todos los casos). Éxito → 303 `/` y respuesta con `X-Offline-Enroll: 1` para que el cliente cree el verificador offline (Fase 4b). | **[CAMBIA]** (F2) |
| `POST /api/auth/logout` | sesión | El cliente comprueba pendientes **antes** de enviar el formulario (FR caso "cierre con pendientes"). | **[CAMBIA]** (F4a) |
| `POST /api/auth/password` | sesión | Cambio de la propia contraseña (≥ 8 caracteres). | sin cambio |
| `POST /api/auth/recovery`, `/recuperar-contrasena`, `/auth/confirmar` | — | Eliminadas (Clarification 1). | **[SE ELIMINA]** (F2) |

## Usuarios (administración)

| Método y ruta | Roles | Contrato | Cambio |
| --- | --- | --- | --- |
| `POST /api/admin/users` | ROOT (cualquier rol), ADMINISTRATOR (solo `OPERATOR`) | Form `username`, `full_name`, `role`, `job_title?`, `password` (≥ 8), `password_confirm`, `assignments[]` (`machine_id:shift_id`) si OPERATOR. 409 si el usuario existe (también retirado → mensaje "reactiva el existente"). Audita `USER_CREATED`. | **[NUEVO]** reemplaza `invite.ts` (F2) |
| `POST /api/admin/users/[id]` `intent=update` | idem matriz de gestión | Form `full_name`, `job_title`, `role`, `active`, `assignments[]`. El objetivo y el rol nuevo deben estar permitidos para el actor; nunca deja 0 ROOT activos. | **[CAMBIA]** (F2) |
| `POST /api/admin/users/[id]` `intent=reset_password` | idem | Form `password`, `password_confirm`. Audita `PASSWORD_RESET`. | **[NUEVO]** (F2) |
| `POST /api/admin/users/[id]` `intent=remove` / `reactivate` | idem | Comportamiento actual + chequeo de matriz. `remove` (y `update` con `active=false`) exige el campo `confirm_offline_risk=1` y responde con error "El usuario tiene datos pendientes de subir o un reporte activo" si `manage_user_assignments` devuelve `USER_HAS_PENDING_DATA` (FR-005a). | **[CAMBIA]** (F2) |
| `GET /api/admin/users/[id]/last-contact` | manager (según matriz) | JSON `{ lastSeenAt, pendingCount, activeReportId }` para el diálogo de confirmación previo a desactivar. | **[NUEVO]** (F2) |
| `POST /api/device-status` | cualquier usuario activo | JSON `{ deviceId, pendingCount, oldestPendingAt }` → RPC `report_device_sync_status`. 204. | **[NUEVO]** (F2 ruta / F4a cliente) |
| `POST /api/admin/users/invite` | — | — | **[SE ELIMINA]** (F2) |

## Catálogos y máquinas

| Método y ruta | Roles | Contrato | Cambio |
| --- | --- | --- | --- |
| `POST /api/admin/{machines,shifts,stop-categories,change-types,catalogs/[catalog]}` | manager | Igual que hoy; `intent=delete` llama a `delete_or_deactivate` y responde "eliminado" o "desactivado (en uso)". | **[CAMBIA]** (F2); `change-types` **[NUEVO]** (F1/F2) |
| `POST /api/catalogs/frequent` | — | — | **[SE ELIMINA]** (F2) |

## Reportes (online)

| Método y ruta | Roles | Contrato | Cambio |
| --- | --- | --- | --- |
| `POST /api/reports` | OPERATOR | JSON `{ id?: uuid, machine_id, started_at }`. Turno y fecha operativa los fija la BD. 409 `ACTIVE_REPORT_EXISTS` / `MACHINE_BUSY`; 422 `NO_ASSIGNMENT` con mensaje "Solicita una asignación a tu coordinador". | **[CAMBIA]** (F2) |
| `PATCH /api/reports/[id]` | OPERATOR (autor, `DRAFT`) | Campos editables + `_base_updated_at`. Managers → 403 (deben usar `/correct`). | **[CAMBIA]** (F2) |
| `POST /api/reports/[id]/correct` | manager | JSON `{ patch: {...campos}, stops?: [...], changes?: [...], reason: string(≥5) }`; solo `SUBMITTED`/`CLOSED`. | **[NUEVO]** (F3) |
| `POST /api/reports/[id]/approve` | manager | Sin cuerpo; 409 `NOT_SUBMITTED` / `OPEN_CONFLICT`. | **[NUEVO]** (F2) |
| `POST /api/reports/[id]/submit` | OPERATOR autor | Sin cambio de contrato. | sin cambio |
| `POST /api/reports/[id]/cancel` | OPERATOR autor; manager si `is_off_shift` | JSON `{ reason }`. 409 `NOT_CANCELLABLE`. | **[CAMBIA]** (F2) |
| `POST /api/reports/[id]/stops` y `/stops/[stopId]/{close,cancel,category}` | OPERATOR autor | **[CAMBIA]** aceptan `id` (uuid cliente) y `started_at`/`ended_at` del dispositivo. | (F4a) |
| `POST /api/reports/[id]/changes` | OPERATOR autor | JSON `{ id: uuid, change_type_id, description, occurred_at }`. | **[NUEVO]** (F1/F4a) |
| `POST /api/sync-quarantine/[id]/review` | manager | Marca revisado; opcional `apply: true` aplica los datos vía `correct_report` con motivo. | **[NUEVO]** (F4a) |

## Exportación y consultas

| Método y ruta | Roles | Contrato | Cambio |
| --- | --- | --- | --- |
| `GET /api/reports/export` | ROOT, ADMINISTRATOR, VIEWER | Query: `from`, `to` (fecha operativa, ISO), `machine`, `shift`, `operator`, `status` (`DRAFT`,`SUBMITTED`,`CLOSED`,`CANCELLED`), `stop=active`, `offshift=1`. Compatibilidad: `period`/`date`/`month` se traducen a `from`/`to`. 200 xlsx con hojas SEGUIMIENTO PRODUCCIÓN, DETALLE PARADAS, CAMBIOS, HISTORIAL, CATÁLOGO PARADAS; **204** si no hay resultados; 422/413 límites. OPERATOR → 403. | **[CAMBIA]** (F3) |
| `GET /api/admin/audit` | ROOT | Query `from`, `to`, `actor`, `action`, `entity_type`, `page`. JSON paginado. Página `/administracion/historial`. | **[NUEVO]** (F3) |
| `GET /api/dashboard/summary` | manager, VIEWER | JSON KPIs por estado (rango de fechas, máximo 366 días → 422), máquinas en parada, reportes fuera de turno. | **[NUEVO]** (F5) |
| `GET /api/reports/[id]/timeline` | manager, VIEWER, autor | JSON detalle + historial ordenado cronológicamente (ascendente). | **[NUEVO]** (F3/F5) |

## Offline

| Método y ruta | Roles | Contrato | Cambio |
| --- | --- | --- | --- |
| `GET /api/offline/snapshot` | OPERATOR | JSON `{ profile, settings: { offShiftGrace, offlineLoginWindow }, shifts[], assignments[] (vigentes), catalogs: { stopCategories, changeTypes, clients, products, lines, dosifierTypes } (activos), activeReport?: {...con paradas y cambios}, serverTime, fetchedAt }`. | **[NUEVO]** (F4a) |
| `POST /api/sync/batch` | OPERATOR | Ver [sync-protocol.md](./sync-protocol.md). | **[NUEVO]** (F4a) |
| `GET /api/offline/overview` | manager, VIEWER | JSON snapshot de solo lectura (KPIs del día + últimos 200 reportes del rango visto). | **[NUEVO]** (F4b) |
| `GET /api/health` | público | `HEAD` 204 (existente). | sin cambio |

## Páginas

| Ruta | Roles | Cambio |
| --- | --- | --- |
| `/iniciar-sesion` | público | Campo `username` en lugar de correo; sin enlace de recuperación; modo offline (F4b). |
| `/turno` (prerender, precacheado) | OPERATOR | **[NUEVO]** shell offline del operario (F4a). |
| `/consulta-offline` (prerender, precacheado) | manager, VIEWER | **[NUEVO]** consulta de solo lectura (F4b). |
| `/administracion/historial` | ROOT | **[NUEVO]** historial administrativo (F3). |
| `/administracion/tipos-cambio` | manager | **[NUEVO]** catálogo de tipos de cambio (F2). |
| `/administracion/usuarios` | manager | **[CAMBIA]** alta con contraseña, reset, asignaciones por turno, filtrado por matriz (F2). |
| `/dashboard`, `/reportes`, `/reportes/[id]` | todos según rol | **[CAMBIA]** filtros completos, aprobación, corrección con motivo, historial cronológico, tiempo real (F2–F5). |
