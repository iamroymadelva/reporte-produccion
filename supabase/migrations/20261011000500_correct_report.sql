-- Fase F2 / T050: corrección con motivo por RPC (feature 001, FR-025, FR-025a, hallazgo I3, MINOR-5).
-- correct_report(p_report_id, p_patch, p_stops, p_changes, p_reason): security definer, solo managers,
-- solo reportes SUBMITTED/CLOSED, motivo >= 5 caracteres (recortado), lista blanca de columnas.
-- Los parámetros llevan prefijo p_ (evita choques con columnas dentro de plpgsql) y no tienen valores por
-- defecto: la API pasa null explícito.
--
-- LISTA BLANCA (ver ReportEditor modo adminCorrection / REPORT_EDITABLE_FIELDS):
--   reporte: report_date, production_order, line_id, client_id, client_name, lot, shift_id, product_id,
--            product_name, weight, g_min, dosifier_type_id, started_at, ended_at, programmed_hours,
--            units_produced, waste, process_performance, operator_performance, observations.
--   parada:  stop_category_id, description, started_at, ended_at, cancellation_reason.
--   cambio:  change_type_id, description, occurred_at.
--   Nunca: status, created_by, folio, creator_*, approved_*, cancellation_*, submitted_*, machine_id, id.
-- Paradas y cambios se insertan (id opcional) o se corrigen por id; no se borran.
-- Errores: 42501 FORBIDDEN, 22023 motivo/campo no válido, P0005 NOT_CORRECTABLE, P0006 NOT_FOUND.

-- ---------------------------------------------------------------------------
-- MINOR-5: prepare_stop_event y prepare_change_event respetan app.manager_correction ('on'): lo que un
-- manager inserta o corrige vía correct_report NO se marca clock_skew_review (hora retroactiva legítima).
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
  v_manager_correction boolean := v_is_manager and coalesce(current_setting('app.manager_correction', true), '') = 'on';
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

  -- En un reporte ya enviado o cerrado (correcciones de un manager) toda parada no cancelada debe quedar
  -- cerrada y con categoría: no se reabren paradas ni se insertan paradas abiertas o sin categoría.
  if parent_status <> 'DRAFT' and new.cancelled_at is null
    and (new.ended_at is null or new.stop_category_id is null) then
    raise exception 'Una parada de un reporte enviado debe quedar cerrada y con categoría' using errcode = '22023';
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
        not v_manager_correction
        and not new.captured_offline
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

create or replace function private.prepare_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role := private.current_user_role();
  v_is_manager boolean := coalesce(actor_role in ('ROOT', 'ADMINISTRATOR'), false);
  v_manager_correction boolean := v_is_manager and coalesce(current_setting('app.manager_correction', true), '') = 'on';
  parent_status public.report_status;
  parent_owner uuid;
begin
  select status, created_by into parent_status, parent_owner
  from public.production_reports where id = new.report_id for update;
  if parent_status is null then raise exception 'Reporte no encontrado'; end if;

  if actor_id is not null and not v_is_manager then
    if actor_role is distinct from 'OPERATOR' or parent_owner is distinct from actor_id
      or parent_status <> 'DRAFT' then
      raise exception 'Solo puedes modificar cambios de tus reportes en borrador';
    end if;
    if tg_op = 'UPDATE'
      and (to_jsonb(new) - array['description', 'change_type_id'])
        is distinct from (to_jsonb(old) - array['description', 'change_type_id']) then
      raise exception 'Solo puedes cambiar el tipo y la descripción de un cambio';
    end if;
  end if;

  -- El autor del cambio es siempre el autor del reporte.
  new.created_by := parent_owner;

  if (tg_op = 'INSERT' or new.change_type_id is distinct from old.change_type_id)
    and not exists (select 1 from public.change_types where id = new.change_type_id and active) then
    raise exception 'Selecciona un tipo de cambio activo';
  end if;

  if tg_op = 'INSERT' then
    new.received_at := clock_timestamp();
    new.clock_skew_review := not v_manager_correction and not new.captured_offline
      and abs(extract(epoch from (new.received_at - new.occurred_at))) > 300;
  else
    new.received_at := old.received_at;
    new.clock_skew_review := old.clock_skew_review;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- correct_report
-- ---------------------------------------------------------------------------
create function public.correct_report(
  p_report_id uuid,
  p_patch jsonb,
  p_stops jsonb,
  p_changes jsonb,
  p_reason text
)
returns public.production_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_report public.production_reports%rowtype;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_report_fields constant text[] := array[
    'report_date', 'production_order', 'line_id', 'client_id', 'client_name', 'lot', 'shift_id',
    'product_id', 'product_name', 'weight', 'g_min', 'dosifier_type_id', 'started_at', 'ended_at',
    'programmed_hours', 'units_produced', 'waste', 'process_performance', 'operator_performance',
    'observations'];
  v_stop_fields constant text[] := array[
    'stop_category_id', 'description', 'started_at', 'ended_at', 'cancellation_reason'];
  v_change_fields constant text[] := array['change_type_id', 'description', 'occurred_at'];
  v_key text;
  v_item jsonb;
  v_id uuid;
  v_new_report public.production_reports;
  v_stop_old public.report_stop_events%rowtype;
  v_stop_new public.report_stop_events;
  v_change_old public.report_change_events%rowtype;
  v_change_new public.report_change_events;
