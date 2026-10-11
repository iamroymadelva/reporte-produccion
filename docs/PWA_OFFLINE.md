# PWA y base de funcionamiento sin conexión

## Alcance

La aplicación incluye un manifiesto instalable, iconos neutrales, una página estática de contingencia, detección de conectividad y un service worker conservador. Además, el Operario puede trabajar **un turno completo sin conexión** desde `/turno`: iniciar el reporte de una máquina asignada en su turno, registrar paradas (categoría opcional al iniciar, obligatoria al cerrar), cambios y datos de producción, y enviar o cancelar el reporte. Todo se guarda primero en IndexedDB y se sube solo cuando el autor lo confirma.

Los datos de producción siguen siendo autoritativos en el servidor. Desde la Fase 4b (Phase 8) también se puede **iniciar sesión sin conexión** y coordinadores, administradores raíz y auditores disponen de la **consulta sin conexión** (ver «Fase 4b» más abajo).

### Flujo del Operario en `/turno`

1. **Con conexión**, la isla descarga el snapshot de trabajo (`GET /api/offline/snapshot`: perfil, ajustes, turnos, asignaciones vigentes, catálogos activos y reporte activo) y lo guarda por usuario en IndexedDB.
2. **Cada acción** (iniciar, parada, cambio, datos, enviar, cancelar) valida con las mismas reglas que la base de datos (un reporte activo por operario, sin solapamiento de paradas, categoría al cerrar y antes de enviar, campos obligatorios, sin enviar con una parada abierta), toma la **hora del dispositivo en ese instante** (no editable) y escribe en una sola transacción la operación en la outbox y su efecto local.
3. **Sin pendientes y con conexión**, la operación también se envía de inmediato a las rutas en línea (con `id` y horas del cliente). Si la red falla, queda como pendiente.
4. **Con pendientes** no se hace ninguna escritura de red automática: ni autosave, ni `PATCH`, ni lote (Principio III). Al confirmarse una reconexión (`HEAD /api/health` 204) se muestra el **resumen de pendientes**: contadores por tipo, antigüedad de lo más viejo, aviso si hay datos de más de 7 días y los resultados de conflicto o rechazo.
5. **Confirmar y subir** envía lotes de hasta 50 operaciones ordenadas por `seq` a `POST /api/sync/batch`. Los guardados de campos consecutivos del mismo reporte se funden en una operación y nunca se envían dos con la misma versión base en un lote. Un corte de red deja las ya confirmadas como `synced` y el resto `pending`; el reintento reutiliza la `operationId` y el servidor responde `duplicate`. Un 401 conserva todo y pide iniciar sesión. **Posponer** conserva todo y vuelve a ofrecer el resumen en la siguiente reconexión, al iniciar sesión o desde el indicador.
6. `conflict` y `rejected` quedan visibles con su mensaje y **nunca se borran solos**; solo se descartan con confirmación explícita.
7. Al cerrar sesión con datos sin subir se pide confirmación explícita; los datos siguen guardados en el dispositivo, aislados por usuario.

El indicador de la barra superior (y de la cabecera de `/turno`) muestra siempre el estado de conexión y los pendientes: «Sin conexión — guardado en este dispositivo · N pendientes».

### Aviso de pendientes al servidor (FR-005a)

Cada dispositivo tiene un `deviceId` (UUID guardado en IndexedDB). Al arrancar con conexión, en cada `online` confirmado, tras cada subida y al cambiar el número de pendientes (con debounce de 5 s) se llama a `POST /api/device-status` con `{ deviceId, pendingCount, oldestPendingAt }`. Solo viajan conteos, nunca datos de operaciones, y no se envía sin conexión.

## Límite de caché

El service worker solo controla solicitudes `GET` del mismo origen:

- Las navegaciones siempre consultan la red. Si falla, el respaldo es **por ruta** (el service worker no conoce el rol sin conexión): `/turno` y `/reportes*` sirven el shell `/turno`; `/consulta-offline` sirve su shell; `/iniciar-sesion`, `/acceso-offline`, `/` y `/dashboard` sirven `/acceso-offline`; cualquier otra ruta (administración, notificaciones…) muestra `/offline.html`. El HTML SSR autenticado nunca se guarda en Cache Storage.
- Los recursos con hash bajo `/_astro/` usan cache-first.
- El manifiesto usa network-first con respaldo en caché.
- Se precargan los iconos, `/offline.html` y los shells prerenderizados `/turno`, `/consulta-offline` y `/acceso-offline` (HTML estático **sin datos**) con sus recursos `/_astro/`. `CACHE_VERSION` es `v5`.
- `/api/**`, respuestas de Supabase, exportaciones, autenticación, datos de reportes y mutaciones nunca se almacenan.

