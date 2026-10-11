-- Fase F1 / T013: helpers de rol, username, invariante ROOT, login_attempts,
-- asignaciones por turno y resolución de turno (feature 001).

-- ---------------------------------------------------------------------------
-- Helpers de rol (ROOT y ADMINISTRATOR son "managers"; ADMINISTRATOR = coordinador).
-- ---------------------------------------------------------------------------
create function private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_user_role() in ('ROOT', 'ADMINISTRATOR'), false);
$$;

create function private.is_root()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_user_role() = 'ROOT', false);
$$;

revoke all on function private.is_manager() from public;
revoke all on function private.is_root() from public;
grant execute on function private.is_manager() to authenticated;
grant execute on function private.is_root() to authenticated;

-- ---------------------------------------------------------------------------
-- profiles.username (único, minúsculas, inmutable) y profiles.created_by
-- ---------------------------------------------------------------------------
-- Normaliza un texto a un username candidato válido: minúsculas, caracteres
-- inválidos reemplazados por "_", relleno con "0" hasta 3 y truncado a 32.
create function private.normalize_username(p_base text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    case
      when length(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9._-]', '_', 'g')) < 3
        then rpad(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9._-]', '_', 'g'), 3, '0')
      else regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9._-]', '_', 'g')
    end,
    32
  );
$$;

-- Devuelve un username libre a partir de una base, con sufijo numérico si hay colisión.
create function private.unique_username(p_base text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_base text := private.normalize_username(p_base);
  v_candidate text := v_base;
  v_suffix integer := 1;
begin
  while exists (select 1 from public.profiles where username = v_candidate) loop
    v_suffix := v_suffix + 1;
    v_candidate := left(v_base, 32 - length(v_suffix::text)) || v_suffix::text;
  end loop;
  return v_candidate;
end;
$$;

revoke all on function private.normalize_username(text) from public;
revoke all on function private.unique_username(text) from public;

alter table public.profiles
  add column username text,
  add column created_by uuid references public.profiles(id) on delete set null;

-- Backfill desde la parte local del correo actual (sin tocar updated_at).
alter table public.profiles disable trigger user;
do $$
declare
  r record;
begin
  for r in
    select p.id, u.email
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at, p.id
  loop
    update public.profiles
    set username = private.unique_username(split_part(coalesce(r.email, ''), '@', 1))
    where id = r.id;
  end loop;
end;
$$;
alter table public.profiles enable trigger user;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,32}$');
create unique index profiles_username_unique on public.profiles (username);

create function private.protect_profile_username()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is distinct from old.username then
    raise exception 'El nombre de usuario no puede modificarse' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger profiles_protect_username before update on public.profiles
  for each row execute function private.protect_profile_username();
revoke all on function private.protect_profile_username() from public;

-- Los usuarios nuevos de auth reciben username (metadata `username` o parte local del correo).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, full_name, role, active)
  values (
    new.id,
    private.unique_username(
      coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1))
    ),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    'OPERATOR',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invariante: siempre existe al menos un ROOT activo (se evalúa al hacer commit).
-- Solo se dispara cuando se modifica o borra un ROOT activo.
-- ---------------------------------------------------------------------------
create function private.ensure_active_root()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles where role = 'ROOT' and active
  ) then
    raise exception 'Debe existir al menos un administrador raíz activo'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.ensure_active_root() from public;

create constraint trigger profiles_ensure_active_root
  after update or delete on public.profiles
  deferrable initially deferred
  for each row
  when (old.role = 'ROOT' and old.active)
  execute function private.ensure_active_root();

