-- Fase F2 / T047: aprobación y cancelación por RPC security definer (feature 001, FR-010a, FR-024, FR-024b).
-- - approve_report(p_report_id): manager; SUBMITTED sin cuarentena OPEN -> CLOSED con approved_*.
-- - cancel_report(p_report_id, p_reason): autor OPERATOR sobre su DRAFT, o manager solo si el DRAFT está
--   "abierto fuera de turno" (fin de turno + app_settings.off_shift_grace, misma lógica que la vista).
-- Errores: el mensaje es el código estable (NOT_SUBMITTED, OPEN_CONFLICT, NOT_CANCELLABLE, NOT_FOUND) y el
-- texto en español viaja en DETAIL; 42501 FORBIDDEN y 22023 llevan mensaje en español.
-- Los parámetros llevan prefijo p_ para no chocar con las columnas report_id/reason dentro de plpgsql.

-- ---------------------------------------------------------------------------
-- Misma regla que production_report_overview.is_off_shift, reutilizable por RPC y triggers.
-- ---------------------------------------------------------------------------
create function private.report_is_off_shift(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.status = 'DRAFT'
      and sh.id is not null
      and now() > (((r.report_date + case when sh.start_time < sh.end_time then 0 else 1 end) + sh.end_time)
        at time zone 'America/Bogota') + cfg.off_shift_grace
    from public.production_reports r
    left join public.shifts sh on sh.id = r.shift_id
    cross join public.app_settings cfg
    where r.id = p_report_id
  ), false);
$$;
revoke all on function private.report_is_off_shift(uuid) from public;

-- ---------------------------------------------------------------------------
-- validate_production_report: SUBMITTED -> CLOSED solo desde approve_report (app.via_rpc = 'approve') y
-- DRAFT -> CANCELLED de un manager solo desde cancel_report (app.via_rpc = 'cancel') y fuera de turno.
-- ---------------------------------------------------------------------------
create or replace function private.validate_production_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role := private.current_user_role();
  v_is_manager boolean := coalesce(actor_role in ('ROOT', 'ADMINISTRATOR'), false);
  v_via_rpc text := coalesce(current_setting('app.via_rpc', true), '');
  v_shift_id uuid;
  v_operational_date date;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DRAFT' then
      raise exception 'Los reportes nuevos deben iniciar en borrador';
    end if;

    if new.created_by is null then
      new.created_by := actor_id;
    end if;
    new.updated_by := coalesce(actor_id, new.created_by);

    if new.started_at is null then
      raise exception 'La hora de inicio del reporte es obligatoria';
    end if;

    select c.shift_id, c.operational_date into v_shift_id, v_operational_date
    from private.current_shift_at(new.started_at) c;
    if v_shift_id is null then
      raise exception 'No hay un turno activo para la hora de inicio del reporte';
    end if;

    -- Los valores enviados por el cliente se ignoran.
    new.shift_id := v_shift_id;
    new.report_date := v_operational_date;
    new.received_at := clock_timestamp();
  else
    if new.created_by is distinct from old.created_by then
      raise exception 'El operador responsable del reporte no puede cambiar';
    end if;

    if (new.shift_id is distinct from old.shift_id or new.report_date is distinct from old.report_date)
      and not v_is_manager then
      raise exception 'El turno y la fecha operativa del reporte no pueden modificarse';
    end if;

    if new.machine_id is distinct from old.machine_id and not v_is_manager then
      raise exception 'La máquina del reporte solo puede corregirla un Administrador';
    end if;

    new.origin := old.origin;
    new.received_at := old.received_at;

    if old.status = 'SUBMITTED' and new.status = 'CLOSED' then
      -- Solo la RPC approve_report (ya validó actor, estado y conflictos) puede cerrar un reporte.
      if v_via_rpc <> 'approve' or not v_is_manager then
        raise exception 'Un reporte finalizado no puede cambiar de estado';
      end if;
    elsif old.status <> 'DRAFT' and new.status is distinct from old.status then
      raise exception 'Un reporte finalizado no puede cambiar de estado';
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
      if exists (
        select 1 from public.report_stop_events
        where report_id = new.id and ended_at is not null and cancelled_at is null
          and stop_category_id is null
      ) then
        raise exception 'No se puede enviar un reporte con paradas sin categoría';
      end if;
      new.submitted_at := clock_timestamp();
      new.submitted_by := coalesce(actor_id, new.updated_by, new.created_by);
    elsif old.status = 'DRAFT' and new.status = 'CANCELLED' then
      if actor_role = 'OPERATOR' and actor_id is not distinct from old.created_by then
        null; -- el autor cancela su propio borrador
      elsif v_is_manager and v_via_rpc = 'cancel' and private.report_is_off_shift(old.id) then
        null; -- el manager solo cancela borradores abiertos fuera de turno, vía cancel_report
      else
        raise exception 'Solo el Operario responsable puede cancelar el reporte';
      end if;
      if nullif(btrim(new.cancellation_reason), '') is null then
        raise exception 'Debes indicar el motivo de cancelación';
      end if;
      if exists (
        select 1 from public.report_stop_events
        where report_id = new.id and ended_at is null
      ) then
        raise exception 'No se puede cancelar un reporte con una parada abierta';
      end if;
      new.cancellation_reason := btrim(new.cancellation_reason);
      new.cancelled_at := clock_timestamp();
      new.cancelled_by := actor_id;
    elsif old.status = 'SUBMITTED' and new.status = 'CLOSED' then
      null;
    elsif new.status is distinct from old.status then
      raise exception 'Transición de estado no permitida';
    end if;

    new.updated_by := coalesce(actor_id, new.updated_by, old.updated_by);
  end if;

  if new.status = 'DRAFT' and (tg_op = 'INSERT' or new.machine_id is distinct from old.machine_id) then
    if not exists (select 1 from public.machines where id = new.machine_id and active) then
      raise exception 'La máquina seleccionada no está activa';
    end if;
    -- Asignación activa de esa máquina al operario, en ese turno y con la fecha operativa vigente.
    if not exists (
      select 1 from public.operator_machine_assignments a
      where a.operator_id = new.created_by
        and a.machine_id = new.machine_id
        and a.shift_id = new.shift_id
        and a.active
        and a.valid_from <= new.report_date
        and (a.valid_to is null or a.valid_to >= new.report_date)
    ) then
      raise exception 'La máquina no está asignada al Operador';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aviso REPORT_APPROVED en notify_report_change (SUBMITTED -> CLOSED): managers y autor del reporte.