Las respuestas dinámicas de Astro se entregan con `Cache-Control: private, no-store`. El middleware, Supabase Auth, perfiles activos, roles, RLS y las restricciones de base de datos continúan siendo las barreras de autorización.

## Conectividad y mutaciones

Los eventos `online` y `offline` del navegador se combinan con `HEAD /api/health`. La comprobación tiene timeout y reintento limitado únicamente cuando el servidor permanece inaccesible y la página está visible. El endpoint prueba el origen de la aplicación, no el estado completo de Supabase.

Una mutación en línea (aprobar, corregir, cancelar fuera de turno, administración, exportación) conocida como offline o inaccesible no se envía: la interfaz lo indica y no reintenta automáticamente. Si la red falla después de enviar una solicitud, el resultado es incierto y el usuario debe recuperar la conexión y actualizar para reconciliar con el servidor.

El **operario** no usa ese camino: todo lo que hace en `/turno` (iniciar, paradas, cambios, datos, enviar, cancelar) pasa por la outbox local y se sube con «Confirmar y subir». El editor de `/reportes/[id]` (`ReportEditor`) ya no trabaja sin conexión y queda para la vista en línea y la corrección de coordinadores.

## Versionado y actualizaciones

El service worker usa el prefijo de caché `reporte-produccion-static` y una versión explícita en `public/sw.js`. Al modificar reglas de caché o archivos precargados:

1. Cambie `CACHE_VERSION`.
2. Construya y despliegue la aplicación.
3. Verifique que aparezca **Nueva versión disponible** en una sesión controlada por el worker anterior.
4. Pulse **Actualizar** y confirme una única recarga.
5. Inspeccione que solo se hayan eliminado cachés antiguas con el prefijo de esta aplicación.

Las actualizaciones no ejecutan `skipWaiting` automáticamente. `/sw.js` se sirve con revalidación y se registra con `updateViaCache: "none"`.

## Recuperación manual

Si un navegador conserva un worker histórico o datos desconocidos:

1. Abra DevTools > Application > Service Workers y pulse **Unregister** para este origen.
2. En Application > Storage, revise Cache Storage antes de eliminar datos del sitio.
3. Recargue con conexión y confirme que `/sw.js`, el manifiesto y los iconos responden correctamente.
4. Evite scripts que borren cachés arbitrarias; la aplicación solo limpia nombres que empiezan por su prefijo propio.

En dispositivos móviles puede ser necesario eliminar los datos del sitio desde la configuración del navegador y volver a añadir la aplicación a la pantalla de inicio.

## Dispositivos compartidos

Cerrar la pestaña o la PWA no cierra la sesión. El cierre de sesión requiere conexión para ser confirmado por Supabase. Las cachés estáticas pueden permanecer después de salir porque no contienen perfiles ni reportes, pero el almacenamiento del navegador persiste hasta que el usuario o el sistema lo elimine.

En tabletas compartidas, cierre la sesión (con conexión si es posible; sin conexión el cierre queda pendiente en el servidor y se completa en la primera página en línea) y no trate una pantalla autenticada que quedó abierta sin red como información actualizada. Los datos pendientes de cada usuario son invisibles e imposibles de subir para otro usuario del mismo dispositivo.

## Datos locales (IndexedDB v2)

La base `reporte-produccion-offline` versión 2 aísla todo por `userId`:

- `outbox` [userId, operationId]: operaciones tipadas (`CREATE_REPORT`, `SAVE_REPORT_FIELDS`, `START_STOP`, `CLOSE_STOP`, `SET_STOP_CATEGORY`, `CANCEL_STOP`, `ADD_CHANGE`, `SUBMIT_REPORT`, `CANCEL_REPORT`) con `seq` monótono por usuario, estado (`pending`, `syncing`, `synced`, `conflict`, `rejected`) y hora de captura.
- `entities` [userId, entityType, id]: copia local de reportes, paradas y cambios para renderizar sin conexión.
- `snapshot` (userId), `meta` (deviceId, contadores `seq`, matrícula pendiente, sesión local y cierre de sesión pendiente en el servidor), `offlineCredentials` (usernameNormalized: verificador PBKDF2, rol, `enabledUntil`, bloqueo local) y `overview` (userId: resumen de solo lectura de la consulta). Desde la Fase 4b `meta.lastUserId` ya no existe: la identidad sin conexión sale de la sesión local.

