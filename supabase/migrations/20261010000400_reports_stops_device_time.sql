-- Fase F1 / T014: reportes y paradas con hora del dispositivo, turno resuelto por el
-- servidor y un solo reporte activo por operario y por máquina (feature 001).

-- ---------------------------------------------------------------------------
-- Columnas nuevas de reportes y paradas.
-- ---------------------------------------------------------------------------
alter table public.production_reports
  add column origin text not null default 'online' check (origin in ('online', 'offline')),
  add column received_at timestamptz,
  add column approved_by uuid references public.profiles(id) on delete restrict,
  add column approved_at timestamptz,
  add column approver_full_name text;

alter table public.report_stop_events
  add column received_at timestamptz,
  add column captured_offline boolean not null default false,
  add column clock_skew_review boolean not null default false,
  alter column stop_category_id drop not null;

-- Migración de datos con los triggers de negocio desactivados (no son transiciones reales).
alter table public.production_reports disable trigger user;
alter table public.report_stop_events disable trigger user;

update public.production_reports set received_at = created_at where received_at is null;
update public.report_stop_events set received_at = created_at where received_at is null;

-- Un solo reporte activo por operario: se conserva el DRAFT más reciente y se cancelan
-- los demás (con sus paradas abiertas) para poder crear el índice único.
create temporary table migrated_cancelled_reports as
with ranked as (
  select id, row_number() over (partition by created_by order by updated_at desc, created_at desc, id) as rn
  from public.production_reports
  where status = 'DRAFT'
)
select id from ranked where rn > 1;

update public.report_stop_events s
set cancellation_reason = 'Cancelada al migrar: un operario solo puede tener un reporte activo',
    cancelled_at = now(),
    cancelled_by = s.responsible_user_id,
    ended_at = now(),
    duration_seconds = null
where s.ended_at is null and s.report_id in (select id from migrated_cancelled_reports);

update public.production_reports r
set status = 'CANCELLED',
    cancellation_reason = 'Cancelado al migrar: un operario solo puede tener un reporte activo',
    cancelled_at = now(),
    cancelled_by = r.created_by
where r.id in (select id from migrated_cancelled_reports);

drop table migrated_cancelled_reports;

alter table public.production_reports enable trigger user;
alter table public.report_stop_events enable trigger user;

alter table public.production_reports
  add constraint production_reports_approval_consistency check (
    (
      status = 'CLOSED'
      and approved_by is not null
      and approved_at is not null
      and approver_full_name is not null
      and btrim(approver_full_name) <> ''
    )
    or (
      status <> 'CLOSED'
      and approved_by is null
      and approved_at is null
      and approver_full_name is null
    )
  );

-- ---------------------------------------------------------------------------
-- Un reporte activo por operario y por máquina (reemplaza el límite de 5 y el
-- índice production_reports_one_draft_per_machine).
-- ---------------------------------------------------------------------------
drop index public.production_reports_one_draft_per_machine;
create unique index one_active_per_operator
  on public.production_reports (created_by) where status = 'DRAFT';
create unique index one_active_per_machine
  on public.production_reports (machine_id) where status = 'DRAFT';

-- ---------------------------------------------------------------------------
-- validate_production_report: turno y fecha operativa los fija el servidor.
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
-- prepare_stop_event: respeta las horas del dispositivo; categoría opcional al
-- iniciar, obligatoria y activa al cerrar.
-- ---------------------------------------------------------------------------
create or replace function private.prepare_stop_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role := private.current_user_role();
  v_is_manager boolean := coalesce(actor_role in ('ROOT', 'ADMINISTRATOR'), false);
  parent_status public.report_status;
  parent_owner uuid;
begin
  -- Serialize stop mutations against report submission/cancellation, without
  -- changing the report's updated_at (the offline draft concurrency version).
  select status, created_by into parent_status, parent_owner
  from public.production_reports where id = new.report_id for update;
  if parent_status is null then raise exception 'Reporte no encontrado'; end if;

  if actor_id is not null and not v_is_manager then
    if actor_role is distinct from 'OPERATOR' or parent_owner is distinct from actor_id
      or parent_status <> 'DRAFT' then
      raise exception 'Solo puedes modificar paradas de tus reportes en borrador';
    end if;

    if tg_op = 'INSERT' then
      if new.cancellation_reason is not null or new.cancelled_at is not null or new.cancelled_by is not null then
        raise exception 'Una parada nueva no puede estar cancelada';
      end if;
      new.responsible_user_id := actor_id;
      new.ended_at := null;
    else
      if old.ended_at is not null or old.cancelled_at is not null then
        raise exception 'Una parada cerrada o cancelada es de solo lectura para el Operario';
      end if;
      if (to_jsonb(new) - array['stop_category_id', 'ended_at', 'cancellation_reason'])
        is distinct from (to_jsonb(old) - array['stop_category_id', 'ended_at', 'cancellation_reason']) then
        raise exception 'Solo puedes cambiar la categoría, detener o cancelar una parada activa';
      end if;
    end if;

    if new.stop_category_id is not null
      and (tg_op = 'INSERT' or new.stop_category_id is distinct from old.stop_category_id) then
      if not exists (select 1 from public.stop_categories where id = new.stop_category_id and active) then
        raise exception 'Selecciona una categoría de parada activa';
      end if;
    end if;
  end if;

  if new.cancellation_reason is not null then
    new.cancellation_reason := regexp_replace(new.cancellation_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if new.cancellation_reason = '' then raise exception 'Debes indicar el motivo de cancelación de la parada'; end if;
    if new.cancelled_at is null then
      new.cancelled_at := clock_timestamp();
      new.cancelled_by := actor_id;
    end if;
    new.ended_at := new.cancelled_at;
  end if;

  -- Cerrar (no cancelar) exige una categoría activa.
  if new.ended_at is not null and new.cancelled_at is null then
    if new.stop_category_id is null then
      raise exception 'Selecciona una categoría de parada activa';
    end if;
    if (tg_op = 'INSERT' or old.ended_at is null or new.stop_category_id is distinct from old.stop_category_id)
      and not exists (select 1 from public.stop_categories where id = new.stop_category_id and active) then
      raise exception 'Selecciona una categoría de parada activa';
    end if;
  end if;

  -- Hora de llegada y revisión de reloj (las horas del dispositivo no se sobrescriben).
  if tg_op = 'INSERT' or (old.ended_at is null and new.ended_at is not null) then
    new.received_at := clock_timestamp();
  else
    new.received_at := old.received_at;
  end if;

  if (tg_op = 'INSERT' or (old.ended_at is null and new.ended_at is not null)) and new.cancelled_at is null then
    new.clock_skew_review := (tg_op = 'UPDATE' and old.clock_skew_review)
      or (
        not new.captured_offline
        and abs(extract(epoch from (new.received_at - coalesce(new.ended_at, new.started_at)))) > 300
      );
  elsif tg_op = 'UPDATE' then
    new.clock_skew_review := old.clock_skew_review;
  else
    new.clock_skew_review := false;
  end if;

  if new.ended_at is null or new.cancelled_at is not null then
    new.duration_seconds := null;
  else
    new.duration_seconds := floor(extract(epoch from (new.ended_at - new.started_at)))::bigint;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- Las paradas no se borran: una parada errónea se corrige o se cancela.
drop policy stops_delete_by_role on public.report_stop_events;
revoke delete on public.report_stop_events from authenticated;