-- ---------------------------------------------------------------------------
create or replace function private.notify_report_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid;
v_type text;
v_actor uuid := coalesce((select auth.uid()), new.updated_by);
begin
  if old.status = 'DRAFT' and new.status in ('SUBMITTED', 'CANCELLED') then
    v_type := case when new.status = 'SUBMITTED' then 'REPORT_SUBMITTED' else 'REPORT_CANCELLED' end;
    insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
    values ('report:' || new.id || ':' || new.status, v_type, 'report', new.id, v_actor,
      case when new.status = 'SUBMITTED' then 'Reporte enviado' else 'Reporte cancelado' end,
      coalesce(new.folio, 'Reporte') || case when new.status = 'SUBMITTED' then ' fue enviado.' else ' fue cancelado.' end,
      '/reportes/' || new.id)
    on conflict (event_key) do nothing returning id into v_event_id;
    if v_event_id is not null then perform private.notify_active_admins(v_event_id, v_actor); end if;
  elsif old.status = 'SUBMITTED' and new.status = 'CLOSED' then
    insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
    values ('report:' || new.id || ':CLOSED', 'REPORT_APPROVED', 'report', new.id, v_actor,
      'Reporte aprobado', coalesce(new.folio, 'Reporte') || ' fue aprobado y cerrado.', '/reportes/' || new.id)
    on conflict (event_key) do nothing returning id into v_event_id;
    if v_event_id is not null then
      perform private.notify_active_admins(v_event_id, v_actor);
      if new.created_by is distinct from v_actor then
        insert into public.notification_deliveries(event_id, recipient_id)
        select v_event_id, new.created_by
        where exists (select 1 from public.profiles where id = new.created_by and active and removed_at is null)
        on conflict (event_id, recipient_id) do nothing;
      end if;
    end if;
  elsif old.status in ('SUBMITTED', 'CANCELLED', 'CLOSED') and v_actor is not null
    and exists (select 1 from public.profiles where id = v_actor and role in ('ROOT', 'ADMINISTRATOR') and active)
    and (to_jsonb(old) - array['updated_at','updated_by']) is distinct from
        (to_jsonb(new) - array['updated_at','updated_by']) then
    insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
    values ('correction:' || new.id || ':' || txid_current(), 'REPORT_CORRECTED', 'report', new.id, v_actor,
      'Reporte corregido', 'Un administrador corrigió ' || coalesce(new.folio, 'tu reporte') || '.', '/reportes/' || new.id)
    on conflict (event_key) do update set updated_at = clock_timestamp()
    returning id into v_event_id;
    if new.created_by is distinct from v_actor then
      insert into public.notification_deliveries(event_id, recipient_id)
      select v_event_id, new.created_by
      where exists (select 1 from public.profiles where id = new.created_by and active and removed_at is null)
      on conflict (event_id, recipient_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_report_change() from public;

-- ---------------------------------------------------------------------------
-- approve_report
-- ---------------------------------------------------------------------------
create function public.approve_report(p_report_id uuid)
returns public.production_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
  v_report public.production_reports%rowtype;
begin
  -- 1) Actor activo con rol manager (ROOT o ADMINISTRATOR).
  if v_actor is null or not private.is_manager() then
    raise exception 'No tienes permiso para aprobar reportes' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = v_actor;

  -- 2) Estado y conflictos.
  select * into v_report from public.production_reports where id = p_report_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0006', detail = 'Reporte no encontrado.';
  end if;
  if v_report.status <> 'SUBMITTED' then
    raise exception 'NOT_SUBMITTED' using errcode = 'P0001', detail = 'Solo se pueden aprobar reportes enviados.';
  end if;
  if exists (select 1 from public.sync_quarantine q where q.report_id = v_report.id and q.status = 'OPEN') then
    raise exception 'OPEN_CONFLICT' using errcode = 'P0002',
      detail = 'El reporte tiene datos sin conciliar de la sincronización. Resuélvelos antes de aprobar.';
  end if;

  if exists (
    select 1 from public.report_stop_events s
    where s.report_id = v_report.id and s.cancelled_at is null
      and (s.ended_at is null or s.stop_category_id is null)
  ) then
    raise exception 'INVALID_STOPS' using errcode = 'P0007',
      detail = 'El reporte tiene paradas abiertas o sin categoría. Corrígelas antes de aprobar.';
  end if;

  perform set_config('app.via_rpc', 'approve', true);
  perform set_config('app.change_reason', 'Aprobación y cierre del reporte', true);
  update public.production_reports
  set status = 'CLOSED',
      approved_by = v_actor,
      approved_at = clock_timestamp(),
      approver_full_name = v_name
  where id = p_report_id
  returning * into v_report;
  perform set_config('app.via_rpc', '', true);
  perform set_config('app.change_reason', '', true);
  return v_report;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_report
