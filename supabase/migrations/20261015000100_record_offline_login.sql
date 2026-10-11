-- Phase 8 (correcciones NO-GO) / FR-006c: auditoría de los inicios de sesión SIN conexión de TODOS los roles.
--
-- public.record_offline_login(p_operation_id, p_started_at): la llama el propio usuario autenticado y activo (cualquier
-- rol) desde la primera página en línea tras iniciar sesión sin conexión. Escribe una fila OFFLINE_LOGIN en
-- administrative_audit_log (actor = auth.uid(); solo ROOT la lee). Idempotente por operation_id (índice único),
-- rechaza horas a más de 5 minutos en el futuro y evita inundar la auditoría: devuelve `duplicate` si ya existe un
-- OFFLINE_LOGIN del mismo usuario con el mismo startedAt y rechaza (RATE_LIMITED) más de 20 por usuario y hora.
-- Sustituye a la operación OFFLINE_LOGIN del lote de sincronización (un solo camino, sin doble registro).

create unique index administrative_audit_log_offline_login_op_idx
  on public.administrative_audit_log ((details ->> 'operation_id'))
  where action = 'OFFLINE_LOGIN';

create function public.record_offline_login(p_operation_id uuid, p_started_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_profile public.profiles%rowtype;
  v_owner uuid;
begin
  if v_actor is null then
    return jsonb_build_object('status', 'rejected', 'code', 'FORBIDDEN', 'message', 'Debes iniciar sesión.');
  end if;
  v_role := private.current_user_role();
  if v_role is null then
    return jsonb_build_object('status', 'rejected', 'code', 'FORBIDDEN', 'message', 'El usuario no está activo.');
  end if;
  if p_operation_id is null or p_started_at is null then
    return jsonb_build_object('status', 'rejected', 'code', 'VALIDATION', 'message', 'Faltan la operación o la hora de inicio.');
  end if;
  if p_started_at > clock_timestamp() + interval '5 minutes' then
    return jsonb_build_object('status', 'rejected', 'code', 'VALIDATION', 'message', 'La hora del dispositivo está en el futuro.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('offline_login:' || v_actor::text, 0));

  select performed_by into v_owner from public.administrative_audit_log
  where action = 'OFFLINE_LOGIN' and details ->> 'operation_id' = p_operation_id::text;
  if found then
    if v_owner is distinct from v_actor then
      return jsonb_build_object('status', 'rejected', 'code', 'FORBIDDEN', 'message', 'La operación no pertenece a la sesión actual.');
    end if;
    return jsonb_build_object('status', 'duplicate');
  end if;

  if exists (
    select 1 from public.administrative_audit_log
    where action = 'OFFLINE_LOGIN' and performed_by = v_actor
      and (details ->> 'device_started_at')::timestamptz = p_started_at
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if (select count(*) from public.administrative_audit_log
      where action = 'OFFLINE_LOGIN' and performed_by = v_actor and performed_at > clock_timestamp() - interval '1 hour') >= 20 then
    return jsonb_build_object('status', 'rejected', 'code', 'RATE_LIMITED', 'message', 'Demasiados inicios de sesión sin conexión registrados.');
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  insert into public.administrative_audit_log
    (action, entity_type, entity_id, entity_label, performed_by, actor_role, details)
  values ('OFFLINE_LOGIN', 'profiles', v_actor::text, v_profile.full_name, v_actor, v_role,
    jsonb_build_object('username', v_profile.username, 'device_started_at', p_started_at,
      'received_at', clock_timestamp(), 'operation_id', p_operation_id::text));
  return jsonb_build_object('status', 'applied');
end;
$$;

revoke all on function public.record_offline_login(uuid, timestamptz) from public, anon;
grant execute on function public.record_offline_login(uuid, timestamptz) to authenticated;
