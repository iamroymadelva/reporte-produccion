# Research — 001 Plataforma de reportes offline y roles separados

**Fecha**: 2026-10-09 · **Entrada**: [spec.md](./spec.md) (con Clarifications 2026-10-09) y
[gap-analysis.md](./gap-analysis.md).

Cada decisión resuelve una incógnita del Technical Context de [plan.md](./plan.md). Formato:
**Decisión** / **Justificación** / **Alternativas consideradas**.

---

## R1. Inicio de sesión con nombre de usuario sobre Supabase Auth

- **Decisión**: Supabase Auth sigue siendo el proveedor de identidad. Cada usuario tiene
  `profiles.username` (único, minúsculas, `^[a-z0-9._-]{3,32}$`). En Auth se guarda un **correo
  sintético no enrutable** `<username>@usuarios.reporte-produccion.invalid`. El formulario pide
  usuario y contraseña; el servidor traduce el usuario a correo sintético antes de
  `signInWithPassword`. El alta usa `auth.admin.createUser({ email_confirm: true, password })` y el
  restablecimiento usa `auth.admin.updateUserById({ password })`, ambos desde el cliente admin del
  servidor. Se eliminan invitación, recuperación por correo y `/auth/confirmar`.
- **Justificación**: Conserva sesiones, cookies SSR, RLS por `auth.uid()` y el resto de la
  arquitectura existente (`src/lib/auth.ts`, `src/lib/supabase/server.ts`). El TLD `.invalid` está
  reservado (RFC 2606), así que nunca se envía correo real. Los cambios quedan acotados a login,
  alta y restablecimiento.
- **Alternativas**: (a) Autenticación propia con tabla de hashes: obliga a reimplementar sesiones y
  RLS; se descarta. (b) Login por teléfono/OTP: requiere SMS y no aplica en planta. (c) Mantener el
  correo real: lo descarta la Clarification 1.

## R2. Bloqueo por intentos fallidos (FR-004)

- **Decisión**: Nueva tabla `private.login_attempts(username, failed_count, first_failed_at,
  locked_until)`. Las funciones `security definer` `private.check_login_allowed(username)` y
  `private.register_login_result(username, success)` las invoca **solo el servidor** con
  service-role. Son 5 fallos consecutivos y un bloqueo de 15 min; un login correcto reinicia el
  contador. La respuesta es siempre "Usuario o contraseña incorrectos" y no revela si el usuario
  existe ni si está bloqueado (existan o no, se cuentan los intentos). El bloqueo en modo offline
  usa un contador local equivalente (R8).
- **Justificación**: El rate limit de Supabase es por IP y no por usuario. Mantener la lógica en la
  BD la hace atómica ante peticiones concurrentes.
- **Alternativas**: Contador en memoria o en el KV de Vercel: no es durable entre instances
  serverless. Captcha: no cumple el requisito.

## R3. Modelo de roles con administrador raíz (FR-002, FR-005, FR-028, FR-029a)

- **Decisión**: Se añade `ROOT` al enum `app_role` y se conservan los valores existentes con este
  significado: `ADMINISTRATOR` = **coordinador**, `VIEWER` = **auditor**, `OPERATOR` = operario. Se
  añaden los helpers `private.is_manager()` (ROOT o ADMINISTRATOR) e `private.is_root()`. Todas las
  políticas que hoy dicen `= 'ADMINISTRATOR'` pasan a `private.is_manager()`, salvo la gestión de
  coordinadores y auditores y la lectura de `administrative_audit_log`, que pasan a
  `private.is_root()`. Un trigger diferido sobre `profiles` impide quedar sin un ROOT activo. La
  primera cuenta ROOT se crea con un script de bootstrap en la instalación (`supabase/seed.sql`
  local y un script documentado para producción). Las etiquetas de UI cambian a "Administrador
  raíz", "Coordinador", "Operario" y "Auditor".
- **Justificación**: Renombrar valores de enum obliga a reescribir los datos y todas las políticas y
  tests. Añadir un valor es retrocompatible. Ya existe un precedente (`add_cancelled_status.sql`):
  el `ALTER TYPE ... ADD VALUE` va en una migración separada de su primer uso.
- **Alternativas**: (a) Tabla de permisos granular (RBAC): excesiva para 4 roles fijos. (b) Un flag
  `is_root` sobre ADMINISTRATOR: mezcla dos roles con matrices de permisos distintas y complica RLS.

