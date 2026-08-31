create table public.report_folio_counters (
  folio_year integer primary key,
  last_value bigint not null default 0 check (last_value >= 0)
);

alter table public.production_reports
  add column folio text,
  add column creator_full_name text,
  add column creator_job_title text,
  add column creator_role public.app_role;

alter table public.production_reports disable trigger audit_report_correction_after_update;

with numbered as (
  select
    id,
    extract(year from coalesce(report_date, created_at::date))::integer as folio_year,
    row_number() over (
      partition by extract(year from coalesce(report_date, created_at::date))::integer
      order by created_at, id
    ) as folio_number
  from public.production_reports
)
update public.production_reports report
set
  folio = format('RPT-%s-%s', numbered.folio_year, lpad(numbered.folio_number::text, 6, '0')),
  creator_full_name = profile.full_name,
  creator_job_title = profile.job_title,
  creator_role = profile.role
from numbered
join public.profiles profile on profile.id = (
  select created_by from public.production_reports source_report where source_report.id = numbered.id
)
where report.id = numbered.id;

insert into public.report_folio_counters (folio_year, last_value)
select
  extract(year from coalesce(report_date, created_at::date))::integer,
  count(*)
from public.production_reports
group by extract(year from coalesce(report_date, created_at::date))::integer;

alter table public.production_reports enable trigger audit_report_correction_after_update;

alter table public.production_reports
  alter column folio set not null,
  alter column creator_full_name set not null,
  alter column creator_role set not null,
  add constraint production_reports_folio_unique unique (folio),
  add constraint production_reports_folio_format check (folio ~ '^RPT-[0-9]{4}-[0-9]{6}$');

create function private.assign_report_folio_and_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_year integer;
  next_number bigint;
begin
  target_year := extract(year from coalesce(new.report_date, current_date))::integer;

  insert into public.report_folio_counters (folio_year, last_value)
  values (target_year, 1)
  on conflict (folio_year) do update
    set last_value = public.report_folio_counters.last_value + 1
  returning last_value into next_number;

  new.folio := format('RPT-%s-%s', target_year, lpad(next_number::text, 6, '0'));

  select full_name, job_title, role
  into new.creator_full_name, new.creator_job_title, new.creator_role
  from public.profiles
  where id = new.created_by;

  if new.creator_full_name is null or new.creator_role is null then
    raise exception 'No se encontró la identidad del creador del reporte';
  end if;

  return new;
end;
$$;

create trigger zz_assign_report_folio_and_identity_before_insert
  before insert on public.production_reports
  for each row execute function private.assign_report_folio_and_identity();

create function private.protect_report_folio_and_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.folio is distinct from old.folio
    or new.creator_full_name is distinct from old.creator_full_name
    or new.creator_job_title is distinct from old.creator_job_title
    or new.creator_role is distinct from old.creator_role then
    raise exception 'El folio y la identidad histórica del creador son inmutables';
  end if;
  return new;
end;
$$;

create trigger zz_protect_report_folio_and_identity_before_update
  before update on public.production_reports
  for each row execute function private.protect_report_folio_and_identity();

alter table public.profiles
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles(id) on delete restrict,
  add constraint profiles_removal_consistency check (
    (removed_at is null and removed_by is null)
    or (removed_at is not null and removed_by is not null and active = false)
  );

create table public.administrative_audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  entity_label text,
  performed_by uuid references public.profiles(id) on delete restrict,
  details jsonb,
  performed_at timestamptz not null default now()
);

create index administrative_audit_log_performed_at_idx
  on public.administrative_audit_log(performed_at desc);

alter table public.administrative_audit_log enable row level security;

grant select on public.administrative_audit_log to authenticated;
grant usage, select on sequence public.administrative_audit_log_id_seq to authenticated;

create policy administrative_audit_admin_select on public.administrative_audit_log
  for select to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');

create function private.audit_administrative_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_data jsonb := to_jsonb(old);
begin
  insert into public.administrative_audit_log (
    action,
    entity_type,
    entity_id,
    entity_label,
    performed_by,
    details
  ) values (
    'DELETE',
    tg_table_name,
    old_data ->> 'id',
    coalesce(old_data ->> 'name', old_data ->> 'code'),
    (select auth.uid()),
    old_data
  );
  return old;
end;
$$;

create trigger machines_audit_delete after delete on public.machines
  for each row execute function private.audit_administrative_deletion();
create trigger lines_audit_delete after delete on public.lines
  for each row execute function private.audit_administrative_deletion();
create trigger clients_audit_delete after delete on public.clients
  for each row execute function private.audit_administrative_deletion();
create trigger products_audit_delete after delete on public.products
  for each row execute function private.audit_administrative_deletion();
create trigger dosifier_types_audit_delete after delete on public.dosifier_types
  for each row execute function private.audit_administrative_deletion();
create trigger shifts_audit_delete after delete on public.shifts
  for each row execute function private.audit_administrative_deletion();
create trigger stop_categories_audit_delete after delete on public.stop_categories
  for each row execute function private.audit_administrative_deletion();

grant delete on public.machines, public.lines, public.clients, public.products,
  public.dosifier_types, public.shifts, public.stop_categories,
  public.operator_machine_assignments to authenticated;

create policy machines_admin_delete on public.machines for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
create policy lines_admin_delete on public.lines for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
create policy clients_admin_delete on public.clients for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
create policy products_admin_delete on public.products for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
create policy dosifier_types_admin_delete on public.dosifier_types for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
create policy shifts_admin_delete on public.shifts for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
create policy stop_categories_admin_delete on public.stop_categories for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
create policy assignments_admin_delete on public.operator_machine_assignments for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');
