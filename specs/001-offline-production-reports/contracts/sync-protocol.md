# Contrato de sincronización offline (Fase 4a)

Implementa FR-012…FR-019, SC-003 y SC-004. Diseño en [research.md](../research.md) R9/R10.

## Principios

1. **Nada se sube sin confirmación explícita del autor.** Mientras la outbox del usuario tenga
   operaciones `pending`, la app no hace ningún autosave contra el servidor; toda escritura va a la
   outbox. Al detectar reconexión (`/api/health` 204) se muestra el **resumen de pendientes**.
2. **Idempotencia por `operationId`** y por IDs de entidad generados en el cliente.
3. **Orden causal**: las operaciones se envían en orden de `seq` (monótono por usuario y
   dispositivo); `CREATE_REPORT` siempre antes que sus paradas/cambios/envío.
4. **Aislamiento por usuario**: el cliente solo lista y envía operaciones con `userId` = usuario
   autenticado; el servidor rechaza cualquier operación cuyo `userId` ≠ `auth.uid()`.
5. **Revalidación previa** (FR-006b): antes de subir, la sesión debe ser online y válida; si el
   usuario fue desactivado o su rol cambió, se cierra la sesión y nada se sube.

## Resumen de pendientes (UI)

Contenido mínimo: número de reportes nuevos, guardados de campos, paradas (iniciadas/cerradas/
canceladas), cambios, envíos y cancelaciones; antigüedad de la operación más vieja (aviso si > 7
días); botones **"Confirmar y subir"** y **"Posponer"**. "Posponer" cierra el resumen; se vuelve a
ofrecer en la siguiente reconexión, al iniciar sesión y desde el indicador global (FR-016). El
indicador global (barra superior) muestra siempre estado de conexión + número de pendientes (FR-014).

## Aviso de pendientes al servidor (FR-005a)

Cada dispositivo tiene un `deviceId` (UUID persistido en IndexedDB). Cada vez que hay conexión
(arranque, evento `online` confirmado por `/api/health`, tras una subida y cuando cambia el número de
pendientes, con debounce de 5 s), el cliente llama a `report_device_sync_status(deviceId,
pendingCount, oldestPendingAt)` para el usuario autenticado. **No sube datos**: solo el conteo, por lo
que no requiere la confirmación de FR-015. El servidor usa esa información para impedir desactivar a
un usuario con pendientes.

## Operación (cliente → servidor)

```jsonc
{
  "operationId": "uuid",            // único global
  "userId": "uuid",
  "seq": 42,                        // orden causal local
  "type": "CREATE_REPORT | SAVE_REPORT_FIELDS | START_STOP | CLOSE_STOP | SET_STOP_CATEGORY | CANCEL_STOP | ADD_CHANGE | SUBMIT_REPORT | CANCEL_REPORT",
  "capturedAt": "2026-10-09T03:12:44.120-05:00",   // reloj del dispositivo
  "capturedOffline": true,
  "baseVersion": "2026-10-09T03:00:01.000Z",       // updated_at del servidor conocido (SAVE_REPORT_FIELDS)
  "payload": { /* según tipo */ }
}
```

| Tipo | `payload` | Reglas del servidor |
| --- | --- | --- |
| `CREATE_REPORT` | `{ reportId, machineId, startedAt }` | Asignación vigente para el turno de `startedAt` (aunque haya sido revocada después → se aplica y se marca `OFFLINE_DATA_REVIEW`); un activo por operario y por máquina. |
| `SAVE_REPORT_FIELDS` | `{ reportId, fields: {...} }` | Solo autor y `DRAFT`. Si `updated_at` ≠ `baseVersion` y los valores difieren → `conflict`. Si ya son iguales → `duplicate`. |
| `START_STOP` | `{ stopId, reportId, categoryId?, description?, startedAt }` | Sin solapamiento; una abierta; si viene categoría, debe estar activa (es opcional al iniciar). |
| `CLOSE_STOP` | `{ stopId, reportId?, endedAt, categoryId? }` | `endedAt ≥ startedAt`; parada abierta; la parada debe quedar con categoría activa (la que ya tenía o `categoryId`); si no → `rejected CATEGORY_REQUIRED`. |
| `SET_STOP_CATEGORY` | `{ stopId, reportId?, categoryId }` | Parada abierta. |
| `CANCEL_STOP` | `{ stopId, reportId?, reason }` | Parada abierta. |
| `ADD_CHANGE` | `{ changeId, reportId, changeTypeId, description, occurredAt }` | Tipo activo; reporte `DRAFT` del autor. |
| `SUBMIT_REPORT` | `{ reportId }` | Validación de campos obligatorios, sin paradas abiertas y todas con categoría (igual que online). |
| `CANCEL_REPORT` | `{ reportId, reason }` | Solo `DRAFT` del autor. |