begin
  -- 1) Actor activo con rol manager.
  if v_actor is null or not private.is_manager() then
    raise exception 'No tienes permiso para corregir reportes' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'El motivo de la corrección debe tener al menos 5 caracteres' using errcode = '22023';
  end if;

  -- 2) Estado.
  select * into v_report from public.production_reports where id = p_report_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0006', detail = 'Reporte no encontrado.';
  end if;
  if v_report.status not in ('SUBMITTED', 'CLOSED') then
    raise exception 'NOT_CORRECTABLE' using errcode = 'P0005',
      detail = 'Solo se pueden corregir reportes enviados o cerrados.';
  end if;

  -- 3) Validación de la forma y la lista blanca (antes de escribir nada).
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'El parche del reporte debe ser un objeto' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(v_patch) loop
    if not v_key = any (v_report_fields) then
      raise exception 'El campo "%" no se puede corregir', v_key using errcode = '22023';
    end if;
  end loop;

  if p_stops is not null then
    if jsonb_typeof(p_stops) <> 'array' then
      raise exception 'Las paradas deben enviarse como una lista' using errcode = '22023';
    end if;
    for v_item in select value from jsonb_array_elements(p_stops) loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'Cada parada debe ser un objeto' using errcode = '22023';
      end if;
      for v_key in select jsonb_object_keys(v_item) loop
        if v_key <> 'id' and not v_key = any (v_stop_fields) then
          raise exception 'El campo "%" de la parada no se puede corregir', v_key using errcode = '22023';
        end if;
      end loop;
      if v_item ? 'id' then
        v_id := (v_item ->> 'id')::uuid;
        if exists (select 1 from public.report_stop_events s where s.id = v_id and s.report_id <> p_report_id) then
          raise exception 'La parada pertenece a otro reporte' using errcode = '22023';
        end if;
      end if;
    end loop;
  end if;

  if p_changes is not null then
    if jsonb_typeof(p_changes) <> 'array' then
      raise exception 'Los cambios deben enviarse como una lista' using errcode = '22023';
    end if;
    for v_item in select value from jsonb_array_elements(p_changes) loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'Cada cambio debe ser un objeto' using errcode = '22023';
      end if;
      for v_key in select jsonb_object_keys(v_item) loop
        if v_key <> 'id' and not v_key = any (v_change_fields) then
          raise exception 'El campo "%" del cambio no se puede corregir', v_key using errcode = '22023';
        end if;
      end loop;
      if v_item ? 'id' then
        v_id := (v_item ->> 'id')::uuid;
        if exists (select 1 from public.report_change_events c where c.id = v_id and c.report_id <> p_report_id) then
          raise exception 'El cambio pertenece a otro reporte' using errcode = '22023';
        end if;
      end if;
    end loop;
  end if;

  perform set_config('app.via_rpc', 'correct', true);
  perform set_config('app.manager_correction', 'on', true);
  perform set_config('app.change_reason', v_reason, true);

  -- 4) Reporte: solo las columnas presentes en el parche (un null explícito limpia el campo).
  if v_patch <> '{}'::jsonb then
    v_new_report := jsonb_populate_record(null::public.production_reports, to_jsonb(v_report) || v_patch);
    update public.production_reports r
    set report_date = v_new_report.report_date,
        production_order = v_new_report.production_order,
        line_id = v_new_report.line_id,
        client_id = v_new_report.client_id,
        client_name = v_new_report.client_name,
        lot = v_new_report.lot,
        shift_id = v_new_report.shift_id,
        product_id = v_new_report.product_id,
        product_name = v_new_report.product_name,
        weight = v_new_report.weight,
        g_min = v_new_report.g_min,
        dosifier_type_id = v_new_report.dosifier_type_id,
        started_at = v_new_report.started_at,
        ended_at = v_new_report.ended_at,
        programmed_hours = v_new_report.programmed_hours,
        units_produced = v_new_report.units_produced,
        waste = v_new_report.waste,
        process_performance = v_new_report.process_performance,
        operator_performance = v_new_report.operator_performance,
        observations = v_new_report.observations
    where r.id = p_report_id;
  end if;

  -- 5) Paradas: inserta o corrige por id (nunca borra).
  if p_stops is not null then
    for v_item in select value from jsonb_array_elements(p_stops) loop
      v_id := nullif(v_item ->> 'id', '')::uuid;
      select * into v_stop_old from public.report_stop_events where id = v_id;
      if v_id is not null and found then
        v_stop_new := jsonb_populate_record(null::public.report_stop_events, to_jsonb(v_stop_old) || (v_item - 'id'));
        update public.report_stop_events s
        set stop_category_id = v_stop_new.stop_category_id,
            description = v_stop_new.description,
            started_at = v_stop_new.started_at,
            ended_at = v_stop_new.ended_at,
            cancellation_reason = v_stop_new.cancellation_reason
        where s.id = v_id;
      else
        if v_item ->> 'started_at' is null then
          raise exception 'La hora de inicio de la parada es obligatoria' using errcode = '22023';
        end if;
        insert into public.report_stop_events (
          id, report_id, stop_category_id, description, started_at, ended_at, cancellation_reason,
          responsible_user_id
        ) values (
          coalesce(v_id, gen_random_uuid()), p_report_id,
          nullif(v_item ->> 'stop_category_id', '')::uuid,
          v_item ->> 'description',
          (v_item ->> 'started_at')::timestamptz,
          nullif(v_item ->> 'ended_at', '')::timestamptz,
          nullif(v_item ->> 'cancellation_reason', ''),
          v_report.created_by
        );
      end if;
    end loop;
  end if;

  -- 6) Cambios: inserta o corrige por id (nunca borra).
  if p_changes is not null then
    for v_item in select value from jsonb_array_elements(p_changes) loop
      v_id := nullif(v_item ->> 'id', '')::uuid;
      select * into v_change_old from public.report_change_events where id = v_id;
      if v_id is not null and found then
        v_change_new := jsonb_populate_record(null::public.report_change_events, to_jsonb(v_change_old) || (v_item - 'id'));
        update public.report_change_events c
        set change_type_id = v_change_new.change_type_id,
            description = v_change_new.description,
            occurred_at = v_change_new.occurred_at
        where c.id = v_id;
      else
        if v_item ->> 'occurred_at' is null then
          raise exception 'La hora del cambio es obligatoria' using errcode = '22023';
        end if;
        insert into public.report_change_events (id, report_id, change_type_id, description, occurred_at, created_by)
        values (
          coalesce(v_id, gen_random_uuid()), p_report_id,
          (v_item ->> 'change_type_id')::uuid,
          v_item ->> 'description',
          (v_item ->> 'occurred_at')::timestamptz,
          v_report.created_by
        );
      end if;
    end loop;
  end if;

  perform set_config('app.via_rpc', '', true);
  perform set_config('app.manager_correction', '', true);
  perform set_config('app.change_reason', '', true);

  select * into v_report from public.production_reports where id = p_report_id;
  return v_report;
