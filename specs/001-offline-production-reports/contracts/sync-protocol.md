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
| `START_STOP` | `{ stopId, reportId, categoryId, description?, startedAt }` | Sin solapamiento; una abierta; categoría activa. |
| `CLOSE_STOP` | `{ stopId, endedAt }` | `endedAt ≥ startedAt`; parada abierta. |
| `SET_STOP_CATEGORY` | `{ stopId, categoryId }` | Parada abierta. |
| `CANCEL_STOP` | `{ stopId, reason }` | Parada abierta. |
| `ADD_CHANGE` | `{ changeId, reportId, changeTypeId, description, occurredAt }` | Tipo activo; reporte `DRAFT` del autor. |
| `SUBMIT_REPORT` | `{ reportId }` | Validación de campos obligatorios y parada cerrada (igual que online). |
| `CANCEL_REPORT` | `{ reportId, reason }` | Solo `DRAFT` del autor. |

## `POST /api/sync/batch`

Request: `{ "operations": Operation[] }` (1–50, ordenadas por `seq`).

Response 200:

```jsonc
{
  "results": [
    { "operationId": "uuid", "status": "applied",   "entity": { "type": "report", "id": "uuid", "folio": "RPT-2026-000123", "updatedAt": "..." } },
    { "operationId": "uuid", "status": "duplicate" },
    { "operationId": "uuid", "status": "conflict",  "code": "REPORT_CHANGED | REPORT_NOT_DRAFT | REPORT_CANCELLED", "server": { /* versión actual */ } },
    { "operationId": "uuid", "status": "rejected",  "code": "VALIDATION | FORBIDDEN | NO_ASSIGNMENT | STOP_OVERLAP", "message": "texto en español" }
  ],
  "serverTime": "..."
}
```

- 401 si la sesión no es válida (el cliente pide login y conserva todo); 403 si el usuario está
  inactivo o no es OPERATOR.
- El servidor procesa en orden y **se detiene** tras la primera operación cuyo resultado deje
  dependientes sin sentido (p. ej. `CREATE_REPORT` rechazado → sus dependientes se devuelven
  `rejected` con `code: "DEPENDENCY_FAILED"`, sin aplicarse).
- Cada operación: RPC `apply_sync_operation(op jsonb)` en su propia transacción; registra
  `sync_operation_log` y fija `app.captured_offline`/`app.captured_at` para la auditoría.

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
