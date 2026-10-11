# Contrato de funciones de base de datos (Supabase/PostgREST)

**Regla de seguridad (Principio I, hallazgo I1 de /speckit-analyze)**: ninguna política RLS concede
`UPDATE` directo a managers sobre reportes, paradas o cambios. Las mutaciones privilegiadas se hacen
**solo** con RPC `security definer` (`set search_path = ''`) que, como primeras instrucciones,
validan: `auth.uid()` no nulo y perfil activo, rol permitido, propiedad del recurso cuando aplica y
estado del reporte. Las lecturas y la escritura del operario sobre su propio `DRAFT` siguen siendo
`security invoker` bajo RLS. Las funciones `private.*` no son invocables por clientes. Errores con
`raise exception` en español y `errcode` estable para que la API los traduzca.

| Función | Tipo | Rol llamador | Contrato | Fase |
| --- | --- | --- | --- | --- |
| `private.is_manager() → bool` / `private.is_root() → bool` | definer | interno | Rol activo del `auth.uid()`. | F1 |
| `private.current_shift_at(ts timestamptz) → table(shift_id uuid, operational_date date, shift_end timestamptz)` | invoker | interno | Turno activo que contiene `ts` en America/Bogota; turnos que cruzan medianoche → fecha del día de inicio. Sin turno → vacío. | F1 |
| `private.check_login_allowed(username text) → bool` | definer | service-role | `false` si `locked_until > now()`. | F2 |
| `private.register_login_result(username text, success bool)` | definer | service-role | Éxito → reinicia; fallo → `failed_count+1`; al llegar a 5 fija `locked_until = now()+15 min`. | F2 |
| `public.resolve_login_email(username text) → text` | definer | service-role | Correo sintético; exista o no el usuario, devuelve un valor con el mismo formato (no revela existencia). | F2 |
| `public.approve_report(p_report_id uuid) → production_reports` | **definer** | manager | Valida actor activo con `is_manager()`; exige `SUBMITTED`, que no haya `sync_quarantine` `OPEN` y que no queden paradas no canceladas abiertas o sin categoría → `CLOSED`, `approved_*`, `approver_full_name`; fija `app.change_reason`; emite `REPORT_APPROVED`. Errores (código estable en MESSAGE, texto en español en DETAIL): `42501` FORBIDDEN, `P0001 NOT_SUBMITTED`, `P0002 OPEN_CONFLICT`, `P0006 NOT_FOUND`, `P0007 INVALID_STOPS`. | F2 |
| `public.cancel_report(p_report_id uuid, p_reason text) → production_reports` | **definer** | autor (DRAFT) o manager (`is_off_shift`) | Valida actor: autor OPERATOR del `DRAFT`, o manager con `is_off_shift` (fin de turno + `app_settings.off_shift_grace`, 2 h por defecto; sin turno: `coalesce(started_at, created_at)` + 12 h + margen). Motivo obligatorio (`22023`); fija `app.change_reason`; el manager cancela además las paradas abiertas. Errores: `42501` FORBIDDEN, `P0003 NOT_CANCELLABLE`, `P0006 NOT_FOUND`. | F2 |
| `public.correct_report(p_report_id uuid, p_patch jsonb, p_stops jsonb, p_changes jsonb, p_reason text) → production_reports` | **definer** | manager | Sin valores por defecto (la API pasa `null`). Valida `is_manager()`; solo `SUBMITTED`/`CLOSED`; `p_reason` ≥ 5 caracteres recortado; lista blanca de columnas (reporte: las 20 de `REPORT_EDITABLE_FIELDS`; parada: `stop_category_id, description, started_at, ended_at, cancellation_reason`; cambio: `change_type_id, description, occurred_at`); paradas y cambios se insertan o corrigen por id, nunca se borran; toda parada no cancelada debe quedar cerrada y con categoría; no marca `clock_skew_review` (`app.manager_correction`). Errores: `42501` FORBIDDEN, `22023` motivo/campo/parada no válidos, `P0005 NOT_CORRECTABLE`, `P0006 NOT_FOUND`. | F2 |
| `public.delete_or_deactivate(catalog text, item_id uuid) → jsonb` | definer | manager | Valida `is_manager()`; `catalog` ∈ {machines, lines, clients, products, dosifier_types, shifts, stop_categories, change_types}; sin referencias → DELETE `{action:'deleted'}`; con referencias → `active=false` `{action:'deactivated'}`. | F2 |
| `public.manage_user_assignments(p_target uuid, p_actor uuid, p_profile jsonb, p_assignments jsonb) → jsonb` | definer | service-role | Reemplaza `replace_operator_assignments`. Asignaciones `(machine_id, shift_id, valid_from, valid_to)`; valida la matriz de gestión con `p_actor`; invariante ROOT. **FR-005a**: si `p_profile` desactiva o retira y el objetivo tiene un `DRAFT` o algún `device_sync_status.pending_count > 0` → `P0004 USER_HAS_PENDING_DATA` con `{activeReportId, pendingDevices, lastSeenAt}`. | F2 |
| `public.user_last_contact(p_user uuid) → jsonb` | definer | manager | `{ lastSeenAt, pendingCount, activeReportId }` para el aviso previo a desactivar (FR-005a). | F2 |
| `public.report_device_sync_status(p_device_id uuid, p_pending_count int, p_oldest_pending_at timestamptz) → void` | definer | cualquier usuario activo | Upsert en `device_sync_status` para `auth.uid()`; `last_seen_at = clock_timestamp()`. | F2 (lista) / F4a (cliente) |
| `public.apply_sync_operation(op jsonb) → jsonb` | **definer** | OPERATOR | Valida `op.userId = auth.uid()`, perfil activo y rol `OPERATOR`. Reproduce explícitamente las reglas que la RLS impone al operario (reporte propio, `DRAFT`, asignación vigente, catálogos activos). Idempotente vía `sync_operation_log`; escribe `sync_quarantine`. Nunca lanza al llamador por errores de negocio: los devuelve como `rejected`/`conflict`. Ver [sync-protocol.md](./sync-protocol.md). | F4a |
| `public.review_quarantine(p_item_id uuid, p_apply bool, p_reason text) → jsonb` | **definer** | manager | Valida `is_manager()`; marca `REVIEWED` (con `review_note`); si `p_apply`, aplica vía `correct_report` (motivo >= 5 caracteres; solo reportes `SUBMITTED`/`CLOSED`, si no `P0005 NOT_CORRECTABLE`). Errores: `P0006 NOT_FOUND`, `P0008 ALREADY_REVIEWED`, `22023`. | F4a |
| `public.production_report_overview` (vista, `security_invoker`) | — | todos según RLS | Columnas del reporte + `is_off_shift`, `has_open_conflict`, `has_pending_review`, `active_stop`. | F1/F5 |