La migración desde la v1 (`reportDrafts`, outbox por reporte y `leases` del Block 3B) convierte cada borrador pendiente en una operación `SAVE_REPORT_FIELDS` conservando su `operationId` y su versión base, y en una copia local del reporte. Se pide `navigator.storage.persist()` para reducir el riesgo de borrado. En iOS/Safari el navegador puede eliminar los datos de un sitio sin uso durante varios días: instala la PWA en la pantalla de inicio y sube tus datos cuanto antes.

El editor `ReportEditor` ya no trabaja sin conexión: queda para la corrección de coordinadores y la vista en línea; el reporte activo del Operario se redirige a `/turno`.

## Actualización segura y dispositivos compartidos (correcciones de la Fase 4a)

- **Instalación atómica del service worker**: si `/turno` o alguno de sus recursos `/_astro/` no se puede cachear, la instalación falla y el navegador conserva el worker y la caché anteriores. Al activar, la caché anterior solo se borra si la nueva ya contiene el shell `/turno`. No hay `skipWaiting` automático: la activación la decide el usuario con «Nueva versión disponible → Actualizar», para que las pestañas abiertas no pierdan los chunks que aún necesitan.
- **Cierre de sesión confirmado** (superado por la Fase 4b: ya no existe `meta.lastUserId`; la identidad sin conexión sale de la sesión local verificada con contraseña): el dispositivo olvida al último usuario. Sin conexión y sin ese puntero, `/turno` muestra «Necesitas conexión para iniciar sesión» y no opera como nadie. La outbox, la copia local y el snapshot del usuario se conservan (claves por `userId`) y vuelven cuando ese usuario inicia sesión en línea; otro usuario ve una cola vacía y nunca sube datos ajenos.

## Fase 4b: inicio de sesión y consulta sin conexión (Phase 8)

- **Verificador (FR-006a, R8)**: al escribir usuario y contraseña con conexión, el navegador deriva un verificador **PBKDF2-SHA-256** (600 000 iteraciones, sal aleatoria de 16 B por usuario y dispositivo, 32 B derivados) y lo guarda como matrícula *pendiente*. La primera página autenticada pregunta al servidor quién es (`GET /api/auth/session-info`) y la confirma: `offlineCredentials` recibe usuario, rol, nombre y `enabledUntil = ahora + offline_login_window` (7 días por defecto, ajuste de `app_settings`). Si el login falla (`?error=`) o el servidor no confirma, la matrícula pendiente se descarta y no queda nada habilitado. La contraseña **nunca** se guarda. Cada login en línea renueva la ventana y reemplaza el verificador (por eso un cambio de contraseña obliga a entrar en línea).
- **Acceso sin conexión (FR-006)**: `/iniciar-sesion` comprueba `/api/health`; si falla valida contra el verificador local. Sin matrícula o con la ventana vencida: «Necesitas conexión para entrar». Contraseña errónea: «Usuario o contraseña incorrectos»; **5 fallos bloquean 15 minutos** (persistido por usuario; también bloquea la contraseña correcta, con el mismo mensaje). Sin conexión el service worker sirve `/acceso-offline` (shell estático, sin datos) en lugar de `/iniciar-sesion`, `/` y `/dashboard`.
- **Sesión local (FR-006c)**: `meta.localSession` guarda usuario, rol y hora de inicio; solo da acceso a las pantallas de ese rol (OPERATOR → `/turno`; ROOT/ADMINISTRATOR/VIEWER → `/consulta-offline`). Se elimina al cerrar sesión o al iniciar sesión en línea. Cerrar sesión sin conexión deja anotado el cierre en el servidor y se completa en la primera página con conexión.
- **Revalidación antes de subir (FR-006b)**: con una sesión local, al reconectar el resumen de pendientes **no ofrece** «Confirmar y subir» hasta que el usuario inicie sesión en línea con su contraseña (`/iniciar-sesion?reauth=1`). Si el servidor responde que el perfil está inactivo o cambió de rol se cierra la sesión (local y del servidor) y los pendientes se conservan; solo el autor podrá subirlos (FR-019, FR-005a). Una cookie en línea de otra persona no sirve para operar como la sesión local.
- **Auditoría (FR-006c)**: cada inicio de sesión sin conexión (cualquier rol) deja un marcador `{operationId, startedAt}` en `meta`; la primera página en línea donde `session-info` confirme al mismo usuario lo envía a `POST /api/offline/login-audit` (`record_offline_login`: `administrative_audit_log`, acción `OFFLINE_LOGIN`, idempotente por `operationId`, sin repetir `startedAt`, máx. 20 por usuario y hora) y lo borra. Es el único camino: ya no viaja como operación del lote.
- **Consulta sin conexión (FR-020)**: `/consulta-offline` (prerenderizada, sin datos) muestra en solo lectura el último `GET /api/offline/overview` (KPI del día y últimos 200 reportes con paradas y cambios) guardado en `overview` por usuario, con «Datos de HH:MM». Exportar, corregir, aprobar, cancelar y administrar están deshabilitados («Requiere conexión»). Se refresca al abrirla con conexión y en silencio (máx. cada 5 min) al navegar autenticado como manager o auditor.
- **Service worker v5**: precachea `/turno`, `/consulta-offline` y `/acceso-offline` con sus `/_astro`; la instalación es atómica y la caché anterior solo se borra si la nueva tiene los tres shells. Sigue sin guardarse HTML SSR autenticado ni `/api/**`.
- **Matrícula atada a un login real**: la matrícula pendiente guarda la hora del SERVIDOR (`X-Server-Time` de `HEAD /api/health`) y solo se confirma si `session-info.signInAt` (last_sign_in_at) es posterior a esa hora (tolerancia de 30 s entre dos horas del servidor); una sesión previa la descarta. El vencimiento de 10 min se mide con `session-info.serverTime`. **El reloj del dispositivo no interviene**; sin hora del servidor no se matricula (el login en línea sigue normal). Limitación documentada: la matrícula no se ata a la sesión concreta (`session.created_at`), solo a su hora de inicio de sesión. **Sesión local**: termina a las 12 h o al vencer `enabledUntil` (se comprueba en cada shell). **Login en línea**: si `/api/health` falla pero `navigator.onLine` es true y no hay habilitación (o el código offline falla), el formulario se envía de forma nativa. **Cookies**: las `sb-*` no son HttpOnly, por eso el cierre de sesión sin conexión las borra con `document.cookie` (además queda pendiente el cierre en el servidor).
- **Límites conocidos**: no se ha probado en un navegador ni una tableta reales; la medición de PBKDF2 en una tableta de gama baja está pendiente (SC-012). `enabledUntil` y la caducidad de la sesión local sí usan el reloj del dispositivo (es el que se tiene sin conexión).