-- ---------------------------------------------------------------------------
-- Intentos de inicio de sesión (las funciones llegan en la Fase 3).
-- ---------------------------------------------------------------------------
create table private.login_attempts (
  username text primary key,
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.login_attempts enable row level security;
revoke all on private.login_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Asignaciones por turno con vigencia.
-- ---------------------------------------------------------------------------
alter table public.operator_machine_assignments disable trigger user;

alter table public.operator_machine_assignments drop constraint operator_machine_assignments_pkey;
alter table public.operator_machine_assignments
  add column id uuid not null default gen_random_uuid(),
  add column shift_id uuid references public.shifts(id) on delete restrict,
  add column valid_from date not null default ((now() at time zone 'America/Bogota')::date),
  add column valid_to date;

-- Cada asignación activa existente se expande a una fila por turno activo,
-- vigente desde la fecha de su creación.
insert into public.operator_machine_assignments
  (operator_id, machine_id, shift_id, active, created_by, created_at, updated_at, valid_from)
select a.operator_id, a.machine_id, s.id, true, a.created_by, a.created_at, a.updated_at,
  (a.created_at at time zone 'America/Bogota')::date
from public.operator_machine_assignments a
cross join public.shifts s
where a.active and a.shift_id is null and s.active;

delete from public.operator_machine_assignments where active and shift_id is null;

-- Las asignaciones inactivas (historial) conservan una sola fila con el primer turno.
update public.operator_machine_assignments a
set shift_id = (select id from public.shifts order by sort_order, start_time limit 1),
    valid_from = (a.created_at at time zone 'America/Bogota')::date,
    valid_to = greatest((a.created_at at time zone 'America/Bogota')::date,
                        (a.updated_at at time zone 'America/Bogota')::date)
where a.shift_id is null;

alter table public.operator_machine_assignments disable trigger user;
alter table public.operator_machine_assignments
  alter column shift_id set not null,
  add primary key (id),
  add constraint operator_machine_assignments_validity check (valid_to is null or valid_to >= valid_from);
alter table public.operator_machine_assignments enable trigger user;

create unique index operator_machine_assignments_active_unique
  on public.operator_machine_assignments (operator_id, machine_id, shift_id)
  where active;
create index operator_machine_assignments_lookup_idx
  on public.operator_machine_assignments (operator_id, shift_id, machine_id);

-- El RPC vigente (Fase 4 lo reemplaza) sigue funcionando con el esquema nuevo:
-- cada máquina indicada se asigna en TODOS los turnos activos.
create or replace function public.replace_operator_assignments(
  p_operator_id uuid, p_machine_ids uuid[], p_actor_id uuid,
  p_profile jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before uuid[];
v_after uuid[];
v_added uuid[];
v_removed uuid[];
v_event_id uuid;
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles
    where id = p_actor_id and role in ('ROOT', 'ADMINISTRATOR') and active and removed_at is null) then
    raise exception 'Invalid administrator' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = p_operator_id for update;
  if not found then raise exception 'Operator not found'; end if;
  select coalesce(array_agg(distinct machine_id order by machine_id), '{}'::uuid[]) into v_before
  from public.operator_machine_assignments where operator_id = p_operator_id and active;
  select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_after from unnest(coalesce(p_machine_ids, '{}'::uuid[])) x;
  if exists (select 1 from unnest(v_after) x left join public.machines m on m.id = x and m.active where m.id is null) then
    raise exception 'Only active machines may be assigned';
  end if;
  if p_profile is not null then
    update public.profiles set
      full_name = coalesce(p_profile->>'full_name', full_name),
      job_title = case when p_profile ? 'job_title' then p_profile->>'job_title' else job_title end,
      role = coalesce((p_profile->>'role')::public.app_role, role),
      active = coalesce((p_profile->>'active')::boolean, active),
      removed_at = case when p_profile ? 'removed_at' then (p_profile->>'removed_at')::timestamptz else removed_at end,
      removed_by = case when p_profile ? 'removed_by' then (p_profile->>'removed_by')::uuid else removed_by end
    where id = p_operator_id;
  end if;
  update public.operator_machine_assignments set active = false
  where operator_id = p_operator_id and active and machine_id <> all(v_after);
  insert into public.operator_machine_assignments(operator_id, machine_id, shift_id, active, created_by)
  select p_operator_id, x, s.id, true, p_actor_id
  from unnest(v_after) x cross join public.shifts s
  where s.active
    and not exists (
      select 1 from public.operator_machine_assignments a
      where a.operator_id = p_operator_id and a.machine_id = x and a.shift_id = s.id and a.active
    );
  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_added
  from unnest(v_after) x where x <> all(v_before);
  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_removed
  from unnest(v_before) x where x <> all(v_after);
  if (cardinality(v_added) > 0 or cardinality(v_removed) > 0)
    and exists (select 1 from public.profiles where id = p_operator_id and active and removed_at is null and role = 'OPERATOR') then
    insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
    values ('assignment:' || p_operator_id || ':' || txid_current(), 'ASSIGNMENTS_CHANGED', 'assignment', p_operator_id, p_actor_id,
      'Asignaciones actualizadas',
      'Máquinas añadidas: ' || cardinality(v_added) || '. Máquinas retiradas: ' || cardinality(v_removed) || '.', '/reportes')
    returning id into v_event_id;
    insert into public.notification_deliveries(event_id, recipient_id) values (v_event_id, p_operator_id);
  end if;
  if p_profile->>'audit_action' in ('REACTIVATE_USER', 'REMOVE_USER') then
    insert into public.administrative_audit_log(action, entity_type, entity_id, entity_label, performed_by, details)
    select p_profile->>'audit_action', 'profiles', p_operator_id::text, full_name, p_actor_id,
      jsonb_build_object('added_machine_ids', v_added, 'removed_machine_ids', v_removed)
    from public.profiles where id = p_operator_id;
  end if;
  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$$;

revoke all on function public.replace_operator_assignments(uuid,uuid[],uuid,jsonb) from public, anon, authenticated;
grant execute on function public.replace_operator_assignments(uuid,uuid[],uuid,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Turno vigente en America/Bogota. Los turnos que cruzan medianoche pertenecen
-- al día en que empiezan (fecha operativa).
-- ---------------------------------------------------------------------------
create function private.current_shift_at(ts timestamptz)
returns table (shift_id uuid, operational_date date, shift_end timestamptz)
language sql
stable
set search_path = ''
as $$
  select
    s.id,
    x.op_date,
    ((x.op_date + case when s.start_time < s.end_time then 0 else 1 end) + s.end_time)
      at time zone 'America/Bogota'
  from public.shifts s
  cross join lateral (select ts at time zone 'America/Bogota' as lt) l
  cross join lateral (
    select case
      when s.start_time < s.end_time then l.lt::date
      when l.lt::time >= s.start_time then l.lt::date
      else l.lt::date - 1
    end as op_date
  ) x
  where s.active
    and (
      (s.start_time < s.end_time and l.lt::time >= s.start_time and l.lt::time < s.end_time)
      or (s.start_time >= s.end_time and (l.lt::time >= s.start_time or l.lt::time < s.end_time))
    )
  order by s.sort_order, s.start_time
  limit 1;
$$;

revoke all on function private.current_shift_at(timestamptz) from public;
grant execute on function private.current_shift_at(timestamptz) to authenticated;