## R4. Ciclo de vida del reporte y aprobación (FR-024*, FR-010a, FR-025a)

- **Decisión**: Se añade `CLOSED` al enum `report_status` (etiqueta "Cerrado (aprobado)") y las
  columnas `approved_by`, `approved_at`, `approver_full_name` (snapshot). Las transiciones válidas
  son `DRAFT→SUBMITTED` (autor), `DRAFT→CANCELLED` (autor, o manager si está *abierto fuera de
  turno*) y `SUBMITTED→CLOSED` (manager, con conexión y sin conflictos abiertos). Las correcciones
  de un manager solo se permiten en `SUBMITTED` o `CLOSED`, vía RPC con motivo obligatorio (R7).
  RLS y trigger impiden que un manager edite un `DRAFT`. "Abierto fuera de turno" es un valor
  **calculado** (`now()` posterior al fin del turno del reporte en su fecha operativa), expuesto en
  la vista `production_report_overview`; no se almacena.
- **Mecanismo de permisos (añadido tras /speckit-analyze, hallazgo I1)**: ninguna política RLS
  concede `UPDATE` directo a managers sobre reportes, paradas o cambios. `approve_report`,
  `cancel_report`, `correct_report`, `review_quarantine` y `apply_sync_operation` son RPC
  `security definer` con `search_path = ''` que validan, antes de nada, actor activo, rol, propiedad
  y estado. Así la única vía de escritura privilegiada está controlada en la BD (Principio I).
- **Margen "fuera de turno"**: `is_off_shift` se activa en el fin del turno + `off_shift_grace`
  (2 h por defecto, configurable en `app_settings`), para no cancelar reportes de operarios que
  trabajaron sin señal y aún no sincronizan su envío.
- **Justificación**: El trigger existente `validate_production_report` ya centraliza las
  transiciones y se amplía. Calcular "fuera de turno" evita jobs programados y estados
  desincronizados.
- **Alternativas**: Un job (`pg_cron`) que marque los reportes abandonados: añade infraestructura
  sin aportar nada sobre el cálculo en la consulta.

## R5. Asignaciones por turno, fecha operativa y un reporte activo (FR-007, FR-007a, FR-007b)

- **Decisión**: `operator_machine_assignments` pasa a tener `id uuid`, `shift_id`, `valid_from`,
  `valid_to` (nullable) y `active`, con unicidad parcial `(operator_id, machine_id, shift_id) where
  active`. La función `private.current_shift_at(ts timestamptz)` resuelve el turno vigente en
  `America/Bogota`, incluidos los que cruzan medianoche, y su **fecha operativa** (la fecha de
  inicio del turno). Al crear un reporte, el trigger fija `shift_id` y `report_date` (fecha
  operativa) a partir del `started_at` del dispositivo; el operario ya no las escribe. Los índices
  únicos parciales `one_active_per_operator (created_by) where status='DRAFT'` y
  `one_active_per_machine (machine_id) where status='DRAFT'` sustituyen el límite de 5 borradores.
- **Justificación**: Hace cumplir FR-007a en la BD, incluso para reportes creados offline al
  sincronizar. La lógica de turnos nocturnos queda en un solo lugar.
- **Alternativas**: Calcular el turno solo en el cliente: inconsistente entre dispositivos y
  falsificable.

## R6. Entidad "Cambio" y horas del dispositivo (FR-008, FR-008a)

- **Decisión**: Nueva tabla `report_change_events(id uuid, report_id, change_type_id, description,
  occurred_at, received_at, captured_offline, clock_skew_review, created_by)` y un catálogo nuevo
  `change_types` (semilla: Producto, Formato, Lote, Otro). Para paradas y cambios, el `id` lo
  **genera el cliente** (UUID v4) y la hora del evento es la del dispositivo (`started_at`,
  `ended_at`, `occurred_at`). El servidor registra `received_at = clock_timestamp()` y fija
  `clock_skew_review = true` cuando el evento se capturó online y difiere más de 5 min de la llegada.
  Se elimina la sobrescritura con `clock_timestamp()` del trigger `prepare_stop_event`. La
  validación de no solapamiento (GiST) se conserva y se replica en el cliente para el modo offline.
- **Justificación**: Los IDs del cliente hacen la subida idempotente (R9). La hora del dispositivo
  es la decisión de la Clarification 3.
- **Alternativas**: IDs asignados por el servidor con una tabla de mapeo: complica las referencias
  locales entre parada y reporte creados offline.

