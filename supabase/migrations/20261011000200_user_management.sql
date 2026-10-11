-- Fase F2 / T034: administración de usuarios con jerarquía raíz (feature 001, US4).
-- - public.manage_user_assignments (reemplaza public.replace_operator_assignments).
-- - public.user_last_contact y public.report_device_sync_status (FR-005a).

-- ---------------------------------------------------------------------------
-- manage_user_assignments: perfil + asignaciones máquina × turno + auditoría (solo service_role).
--
-- p_profile (jsonb, opcional): full_name, job_title, role, active y audit_action
--   (USER_CREATED | UPDATE | REMOVE_USER | REACTIVATE_USER | PASSWORD_RESET).
--   REMOVE_USER fija active=false y removed_at/removed_by; REACTIVATE_USER y active=true los limpian.
--   PASSWORD_RESET solo valida la matriz y audita (la contraseña nunca llega a la base de datos).
-- p_assignments (jsonb array, opcional): [{machine_id, shift_id, valid_from, valid_to}]. null = sin cambios.
-- ---------------------------------------------------------------------------
-- T113: marca de perfiles desactivados/retirados por ROOT pese a datos pendientes (FR-005a).
alter table public.profiles add column possible_unsynced_data boolean not null default false;

create function public.manage_user_assignments(
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

  return jsonb_build_object('added', v_added_machines, 'removed', v_removed_machines,
    'added_assignments', v_added_pairs, 'removed_assignments', v_removed_pairs);
end;
$$;

revoke all on function public.manage_user_assignments(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.manage_user_assignments(uuid, uuid, jsonb, jsonb) to service_role;

drop function public.replace_operator_assignments(uuid, uuid[], uuid, jsonb);

-- ---------------------------------------------------------------------------
-- user_last_contact: aviso previo a desactivar (FR-005a). Managers según la matriz.
-- ---------------------------------------------------------------------------
create function public.user_last_contact(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  if not private.is_manager() then
    raise exception 'Management not permitted' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_user;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if not private.is_root() and v_role <> 'OPERATOR' then
    raise exception 'Management not permitted' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'lastSeenAt', (select max(last_seen_at) from public.device_sync_status where user_id = p_user),
    'pendingCount', (select coalesce(sum(pending_count), 0)::integer from public.device_sync_status where user_id = p_user),
    'activeReportId', (select id from public.production_reports
      where created_by = p_user and status = 'DRAFT' order by started_at desc limit 1)
  );
end;
$$;

revoke all on function public.user_last_contact(uuid) from public, anon, authenticated;
grant execute on function public.user_last_contact(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- report_device_sync_status: el dispositivo informa sus pendientes. Solo escribe la fila de auth.uid().
-- ---------------------------------------------------------------------------
create function public.report_device_sync_status(
  p_device_id uuid,
  p_pending_count integer,
  p_oldest_pending_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null or not private.current_user_is_active() then
    raise exception 'Active user required' using errcode = '42501';
  end if;
  if p_device_id is null or p_pending_count is null or p_pending_count < 0 then
    raise exception 'Invalid device status' using errcode = '22023';
  end if;
  insert into public.device_sync_status (user_id, device_id, pending_count, oldest_pending_at, last_seen_at)
  values (v_user, p_device_id, p_pending_count, p_oldest_pending_at, clock_timestamp())
  on conflict (user_id, device_id) do update set
    pending_count = excluded.pending_count,
    oldest_pending_at = excluded.oldest_pending_at,
    last_seen_at = excluded.last_seen_at;
end;
$$;

revoke all on function public.report_device_sync_status(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.report_device_sync_status(uuid, integer, timestamptz) to authenticated;
