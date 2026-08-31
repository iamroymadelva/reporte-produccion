do $$
declare
  conflict_field text;
  conflict_value text;
begin
  select candidate.field, candidate.normalized
  into conflict_field, conflict_value
  from (
    select 'machines.code' as field, lower(btrim(code)) as normalized from public.machines
    union all select 'machines.name', lower(btrim(name)) from public.machines
    union all select 'products.code', lower(btrim(code)) from public.products
    union all select 'products.name', lower(btrim(name)) from public.products
    union all select 'clients.code', lower(btrim(code)) from public.clients
    union all select 'clients.name', lower(btrim(name)) from public.clients
    union all select 'lines.code', lower(btrim(code)) from public.lines
    union all select 'lines.name', lower(btrim(name)) from public.lines
    union all select 'dosifier_types.code', lower(btrim(code)) from public.dosifier_types
    union all select 'dosifier_types.name', lower(btrim(name)) from public.dosifier_types
    union all select 'shifts.name', lower(btrim(name)) from public.shifts where name is not null
    union all select 'stop_categories.name', lower(btrim(name)) from public.stop_categories
    union all select 'stop_categories.numeric_code', numeric_code::text from public.stop_categories
  ) candidate
  group by candidate.field, candidate.normalized
  having count(*) > 1
  order by candidate.field, candidate.normalized
  limit 1;

  if conflict_field is not null then
    raise exception 'Conflicto de unicidad existente en % para el valor normalizado %. Debe resolverse manualmente antes de aplicar la migración.', conflict_field, conflict_value;
  end if;

  select candidate.field
  into conflict_field
  from (
    select 'machines.code' as field, code as value from public.machines
    union all select 'machines.name', name from public.machines
    union all select 'products.code', code from public.products
    union all select 'products.name', name from public.products
    union all select 'clients.code', code from public.clients
    union all select 'clients.name', name from public.clients
    union all select 'lines.code', code from public.lines
    union all select 'lines.name', name from public.lines
    union all select 'dosifier_types.code', code from public.dosifier_types
    union all select 'dosifier_types.name', name from public.dosifier_types
    union all select 'shifts.name', name from public.shifts where name is not null
    union all select 'stop_categories.name', name from public.stop_categories
  ) candidate
  where btrim(candidate.value) = ''
  order by candidate.field
  limit 1;

  if conflict_field is not null then
    raise exception 'Valor vacío existente en %. Debe resolverse manualmente antes de aplicar la migración.', conflict_field;
  end if;
end;
$$;

alter table public.machines
  add constraint machines_code_not_blank check (btrim(code) <> ''),
  add constraint machines_name_not_blank check (btrim(name) <> '');
alter table public.products
  add constraint products_code_not_blank check (btrim(code) <> ''),
  add constraint products_name_not_blank check (btrim(name) <> '');
alter table public.clients
  add constraint clients_code_not_blank check (btrim(code) <> ''),
  add constraint clients_name_not_blank check (btrim(name) <> '');
alter table public.lines
  add constraint lines_code_not_blank check (btrim(code) <> ''),
  add constraint lines_name_not_blank check (btrim(name) <> '');
alter table public.dosifier_types
  add constraint dosifier_types_code_not_blank check (btrim(code) <> ''),
  add constraint dosifier_types_name_not_blank check (btrim(name) <> '');
alter table public.stop_categories
  add constraint stop_categories_name_not_blank check (btrim(name) <> '');

create unique index machines_code_normalized_unique on public.machines (lower(btrim(code)));
create unique index machines_name_normalized_unique on public.machines (lower(btrim(name)));
create unique index products_code_normalized_unique on public.products (lower(btrim(code)));
create unique index clients_code_normalized_unique on public.clients (lower(btrim(code)));
create unique index lines_code_normalized_unique on public.lines (lower(btrim(code)));
create unique index lines_name_normalized_unique on public.lines (lower(btrim(name)));
create unique index dosifier_types_code_normalized_unique on public.dosifier_types (lower(btrim(code)));
create unique index dosifier_types_name_normalized_unique on public.dosifier_types (lower(btrim(name)));
create unique index shifts_name_normalized_unique on public.shifts (lower(btrim(name))) where name is not null;
create unique index stop_categories_numeric_code_unique on public.stop_categories (numeric_code);
create unique index stop_categories_name_normalized_unique on public.stop_categories (lower(btrim(name)));
