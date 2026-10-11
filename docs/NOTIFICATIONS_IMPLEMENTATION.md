# Implementación de notificaciones

## Contrato

- `GET /api/notifications?filter=all|unread&cursor=…` devuelve `{items, unreadCount, nextCursor, snapshotAt}`. Cada página contiene hasta 20 entregas ordenadas por `(created_at, id)` descendente. El cursor es opaco e incluye la instantánea para evitar que nuevos avisos desplacen páginas existentes.
- `PATCH /api/notifications/[id]` acepta `{ "read": true }` y devuelve `{ "ok": true }`. Repetirlo conserva la primera fecha de lectura. Una entrega ajena o ya inaccesible devuelve 404.
- `POST /api/notifications/read-all` acepta `{ "before": snapshotAt }` y devuelve `{ "ok": true, "markedCount": n }`. Los avisos posteriores a la instantánea quedan sin leer.
- Cada elemento contiene `id`, `type`, `resourceType`, `resourceId`, `actorId`, `stopStatus`, `title`, `body`, `href`, `createdAt`, `updatedAt` y `readAt`.
- Todas las respuestas pasan por el middleware con `Cache-Control: private, no-store`. Las mutaciones requieren sesión, rechazan un encabezado `Origin` ajeno y no tienen cola offline.

## Persistencia y autorización

La migración `20261008165311_notifications.sql` crea `notification_events` y `notification_deliveries`. Claves únicas en `event_key` y `(event_id, recipient_id)` evitan duplicados. Triggers de reportes y paradas insertan o actualizan avisos en la transacción que modifica el recurso. El evento de parada conserva la misma entrega y `read_at` al cerrar o anular. Las correcciones del mismo reporte se agrupan mediante `txid_current()`.

Las tablas tienen RLS y no conceden inserción ni modificación al navegador. La lectura y el marcado pasan por RPC con identidad `auth.uid()` y reevaluación de perfil activo, rol y recurso. Los avisos administrativos requieren conservar rol administrador; los de asignación requieren rol operario. La retirada de una asignación enlaza a `/reportes`, sin conceder acceso a la máquina. `replace_operator_assignments` sólo acepta `service_role` y un administrador activo, bloquea el perfil durante la sustitución y compara conjuntos efectivos antes de emitir un aviso. También guarda el perfil y la auditoría administrativa en la misma transacción cuando corresponde.

Los cambios de correo y de bloqueo en Supabase Auth son externos a la transacción SQL; el endpoint conserva su compensación al fallar la operación en base de datos. No hay backfill de notificaciones históricas.

## Validación local

Se aplicaron en orden las migraciones locales pendientes `20260831120000`, `20260916020525`, `20260927233202` y `20260928003331` para alinear el esquema con el repositorio. Se deshabilitaron únicamente los triggers nuevos de notificaciones durante esas migraciones, evitando avisos por los backfills. No se reinició ni borró la base.

- `supabase/tests/notifications.test.sql`: 20 comprobaciones de privilegios, aislamiento, marcado, cambios netos y fallo transaccional **después** de escribir perfil y asignaciones; pasan.
- `supabase/tests/notification_transitions.test.sql`: 22 comprobaciones de eventos reales, destinatarios, lectura preservada, correcciones agrupadas, cambios simples de categoría y revocación de rol; pasan.
- `supabase/tests/notification_pagination.test.sql`: 5 comprobaciones de paginación y concurrencia con instantánea; pasan.
- `bun test tests/notifications-api.test.ts`: 4 pruebas de cursor, fecha imposible y origen de mutaciones; pasan.
- `bunx astro check`: 0 errores; 2 pistas ajenas al backend.

Las pruebas SQL se ejecutaron sobre Supabase **local** dentro de transacciones con `ROLLBACK`. Falta validar con cuentas reales la API HTTP y la experiencia visual de la bandeja en QA integral.
Las salidas completas están en `docs/qa/backend-notifications-security.txt`, `docs/qa/backend-notifications-transitions.txt` y `docs/qa/backend-notifications-pagination.txt`.