## R7. Auditoría completa con motivo, rol e indicador offline (FR-029, FR-029a, FR-030, FR-025)

- **Decisión**:
  - `report_audit_log` gana las columnas `actor_role`, `reason`, `captured_offline`, `captured_at`,
    `received_at` y `entity_type` (`report` | `stop` | `change`).
  - Un trigger de auditoría genérico registra **toda** inserción y modificación de
    `production_reports`, `report_stop_events` y `report_change_events`, por cualquier rol (también
    las ediciones del operario en borrador, guardando solo los campos que cambian).
  - El motivo y el contexto offline viajan por variables de transacción
    (`set_config('app.change_reason', …, true)`, `app.captured_offline`, `app.captured_at`),
    fijadas por las RPC `correct_report`, `approve_report`, `cancel_report` y por la RPC de
    sincronización. Las correcciones de manager **solo** entran por `correct_report(report_id,
    patch, reason)`; el `UPDATE` directo de un manager se bloquea en RLS.
  - `administrative_audit_log` se alimenta con triggers `INSERT/UPDATE/DELETE` sobre `profiles`,
    `machines`, `operator_machine_assignments`, catálogos, `shifts` y `change_types`, más los eventos
    explícitos `PASSWORD_RESET`, `OFFLINE_LOGIN` y `USER_CREATED`. La lectura queda solo para ROOT.
  - Inmutabilidad: sin `INSERT/UPDATE/DELETE` para `authenticated`; las FK hacia las tablas de
    auditoría son `restrict`, como hoy.
- **Justificación**: Un único punto de auditoría en la BD no se puede saltar desde la API, y las
  variables de transacción permiten pasar el motivo sin columnas temporales en las tablas de negocio.
- **Alternativas**: Auditar en la API: se puede saltar con llamadas directas a PostgREST, lo que
  viola FR-003. Una extensión tipo `supa_audit`: no captura motivo ni contexto offline.
- **Riesgo**: Volumen por el autosave del operario. Mitigación: se registran solo los campos que
  cambian y el autosave mantiene su debounce. Se espera un volumen bajo (decenas de reportes al día).

## R8. Inicio de sesión sin conexión (FR-006, FR-006a, FR-006b, FR-006c) — Fase 4b

- **Decisión**: Tras cada login online exitoso, el cliente deriva un verificador **PBKDF2-SHA-256**
  (WebCrypto, 600 000 iteraciones, sal aleatoria de 16 B por usuario y dispositivo) y guarda en
  IndexedDB `offlineCredentials {usernameNormalized, userId, salt, verifier, role, fullName,
  enabledUntil = now + 7 días (configurable), failedCount, lockedUntil}`. La contraseña nunca se
  guarda. El login offline valida contra el verificador, aplica el mismo bloqueo 5/15 de forma local
  y abre una **sesión local** que solo da acceso al shell offline (R10) con el rol guardado. Al
  recuperar la conexión, la plataforma exige un login online (revalida identidad, estado y rol)
  antes de ofrecer la subida. Si falla, se cierra la sesión y los pendientes se conservan. El primer
  paso de la sincronización registra `OFFLINE_LOGIN` en la auditoría.
- **Justificación**: Las sesiones de Supabase no se pueden emitir offline. Un verificador lento con
  sal protege la contraseña ante extracción del dispositivo, y la revalidación online cubre los
  usuarios desactivados.
- **Alternativas**: Guardar el refresh token de Supabase y reutilizarlo offline: solo funciona si
  la sesión no expiró, no verifica la contraseña (FR-006a) y expone un token de larga vida.

## R9. Protocolo de sincronización offline (FR-012…FR-019, SC-003, SC-004) — Fase 4a

