alter table public.production_reports
  add column cancellation_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id) on delete restrict,
  add constraint production_reports_cancellation_consistency check (
    (
      status = 'CANCELLED'
      and cancellation_reason is not null
      and btrim(cancellation_reason) <> ''
      and cancelled_at is not null
      and cancelled_by is not null
    )
    or (
      status <> 'CANCELLED'
      and cancellation_reason is null
      and cancelled_at is null
      and cancelled_by is null
    )
  );

create index production_reports_cancelled_by_idx
  on public.production_reports(cancelled_by, cancelled_at desc)
  where status = 'CANCELLED';

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

    if old.status <> 'DRAFT' and new.status is distinct from old.status then
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
      new.submitted_at := clock_timestamp();
      new.submitted_by := coalesce(actor_id, new.updated_by, new.created_by);
    elsif old.status = 'DRAFT' and new.status = 'CANCELLED' then
      if actor_role is distinct from 'OPERATOR' or actor_id is distinct from old.created_by then
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

create or replace function private.prepare_stop_event()
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
  select status into parent_status from public.production_reports where id = new.report_id;
  if parent_status is null then raise exception 'Reporte no encontrado'; end if;
  if parent_status <> 'DRAFT' and actor_role is distinct from 'ADMINISTRATOR' then
    raise exception 'El reporte finalizado es de solo lectura';
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
      if old.ended_at is null and new.ended_at is not null then new.ended_at := clock_timestamp(); end if;
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

create or replace function private.audit_report_correction()
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
  if old.status not in ('SUBMITTED', 'CANCELLED') or private.current_user_role() <> 'ADMINISTRATOR' then
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

create or replace function private.audit_stop_correction()
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
  if target_status in ('SUBMITTED', 'CANCELLED') and private.current_user_role() = 'ADMINISTRATOR' then
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

drop policy reports_update_by_role on public.production_reports;
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
      and status in ('DRAFT', 'SUBMITTED', 'CANCELLED')
    )
  );
