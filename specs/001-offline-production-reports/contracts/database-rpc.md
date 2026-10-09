# Contrato de funciones de base de datos (Supabase/PostgREST)

Todas en `public` salvo indicación; `security invoker` (RLS activa) salvo las marcadas
`definer`. Las funciones `private.*` no son invocables por clientes. Errores con `raise exception`
en español y `errcode` estable para que la API los traduzca.

| Función | Rol llamador | Contrato | Fase |
| --- | --- | --- | --- |
| `private.is_manager() → bool` / `private.is_root() → bool` | interno | Rol activo del `auth.uid()`. | F1 |
| `private.current_shift_at(ts timestamptz) → table(shift_id uuid, operational_date date, shift_end timestamptz)` | interno | Turno activo que contiene `ts` en America/Bogota; turnos que cruzan medianoche → fecha del día de inicio. Sin turno → vacío. | F1 |
| `private.check_login_allowed(username text) → bool` (definer) | service-role | `false` si `locked_until > now()`. | F2 |
| `private.register_login_result(username text, success bool)` (definer) | service-role | Éxito → reinicia; fallo → `failed_count+1`, al llegar a 5 fija `locked_until = now()+15 min`. | F2 |
| `public.resolve_login_email(username text) → text` (definer) | service-role | Correo sintético; existe o no, devuelve un valor con el mismo formato (no revela existencia). | F2 |
| `public.approve_report(report_id uuid) → production_reports` | manager | `SUBMITTED` y sin `sync_quarantine` `OPEN` → `CLOSED`, `approved_*`; audita `STATUS` con `actor_role`. errcodes: `P0001 NOT_SUBMITTED`, `P0002 OPEN_CONFLICT`. | F2 |
| `public.cancel_report(report_id uuid, reason text) → production_reports` | autor (DRAFT) o manager (`is_off_shift`) | Motivo obligatorio; audita con `reason`. errcode `P0003 NOT_CANCELLABLE`. | F2 |
| `public.correct_report(report_id uuid, patch jsonb, stops jsonb default null, changes jsonb default null, reason text) → production_reports` | manager | Solo `SUBMITTED`/`CLOSED`; `reason` ≥ 5 caracteres; fija `app.change_reason`; aplica campo a campo; triggers auditan cada diferencia. | F3 |
| `public.delete_or_deactivate(catalog text, item_id uuid) → jsonb` | manager | `catalog` ∈ {machines, lines, clients, products, dosifier_types, shifts, stop_categories, change_types}; sin referencias → DELETE `{action:'deleted'}`; con referencias → `active=false` `{action:'deactivated'}`. | F2 |
| `public.manage_user_assignments(...)` | service-role | Reemplaza `replace_operator_assignments`: asignaciones `(machine_id, shift_id, valid_from, valid_to)`; valida matriz de gestión con `p_actor_id`; invariante ROOT. | F2 |
| `public.apply_sync_operation(op jsonb) → jsonb` | OPERATOR | Ver [sync-protocol.md](./sync-protocol.md); idempotente vía `sync_operation_log`; nunca lanza al llamador por errores de negocio (los devuelve como `rejected`/`conflict`). | F4a |
| `public.review_quarantine(item_id uuid, apply bool, reason text) → jsonb` | manager | Marca `REVIEWED`; si `apply`, aplica vía `correct_report`. | F4a |
| `public.production_report_overview` (vista, `security_invoker`) | todos según RLS | Columnas del reporte + `is_off_shift`, `has_open_conflict`, `has_pending_review`, `active_stop`. | F1/F5 |

## Triggers

| Trigger | Tabla | Efecto | Fase |
| --- | --- | --- | --- |
| `validate_production_report` **[CAMBIA]** | `production_reports` | Transiciones de R4; fija `shift_id`, `report_date`, `received_at`, `origin`; managers no actualizan `DRAFT` (salvo cancelación fuera de turno); `client_id`/`product_id` activos. | F1/F2 |
| `prepare_stop_event` **[CAMBIA]** | `report_stop_events` | Deja de sobrescribir horas; calcula `received_at`, `clock_skew_review`, duración; valida categoría activa. | F1 |
| `prepare_change_event` **[NUEVO]** | `report_change_events` | Igual que paradas. | F1 |
| `audit_report_entity` **[NUEVO]**, reemplaza `audit_report_correction` y `audit_stop_correction` | reportes, paradas, cambios | Registra toda inserción/modificación por cualquier rol con `actor_role`, `reason`, offline. | F3 |
| `audit_admin_entity` **[NUEVO]**, reemplaza `audit_administrative_deletion` | tablas administrativas | INSERT/UPDATE/DELETE → `administrative_audit_log`. | F3 |
| `ensure_active_root` **[NUEVO]** (deferred) | `profiles` | Falla el commit si no queda ningún ROOT activo. | F1 |
| `notify_*` **[CAMBIA]** | varias | Nuevos tipos `SYNC_CONFLICT`, `OFFLINE_DATA_REVIEW`, `CLOCK_SKEW_REVIEW`, `REPORT_APPROVED`. | F2–F4a |
