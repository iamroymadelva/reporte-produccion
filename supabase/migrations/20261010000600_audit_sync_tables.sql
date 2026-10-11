-- Fase F1 / T016: columnas de auditoría, tablas de sincronización, ajustes de la app y vista de resumen
-- (feature 001, R7 y R9). Las tablas de sincronización las escriben solo RPC security definer (Fase 4a).

-- ---------------------------------------------------------------------------
-- report_audit_log: contexto de la acción (rol, motivo, origen offline)
-- ---------------------------------------------------------------------------
alter table public.report_audit_log
  add column entity_type text check (entity_type in ('report', 'stop', 'change')),
  add column entity_id uuid,
  -- DELETE se admite solo para el trigger heredado de paradas (el DELETE de clientes está revocado).
  add column action text check (action in ('INSERT', 'UPDATE', 'STATUS', 'DELETE')),
  add column actor_role public.app_role,
  add column reason text,
  add column captured_offline boolean not null default false,
  add column captured_at timestamptz,
  add column received_at timestamptz not null default now();

-- Backfill de las filas existentes (best effort a partir de field_name y valores).
update public.report_audit_log l
set entity_type = case when l.field_name like 'stop_event.%' then 'stop' else 'report' end,
    entity_id = case
      when l.field_name like 'stop_event.%'
        then coalesce((l.new_value ->> 'id')::uuid, (l.old_value ->> 'id')::uuid, l.report_id)
      else l.report_id
    end,
    action = case
      when l.field_name = 'status' then 'STATUS'
      when l.field_name = 'stop_event.insert' then 'INSERT'
      else 'UPDATE'
    end,
    actor_role = (select p.role from public.profiles p where p.id = l.changed_by),
    received_at = l.changed_at;

alter table public.report_audit_log
  alter column entity_type set not null,
  alter column entity_id set not null,
  alter column action set not null;

create index report_audit_log_entity_idx on public.report_audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- administrative_audit_log: rol del autor y diferencias
-- ---------------------------------------------------------------------------
alter table public.administrative_audit_log
  add column actor_role public.app_role,
  add column old_value jsonb,
  add column new_value jsonb;

-- ---------------------------------------------------------------------------
-- sync_operation_log (idempotencia de la sincronización)
-- ---------------------------------------------------------------------------
create table public.sync_operation_log (
  operation_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  operation_type text not null check (operation_type in (
    'CREATE_REPORT', 'SAVE_REPORT_FIELDS', 'START_STOP', 'CLOSE_STOP', 'SET_STOP_CATEGORY',
    'CANCEL_STOP', 'ADD_CHANGE', 'SUBMIT_REPORT', 'CANCEL_REPORT'
  )),
  result text not null check (result in ('applied', 'conflict', 'rejected')),
  detail jsonb,
  captured_at timestamptz,
  received_at timestamptz not null default now()
);
create index sync_operation_log_user_idx on public.sync_operation_log (user_id, received_at desc);

-- ---------------------------------------------------------------------------
-- sync_quarantine (datos offline que no pudieron aplicarse)
-- ---------------------------------------------------------------------------
create table public.sync_quarantine (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  report_id uuid references public.production_reports(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  payload jsonb not null,
  reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'REVIEWED')),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sync_quarantine_review_consistency check (
    (status = 'OPEN' and reviewed_by is null and reviewed_at is null)
    or (status = 'REVIEWED' and reviewed_by is not null and reviewed_at is not null)
  )
);
create index sync_quarantine_open_report_idx on public.sync_quarantine (report_id) where status = 'OPEN';
create index sync_quarantine_user_idx on public.sync_quarantine (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- device_sync_status (FR-005a): pendientes por usuario y dispositivo
-- ---------------------------------------------------------------------------
create table public.device_sync_status (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  pending_count integer not null default 0 check (pending_count >= 0),
  oldest_pending_at timestamptz,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- ---------------------------------------------------------------------------
-- app_settings (fila única)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  off_shift_grace interval not null default interval '2 hours' check (off_shift_grace >= interval '0'),
  offline_login_window interval not null default interval '7 days' check (offline_login_window > interval '0'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.app_settings (id) values (true);
create trigger app_settings_set_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS y grants
-- ---------------------------------------------------------------------------
alter table public.sync_operation_log enable row level security;
alter table public.sync_quarantine enable row level security;
alter table public.device_sync_status enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.sync_operation_log, public.sync_quarantine, public.device_sync_status, public.app_settings from anon, authenticated;
grant select on public.sync_operation_log, public.sync_quarantine, public.device_sync_status to authenticated;
grant select, update on public.app_settings to authenticated;

create policy sync_operation_log_select on public.sync_operation_log
  for select to authenticated
  using (
    private.is_manager()
    or (private.current_user_is_active() and user_id = (select auth.uid()))
  );

create policy sync_quarantine_select on public.sync_quarantine
  for select to authenticated
  using (
    private.is_manager()
    or private.current_user_role() = 'VIEWER'
    or (private.current_user_is_active() and user_id = (select auth.uid()))
  );

create policy device_sync_status_select on public.device_sync_status
  for select to authenticated
  using (
    private.is_manager()
    or (private.current_user_is_active() and user_id = (select auth.uid()))
  );

create policy app_settings_select on public.app_settings
  for select to authenticated using (private.current_user_is_active());
create policy app_settings_root_update on public.app_settings
  for update to authenticated
  using (private.is_root()) with check (private.is_root());

-- ---------------------------------------------------------------------------
-- Vista de resumen (security_invoker: aplica la RLS de quien consulta).
-- is_off_shift: DRAFT cuyo turno terminó hace más de off_shift_grace.
-- has_pending_review: cuarentena abierta o paradas/cambios con revisión de reloj
--   en un reporte que aún no está cerrado.
-- active_stop: la parada abierta del reporte (jsonb) o null.
-- ---------------------------------------------------------------------------
create view public.production_report_overview
with (security_invoker = true)
as
select
  r.*,
  coalesce(
    r.status = 'DRAFT'
    and sh.id is not null
    and now() > (((r.report_date + case when sh.start_time < sh.end_time then 0 else 1 end) + sh.end_time)
      at time zone 'America/Bogota') + cfg.off_shift_grace,
    false
  ) as is_off_shift,
  exists (
    select 1 from public.sync_quarantine q where q.report_id = r.id and q.status = 'OPEN'
  ) as has_open_conflict,
  (
    exists (select 1 from public.sync_quarantine q where q.report_id = r.id and q.status = 'OPEN')
    or (
      r.status <> 'CLOSED'
      and (
        exists (select 1 from public.report_stop_events s where s.report_id = r.id and s.clock_skew_review)
        or exists (select 1 from public.report_change_events c where c.report_id = r.id and c.clock_skew_review)
      )
    )
  ) as has_pending_review,
  (
    select jsonb_build_object('id', s.id, 'started_at', s.started_at, 'stop_category_id', s.stop_category_id)
    from public.report_stop_events s
    where s.report_id = r.id and s.ended_at is null and s.cancelled_at is null
    limit 1
  ) as active_stop
from public.production_reports r
left join public.shifts sh on sh.id = r.shift_id
cross join public.app_settings cfg;

revoke all on public.production_report_overview from anon, authenticated;
grant select on public.production_report_overview to authenticated;
