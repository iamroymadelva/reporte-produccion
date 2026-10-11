# Data Model — 001 Plataforma de reportes offline y roles separados

**Base**: el esquema actual (`supabase/migrations/*`, descrito en `docs/DATA_MODEL.md`). Este
documento describe el **estado objetivo** y marca cada cambio como **[NUEVO]**, **[CAMBIA]** o
**[SE ELIMINA]**. Las decisiones están justificadas en [research.md](./research.md) (R#).

## Convenciones

- Zona horaria operativa: `America/Bogota`. Las horas se guardan como `timestamptz`.
- "Manager" = `ROOT` o `ADMINISTRATOR` (coordinador). Helpers: `private.is_manager()` y
  `private.is_root()`.
- Las entidades que se capturan offline usan `id uuid` **generado en el cliente**.
- Las etiquetas de la UI son "Activo" (`DRAFT`), "Enviado" (`SUBMITTED`), "Cerrado (aprobado)"
  (`CLOSED`) y "Cancelado" (`CANCELLED`).

---

## Enums

| Enum | Valores | Cambio |
| --- | --- | --- |
| `app_role` | `ROOT`, `ADMINISTRATOR` (coordinador), `OPERATOR`, `VIEWER` (auditor) | **[CAMBIA]** se añade `ROOT` en una migración propia (R3) |
| `report_status` | `DRAFT`, `SUBMITTED`, `CLOSED`, `CANCELLED` | **[CAMBIA]** se añade `CLOSED` en una migración propia (R4) |

## Entidades

### `profiles` (Usuario) **[CAMBIA]**

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` | uuid PK → `auth.users` | — |
| `username` **[NUEVO]** | text | Único, en minúsculas, `^[a-z0-9._-]{3,32}$`, inmutable tras crearse |
| `full_name` | text | Obligatorio |
| `role` | `app_role` | Ver la matriz de gestión |
| `job_title` | text null | — |
| `active` | bool | Un usuario inactivo no puede iniciar sesión (US4-6) |
| `created_by` **[NUEVO]** | uuid null → profiles | Quién lo dio de alta |
| `created_at`, `updated_at`, `removed_at`, `removed_by` | — | Existentes |

- **Invariante (FR-005)**: siempre ≥ 1 perfil `role='ROOT' and active`. Se aplica con un trigger
  `constraint ... deferrable initially deferred` sobre `profiles`.
- **Matriz de gestión (FR-028, CA-04-02)**:

| Actor \ objetivo | ROOT | ADMINISTRATOR | VIEWER | OPERATOR |
| --- | --- | --- | --- | --- |
| ROOT | crear, editar, desactivar (sin romper la invariante) | todo | todo | todo |
| ADMINISTRATOR | ✗ | ✗ | ✗ | crear, editar, desactivar, reactivar, restablecer contraseña |
| VIEWER / OPERATOR | ✗ | ✗ | ✗ | ✗ |

- Auth: el correo sintético es `<username>@usuarios.reporte-produccion.invalid` (R1).
- **Desactivación (FR-005a)**: `active = false` o retiro se rechaza si el usuario tiene un reporte
  `DRAFT` o si alguna fila de `device_sync_status` del usuario tiene `pending_count > 0`. La UI muestra
  `max(last_seen_at)` y exige confirmación explícita.

### `device_sync_status` **[NUEVO]** (FR-005a)

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `user_id` | uuid → profiles | Parte de la PK |
| `device_id` | uuid | Parte de la PK; generado y guardado en IndexedDB de cada dispositivo |
| `pending_count` | int ≥ 0 | Pendientes del usuario en ese dispositivo |
| `oldest_pending_at` | timestamptz null | Captura más antigua pendiente |
| `last_seen_at` | timestamptz | Lo fija el servidor al recibir el aviso |

Se escribe solo vía `report_device_sync_status(...)`, que el cliente llama cada vez que tiene
conexión y cada vez que cambia el número de pendientes. Lectura: el propio usuario y los managers.

### `private.login_attempts` **[NUEVO]** (R2)

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `username` | text PK | Normalizado; también para usuarios inexistentes |
| `failed_count` | int | Se reinicia a 0 tras un login correcto |
| `locked_until` | timestamptz null | `now()+15 min` al llegar a 5 fallos |
| `updated_at` | timestamptz | — |

Sin acceso para `anon` ni `authenticated`; solo la usan funciones `security definer` llamadas con
service-role.

### `shifts` (Turno) — sin cambios de esquema

`start_time`, `end_time` (puede cruzar medianoche) y `active`.
**[NUEVO]** `private.current_shift_at(ts timestamptz) → (shift_id, operational_date)`: resuelve el
turno vigente en Bogotá. Para turnos que cruzan medianoche, la fecha operativa es la del día de
inicio (Clarification 4).

### `operator_machine_assignments` (Asignación) **[CAMBIA]** (R5)

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` **[NUEVO]** | uuid PK | Reemplaza la PK compuesta `(operator_id, machine_id)` |
| `operator_id` | uuid → profiles | El rol debe ser `OPERATOR` |
| `machine_id` | uuid → machines | La máquina debe estar activa al asignar |
| `shift_id` **[NUEVO]** | uuid → shifts | Obligatorio |
| `valid_from` **[NUEVO]** | date | Por defecto, hoy |
| `valid_to` **[NUEVO]** | date null | `null` = indefinida; `≥ valid_from` |
| `active`, `created_by`, `created_at`, `updated_at` | — | Existentes |

- Unicidad: `(operator_id, machine_id, shift_id) where active`.
- **Migración de datos**: cada asignación activa existente se expande a una fila por turno activo.

### `production_reports` (Reporte de producción) **[CAMBIA]**

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` | uuid PK | **[CAMBIA]** puede venir del cliente (creación offline) |
| `folio` | text | Lo asigna el servidor al insertar; offline se muestra "Pendiente" |
| `machine_id` | uuid | Asignada al operario en el turno vigente (FR-007) |
| `shift_id` | uuid | **[CAMBIA]** lo fija el trigger desde `started_at` (FR-007b); el operario no lo edita |
| `report_date` | date | **[CAMBIA]** = fecha operativa, la fija el trigger; el operario no la edita |
| `started_at` | timestamptz | **[CAMBIA]** hora del dispositivo al iniciar el reporte, obligatoria |
| Datos de producción (`production_order`, `lot`, `client_id`, `product_id`, `weight`, `g_min`, `programmed_hours`, `units_produced`, `waste`, `ended_at`, `observations`, …) | — | Existentes; `client_id` y `product_id` solo pueden ser elementos activos (FR-011a) |
| `status` | `report_status` | Ver la máquina de estados |
| `origin` **[NUEVO]** | text `online`/`offline` | Cómo se creó |
| `received_at` **[NUEVO]** | timestamptz | Hora de llegada al servidor |
| `approved_by` **[NUEVO]**, `approved_at` **[NUEVO]**, `approver_full_name` **[NUEVO]** | — | Obligatorios si `CLOSED` y null en otro caso (FR-024a) |
| `cancellation_reason`, `cancelled_at`, `cancelled_by` | — | Existentes; ahora también puede cancelar un manager si está fuera de turno |
| `created_by`, `creator_*` (snapshot), `submitted_*`, `updated_*` | — | Existentes |

- **[SE ELIMINA]** el límite de 5 borradores por operario y el índice
  `production_reports_one_draft_per_machine`. Se reemplazan por los índices únicos parciales
  `one_active_per_operator (created_by) where status='DRAFT'` y `one_active_per_machine
  (machine_id) where status='DRAFT'` (FR-007a).
- **Calculado** (vista `production_report_overview`): `is_off_shift` = `status='DRAFT'` y `now()`
  posterior al fin del turno en su fecha operativa **+ margen** (`app_settings.off_shift_grace`,
  por defecto 2 h, configurable); `has_open_conflict`; `has_pending_review`.
  - Semántica implementada en F1: `has_open_conflict` = existe una fila `OPEN` en `sync_quarantine` del reporte.
    `has_pending_review` = `has_open_conflict` **o** (el reporte no está `CLOSED` y alguna parada o cambio tiene
    `clock_skew_review = true`). `active_stop` = `jsonb` `{id, started_at, stop_category_id}` de la parada abierta
    (sin `ended_at` ni cancelación) o `null`.

#### Máquina de estados

```text
            submit (autor, sin parada abierta, campos obligatorios)
  DRAFT ─────────────────────────────────────────────▶ SUBMITTED ──approve (manager)──▶ CLOSED
    │                                                      │  ▲                          │  ▲
    │ cancel (autor) | cancel (manager si is_off_shift)    │  └── correct (manager,      │  └── correct (manager,
    ▼                                                      │      motivo obligatorio)    │      motivo obligatorio)
 CANCELLED                                                  └──────────────────────────────┘
```

- `SUBMITTED→CLOSED` requiere `has_open_conflict = false` y conexión (FR-024b).
- `SUBMITTED`, `CLOSED` y `CANCELLED` no vuelven atrás. Nadie cancela `SUBMITTED` ni `CLOSED`.
- En `DRAFT` solo escribe el autor; los managers no pueden hacer `UPDATE` (FR-025a).
- La corrección de un manager se hace **solo** vía `correct_report(...)`, con motivo (FR-025).

### `report_stop_events` (Parada) **[CAMBIA]**

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` | uuid PK | **[CAMBIA]** lo genera el cliente |
| `report_id`, `description` | — | Existentes |
| `stop_category_id` | uuid null | **[CAMBIA]** opcional mientras la parada está abierta; obligatoria (y activa) para cerrarla; un reporte no se envía con paradas cerradas sin categoría |
| `started_at`, `ended_at` | timestamptz | **[CAMBIA]** hora del dispositivo; el trigger ya no las sobrescribe (FR-008a) |
| `received_at` **[NUEVO]**, `captured_offline` **[NUEVO]**, `clock_skew_review` **[NUEVO]** | — | `clock_skew_review` = online y \|captura − llegada\| > 5 min |
| `cancellation_*`, `duration_seconds`, `responsible_user_id` | — | Existentes |

- Restricciones existentes: `ended_at ≥ started_at`, GiST sin solapamiento, una sola abierta por
  reporte; no se envía un reporte con una parada abierta (FR-009).
- **[CAMBIA]** el `DELETE` físico ya no se permite a nadie; una parada errónea se corrige o se
  cancela.

### `change_types` (Tipo de cambio) **[NUEVO]**

`id uuid`, `code` (único), `name` (único, normalizado), `active`, `sort_order`, timestamps.
Semilla: Producto, Formato, Lote, Otro. Lo gestionan los managers. Si está en uso, se desactiva en
lugar de borrarse (R13).

### `report_change_events` (Cambio) **[NUEVO]**

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` | uuid PK (cliente) | — |
| `report_id` | uuid → production_reports (`restrict`) | El reporte debe estar en `DRAFT` y ser del autor |
| `change_type_id` | uuid → change_types | Activo al registrar |
| `description` | text | Obligatoria, 1–500 caracteres |
| `occurred_at` | timestamptz | Hora del dispositivo |
| `received_at`, `captured_offline`, `clock_skew_review` | — | Igual que en las paradas |
| `created_by` | uuid → profiles | Autor del reporte |
| `created_at`, `updated_at` | — | — |

RLS: la misma visibilidad que las paradas. El operario solo inserta en sus borradores; los managers
corrigen vía `correct_report`.

### `report_audit_log` (Registro de auditoría de reportes) **[CAMBIA]** (R7)

| Campo | Tipo | Cambio |
| --- | --- | --- |
| `id`, `report_id`, `changed_by`, `changed_at`, `field_name`, `old_value`, `new_value` | — | Existentes |
| `entity_type` | text `report`/`stop`/`change` | **[NUEVO]** |
| `entity_id` | uuid | **[NUEVO]** |
| `action` | text `INSERT`/`UPDATE`/`STATUS` | **[NUEVO]** |
| `actor_role` | `app_role` | **[NUEVO]** el rol en el momento de la acción |
| `reason` | text null | **[NUEVO]** obligatorio en correcciones, cancelaciones y aprobaciones |
| `captured_offline` | bool | **[NUEVO]** |
| `captured_at` | timestamptz null | **[NUEVO]** hora del dispositivo |
| `received_at` | timestamptz | **[NUEVO]** hora de llegada |

- Se escribe para **toda** inserción o modificación, por cualquier rol, de reportes, paradas y
  cambios (FR-029).
- Lectura: managers y auditores, para **todos** los reportes (FR-031). Antes el auditor solo veía
  los `SUBMITTED`.
- Inmutable: sin `INSERT/UPDATE/DELETE` para clientes (FR-030).

### `administrative_audit_log` (Historial administrativo) **[CAMBIA]**

| Campo | Cambio |
| --- | --- |
| `action` | Se amplía a `INSERT`, `UPDATE`, `DELETE`, `DEACTIVATE`, `REACTIVATE`, `PASSWORD_RESET`, `USER_CREATED`, `REMOVE_USER`, `REACTIVATE_USER`, `OFFLINE_LOGIN` |
| `actor_role` **[NUEVO]** | Rol del autor |
| `old_value`, `new_value` **[NUEVO]** (jsonb) | Diferencias, sin secretos |

- Triggers `INSERT/UPDATE/DELETE` sobre `profiles`, `machines`, `operator_machine_assignments`,
  `lines`, `clients`, `products`, `dosifier_types`, `shifts`, `stop_categories` y `change_types`.
- Lectura **solo ROOT** (FR-029a). Inmutable.

### `sync_operation_log` **[NUEVO]** (R9)

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `operation_id` | uuid PK | Idempotencia |
| `user_id` | uuid → profiles | Debe coincidir con `auth.uid()` |
| `operation_type` | text | `CREATE_REPORT`, `SAVE_REPORT_FIELDS`, `START_STOP`, `CLOSE_STOP`, `SET_STOP_CATEGORY`, `CANCEL_STOP`, `ADD_CHANGE`, `SUBMIT_REPORT`, `CANCEL_REPORT` |
| `result` | text `applied`/`conflict`/`rejected` | — |
| `detail` | jsonb | Motivo o versión del servidor |
| `captured_at`, `received_at` | timestamptz | — |

El usuario lee solo sus filas; los managers leen todas. Nadie escribe directamente: se escribe vía
`apply_sync_operation`.

### `sync_quarantine` **[NUEVO]** (R9)

Datos que llegan offline para un reporte que ya no los admite (por ejemplo, cancelado fuera de
turno por un manager) o que entran en conflicto: `id`, `operation_id`, `report_id`, `user_id`,
`payload jsonb`, `reason`, `status` (`OPEN`/`REVIEWED`), `reviewed_by`, `reviewed_at`.

- Mientras existan filas `OPEN` del reporte, `has_open_conflict` es verdadero y el reporte no se
  puede aprobar (FR-024b).
- Los managers revisan; los auditores leen.

### `app_settings` **[NUEVO]**

Fila única de configuración: `off_shift_grace interval` (por defecto `2 hours`),
`offline_login_window interval` (por defecto `7 days`). Lectura para usuarios autenticados;
escritura solo ROOT.

### `notification_events` **[CAMBIA]**

Se añaden los tipos `SYNC_CONFLICT`, `OFFLINE_DATA_REVIEW`, `CLOCK_SKEW_REVIEW` y
`REPORT_APPROVED`. Los destinatarios son los managers activos (el autor, en `REPORT_APPROVED`).
Requiere ampliar el CHECK de `type` y `private.notification_is_visible` (sin ello los inserts fallan).

### Elemento pendiente de subir (cliente, IndexedDB) **[CAMBIA]**

Base de datos `reporte-produccion-offline` **v2**:

| Store | Clave | Contenido |
| --- | --- | --- |
| `outbox` | `[userId, operationId]` | Operación tipada (R9), `state` (`pending`, `syncing`, `synced`, `conflict`, `rejected`), `capturedAt`, `seq` causal |
| `entities` | `[userId, entityType, id]` | Copia local de reportes, paradas y cambios para renderizar offline |
| `snapshot` | `userId` | Snapshot de trabajo: asignaciones, turnos, catálogos activos y reporte activo, con `fetchedAt` |
| `offlineCredentials` | `usernameNormalized` | Verificador PBKDF2, rol, `enabledUntil`, bloqueo local (R8; Fase 4b) |
| `overview` | `userId` | Snapshot de solo lectura para manager o auditor (FR-020; Fase 4b) |
| `reportDrafts`, `leases` | — | Existentes; `reportDrafts` se migra a `outbox` + `entities` |

---

## Matriz RLS objetivo (resumen)

> Ninguna política concede `UPDATE` directo a managers sobre reportes, paradas o cambios. Las
> mutaciones privilegiadas (aprobar, cancelar fuera de turno, corregir, sincronizar, revisar
> cuarentena) se hacen solo vía RPC `security definer` que validan actor, rol y estado (Principio I).

| Tabla / acción | ROOT | ADMINISTRATOR (coord.) | VIEWER (auditor) | OPERATOR |
| --- | --- | --- | --- | --- |
| Reportes: SELECT | todos | todos | **todos** | propios |
| Reportes: INSERT | ✗ | ✗ | ✗ | propio, máquina asignada en el turno vigente |
| Reportes: UPDATE en `DRAFT` | ✗ | ✗ | ✗ | propio |
| Reportes: corregir `SUBMITTED`/`CLOSED` | RPC + motivo | RPC + motivo | ✗ | ✗ |
| Reportes: aprobar | RPC | RPC | ✗ | ✗ |
| Reportes: cancelar `DRAFT` | si fuera de turno | si fuera de turno | ✗ | propio |
| Paradas y cambios: INSERT/UPDATE | vía `correct_report` | vía `correct_report` | ✗ | propio `DRAFT` |
| Catálogos y máquinas: escritura | ✓ | ✓ | ✗ | ✗ (**se elimina** `save_frequent_catalog_value`) |
| Usuarios: gestión | todos los roles | solo operarios | ✗ | ✗ |
| `report_audit_log`: SELECT | ✓ | ✓ | ✓ | ✗ |
| `administrative_audit_log`: SELECT | ✓ | ✗ | ✗ | ✗ |
| `sync_quarantine`: SELECT / revisar | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ | propias / ✗ |