## Fase 5: tiempo real y conectividad

- El tablero, la lista y el detalle de reportes (solo coordinadores, raíz y auditores) abren un canal Realtime con la sesión del usuario; cada evento solo dispara la recarga del fragmento autorizado.
- **Sin conexión o con el WebSocket bloqueado** no hay errores visibles: si la suscripción no llega a `SUBSCRIBED` en 5 s, o el canal falla o se agota el tiempo, las islas pasan a **sondeo cada 8 s** y muestran «Actualización automática cada 8 s»; al recuperarse vuelve «Actualización en vivo».
- El operario publica su presencia (`plant-presence`) **solo con conexión** y con un payload mínimo `{ userId, fullName, pendingCount, lastSeen }` cada 30 s y al cambiar los pendientes. En modo avión `/turno` no abre ningún canal. Tras cerrar sesión no queda ningún WebSocket abierto.
- La presencia es solo indicativa (ver [SECURITY_AND_ABUSE.md](SECURITY_AND_ABUSE.md)); no alimenta FR-005a.
- Cache Storage sigue sin guardar HTML autenticado ni respuestas `/api/**` del tablero.

## Limitaciones conocidas del acceso sin conexión

- La matrícula se ata a la hora de inicio de sesión del servidor, no a la sesión concreta: un inicio de sesión del mismo usuario en otro dispositivo dentro de los 10 minutos de un registro pendiente podría confirmarlo.
- `enabledUntil`, el bloqueo local y la caducidad de la sesión local usan el reloj del dispositivo; se recomienda hora automática bloqueada (modo kiosco).
- Los datos de la consulta sin conexión se guardan sin cifrar en IndexedDB; se asume un dispositivo gestionado sin acceso a DevTools.
- **No verificado en navegador ni tableta reales**: las pruebas automáticas simulan el navegador (happy-dom + fake-indexeddb) y el smoke ejecuta el cliente real contra el servidor local. La lista de comprobaciones manuales está en `specs/001-offline-production-reports/release-checklist.md`.
