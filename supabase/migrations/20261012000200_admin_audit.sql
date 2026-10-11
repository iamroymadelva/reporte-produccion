-- Fase F3 / T061: auditoría administrativa completa (feature 001, FR-029a, US3).
-- Un único trigger genérico (private.audit_admin_entity) registra INSERT/UPDATE/DELETE sobre las tablas
-- administrativas en administrative_audit_log (que solo lee ROOT). Reemplaza audit_administrative_deletion.
--
-- Acciones: INSERT, UPDATE, DELETE; DEACTIVATE / REACTIVATE cuando lo único que cambia es `active`.
-- old_value / new_value: en UPDATE solo los campos que cambian; se excluyen updated_at, updated_by y los
-- campos sensibles (password, token, secret, ...). Un UPDATE sin cambios auditables no genera fila.
-- performed_by / actor_role: app.actor_id (fijado por manage_user_assignments, que corre con service_role)
-- o auth.uid(); nulos cuando escribe el sistema (service_role directo, migraciones, SQL manual).
--
-- REGLA ANTI-DUPLICADOS: manage_user_assignments ya escribe filas semánticas (USER_CREATED, UPDATE,
-- REMOVE_USER, REACTIVATE_USER, PASSWORD_RESET, FORCE_DEACTIVATE). Mientras corre, fija
-- app.admin_semantic_audit='1' (local a la transacción) y el trigger genérico OMITE profiles y
-- operator_machine_assignments. handle_new_user (alta técnica del perfil en auth.users) hace lo mismo:
-- el alta se audita como USER_CREATED. El resto de escrituras (catálogos, máquinas, turnos, cambios,
-- app_settings, y profiles/asignaciones escritos fuera de esas rutas) sí pasan por el trigger.

create or replace function private.audit_admin_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_excluded constant text[] := array[
    'updated_at', 'updated_by', 'password', 'encrypted_password', 'password_hash', 'token', 'secret', 'api_key'
  ];
  v_skip constant text[] := array['profiles', 'operator_machine_assignments'];
  v_actor uuid;
  v_role public.app_role;
  v_old jsonb;
  v_new jsonb;
  v_old_diff jsonb := '{}'::jsonb;
  v_new_diff jsonb := '{}'::jsonb;
  v_action text := tg_op;
  v_row jsonb;
  v_label text;
  v_id text;
  item record;
begin
  if tg_table_name = any (v_skip) and coalesce(current_setting('app.admin_semantic_audit', true), '') = '1' then
    return null;
  end if;

  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id := case when tg_table_name = 'app_settings' then 'app_settings'
    else coalesce(v_row ->> 'id', v_row ->> 'operator_id') end;
  v_label := coalesce(v_row ->> 'username', v_row ->> 'name', v_row ->> 'code');
  if tg_table_name = 'operator_machine_assignments' then
    select p.username into v_label from public.profiles p where p.id = (v_row ->> 'operator_id')::uuid;
  elsif tg_table_name = 'app_settings' then
    v_label := 'Configuración de la aplicación';
  end if;

  v_actor := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, (select auth.uid()));
  if v_actor is not null then
    select p.role into v_role from public.profiles p where p.id = v_actor;
    if not found then v_actor := null; end if;
  end if;

  if tg_op = 'INSERT' then
    v_new_diff := to_jsonb(new) - v_excluded;
  elsif tg_op = 'DELETE' then
    v_old_diff := to_jsonb(old) - v_excluded;
  else
    v_old := to_jsonb(old) - v_excluded;
    v_new := to_jsonb(new) - v_excluded;
    for item in select key, value from jsonb_each(v_new)
    loop
      if v_old -> item.key is distinct from item.value then
        v_old_diff := v_old_diff || jsonb_build_object(item.key, v_old -> item.key);
        v_new_diff := v_new_diff || jsonb_build_object(item.key, item.value);
      end if;
    end loop;
    if v_new_diff = '{}'::jsonb then
      return null;
    end if;
    if (select count(*) from jsonb_object_keys(v_new_diff)) = 1 and v_new_diff ? 'active' then
      v_action := case when (v_new_diff ->> 'active')::boolean then 'REACTIVATE' else 'DEACTIVATE' end;
    end if;
  end if;

  insert into public.administrative_audit_log
    (action, entity_type, entity_id, entity_label, performed_by, actor_role, old_value, new_value)
  values (
    v_action, tg_table_name, v_id, v_label, v_actor, v_role,
    case when tg_op = 'INSERT' then null else v_old_diff end,
    case when tg_op = 'DELETE' then null else v_new_diff end
  );
  return null;
