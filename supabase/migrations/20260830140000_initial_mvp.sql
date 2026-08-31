create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create type public.app_role as enum ('ADMINISTRATOR', 'OPERATOR', 'VIEWER');
create type public.report_status as enum ('DRAFT', 'SUBMITTED');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'OPERATOR',
  job_title text,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.machines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.operator_machine_assignments (
  operator_id uuid not null references public.profiles(id) on delete cascade,
  machine_id uuid not null references public.machines(id) on delete restrict,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (operator_id, machine_id)
);

create table public.lines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dosifier_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stop_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.production_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date,
  production_order text,
  machine_id uuid not null references public.machines(id) on delete restrict,
  line_id uuid references public.lines(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  lot text,
  shift text,
  product_id uuid references public.products(id) on delete restrict,
  weight numeric check (weight is null or weight >= 0),
  g_min numeric check (g_min is null or g_min >= 0),
  dosifier_type_id uuid references public.dosifier_types(id) on delete restrict,
  started_at timestamptz,
  ended_at timestamptz,
  programmed_hours numeric check (programmed_hours is null or programmed_hours >= 0),
  units_produced bigint check (units_produced is null or units_produced >= 0),
  waste numeric check (waste is null or waste >= 0),
  process_performance numeric,
  operator_performance numeric,
  observations text,
  status public.report_status not null default 'DRAFT',
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  submitted_by uuid references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_reports_time_order check (ended_at is null or started_at is null or ended_at >= started_at)
);

create unique index production_reports_one_draft_per_machine
  on public.production_reports(machine_id)
  where status = 'DRAFT';
create index production_reports_created_by_status_idx
  on public.production_reports(created_by, status);

create table public.report_stop_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.production_reports(id) on delete cascade,
  stop_category_id uuid not null references public.stop_categories(id) on delete restrict,
  description text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds bigint,
  responsible_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_stop_events_time_order check (ended_at is null or ended_at >= started_at),
  constraint report_stop_events_duration_nonnegative check (duration_seconds is null or duration_seconds >= 0)
);

create unique index report_stop_events_one_open_per_report
  on public.report_stop_events(report_id)
  where ended_at is null;

alter table public.report_stop_events
  add constraint report_stop_events_no_overlap
  exclude using gist (
    report_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&
  );

create index report_stop_events_report_idx on public.report_stop_events(report_id, started_at);

create table public.report_audit_log (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.production_reports(id) on delete cascade,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  field_name text not null,
  old_value jsonb,
  new_value jsonb
);

create index report_audit_log_report_idx on public.report_audit_log(report_id, changed_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function private.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and active
  );
$$;

create function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid()) and active;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    'OPERATOR',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.validate_production_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role := private.current_user_role();
  draft_count integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then
      raise exception 'Los reportes nuevos deben iniciar en borrador';
    end if;

    if new.created_by is null then
      new.created_by := actor_id;
    end if;
    new.updated_by := coalesce(actor_id, new.created_by);
  else
    if new.created_by is distinct from old.created_by then
      raise exception 'El operador responsable del reporte no puede cambiar';
    end if;

    if new.machine_id is distinct from old.machine_id and actor_role is distinct from 'ADMINISTRATOR' then
      raise exception 'La máquina del reporte solo puede corregirla un Administrador';
    end if;

    if old.status = 'SUBMITTED' and new.status <> 'SUBMITTED' then
      raise exception 'Un reporte enviado no puede volver a borrador';
    end if;

    if old.status = 'DRAFT' and new.status = 'SUBMITTED' then
      if exists (
        select 1 from public.report_stop_events
        where report_id = new.id and ended_at is null
      ) then
        raise exception 'No se puede enviar un reporte con una parada abierta';
      end if;
      new.submitted_at := clock_timestamp();
      new.submitted_by := coalesce(actor_id, new.updated_by, new.created_by);
    elsif new.status is distinct from old.status then
      raise exception 'Transición de estado no permitida';
    end if;

    new.updated_by := coalesce(actor_id, new.updated_by, old.updated_by);
  end if;

  if new.status = 'DRAFT' and (tg_op = 'INSERT' or new.machine_id is distinct from old.machine_id) then
    if not exists (select 1 from public.machines where id = new.machine_id and active) then
      raise exception 'La máquina seleccionada no está activa';
    end if;

    if not exists (
      select 1 from public.operator_machine_assignments
      where operator_id = new.created_by and machine_id = new.machine_id and active
    ) then
      raise exception 'La máquina no está asignada al Operador';
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.created_by::text, 0));
    select count(*) into draft_count
    from public.production_reports
    where created_by = new.created_by and status = 'DRAFT';

    if draft_count >= 5 then
      raise exception 'Un Operador puede tener máximo 5 reportes en borrador';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger validate_production_report_before_write
  before insert or update on public.production_reports
  for each row execute function private.validate_production_report();