end;
$$;

revoke all on function public.correct_report(uuid, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.correct_report(uuid, jsonb, jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Los managers pierden el INSERT/UPDATE directo que conservaban sobre reportes, paradas y cambios en
-- SUBMITTED/CLOSED (hallazgo I3): desde aquí solo escriben mediante las RPC. El operario conserva su
-- escritura sobre su propio DRAFT.
-- ---------------------------------------------------------------------------
drop policy reports_update_by_role on public.production_reports;
create policy reports_update_by_role on public.production_reports
  for update to authenticated
  using (
    private.current_user_role() = 'OPERATOR' and created_by = (select auth.uid()) and status = 'DRAFT'
  )
  with check (
    private.current_user_role() = 'OPERATOR'
    and created_by = (select auth.uid())
    and status in ('DRAFT', 'SUBMITTED', 'CANCELLED')
  );

drop policy stops_insert_by_role on public.report_stop_events;
create policy stops_insert_by_role on public.report_stop_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and private.current_user_role() = 'OPERATOR'
        and report_stop_events.responsible_user_id = (select auth.uid())
        and r.created_by = (select auth.uid())
        and r.status = 'DRAFT'
    )
  );

drop policy stops_update_by_role on public.report_stop_events;
create policy stops_update_by_role on public.report_stop_events
  for update to authenticated
  using (
    exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and private.current_user_role() = 'OPERATOR'
        and report_stop_events.ended_at is null and report_stop_events.cancelled_at is null
        and r.created_by = (select auth.uid())
        and r.status = 'DRAFT'
    )
  )
  with check (
    exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and private.current_user_role() = 'OPERATOR'
        and report_stop_events.responsible_user_id = (select auth.uid())
        and r.created_by = (select auth.uid())
        and r.status = 'DRAFT'
    )
  );

drop policy change_events_insert_by_role on public.report_change_events;
create policy change_events_insert_by_role on public.report_change_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.production_reports r
      where r.id = report_change_events.report_id
        and private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
    )
  );

drop policy change_events_update_by_role on public.report_change_events;
create policy change_events_update_by_role on public.report_change_events
  for update to authenticated
  using (
    exists (
      select 1 from public.production_reports r
      where r.id = report_change_events.report_id
        and private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
    )
  )
  with check (
    exists (
      select 1 from public.production_reports r
      where r.id = report_change_events.report_id
        and private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()) and r.status = 'DRAFT'
    )
  );
