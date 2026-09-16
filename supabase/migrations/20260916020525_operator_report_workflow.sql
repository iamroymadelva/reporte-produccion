-- A cancelled stop remains a closed historical row. Its duration is NULL, so
-- the existing production_report_metrics SUM excludes it in every category.
alter table public.report_stop_events
  add column cancellation_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id) on delete restrict,
  add constraint report_stop_events_cancellation_consistency check (
    (cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or (
      cancelled_at is not null and cancelled_by is not null
      and cancellation_reason is not null and cancellation_reason ~ '[^[:space:]]'
      and ended_at is not null and ended_at = cancelled_at
      and duration_seconds is null
    )
  );

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
  parent_owner uuid;
begin
  -- Serialize stop mutations against report submission/cancellation, without
  -- changing the report's updated_at (the offline draft concurrency version).
  select status, created_by into parent_status, parent_owner
  from public.production_reports where id = new.report_id for update;
  if parent_status is null then raise exception 'Reporte no encontrado'; end if;

  if actor_id is not null and actor_role is distinct from 'ADMINISTRATOR' then
    if actor_role is distinct from 'OPERATOR' or parent_owner is distinct from actor_id
      or parent_status <> 'DRAFT' then
      raise exception 'Solo puedes modificar paradas de tus reportes en borrador';
    end if;

    if tg_op = 'INSERT' then
      if new.cancellation_reason is not null or new.cancelled_at is not null or new.cancelled_by is not null then
        raise exception 'Una parada nueva no puede estar cancelada';
      end if;
      new.started_at := clock_timestamp();
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
      if new.ended_at is not null then new.ended_at := clock_timestamp(); end if;
    end if;

    if tg_op = 'INSERT' or new.stop_category_id is distinct from old.stop_category_id then
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

  if new.ended_at is null or new.cancelled_at is not null then
    new.duration_seconds := null;
  else
    new.duration_seconds := floor(extract(epoch from (new.ended_at - new.started_at)))::bigint;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop policy stops_update_by_role on public.report_stop_events;
create policy stops_update_by_role on public.report_stop_events
  for update to authenticated
  using (
    private.current_user_role() = 'ADMINISTRATOR'
    or (
      private.current_user_role() = 'OPERATOR'
      and ended_at is null and cancelled_at is null
      and exists (
        select 1 from public.production_reports r
        where r.id = report_stop_events.report_id
          and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
      )
    )
  )
  with check (
    private.current_user_role() = 'ADMINISTRATOR'
    or (
      private.current_user_role() = 'OPERATOR'
      and responsible_user_id = (select auth.uid())
      and exists (
        select 1 from public.production_reports r
        where r.id = report_stop_events.report_id
          and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
      )
    )
  );

drop policy stops_delete_by_role on public.report_stop_events;
create policy stops_delete_by_role on public.report_stop_events
  for delete to authenticated
  using (private.current_user_role() = 'ADMINISTRATOR');

-- Reuse the existing protected audit log, including active category changes and
-- cancellation. Administrator stop corrections are audited in drafts as well.
create or replace function private.audit_stop_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is not null and private.current_user_role() in ('ADMINISTRATOR', 'OPERATOR') then
    insert into public.report_audit_log (report_id, changed_by, field_name, old_value, new_value)
    values (
      coalesce(new.report_id, old.report_id), actor_id, 'stop_event.' || lower(tg_op),
      case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      case when tg_op = 'DELETE' then null else to_jsonb(new) end
    );
  end if;
  return coalesce(new, old);
end;
$$;

-- Validate only the DRAFT -> SUBMITTED transition. Existing historical reports,
-- partial autosaves and administrative corrections remain compatible.
create function private.validate_operator_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  values_json jsonb := to_jsonb(new);
begin
  if old.status = 'DRAFT' and new.status = 'SUBMITTED' then
    if exists (select 1 from public.report_stop_events where report_id = new.id and ended_at is null) then
      raise exception 'No puedes enviar el reporte mientras haya una parada activa. Detén o cancela la parada primero.';
    end if;
    -- Retain the existing end-time validation for Administrator transitions.
    if private.current_user_role() = 'OPERATOR' then
      for item in select * from (values
        ('report_date', 'Fecha'), ('product_name', 'Producto'), ('production_order', 'O.P.'),
        ('line_id', 'Área / Línea'), ('client_name', 'Cliente'), ('lot', 'Lote'),
        ('shift_id', 'Turno'), ('weight', 'Peso (gr)'), ('g_min', 'G/min'),
        ('dosifier_type_id', 'Tipo de dosificador'), ('started_at', 'Hora inicio'),
        ('ended_at', 'Hora finalización'), ('programmed_hours', 'Horas programadas'),
        ('units_produced', 'Unidades producidas'), ('waste', 'Desperdicio')
      ) as required(field, label) loop
        if values_json ->> item.field is null or not (values_json ->> item.field ~ '[^[:space:]]') then
          raise exception '% es obligatorio.', item.label;
        end if;
        if item.field in ('weight', 'g_min', 'programmed_hours', 'units_produced', 'waste')
          and values_json ->> item.field in ('NaN', 'Infinity', '-Infinity') then
          raise exception '% debe ser un número finito.', item.label;
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_operator_submission_before_update
  before update on public.production_reports
  for each row execute function private.validate_operator_submission();

revoke all on function private.validate_operator_submission() from public;
revoke all on function private.prepare_stop_event() from public;
revoke all on function private.audit_stop_correction() from public;