## Triggers

| Trigger | Tabla | Efecto | Fase |
| --- | --- | --- | --- |
| `validate_production_report` **[CAMBIA]** | `production_reports` | Transiciones de R4; fija `shift_id`, `report_date`, `received_at`, `origin`; `client_id`/`product_id` activos; al pasar a `SUBMITTED` exige paradas cerradas **y con categoría**. | F1/F2 |
| `prepare_stop_event` **[CAMBIA]** | `report_stop_events` | No sobrescribe horas; calcula `received_at`, `clock_skew_review` y duración; categoría opcional mientras está abierta, obligatoria y activa al cerrar. | F1 |
| `prepare_change_event` **[NUEVO]** | `report_change_events` | Igual que las paradas. | F1 |
| `audit_report_entity` **[NUEVO]**, reemplaza `audit_report_correction` y `audit_stop_correction` | reportes, paradas, cambios | Registra toda inserción o modificación, por cualquier rol, con `actor_role`, `reason` e indicador offline. | **F2 (Phase 5)** — antes que las RPC con motivo |
| `audit_admin_entity` **[NUEVO]**, reemplaza `audit_administrative_deletion` | tablas administrativas | INSERT/UPDATE/DELETE → `administrative_audit_log`. | F3 |
| `ensure_active_root` **[NUEVO]** (diferido) | `profiles` | Hace fallar el commit si no queda ningún ROOT activo. | F1 |
| `notify_*` **[CAMBIA]** | varias | Tipos nuevos `SYNC_CONFLICT`, `OFFLINE_DATA_REVIEW`, `CLOCK_SKEW_REVIEW`, `REPORT_APPROVED`; requiere ampliar el CHECK de `notification_events.type` y `private.notification_is_visible` (F1). | F1–F4a |


**Convención de errores de las RPC de reportes**: el MESSAGE lleva el código estable (`NOT_SUBMITTED`, `OPEN_CONFLICT`, `NOT_CANCELLABLE`, `NOT_CORRECTABLE`, `NOT_FOUND`, `INVALID_STOPS`) y el DETAIL el texto en español; `42501` y `22023` llevan el mensaje en español. La API los traduce en `src/lib/report-rpc.ts`.