- **Decisión**:
  - **Outbox tipada** en IndexedDB (amplía `offline-report-store.ts`, versión de BD 2) con las
    operaciones `CREATE_REPORT`, `SAVE_REPORT_FIELDS`, `START_STOP`, `CLOSE_STOP`,
    `SET_STOP_CATEGORY`, `CANCEL_STOP`, `ADD_CHANGE`, `SUBMIT_REPORT` y `CANCEL_REPORT`. Cada
    operación lleva `operationId` (UUID), `userId`, IDs de entidad generados en el cliente,
    `capturedAt` (reloj del dispositivo), `capturedOffline` y `baseVersion` (si aplica).
  - **Nada se sube sin confirmación**: no hay autosave contra el servidor mientras existan
    operaciones pendientes. Al detectar la reconexión se abre el **resumen de pendientes**
    (contadores por tipo de operación), con "Confirmar y subir" y "Posponer". Mientras no haya
    pendientes, el modo online normal sigue autoguardando.
  - **Subida**: `POST /api/sync/batch` con hasta 50 operaciones en orden causal. El servidor las
    aplica **una por una** vía la RPC `public.apply_sync_operation(op jsonb)` (`security definer`,
    que valida explícitamente `userId = auth.uid()`, perfil activo, rol OPERATOR y reproduce las
    reglas de RLS del operario), cada una en su propia transacción. Responde por operación con `applied`,
    `duplicate`, `conflict` o `rejected` y el motivo. La tabla `sync_operation_log(operation_id pk,
    user_id, result, applied_at)` garantiza la idempotencia: una operación repetida devuelve
    `duplicate` sin reaplicarse.
  - **Subida parcial**: el cliente marca como sincronizadas las operaciones aceptadas y se detiene
    en el primer fallo de red. Las demás siguen pendientes.
  - **Conflictos** (solo el mismo operario en dos dispositivos, o un reporte "fuera de turno"
    cancelado por un manager): se conservan las versiones local y del servidor. La operación queda
    `conflict`, con aviso al operario y una notificación `SYNC_CONFLICT` al coordinador. Los datos
    llegados para un reporte cancelado se guardan en `sync_quarantine` y quedan visibles para el
    coordinador como "capturado sin conexión, en revisión".
  - **Aislamiento por usuario**: todas las claves llevan `userId` y el resumen solo muestra y sube
    las operaciones del usuario autenticado.
  - **Persistencia**: se pide `navigator.storage.persist()` al habilitar el modo offline, para
    reducir el riesgo de que el navegador borre los datos.
  - **Aviso de pendientes al servidor (FR-005a)**: cada dispositivo (`deviceId` persistido) informa
    `pendingCount` y `oldestPendingAt` vía `report_device_sync_status` cada vez que hay conexión. Es
    solo un conteo, no una subida de datos, así que no viola FR-015. Permite bloquear la desactivación
    de usuarios con pendientes conocidos. Los dispositivos que nunca reconectaron no se pueden
    conocer: se mitiga mostrando la hora del último contacto y exigiendo confirmación, y con la vía
    de reactivación temporal para que el autor suba sus datos.
  - **Antigüedad**: si hay pendientes con más de 7 días, se muestra un aviso persistente en cada
    inicio de sesión. Los pendientes nunca se borran automáticamente.
- **Justificación**: Los IDs del cliente más un log de operaciones dan idempotencia exacta. Procesar
  operación por operación da éxitos parciales deterministas. Reutiliza la RLS y los triggers
  existentes, así que las reglas son las mismas online y offline.
- **Alternativas**: (a) Background Sync API: sube sin confirmación, viola FR-015, y no está en
  Safari iOS. (b) CRDT o replicación (PowerSync, ElectricSQL, RxDB): sobredimensionado, con un nuevo
  proveedor y un modelo de conflictos que no se necesita, porque solo escribe el autor (FR-025a).
  (c) Una sola transacción para todo el lote: un error anularía todo e incumpliría el caso de
  subida parcial.

## R10. Interfaz offline: shell estático + IndexedDB (FR-012, FR-020) — Fases 4a/4b

- **Decisión**:
  - Nueva ruta **`/turno`** prerenderizada (`export const prerender = true`). Es un HTML sin datos que
    monta una isla React (`OperatorShiftApp`) y que el service worker precachea.
  - Online, la app descarga un **snapshot de trabajo** (`GET /api/offline/snapshot`): perfil,
    asignaciones vigentes con turnos, catálogos activos (categorías de parada, tipos de cambio,
    clientes, productos, líneas, dosificadores) y el reporte activo. Lo guarda en IndexedDB con
    `fetchedAt`.
  - Offline, la isla lee y escribe en IndexedDB y encola en la outbox (R9).
  - El SW pasa a: navegación con red y respaldo al shell `/turno` para el operario (o
    `/consulta-offline` para managers y auditores), en lugar de `offline.html` genérico.
  - **Fase 4b**: `/consulta-offline`, también prerenderizada, muestra en solo lectura el último
    snapshot de tablero y reportes descargado (`GET /api/offline/overview`), con la marca "Datos de
    HH:MM".
  - Las páginas SSR actuales siguen siendo la interfaz online. `/reportes/[id]` del operario
    redirige a `/turno` cuando el reporte está activo y es suyo.
