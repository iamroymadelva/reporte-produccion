alter table public.lines add column sort_order integer not null default 0;
alter table public.clients add column sort_order integer not null default 0;
alter table public.products add column sort_order integer not null default 0;
alter table public.dosifier_types add column sort_order integer not null default 0;

with ordered as (
  select id, row_number() over (order by code, name) * 10 as position from public.lines
)
update public.lines set sort_order = ordered.position from ordered where ordered.id = lines.id;

with ordered as (
  select id, row_number() over (order by name, code) * 10 as position from public.clients
)
update public.clients set sort_order = ordered.position from ordered where ordered.id = clients.id;

with ordered as (
  select id, row_number() over (order by name, code) * 10 as position from public.products
)
update public.products set sort_order = ordered.position from ordered where ordered.id = products.id;

with ordered as (
  select id, row_number() over (order by name, code) * 10 as position from public.dosifier_types
)
update public.dosifier_types set sort_order = ordered.position from ordered where ordered.id = dosifier_types.id;

create unique index clients_name_case_insensitive_unique on public.clients (lower(btrim(name)));
create unique index products_name_case_insensitive_unique on public.products (lower(btrim(name)));

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  name text,
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_name_not_blank check (name is null or btrim(name) <> '')
);

create trigger shifts_set_updated_at before update on public.shifts
  for each row execute function private.set_updated_at();

alter table public.production_reports
  add column client_name text,
  add column product_name text,
  add column shift_id uuid references public.shifts(id) on delete restrict;

alter table public.production_reports disable trigger audit_report_correction_after_update;

update public.production_reports report
set client_name = client.name
from public.clients client
where client.id = report.client_id and report.client_name is null;

update public.production_reports report
set product_name = product.name
from public.products product
where product.id = report.product_id and report.product_name is null;

alter table public.production_reports enable trigger audit_report_correction_after_update;

alter table public.production_reports
  add constraint production_reports_client_name_not_blank check (client_name is null or btrim(client_name) <> ''),
  add constraint production_reports_product_name_not_blank check (product_name is null or btrim(product_name) <> '');

alter table public.stop_categories
  add column numeric_code integer generated always as (
    case when code ~ '^[0-9]+$' then code::integer else null end
  ) stored,
  add constraint stop_categories_code_must_be_numeric check (code ~ '^[0-9]+$');

create or replace function private.validate_production_report()
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
      if new.ended_at is null then
        raise exception 'Debes registrar la hora de finalización antes de enviar el reporte';
      end if;

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

create function public.save_frequent_catalog_value(target_catalog text, entered_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := nullif(btrim(entered_name), '');
  existing_id uuid;
  generated_code text;
begin
  if not private.current_user_is_active()
    or private.current_user_role() not in ('ADMINISTRATOR', 'OPERATOR') then
    raise exception 'No autorizado para guardar valores frecuentes';
  end if;

  if normalized_name is null then
    raise exception 'El nombre frecuente es obligatorio';
  end if;

  if target_catalog = 'clients' then
    select id into existing_id from public.clients
    where lower(btrim(name)) = lower(normalized_name) limit 1;
    if existing_id is not null then return existing_id; end if;

    generated_code := 'CLI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.clients (code, name, sort_order)
    values (generated_code, normalized_name, (select coalesce(max(sort_order), 0) + 10 from public.clients))
    returning id into existing_id;
    return existing_id;
  elsif target_catalog = 'products' then
    select id into existing_id from public.products
    where lower(btrim(name)) = lower(normalized_name) limit 1;
    if existing_id is not null then return existing_id; end if;

    generated_code := 'PROD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.products (code, name, sort_order)
    values (generated_code, normalized_name, (select coalesce(max(sort_order), 0) + 10 from public.products))
    returning id into existing_id;
    return existing_id;
  end if;

  raise exception 'Catálogo frecuente no permitido';
end;
$$;

alter table public.shifts enable row level security;

grant select on public.shifts to authenticated;
grant insert, update on public.shifts to authenticated;
revoke all on function public.save_frequent_catalog_value(text, text) from public;
grant execute on function public.save_frequent_catalog_value(text, text) to authenticated;

create policy shifts_select on public.shifts
  for select to authenticated using (private.current_user_is_active());
create policy shifts_admin_insert on public.shifts
  for insert to authenticated with check (private.current_user_role() = 'ADMINISTRATOR');
create policy shifts_admin_update on public.shifts
  for update to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR')
  with check (private.current_user_role() = 'ADMINISTRATOR');

insert into public.shifts (name, start_time, end_time, sort_order) values
  ('Día', '06:00', '14:00', 10),
  ('Tarde', '14:00', '22:00', 20),
  ('Noche', '22:00', '06:00', 30);