> `reportId` en las operaciones de parada es opcional: permite desviar a cuarentena una operación cuya parada nunca llegó al servidor (su `START_STOP` fue desviado). La cancelación de una parada conserva la hora del dispositivo (`capturedAt`).
> `SAVE_REPORT_FIELDS.fields` usa los nombres de columna (snake_case); `report_date` y `shift_id` los fija el servidor.

## `POST /api/sync/batch`

Request: `{ "operations": Operation[] }` (1–50). `seq` es **obligatorio**, entero y único dentro del lote; el servidor procesa solo por `seq`. Cuerpo máximo ~2 MB (413 si lo supera, comprobado antes de interpretar el JSON); la carga (`payload`) de una operación no puede superar 32 KB (`rejected VALIDATION`).

Response 200:

```jsonc
{
  "results": [
    { "operationId": "uuid", "status": "applied",   "entity": { "type": "report", "id": "uuid", "folio": "RPT-2026-000123", "updatedAt": "..." } },
    { "operationId": "uuid", "status": "duplicate", "previousStatus": "applied | conflict | rejected" /* solo si la operationId ya estaba registrada */ },
    { "operationId": "uuid", "status": "conflict",  "code": "REPORT_CHANGED | REPORT_NOT_DRAFT | REPORT_CANCELLED", "server": { /* versión actual */ } },
    { "operationId": "uuid", "status": "rejected",  "code": "VALIDATION | FORBIDDEN | NOT_FOUND | NO_ASSIGNMENT | ACTIVE_REPORT_EXISTS | MACHINE_BUSY | STOP_OVERLAP | STOP_ALREADY_OPEN | CATEGORY_REQUIRED | DEPENDENCY_FAILED", "message": "texto en español" }
  ],
  "serverTime": "..."
}
```

- 401 si la sesión no es válida (el cliente pide login y conserva todo); 403 si el usuario está
  inactivo o no es OPERATOR.
- El servidor procesa en orden y **se detiene** tras la primera operación cuyo resultado deje
  dependientes sin sentido (p. ej. `CREATE_REPORT` rechazado → sus dependientes se devuelven
  `rejected` con `code: "DEPENDENCY_FAILED"`, sin aplicarse).
- Si la RPC falla a mitad del lote (error de red/base de datos) el servidor devuelve **solo los resultados ya procesados** (200); las demás siguen `pending` en el cliente. Si falla la primera, responde 500.
- Asignación revocada después de la captura (`CREATE_REPORT` con `capturedOffline = true`): `applied` con `review: "ASSIGNMENT_REVOKED"`; el reporte queda con una fila `OPEN` en `sync_quarantine` (no se puede aprobar hasta revisarla) y se notifica `OFFLINE_DATA_REVIEW`.
- Cada operación: RPC `apply_sync_operation(op jsonb)` en su propia transacción; registra
  `sync_operation_log` y fija `app.captured_offline`/`app.captured_at` para la auditoría.

## Validación de horas del dispositivo