-- ---------------------------------------------------------------------------
create function public.cancel_report(p_report_id uuid, p_reason text)
returns public.production_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role := private.current_user_role();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_report public.production_reports%rowtype;
begin
  -- 1) Actor activo con rol permitido (OPERATOR o manager; nunca VIEWER).
  if v_actor is null or v_role is null or v_role not in ('OPERATOR', 'ROOT', 'ADMINISTRATOR') then
    raise exception 'No tienes permiso para cancelar reportes' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Debes indicar el motivo de cancelación' using errcode = '22023';
  end if;

  -- 2) Propiedad y estado.
  select * into v_report from public.production_reports where id = p_report_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0006', detail = 'Reporte no encontrado.';
  end if;
  if v_role = 'OPERATOR' and v_report.created_by is distinct from v_actor then
    raise exception 'Solo el Operario responsable puede cancelar su reporte' using errcode = '42501';
  end if;
  if v_report.status <> 'DRAFT' then
    raise exception 'NOT_CANCELLABLE' using errcode = 'P0003',
      detail = 'Solo se pueden cancelar reportes en borrador.';
  end if;
  if v_role <> 'OPERATOR' and not private.report_is_off_shift(v_report.id) then
    raise exception 'NOT_CANCELLABLE' using errcode = 'P0003',
      detail = 'El coordinador solo puede cancelar reportes abiertos fuera de turno.';
  end if;

  perform set_config('app.via_rpc', 'cancel', true);
  perform set_config('app.change_reason', v_reason, true);
  if v_role <> 'OPERATOR' then
    -- Un borrador olvidado puede tener una parada abierta: se cancela junto con el reporte.
    update public.report_stop_events
    set cancellation_reason = 'Reporte cancelado: ' || v_reason
    where report_id = v_report.id and ended_at is null and cancelled_at is null;
  end if;
  update public.production_reports
  set status = 'CANCELLED', cancellation_reason = v_reason
  where id = p_report_id
  returning * into v_report;
  perform set_config('app.via_rpc', '', true);
  perform set_config('app.change_reason', '', true);
  return v_report;
end;
$$;

revoke all on function public.approve_report(uuid) from public, anon;
revoke all on function public.cancel_report(uuid, text) from public, anon;
grant execute on function public.approve_report(uuid) to authenticated;
grant execute on function public.cancel_report(uuid, text) to authenticated;