create function private.prepare_stop_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role := private.current_user_role();
  parent_status public.report_status;
begin
  select status into parent_status
  from public.production_reports
  where id = new.report_id;

  if parent_status is null then
    raise exception 'Reporte no encontrado';
  end if;

  if parent_status = 'SUBMITTED' and actor_role is distinct from 'ADMINISTRATOR' then
    raise exception 'El reporte enviado es de solo lectura';
  end if;

  if tg_op = 'INSERT' then
    if actor_role is distinct from 'ADMINISTRATOR' and actor_id is not null then
      new.started_at := clock_timestamp();
      new.responsible_user_id := actor_id;
      new.ended_at := null;
    end if;
  else
    if actor_role is distinct from 'ADMINISTRATOR' and actor_id is not null then
      if new.started_at is distinct from old.started_at
        or new.responsible_user_id is distinct from old.responsible_user_id then
        raise exception 'El inicio y responsable de una parada no pueden modificarse';
      end if;

      if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
        raise exception 'Una parada cerrada no puede reabrirse ni cambiar su final';
      end if;

      if old.ended_at is null and new.ended_at is not null then
        new.ended_at := clock_timestamp();
      end if;
    end if;
  end if;

  if new.ended_at is null then
    new.duration_seconds := null;
  else
    new.duration_seconds := floor(extract(epoch from (new.ended_at - new.started_at)))::bigint;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger prepare_stop_event_before_write
  before insert or update on public.report_stop_events
  for each row execute function private.prepare_stop_event();

create function private.audit_report_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  old_data jsonb;
  new_data jsonb;
  item record;
begin
  if old.status <> 'SUBMITTED' or private.current_user_role() <> 'ADMINISTRATOR' then
    return new;
  end if;

  old_data := to_jsonb(old) - array['updated_at', 'updated_by'];
  new_data := to_jsonb(new) - array['updated_at', 'updated_by'];

  for item in select key, value from jsonb_each(new_data)
  loop
    if old_data -> item.key is distinct from item.value then
      insert into public.report_audit_log (report_id, changed_by, field_name, old_value, new_value)
      values (new.id, actor_id, item.key, old_data -> item.key, item.value);
    end if;
  end loop;

  return new;
end;
$$;

create trigger audit_report_correction_after_update
  after update on public.production_reports
  for each row execute function private.audit_report_correction();

create function private.audit_stop_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_report_id uuid := coalesce(new.report_id, old.report_id);
  target_status public.report_status;