- **Justificación**: Las páginas SSR no se pueden servir offline sin cachear HTML autenticado, algo
  que `docs/PWA_OFFLINE.md` prohíbe por seguridad. Un shell sin datos más IndexedDB por usuario
  respeta esa regla.
- **Alternativas**: Cachear el HTML SSR de cada reporte: expone datos entre usuarios del mismo
  dispositivo y queda obsoleto. Convertir toda la app en SPA: cambio innecesario para managers y
  auditores, que trabajan online.

## R11. Tiempo real y presencia (FR-021, FR-022, FR-031, SC-005) — Fase 5

- **Decisión**:
  - **Supabase Realtime `postgres_changes`** desde un cliente de navegador
    (`createBrowserClient` de `@supabase/ssr`, que reutiliza la sesión de cookies) sobre
    `production_reports`, `report_stop_events`, `report_change_events` y `report_audit_log`, añadidas
    a la publicación `supabase_realtime`. La RLS filtra lo que recibe cada suscriptor.
  - Al recibir un evento, la isla vuelve a pedir el fragmento afectado (KPIs o fila de reporte) a
    endpoints JSON ligeros, en lugar de confiar en el payload.
  - **Presencia** con Realtime Presence en el canal `plant-presence`: cada operario online publica
    `{userId, fullName, machineId, pendingCount, lastSeen}`.
  - **Respaldo**: si el canal no se suscribe o se cae, se hace polling cada 8 s, lo que mantiene
    SC-005 (<10 s).
- **Justificación**: Realtime ya está habilitado (`supabase/config.toml:86-87`), respeta RLS y no
  requiere un servidor propio de WebSockets, que Vercel serverless no soporta bien.
- **Alternativas**: (a) SSE desde Astro: Vercel limita las conexiones largas. (b) Solo polling:
  funciona, pero genera más carga y latencia; queda como respaldo.

## R12. Filtros y exportación (FR-023, FR-024a, FR-033, caso "exportación sin resultados")

- **Decisión**:
  - Los filtros pasan a `from`, `to` (fecha operativa, rango libre con atajos día, semana y mes),
    `machine`, `shift`, `operator` y `status` (incluido `CLOSED`), más `stop=active` y
    `offshift=1`.
  - El Excel añade la hoja **CAMBIOS**, la hoja **HISTORIAL** (auditoría de los reportes
    filtrados) y las columnas *Aprobado por* y *Fecha de aprobación*.
  - Si no hay resultados, se responde `204 No Content` y la UI muestra "No hay reportes para los
    filtros seleccionados" sin descargar nada.
  - Se mantienen los límites actuales (10 000 paradas y 4 MB) con su mensaje.
- **Justificación**: Cumple FR-023 y FR-033 sin cambiar de librería (ExcelJS).
- **Alternativas**: Exportación asíncrona con job: innecesaria para el volumen esperado (SC-006).

## R13. Catálogos: eliminar frente a desactivar (FR-027, US4-4/5)

- **Decisión**: La RPC `public.delete_or_deactivate(catalog text, id uuid)`, solo para managers,
  borra si el elemento no tiene referencias y, si las tiene, **lo desactiva** y devuelve
  `{action: 'deactivated'}`. La UI confirma explícitamente antes de llamarla. Borrar una máquina ya
  no elimina sus asignaciones históricas: se desactivan.
- **Alternativas**: Mantener el mensaje de error actual: no cumple "se desactiva" (CA-04-04).

## R14. Estrategia de pruebas

- **Decisión**:
  - **pgTAP** (`supabase test db`) para RLS por rol, transiciones, auditoría, idempotencia de
    `apply_sync_operation`, el bloqueo y la invariante de ROOT. Es la verificación de SC-007 y
    SC-008.
  - **bun test** con `happy-dom` y `fake-indexeddb` para la outbox, el verificador offline, el
    resumen de pendientes, el cálculo de turnos y los filtros y Excel.
  - Pruebas de integración de endpoints con un Supabase local.
  - Cada fase cierra con `bun test`, `bun run db:test`, `bun run build` y `astro check`, y el
    veredicto GO del auditor.
- **Justificación**: Reutiliza las herramientas que ya están en el repo (`package.json`,
  `supabase/tests`). No se añade framework E2E en este plan. La validación manual de cada fase está
  en [quickstart.md](./quickstart.md).