- **Futuro**: `capturedAt`, `startedAt`, `endedAt` y `occurredAt` posteriores a la hora del servidor + 5 min → `rejected VALIDATION` ("La hora del dispositivo está en el futuro").
- **Consistencia**: `startedAt` (`CREATE_REPORT`, `START_STOP`), `endedAt` (`CLOSE_STOP`) y `occurredAt` (`ADD_CHANGE`) no pueden superar `capturedAt` + 5 min → `rejected VALIDATION`.
- **Captura obsoleta** (`capturedOffline = true` y `capturedAt` —o `startedAt` en `CREATE_REPORT`— más antiguo que `app_settings.offline_login_window`, 7 días por defecto): **no se rechaza** (FR-013/FR-017, no se pierden datos offline). Se aplica (`applied`, `review: "STALE_CAPTURE"`), se crea una fila `OPEN` en `sync_quarantine` con motivo `STALE_CAPTURE` (una por reporte; bloquea la aprobación hasta revisarla) y se notifica `OFFLINE_DATA_REVIEW`. Solo se puede marcar como revisada (como `ASSIGNMENT_REVOKED`).
- La asignación revocada exige además que `startedAt` sea anterior a la revocación.

## Estados en el cliente

`pending → syncing → synced` (se purga tras confirmar y refrescar `entities`); `syncing → pending`
si cae la red (resultado incierto: se reenvía con el mismo `operationId`, el servidor devuelve
`duplicate`); `conflict` y `rejected` quedan visibles en el resumen con el mensaje y **nunca se
borran automáticamente**; el operario puede descartarlos solo tras confirmación explícita (los datos
siguen en `sync_quarantine` del servidor cuando aplica).

## Garantías verificables

| Garantía | Prueba |
| --- | --- |
| 0 subidas sin confirmación (SC-004) | bun test: con pendientes y reconexión simulada, `fetch('/api/sync/batch')` y `PATCH` no se llaman hasta "Confirmar y subir". |
| Sin duplicados (FR-017) | pgTAP: misma operación dos veces → 1 fila + `duplicate`. bun test: reintento tras corte reutiliza `operationId`. |
| Subida parcial (caso límite) | bun test: corte tras N resultados → N `synced`, resto `pending`. |
| Aislamiento por usuario (FR-019) | bun test: usuario B no ve ni envía operaciones de A; pgTAP: `userId` ajeno → `rejected FORBIDDEN`. |
| Turno completo de 12 h (SC-003) | bun test de carga: 1 reporte + 40 paradas + 10 cambios + envío offline → servidor contiene exactamente esos datos. |

## Fusión de guardados y reenvíos (Phase 7b)

- **Fusión de `SAVE_REPORT_FIELDS`**: mientras no hayan sido enviados (`pending` y 0 intentos), los guardados de campos del mismo reporte se funden en UNA operación con los últimos valores. La operación fusionada **conserva el `seq` (y la `operationId`) de la primera**, y se actualiza su `capturedAt`. Es seguro porque (a) guardar campos no cambia `updated_at` de ninguna otra entidad ni depende del orden respecto a paradas y cambios; (b) la operación sigue ubicada después del `CREATE_REPORT` y antes del `SUBMIT_REPORT`/`CANCEL_REPORT` del reporte (tras ellos el reporte ya no admite edición, así que no puede haber un guardado posterior); (c) una operación ya intentada nunca se modifica (su resultado incierto se reenvía idéntico) y los guardados posteriores quedan como operaciones distintas que el cliente envía en otro lote, tras rebasar la `baseVersion` con la versión devuelta por el servidor.
- **Reenvío tras una respuesta perdida**: si el efecto ya está en el servidor (p. ej. se aplicó por una ruta en línea, que no escribe `sync_operation_log`) y el cliente reenvía la operación —con la misma `operationId` o con otra—, el servidor responde `duplicate`, sin cuarentena ni notificación. Solo cuenta lo idéntico del mismo autor: `SUBMIT_REPORT` con el reporte ya `SUBMITTED`/`CLOSED`; `CANCEL_STOP` con la parada ya cancelada con el mismo motivo; `SET_STOP_CATEGORY` con la categoría ya igual; `CLOSE_STOP` con la misma hora de fin y categoría; `SAVE_REPORT_FIELDS` con valores ya iguales; `START_STOP`/`ADD_CHANGE`/`CREATE_REPORT` con un id existente del mismo reporte/autor; `CANCEL_REPORT` sobre un reporte ya `CANCELLED`. Los conflictos genuinos (reporte cancelado por un coordinador, valores distintos) siguen siendo `conflict`/`rejected`.