end;
$$;

revoke all on function private.audit_admin_entity() from public;

-- Fuera los triggers de borrado antiguos.
drop trigger machines_audit_delete on public.machines;
drop trigger lines_audit_delete on public.lines;
drop trigger clients_audit_delete on public.clients;
drop trigger products_audit_delete on public.products;
drop trigger dosifier_types_audit_delete on public.dosifier_types;
drop trigger shifts_audit_delete on public.shifts;
drop trigger stop_categories_audit_delete on public.stop_categories;
drop trigger change_types_audit_delete on public.change_types;
drop function private.audit_administrative_deletion();

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'machines', 'operator_machine_assignments', 'lines', 'clients', 'products',
    'dosifier_types', 'shifts', 'stop_categories', 'change_types', 'app_settings'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_admin_entity()',
      t || '_admin_audit', t);
  end loop;
end;
$$;

-- handle_new_user: el alta técnica del perfil no se audita aparte (se audita como USER_CREATED).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text := coalesce(current_setting('app.admin_semantic_audit', true), '');
begin
  perform set_config('app.admin_semantic_audit', '1', true);
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
  perform set_config('app.admin_semantic_audit', v_previous, true);
  return new;
end;
$$;

-- manage_user_assignments: mismo cuerpo que 20261011000200, más las GUC anti-duplicados.
create or replace function public.manage_user_assignments(
  p_target uuid,
  p_actor uuid,
  p_profile jsonb default null,
  p_assignments jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.app_role;
  v_target public.profiles%rowtype;
  v_action text := coalesce(nullif(p_profile ->> 'audit_action', ''), 'UPDATE');
  v_new_role public.app_role;
  v_new_active boolean;
  v_draft uuid;
  v_pending bigint;
  v_devices bigint;
  v_last_seen timestamptz;
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_rows jsonb;
  v_before_machines uuid[] := '{}';
  v_after_machines uuid[] := '{}';
  v_added_machines uuid[] := '{}';
  v_removed_machines uuid[] := '{}';
  v_added_pairs integer := 0;
  v_removed_pairs integer := 0;
  v_event_id uuid;
  v_after public.profiles%rowtype;
  v_force text := nullif(btrim(p_profile ->> 'force_reason'), '');
  v_forced boolean := false;
begin
  if current_setting('request.jwt.claims', true)::jsonb ->> 'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if v_action not in ('USER_CREATED', 'UPDATE', 'REMOVE_USER', 'REACTIVATE_USER', 'PASSWORD_RESET') then
    raise exception 'Invalid audit action';
  end if;

  select role into v_actor_role from public.profiles
  where id = p_actor and role in ('ROOT', 'ADMINISTRATOR') and active and removed_at is null;
  if v_actor_role is null then
    raise exception 'Invalid administrator' using errcode = '42501';
  end if;
  -- T061: evita duplicados con el trigger genérico y atribuye las escrituras al actor.
  perform set_config('app.admin_semantic_audit', '1', true);
  perform set_config('app.actor_id', p_actor::text, true);

  select * into v_target from public.profiles where id = p_target for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  v_new_role := case when v_action = 'PASSWORD_RESET' then v_target.role
    else coalesce((p_profile ->> 'role')::public.app_role, v_target.role) end;
  v_new_active := case
    when v_action = 'PASSWORD_RESET' then v_target.active
    when v_action = 'REMOVE_USER' then false
    when v_action = 'REACTIVATE_USER' then true
    when p_profile ? 'active' then (p_profile ->> 'active')::boolean
    else v_target.active end;

  -- Matriz de gestión (FR-028): ROOT gestiona todo; el coordinador solo operarios y solo con rol OPERATOR.
  if v_actor_role <> 'ROOT' and (v_target.role <> 'OPERATOR' or v_new_role <> 'OPERATOR') then
    raise exception 'Management not permitted' using errcode = '42501';
  end if;
  -- Nadie se desactiva, retira ni cambia su propio rol (protege la invariante de ROOT).
  if p_target = p_actor and (v_new_role <> v_target.role or not v_new_active) then
    raise exception 'Management not permitted' using errcode = '42501';
  end if;

  -- T113: solo ROOT puede forzar, con un motivo de al menos 10 caracteres.
  if p_profile ? 'force_reason' and v_action <> 'PASSWORD_RESET' then
    if v_actor_role <> 'ROOT' then
      raise exception 'Only ROOT may force' using errcode = '42501';
    end if;
    if v_force is null or char_length(v_force) < 10 then
      raise exception 'Force reason must have at least 10 characters' using errcode = '22023';
    end if;
  end if;

  -- FR-005a: no se desactiva ni se retira con un DRAFT o con pendientes por subir.
  if v_action <> 'PASSWORD_RESET' and not v_new_active and (v_target.active or v_action = 'REMOVE_USER') then
    select id into v_draft from public.production_reports
    where created_by = p_target and status = 'DRAFT' order by started_at desc limit 1;
    select coalesce(sum(pending_count), 0), count(*) filter (where pending_count > 0), max(last_seen_at)
      into v_pending, v_devices, v_last_seen
    from public.device_sync_status where user_id = p_target;
    if (v_draft is not null or v_pending > 0) and v_force is not null then
      v_forced := true;
    elsif v_draft is not null or v_pending > 0 then
      raise exception 'USER_HAS_PENDING_DATA' using errcode = 'P0004',
        detail = jsonb_build_object('activeReportId', v_draft, 'pendingDevices', v_devices, 'lastSeenAt', v_last_seen)::text;
    end if;
  end if;

  if v_action <> 'PASSWORD_RESET' then
    update public.profiles set
      full_name = coalesce(nullif(btrim(p_profile ->> 'full_name'), ''), full_name),
      job_title = case when p_profile ? 'job_title' then nullif(btrim(p_profile ->> 'job_title'), '') else job_title end,
      role = v_new_role,
      active = v_new_active,
      removed_at = case when v_action = 'REMOVE_USER' then now() when v_new_active then null else removed_at end,
      removed_by = case when v_action = 'REMOVE_USER' then p_actor when v_new_active then null else removed_by end,
      created_by = case when v_action = 'USER_CREATED' then p_actor else created_by end,
      possible_unsynced_data = possible_unsynced_data or v_forced
    where id = p_target;
  end if;

  if p_assignments is not null and v_action <> 'PASSWORD_RESET' then
    if jsonb_typeof(p_assignments) <> 'array' then
      raise exception 'Assignments must be an array';
    end if;
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
      select distinct on (x.mid, x.sid) x.mid as machine_id, x.sid as shift_id, x.vf as valid_from, x.vt as valid_to,
        x.hf as has_from, x.ht as has_to
      from (
        select (e ->> 'machine_id')::uuid as mid, (e ->> 'shift_id')::uuid as sid,
          nullif(e ->> 'valid_from', '')::date as vf, nullif(e ->> 'valid_to', '')::date as vt,
          (e ? 'valid_from') as hf, (e ? 'valid_to') as ht
        from jsonb_array_elements(p_assignments) e
      ) x
      order by x.mid, x.sid, x.vf desc nulls last
    ) r;

    if jsonb_array_length(v_rows) > 0 and (v_new_role <> 'OPERATOR' or not v_new_active) then
      raise exception 'Only active operators may have assignments';
    end if;
    if exists (select 1 from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean)
      where a.valid_to is not null and a.valid_to < coalesce(a.valid_from, v_today)) then
      raise exception 'Invalid validity range';
    end if;
    if exists (select 1 from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean)
      left join public.machines m on m.id = a.machine_id and m.active where m.id is null) then
      raise exception 'Only active machines may be assigned';
    end if;
    if exists (select 1 from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean)
      left join public.shifts s on s.id = a.shift_id and s.active where s.id is null) then
      raise exception 'Only active shifts may be assigned';
    end if;

    select coalesce(array_agg(distinct machine_id order by machine_id), '{}'::uuid[]) into v_before_machines
    from public.operator_machine_assignments where operator_id = p_target and active;
    select coalesce(array_agg(distinct a.machine_id order by a.machine_id), '{}'::uuid[]) into v_after_machines
    from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean);

    select count(*) into v_added_pairs
    from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean)
    where not exists (select 1 from public.operator_machine_assignments o
      where o.operator_id = p_target and o.active and o.machine_id = a.machine_id and o.shift_id = a.shift_id);
    select count(*) into v_removed_pairs
    from public.operator_machine_assignments o
    where o.operator_id = p_target and o.active and not exists (
      select 1 from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean)
      where a.machine_id = o.machine_id and a.shift_id = o.shift_id);

    update public.operator_machine_assignments o set active = false
    where o.operator_id = p_target and o.active and not exists (
      select 1 from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean)
      where a.machine_id = o.machine_id and a.shift_id = o.shift_id);
    -- Asignaciones que se conservan: una clave de vigencia AUSENTE conserva el valor existente; solo las claves
    -- presentes lo sobrescriben (valid_to presente y null = sin fin; valid_from null = sin cambio).
    update public.operator_machine_assignments o set
      valid_from = case when a.has_from and a.valid_from is not null then a.valid_from else o.valid_from end,
      valid_to = case when a.has_to then a.valid_to else o.valid_to end
    from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean)
    where o.operator_id = p_target and o.active and o.machine_id = a.machine_id and o.shift_id = a.shift_id
      and (o.valid_from, o.valid_to) is distinct from (
        case when a.has_from and a.valid_from is not null then a.valid_from else o.valid_from end,
        case when a.has_to then a.valid_to else o.valid_to end);
    insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, valid_to, active, created_by)
    select p_target, a.machine_id, a.shift_id, coalesce(a.valid_from, v_today), a.valid_to, true, p_actor
    from jsonb_to_recordset(v_rows) a(machine_id uuid, shift_id uuid, valid_from date, valid_to date, has_from boolean, has_to boolean)
    where not exists (select 1 from public.operator_machine_assignments o
      where o.operator_id = p_target and o.active and o.machine_id = a.machine_id and o.shift_id = a.shift_id);

    select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_added_machines
    from unnest(v_after_machines) x where x <> all(v_before_machines);
    select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_removed_machines
    from unnest(v_before_machines) x where x <> all(v_after_machines);

    if (v_added_pairs > 0 or v_removed_pairs > 0) and exists (
      select 1 from public.profiles where id = p_target and active and removed_at is null and role = 'OPERATOR') then
      insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
      values ('assignment:' || p_target || ':' || txid_current(), 'ASSIGNMENTS_CHANGED', 'assignment', p_target, p_actor,
        'Asignaciones actualizadas',
        'Asignaciones añadidas: ' || v_added_pairs || '. Asignaciones retiradas: ' || v_removed_pairs || '.', '/reportes')
      returning id into v_event_id;
      insert into public.notification_deliveries(event_id, recipient_id) values (v_event_id, p_target);
    end if;
  end if;

  select * into v_after from public.profiles where id = p_target;
  -- Invariante FR-005: siempre existe al menos un ROOT activo (además del trigger diferido).
  if not exists (select 1 from public.profiles where role = 'ROOT' and active) then
    raise exception 'Debe existir al menos un administrador raíz activo' using errcode = '23514';
  end if;

  -- Auditoría administrativa (nunca se guardan contraseñas).
  insert into public.administrative_audit_log
    (action, entity_type, entity_id, entity_label, performed_by, actor_role, details, old_value, new_value)
  values (
    v_action, 'profiles', p_target::text, v_after.full_name, p_actor, v_actor_role,
    jsonb_build_object('username', v_target.username, 'added_machine_ids', v_added_machines,
      'removed_machine_ids', v_removed_machines, 'added_assignments', v_added_pairs, 'removed_assignments', v_removed_pairs),
    case when v_action = 'PASSWORD_RESET' then null else
      jsonb_build_object('role', v_target.role, 'active', v_target.active, 'full_name', v_target.full_name, 'job_title', v_target.job_title) end,
    case when v_action = 'PASSWORD_RESET' then null else
      jsonb_build_object('role', v_after.role, 'active', v_after.active, 'full_name', v_after.full_name, 'job_title', v_after.job_title) end
  );

  if v_forced then
    insert into public.administrative_audit_log
      (action, entity_type, entity_id, entity_label, performed_by, actor_role, details, new_value)
    values ('FORCE_DEACTIVATE', 'profiles', p_target::text, v_after.full_name, p_actor, v_actor_role,
      jsonb_build_object('username', v_target.username, 'performed_action', v_action),
      jsonb_build_object('reason', v_force, 'pendingCount', v_pending, 'pendingDevices', v_devices, 'activeReportId', v_draft));
  end if;

  perform set_config('app.admin_semantic_audit', '', true);
  perform set_config('app.actor_id', '', true);

  return jsonb_build_object('added', v_added_machines, 'removed', v_removed_machines,
    'added_assignments', v_added_pairs, 'removed_assignments', v_removed_pairs);
end;
$$;

revoke all on function public.manage_user_assignments(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.manage_user_assignments(uuid, uuid, jsonb, jsonb) to service_role;