begin
  select status into target_status from public.production_reports where id = target_report_id;
  if target_status = 'SUBMITTED' and private.current_user_role() = 'ADMINISTRATOR' then
    insert into public.report_audit_log (report_id, changed_by, field_name, old_value, new_value)
    values (
      target_report_id,
      actor_id,
      'stop_event.' || lower(tg_op),
      case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      case when tg_op = 'DELETE' then null else to_jsonb(new) end
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger audit_stop_correction_after_write
  after insert or update or delete on public.report_stop_events
  for each row execute function private.audit_stop_correction();

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger machines_set_updated_at before update on public.machines
  for each row execute function private.set_updated_at();
create trigger assignments_set_updated_at before update on public.operator_machine_assignments
  for each row execute function private.set_updated_at();
create trigger lines_set_updated_at before update on public.lines
  for each row execute function private.set_updated_at();
create trigger clients_set_updated_at before update on public.clients
  for each row execute function private.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function private.set_updated_at();
create trigger dosifier_types_set_updated_at before update on public.dosifier_types
  for each row execute function private.set_updated_at();
create trigger stop_categories_set_updated_at before update on public.stop_categories
  for each row execute function private.set_updated_at();

create view public.production_report_metrics
with (security_invoker = true)
as
with report_base as (
  select
    r.*,
    coalesce(stops.total_downtime_seconds, 0)::bigint as total_downtime_seconds
  from public.production_reports r
  left join lateral (
    select sum(duration_seconds)::bigint as total_downtime_seconds
    from public.report_stop_events
    where report_id = r.id and ended_at is not null
  ) stops on true
), calculated as (
  select
    report_base.*,
    case when g_min is null then null else g_min * 60 end as theoretical_units_per_hour,
    total_downtime_seconds::numeric / 3600 as total_downtime_hours,
    case
      when programmed_hours is null then null
      else programmed_hours - (total_downtime_seconds::numeric / 3600)
    end as net_productive_hours
  from report_base
)
select
  calculated.*,
  case
    when theoretical_units_per_hour is null or programmed_hours is null then null
    else theoretical_units_per_hour * programmed_hours
  end as theoretical_target,
  case
    when theoretical_units_per_hour is null or net_productive_hours is null then null
    else theoretical_units_per_hour * net_productive_hours
  end as net_target,
  case
    when units_produced is null then null
    else units_produced / nullif(theoretical_units_per_hour * programmed_hours, 0)
  end as theoretical_performance,
  case
    when units_produced is null then null
    else units_produced / nullif(theoretical_units_per_hour * net_productive_hours, 0)
  end as net_performance
from calculated;

insert into public.stop_categories (code, name) values
  ('1', 'CUADRE DE FORMATO'),
  ('2', 'ALISTAMIENTO'),
  ('3', 'AJUSTE'),
  ('4', 'CORRECTIVO'),
  ('5', 'SEGUIMIENTO'),
  ('6', 'DES/MONTAJE DOSIFICADOR'),
  ('7', 'CAMBIO CODIGOS'),
  ('8', 'ASEO'),
  ('9', 'CALIDAD'),
  ('10', 'VARIA CARACT. PRODUCTO'),
  ('11', 'MECANICO NO DISPONIBLE'),
  ('12', 'CAPACITACION'),
  ('13', 'PERMISO PERSONAL / CITA MEDICA'),
  ('14', 'DOCUMENTACION'),
  ('15', 'CAMBIO ROLLO'),
  ('16', 'FALTANTE MATERIAL'),
  ('17', 'CALENTAMIENTO MORDAZAS'),
  ('18', 'LIMPIEZA MORDAZAS'),
  ('19', 'OTROS')
on conflict (code) do update set name = excluded.name;

alter table public.profiles enable row level security;
alter table public.machines enable row level security;
alter table public.operator_machine_assignments enable row level security;
alter table public.lines enable row level security;
alter table public.clients enable row level security;
alter table public.products enable row level security;
alter table public.dosifier_types enable row level security;
alter table public.stop_categories enable row level security;
alter table public.production_reports enable row level security;
alter table public.report_stop_events enable row level security;
alter table public.report_audit_log enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.current_user_is_active() to authenticated;
grant execute on function private.current_user_role() to authenticated;

grant select on public.profiles, public.machines, public.operator_machine_assignments,
  public.lines, public.clients, public.products, public.dosifier_types,
  public.stop_categories, public.production_reports, public.report_stop_events,
  public.report_audit_log, public.production_report_metrics to authenticated;
grant update on public.profiles to authenticated;
grant insert, update on public.machines, public.lines, public.clients,
  public.products, public.dosifier_types, public.stop_categories to authenticated;
grant insert, update on public.operator_machine_assignments to authenticated;
grant insert, update on public.production_reports to authenticated;
grant insert, update, delete on public.report_stop_events to authenticated;

create policy profiles_select_active_users on public.profiles
  for select to authenticated
  using (private.current_user_is_active());
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR')
  with check (private.current_user_role() = 'ADMINISTRATOR');

create policy machines_select on public.machines
  for select to authenticated using (private.current_user_is_active());
create policy machines_admin_insert on public.machines
  for insert to authenticated with check (private.current_user_role() = 'ADMINISTRATOR');
create policy machines_admin_update on public.machines
  for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR')
  with check (private.current_user_role() = 'ADMINISTRATOR');

create policy assignments_select on public.operator_machine_assignments
  for select to authenticated
  using (
    private.current_user_role() = 'ADMINISTRATOR'
    or (private.current_user_is_active() and operator_id = (select auth.uid()))
  );
create policy assignments_admin_insert on public.operator_machine_assignments
  for insert to authenticated with check (private.current_user_role() = 'ADMINISTRATOR');
create policy assignments_admin_update on public.operator_machine_assignments
  for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR')
  with check (private.current_user_role() = 'ADMINISTRATOR');

create policy lines_select on public.lines for select to authenticated
  using (private.current_user_is_active());
create policy clients_select on public.clients for select to authenticated
  using (private.current_user_is_active());
create policy products_select on public.products for select to authenticated
  using (private.current_user_is_active());
create policy dosifier_types_select on public.dosifier_types for select to authenticated
  using (private.current_user_is_active());
create policy stop_categories_select on public.stop_categories for select to authenticated
  using (private.current_user_is_active());

create policy lines_admin_insert on public.lines for insert to authenticated
  with check (private.current_user_role() = 'ADMINISTRATOR');
create policy lines_admin_update on public.lines for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR') with check (private.current_user_role() = 'ADMINISTRATOR');
create policy clients_admin_insert on public.clients for insert to authenticated
  with check (private.current_user_role() = 'ADMINISTRATOR');
create policy clients_admin_update on public.clients for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR') with check (private.current_user_role() = 'ADMINISTRATOR');
create policy products_admin_insert on public.products for insert to authenticated
  with check (private.current_user_role() = 'ADMINISTRATOR');
create policy products_admin_update on public.products for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR') with check (private.current_user_role() = 'ADMINISTRATOR');
create policy dosifier_types_admin_insert on public.dosifier_types for insert to authenticated
  with check (private.current_user_role() = 'ADMINISTRATOR');
create policy dosifier_types_admin_update on public.dosifier_types for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR') with check (private.current_user_role() = 'ADMINISTRATOR');
create policy stop_categories_admin_insert on public.stop_categories for insert to authenticated
  with check (private.current_user_role() = 'ADMINISTRATOR');
create policy stop_categories_admin_update on public.stop_categories for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR') with check (private.current_user_role() = 'ADMINISTRATOR');

create policy reports_select_by_role on public.production_reports
  for select to authenticated
  using (
    private.current_user_role() = 'ADMINISTRATOR'
    or (private.current_user_role() = 'OPERATOR' and created_by = (select auth.uid()))
    or (private.current_user_role() = 'VIEWER' and status = 'SUBMITTED')
  );
create policy reports_operator_insert on public.production_reports
  for insert to authenticated
  with check (
    private.current_user_role() = 'OPERATOR'
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and status = 'DRAFT'
    and exists (
      select 1 from public.operator_machine_assignments a
      join public.machines m on m.id = a.machine_id
      where a.operator_id = (select auth.uid())
        and a.machine_id = production_reports.machine_id
        and a.active and m.active
    )
  );
create policy reports_update_by_role on public.production_reports
  for update to authenticated
  using (
    private.current_user_role() = 'ADMINISTRATOR'
    or (private.current_user_role() = 'OPERATOR' and created_by = (select auth.uid()) and status = 'DRAFT')
  )
  with check (
    private.current_user_role() = 'ADMINISTRATOR'
    or (
      private.current_user_role() = 'OPERATOR'
      and created_by = (select auth.uid())
      and status in ('DRAFT', 'SUBMITTED')
    )
  );

create policy stops_select_by_report_access on public.report_stop_events
  for select to authenticated
  using (
    exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and (
          private.current_user_role() = 'ADMINISTRATOR'
          or (private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()))
          or (private.current_user_role() = 'VIEWER' and r.status = 'SUBMITTED')
        )
    )
  );
create policy stops_insert_by_role on public.report_stop_events
  for insert to authenticated
  with check (
    private.current_user_role() = 'ADMINISTRATOR'
    or (
      private.current_user_role() = 'OPERATOR'
      and responsible_user_id = (select auth.uid())
      and exists (
        select 1 from public.production_reports r
        where r.id = report_stop_events.report_id
          and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
      )
    )
  );
create policy stops_update_by_role on public.report_stop_events
  for update to authenticated
  using (
    private.current_user_role() = 'ADMINISTRATOR'
    or exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
        and private.current_user_role() = 'OPERATOR'
    )
  )
  with check (
    private.current_user_role() = 'ADMINISTRATOR'
    or (
      private.current_user_role() = 'OPERATOR'
      and responsible_user_id = (select auth.uid())
      and exists (
        select 1 from public.production_reports r
        where r.id = report_stop_events.report_id
          and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
      )
    )
  );
create policy stops_delete_by_role on public.report_stop_events
  for delete to authenticated
  using (
    private.current_user_role() = 'ADMINISTRATOR'
    or exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
        and private.current_user_role() = 'OPERATOR'
    )
  );

create policy audit_admin_select on public.report_audit_log
  for select to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
