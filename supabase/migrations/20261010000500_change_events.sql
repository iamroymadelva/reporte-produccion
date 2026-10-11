-- Fase F1 / T015: tipos de cambio y eventos de cambio del reporte (feature 001, R6).

-- ---------------------------------------------------------------------------
-- Catálogo change_types
-- ---------------------------------------------------------------------------
create table public.change_types (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint change_types_code_not_blank check (btrim(code) <> ''),
  constraint change_types_name_not_blank check (btrim(name) <> '')
);
create unique index change_types_code_normalized_unique on public.change_types (lower(btrim(code)));
create unique index change_types_name_normalized_unique on public.change_types (lower(btrim(name)));

create trigger change_types_set_updated_at before update on public.change_types
  for each row execute function private.set_updated_at();
create trigger change_types_audit_delete after delete on public.change_types
  for each row execute function private.audit_administrative_deletion();

insert into public.change_types (code, name, sort_order) values
  ('PRODUCTO', 'Producto', 10),
  ('FORMATO', 'Formato', 20),
  ('LOTE', 'Lote', 30),
  ('OTRO', 'Otro', 40);

alter table public.change_types enable row level security;
revoke all on public.change_types from anon, authenticated;
grant select, insert, update, delete on public.change_types to authenticated;

create policy change_types_select on public.change_types
  for select to authenticated using (private.current_user_is_active());
create policy change_types_manager_insert on public.change_types
  for insert to authenticated with check (private.is_manager());
create policy change_types_manager_update on public.change_types
  for update to authenticated
  using (private.is_manager()) with check (private.is_manager());
create policy change_types_manager_delete on public.change_types
  for delete to authenticated using (private.is_manager());

-- ---------------------------------------------------------------------------
-- Eventos de cambio del reporte
-- ---------------------------------------------------------------------------
create table public.report_change_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.production_reports(id) on delete restrict,
  change_type_id uuid not null references public.change_types(id) on delete restrict,
  description text not null,
  occurred_at timestamptz not null default now(),
  received_at timestamptz,
  captured_offline boolean not null default false,
  clock_skew_review boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_change_events_description_length
    check (char_length(description) between 1 and 500 and btrim(description) <> '')
);
create index report_change_events_report_idx on public.report_change_events (report_id, occurred_at);

create function private.prepare_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role := private.current_user_role();
  v_is_manager boolean := coalesce(actor_role in ('ROOT', 'ADMINISTRATOR'), false);
  parent_status public.report_status;
  parent_owner uuid;
begin
  select status, created_by into parent_status, parent_owner
  from public.production_reports where id = new.report_id for update;
  if parent_status is null then raise exception 'Reporte no encontrado'; end if;

  if actor_id is not null and not v_is_manager then
    if actor_role is distinct from 'OPERATOR' or parent_owner is distinct from actor_id
      or parent_status <> 'DRAFT' then
      raise exception 'Solo puedes modificar cambios de tus reportes en borrador';
    end if;
    if tg_op = 'UPDATE'
      and (to_jsonb(new) - array['description', 'change_type_id'])
        is distinct from (to_jsonb(old) - array['description', 'change_type_id']) then
      raise exception 'Solo puedes cambiar el tipo y la descripción de un cambio';
    end if;
  end if;

  -- El autor del cambio es siempre el autor del reporte.
  new.created_by := parent_owner;

  if (tg_op = 'INSERT' or new.change_type_id is distinct from old.change_type_id)
    and not exists (select 1 from public.change_types where id = new.change_type_id and active) then
    raise exception 'Selecciona un tipo de cambio activo';
  end if;

  if tg_op = 'INSERT' then
    new.received_at := clock_timestamp();
    new.clock_skew_review := not new.captured_offline
      and abs(extract(epoch from (new.received_at - new.occurred_at))) > 300;
  else
    new.received_at := old.received_at;
    new.clock_skew_review := old.clock_skew_review;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.prepare_change_event() from public;

create trigger prepare_change_event_before_write
  before insert or update on public.report_change_events
  for each row execute function private.prepare_change_event();

alter table public.report_change_events enable row level security;
-- Sin DELETE para nadie: un cambio erróneo se corrige, no se borra.
revoke all on public.report_change_events from anon, authenticated;
grant select, insert, update on public.report_change_events to authenticated;

create policy change_events_select_by_report_access on public.report_change_events
  for select to authenticated
  using (
    exists (
      select 1 from public.production_reports r
      where r.id = report_change_events.report_id
        and (
          private.is_manager()
          or private.current_user_role() = 'VIEWER'
          or (private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()))
        )
    )
  );
create policy change_events_insert_by_role on public.report_change_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.production_reports r
      where r.id = report_change_events.report_id
        and (
          (private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()) and r.status = 'DRAFT')
          or (private.is_manager() and r.status <> 'DRAFT')
        )
    )
  );
create policy change_events_update_by_role on public.report_change_events
  for update to authenticated
  using (
    exists (
      select 1 from public.production_reports r
      where r.id = report_change_events.report_id
        and (
          (private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()) and r.status = 'DRAFT')
          or (private.is_manager() and r.status <> 'DRAFT')
        )
    )
  )
  with check (
    exists (
      select 1 from public.production_reports r
      where r.id = report_change_events.report_id
        and (
          (private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()) and r.status = 'DRAFT')
          or (private.is_manager() and r.status <> 'DRAFT')
        )
    )
  );
