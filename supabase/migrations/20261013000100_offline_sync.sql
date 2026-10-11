-- Fase F4a / T072: sincronización offline del operario (feature 001, contracts/sync-protocol.md, R9, FR-007a/b,
-- FR-009..FR-019) y MINOR-3/4 de la auditoría de la Phase 2.
--
-- 1) MINOR-3/4: una escritura directa (sin apply_sync_operation) NUNCA es "offline". Se fuerzan
--    production_reports.origin := 'online' y captured_offline := false en paradas y cambios; solo la GUC local
--    app.captured_offline = 'true', fijada por apply_sync_operation, las toma como capturadas sin conexión
--    (origin = 'offline', captured_offline = true, sin revisión de reloj). Afecta a validate_production_report,
--    prepare_stop_event y prepare_change_event.
-- 2) public.apply_sync_operation(op jsonb): security definer, search_path vacío. Valida PRIMERO que op.userId =
--    auth.uid(), perfil activo y rol OPERATOR (si no -> rejected FORBIDDEN, sin registrar). Idempotente por
--    operationId (sync_operation_log). Cada operación corre en un sub-bloque con manejo de excepciones: los errores
--    de negocio se devuelven como rejected/conflict, nunca se lanzan. Como es definer reproduce de forma explícita
--    las reglas que la RLS impone al operario (reporte propio, DRAFT, asignación vigente del turno de startedAt,
--    catálogos activos); los triggers (prepare_stop_event, prepare_change_event, validate_production_report) las
--    vuelven a aplicar como segunda barrera porque auth.uid() sigue siendo el del llamador.
-- 3) public.review_quarantine(p_item_id, p_apply, p_reason): solo managers; marca REVIEWED y, si p_apply, aplica los
--    datos con correct_report (solo reportes SUBMITTED/CLOSED).
--
-- DECISIONES DOCUMENTADAS
--  * "Asignación revocada después de la captura" (CREATE_REPORT, solo si capturedOffline = true): no existe una
--    asignación vigente hoy para (operario, máquina, turno de startedAt, fecha operativa), pero SÍ existe una fila que
--    ya estaba creada al capturar (created_at <= capturedAt), vigente por fecha (valid_from <= fecha operativa) y que
--    fue desactivada o acortada DESPUÉS de la captura (updated_at > capturedAt). Entonces el reporte se aplica
--    (status applied), se inserta una fila OPEN en sync_quarantine con reason ASSIGNMENT_REVOKED (el reporte queda con
--    has_open_conflict = true y no se puede aprobar hasta revisarlo) y se notifica OFFLINE_DATA_REVIEW. Si la revocación
--    es anterior a la captura, o la captura fue online, la operación se rechaza con NO_ASSIGNMENT.
--  * sync_operation_log solo admite applied/conflict/rejected: un 'duplicate' de negocio (valores ya iguales, cancelar
--    lo ya cancelado, entidad ya creada) se registra como applied con detail.duplicate = true. Reenviar una operationId
--    ya registrada devuelve status 'duplicate' con previousStatus/previousCode para no perder el motivo de un rechazo.
--  * Los operadores de paradas (CLOSE_STOP, SET_STOP_CATEGORY, CANCEL_STOP) aceptan payload.reportId (opcional) para
--    poder desviar a cuarentena una operación cuya parada nunca llegó al servidor (porque su START_STOP fue desviado).
--  * SAVE_REPORT_FIELDS usa los nombres de columna (snake_case) de REPORT_EDITABLE_FIELDS; report_date y shift_id los
--    fija el servidor y se ignoran si llegan. Sin baseVersion no hay control de concurrencia.
--  * Horas del dispositivo (MAJOR-1): capturedAt/startedAt/endedAt/occurredAt posteriores a ahora + 5 min se rechazan
--    (VALIDATION); startedAt (CREATE_REPORT, START_STOP), endedAt y occurredAt no pueden superar capturedAt + 5 min.
--    Una captura offline más antigua que app_settings.offline_login_window NO se rechaza: se aplica y deja una fila
--    OPEN STALE_CAPTURE (una por reporte; bloquea la aprobación) + OFFLINE_DATA_REVIEW; solo se marca revisada.
--  * La carga (payload) de una operación no puede superar 32 KB. La asignación revocada exige además startedAt < updated_at.
--  * Se añade sync_quarantine.review_note (motivo de la revisión) y los códigos de error P0008 ALREADY_REVIEWED.

alter table public.sync_quarantine add column review_note text;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create function private.sync_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return p::uuid;
end;
$$;

create function private.sync_ts(p text)
returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end;
$$;

-- Valida una hora del dispositivo: no puede estar en el futuro (> ahora + 5 min) ni ser posterior a capturedAt + 5 min.
create function private.sync_time_error(p_value timestamptz, p_captured timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  select case
    when p_value > clock_timestamp() + interval '5 minutes'
      then jsonb_build_object('status', 'rejected', 'code', 'VALIDATION', 'message', 'La hora del dispositivo está en el futuro.')
    when p_captured is not null and p_value > p_captured + interval '5 minutes'
      then jsonb_build_object('status', 'rejected', 'code', 'VALIDATION',
        'message', 'La hora registrada es posterior a la hora de captura de la operación.')
    else null end;
$$;

create function private.sync_rejected(p_code text, p_message text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('status', 'rejected', 'code', p_code, 'message', p_message);
$$;

-- Versión del servidor (para conflictos): identificación + campos editables.
create function private.sync_report_json(r public.production_reports)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'folio', r.folio, 'status', r.status, 'updated_at', r.updated_at,
      'cancellation_reason', r.cancellation_reason)
    || (select coalesce(jsonb_object_agg(k, to_jsonb(r) -> k), '{}'::jsonb)
        from unnest(array['production_order', 'line_id', 'client_id', 'client_name', 'lot', 'product_id', 'product_name',
          'weight', 'g_min', 'dosifier_type_id', 'started_at', 'ended_at', 'programmed_hours', 'units_produced', 'waste',
          'process_performance', 'operator_performance', 'observations']) as k);
$$;

create function private.sync_report_entity(r public.production_reports)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('type', 'report', 'id', r.id, 'folio', r.folio, 'updatedAt', r.updated_at);
$$;

create function private.sync_notify(p_type text, p_key text, p_report_id uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid;
begin
  insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
  values (p_key, p_type, 'report', p_report_id, (select auth.uid()), p_title, p_body, '/reportes/' || p_report_id)
  on conflict (event_key) do nothing returning id into v_event_id;
  if v_event_id is not null then perform private.notify_active_admins(v_event_id, null); end if;
end;
$$;

revoke all on function private.sync_uuid(text), private.sync_ts(text), private.sync_rejected(text, text),
  private.sync_time_error(timestamptz, timestamptz),
  private.sync_report_json(public.production_reports), private.sync_report_entity(public.production_reports),
  private.sync_notify(text, text, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- MINOR-3/4: validate_production_report (basada en 20261011000400). Cambios:
--  * INSERT: origin := 'offline' solo con app.captured_offline = 'true'; si no, 'online' (ignora lo enviado).
--  * La comprobación de asignación se omite únicamente cuando apply_sync_operation detectó una asignación
--    revocada después de la captura (app.sync_assignment_review = 'on' junto a app.captured_offline = 'true').
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
  v_sync_offline boolean := coalesce(current_setting('app.captured_offline', true), '') = 'true';
  v_skip_assignment boolean := v_sync_offline and coalesce(current_setting('app.sync_assignment_review', true), '') = 'on';
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
    -- MINOR-4: solo la sincronización (GUC fijada por apply_sync_operation) crea reportes offline.
    new.origin := case when v_sync_offline then 'offline' else 'online' end;
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
    if not v_skip_assignment and not exists (
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
-- MINOR-3: prepare_stop_event (basada en 20261011000500). captured_offline sale solo de la GUC.
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
  v_sync_offline boolean := coalesce(current_setting('app.captured_offline', true), '') = 'true';
  v_device_at timestamptz;
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

  -- MINOR-3: lo enviado por el cliente se ignora. Una parada solo es offline si la sincronización lo declara
  -- (GUC) y el indicador nunca se apaga una vez activado.
  if tg_op = 'INSERT' then
    new.captured_offline := v_sync_offline;
  else
    new.captured_offline := old.captured_offline or v_sync_offline;
  end if;

  if new.cancellation_reason is not null then
    new.cancellation_reason := regexp_replace(new.cancellation_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if new.cancellation_reason = '' then raise exception 'Debes indicar el motivo de cancelación de la parada'; end if;
    if new.cancelled_at is null then
      new.cancelled_at := clock_timestamp();
      -- Una cancelación sincronizada conserva la hora del dispositivo (acotada entre el inicio de la parada y la
      -- llegada): si no, la parada ocuparía hasta la hora de llegada y solaparía a las siguientes.
      if v_sync_offline then
        v_device_at := nullif(current_setting('app.captured_at', true), '')::timestamptz;
        if v_device_at is not null then
          new.cancelled_at := greatest(least(v_device_at, new.cancelled_at), new.started_at);
        end if;
      end if;
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

-- ---------------------------------------------------------------------------
-- MINOR-3: prepare_change_event (basada en 20261011000500).
-- ---------------------------------------------------------------------------
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
  v_sync_offline boolean := coalesce(current_setting('app.captured_offline', true), '') = 'true';
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

  -- MINOR-3: el indicador solo lo fija la sincronización (GUC); lo enviado por el cliente se ignora.
  if tg_op = 'INSERT' then
    new.captured_offline := v_sync_offline;
  else
    new.captured_offline := old.captured_offline or v_sync_offline;
  end if;

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
-- Núcleo: aplica UNA operación para el operario p_actor ya validado. Devuelve un jsonb con status
-- (applied/duplicate/conflict/rejected). Las claves internas _quarantine/_report_id/_notify/_title/_body las
-- consume apply_sync_operation (escribe la cuarentena y las notificaciones FUERA del sub-bloque, para que sobrevivan).
-- ---------------------------------------------------------------------------
create function private.sync_apply_core(op jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := op ->> 'type';
  v_p jsonb := op -> 'payload';
  v_op_id uuid := private.sync_uuid(op ->> 'operationId');
  v_offline boolean := (op -> 'capturedOffline') = 'true'::jsonb;
  v_captured timestamptz := private.sync_ts(op ->> 'capturedAt');
  v_base timestamptz := private.sync_ts(op ->> 'baseVersion');
  v_editable constant text[] := array['production_order', 'line_id', 'client_id', 'client_name', 'lot', 'product_id',
    'product_name', 'weight', 'g_min', 'dosifier_type_id', 'started_at', 'ended_at', 'programmed_hours',
    'units_produced', 'waste', 'process_performance', 'operator_performance', 'observations'];
  v_report_id uuid;
  v_machine_id uuid;
  v_stop_id uuid;
  v_change_id uuid;
  v_type_id uuid;
  v_cat uuid;
  v_shift uuid;
  v_date date;
  v_started timestamptz;
  v_ended timestamptz;
  v_occurred timestamptz;
  v_text text;
  v_fields jsonb;
  v_filtered jsonb;
  v_key text;
  v_new public.production_reports;
  v_report public.production_reports%rowtype;
  v_stop public.report_stop_events%rowtype;
  v_change public.report_change_events%rowtype;
  v_review boolean := false;
  v_same boolean;
  v_time_err jsonb;
begin
  if jsonb_typeof(v_p) is distinct from 'object' then
    return private.sync_rejected('VALIDATION', 'La operación no incluye datos.');
  end if;
  -- MINOR-3: una operación no puede llevar más de 32 KB de datos.
  if octet_length(v_p::text) > 32768 then
    return private.sync_rejected('VALIDATION', 'Los datos de la operación superan el tamaño máximo permitido (32 KB).');
  end if;
  -- MAJOR-1: la hora de captura no puede estar en el futuro.
  if v_captured is not null and v_captured > clock_timestamp() + interval '5 minutes' then
    return private.sync_rejected('VALIDATION', 'La hora del dispositivo está en el futuro.');
  end if;

  -- ------------------------------------------------------------------ CREATE_REPORT
  if v_type = 'CREATE_REPORT' then
    v_report_id := private.sync_uuid(v_p ->> 'reportId');
    v_machine_id := private.sync_uuid(v_p ->> 'machineId');
    v_started := private.sync_ts(v_p ->> 'startedAt');
    if v_report_id is null or v_machine_id is null or v_started is null then
      return private.sync_rejected('VALIDATION', 'Faltan la máquina, el identificador o la hora de inicio del reporte.');
    end if;
    v_time_err := private.sync_time_error(v_started, v_captured);
    if v_time_err is not null then return v_time_err; end if;

    -- Idempotencia por identificador de entidad (p. ej. ya creado en línea).
    select * into v_report from public.production_reports where id = v_report_id;
    if found then
      if v_report.created_by = p_actor and v_report.machine_id = v_machine_id then
        return jsonb_build_object('status', 'duplicate', 'entity', private.sync_report_entity(v_report));
      end if;
      return private.sync_rejected('VALIDATION', 'El identificador del reporte ya está en uso.');
    end if;

    select c.shift_id, c.operational_date into v_shift, v_date from private.current_shift_at(v_started) c;
    if v_shift is null then
      return private.sync_rejected('VALIDATION', 'No hay un turno activo para la hora de inicio del reporte.');
    end if;
    if not exists (select 1 from public.machines where id = v_machine_id and active) then
      return private.sync_rejected('VALIDATION', 'La máquina seleccionada no está activa.');
    end if;

    -- FR-007a: un reporte activo por operario y por máquina.
    if exists (select 1 from public.production_reports where created_by = p_actor and status = 'DRAFT') then
      return private.sync_rejected('ACTIVE_REPORT_EXISTS',
        'Ya tienes un reporte activo. Envíalo o cancélalo antes de iniciar otro.');
    end if;
    if exists (select 1 from public.production_reports where machine_id = v_machine_id and status = 'DRAFT') then
      return private.sync_rejected('MACHINE_BUSY', 'La máquina ya tiene un reporte activo.');
    end if;

    -- FR-007b: asignación vigente para el turno de startedAt.
    if not exists (
      select 1 from public.operator_machine_assignments a
      where a.operator_id = p_actor and a.machine_id = v_machine_id and a.shift_id = v_shift
        and a.active and a.valid_from <= v_date and (a.valid_to is null or a.valid_to >= v_date)
    ) then
      if v_offline and v_captured is not null and exists (
        select 1 from public.operator_machine_assignments a
        where a.operator_id = p_actor and a.machine_id = v_machine_id and a.shift_id = v_shift
          and a.valid_from <= v_date
          and a.created_at <= v_captured
          and a.updated_at > v_captured
          and v_started < a.updated_at
          and (not a.active or (a.valid_to is not null and a.valid_to < v_date))
      ) then
        v_review := true; -- revocada después de la captura: se aplica y se marca para revisión
      else
        return private.sync_rejected('NO_ASSIGNMENT',
          'Esta máquina no está asignada a tu turno. Solicita una asignación a tu coordinador.');
      end if;
    end if;

    if v_review then perform set_config('app.sync_assignment_review', 'on', true); end if;
    insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
    values (v_report_id, v_machine_id, v_started, p_actor, p_actor)
    returning * into v_report;
    perform set_config('app.sync_assignment_review', '', true);

    if v_review then
      return jsonb_build_object('status', 'applied', 'entity', private.sync_report_entity(v_report),
        'review', 'ASSIGNMENT_REVOKED',
        '_quarantine', 'ASSIGNMENT_REVOKED', '_report_id', v_report.id, '_notify', 'OFFLINE_DATA_REVIEW',
        '_title', 'Reporte capturado sin conexión en revisión',
        '_body', coalesce(v_report.folio, 'Un reporte') || ' se capturó sin conexión con una asignación que fue revocada después. Revísalo.');
    end if;
    return jsonb_build_object('status', 'applied', 'entity', private.sync_report_entity(v_report));
  end if;

  -- ------------------------------------------------------------------ Resolución del reporte destino
  if v_type in ('SAVE_REPORT_FIELDS', 'START_STOP', 'ADD_CHANGE', 'SUBMIT_REPORT', 'CANCEL_REPORT') then
    v_report_id := private.sync_uuid(v_p ->> 'reportId');
    if v_report_id is null then
      return private.sync_rejected('VALIDATION', 'Falta el identificador del reporte.');
    end if;
  elsif v_type in ('CLOSE_STOP', 'SET_STOP_CATEGORY', 'CANCEL_STOP') then
    v_stop_id := private.sync_uuid(v_p ->> 'stopId');
    if v_stop_id is null then
      return private.sync_rejected('VALIDATION', 'Falta el identificador de la parada.');
    end if;
    select report_id into v_report_id from public.report_stop_events where id = v_stop_id;
    if v_report_id is null then
      v_report_id := private.sync_uuid(v_p ->> 'reportId');
      if v_report_id is null then
        return private.sync_rejected('NOT_FOUND', 'La parada no existe en el servidor.');
      end if;
    end if;
  else
    return private.sync_rejected('VALIDATION', 'Tipo de operación no soportado.');
  end if;

  -- Reglas de la RLS del operario: reporte propio y en borrador.
  select * into v_report from public.production_reports where id = v_report_id for update;
  if not found or v_report.created_by is distinct from p_actor then
    return private.sync_rejected('NOT_FOUND', 'Reporte no encontrado.');
  end if;

  -- Reenvío tras una respuesta perdida: si el efecto de la operación ya está en el servidor (p. ej. se aplicó por la
  -- ruta en línea, que no escribe sync_operation_log, y el cliente la reenvía por el lote con la misma operationId o
  -- con otra), el resultado es `duplicate`: sin conflicto, sin cuarentena y sin notificación. Solo cuenta lo
  -- IDÉNTICO (misma hora, categoría, motivo o valores) del mismo autor; lo distinto sigue siendo conflicto/rechazo.
  if v_type = 'SUBMIT_REPORT' and v_report.status in ('SUBMITTED', 'CLOSED') then
    return jsonb_build_object('status', 'duplicate', 'entity', private.sync_report_entity(v_report));
  end if;
  if v_type in ('CLOSE_STOP', 'SET_STOP_CATEGORY', 'CANCEL_STOP') then
    select * into v_stop from public.report_stop_events where id = v_stop_id and report_id = v_report.id;
    if found and (
      (v_type = 'CLOSE_STOP' and v_stop.ended_at is not null and v_stop.cancelled_at is null
        and v_stop.ended_at = private.sync_ts(v_p ->> 'endedAt')
        and (nullif(v_p ->> 'categoryId', '') is null or private.sync_uuid(v_p ->> 'categoryId') = v_stop.stop_category_id))
      or (v_type = 'SET_STOP_CATEGORY' and v_stop.stop_category_id is not null
        and private.sync_uuid(v_p ->> 'categoryId') = v_stop.stop_category_id)
      or (v_type = 'CANCEL_STOP' and v_stop.cancelled_at is not null
        and v_stop.cancellation_reason is not distinct from nullif(btrim(coalesce(v_p ->> 'reason', '')), ''))
    ) then
      return jsonb_build_object('status', 'duplicate', 'entity', jsonb_build_object('type', 'stop', 'id', v_stop.id));
    end if;
  elsif v_type = 'START_STOP' then
    if exists (select 1 from public.report_stop_events where id = private.sync_uuid(v_p ->> 'stopId') and report_id = v_report.id) then
      return jsonb_build_object('status', 'duplicate',
        'entity', jsonb_build_object('type', 'stop', 'id', private.sync_uuid(v_p ->> 'stopId')));
    end if;
  elsif v_type = 'ADD_CHANGE' then
    if exists (select 1 from public.report_change_events where id = private.sync_uuid(v_p ->> 'changeId') and report_id = v_report.id) then
      return jsonb_build_object('status', 'duplicate',
        'entity', jsonb_build_object('type', 'change', 'id', private.sync_uuid(v_p ->> 'changeId')));
    end if;
  elsif v_type = 'SAVE_REPORT_FIELDS' and v_report.status <> 'DRAFT'
    and jsonb_typeof(v_p -> 'fields') = 'object' and v_p -> 'fields' <> '{}'::jsonb
    and not exists (select 1 from jsonb_object_keys(v_p -> 'fields') k
      where not (k = any (v_editable) or k in ('report_date', 'shift_id'))) then
    v_filtered := (v_p -> 'fields') - 'report_date' - 'shift_id';
    v_new := jsonb_populate_record(null::public.production_reports, to_jsonb(v_report) || v_filtered);
    if not exists (select 1 from jsonb_each(v_filtered) f where to_jsonb(v_report) -> f.key is distinct from to_jsonb(v_new) -> f.key) then
      return jsonb_build_object('status', 'duplicate', 'entity', private.sync_report_entity(v_report));
    end if;
  end if;

  if v_report.status <> 'DRAFT' then
    if v_type = 'CANCEL_REPORT' and v_report.status = 'CANCELLED' then
      return jsonb_build_object('status', 'duplicate', 'entity', private.sync_report_entity(v_report));
    end if;
    return jsonb_build_object('status', 'conflict',
      'code', case when v_report.status = 'CANCELLED' then 'REPORT_CANCELLED' else 'REPORT_NOT_DRAFT' end,
      'message', case when v_report.status = 'CANCELLED'
        then 'El reporte fue cancelado. Los datos se enviaron a revisión del coordinador.'
        else 'El reporte ya no está en borrador. Los datos se enviaron a revisión del coordinador.' end,
      'server', private.sync_report_json(v_report),
      '_quarantine', case when v_report.status = 'CANCELLED' then 'REPORT_CANCELLED' else 'REPORT_NOT_DRAFT' end,
      '_report_id', v_report.id, '_notify', 'OFFLINE_DATA_REVIEW',
      '_title', 'Datos capturados sin conexión en revisión',
      '_body', 'El operario envió datos capturados sin conexión para ' || coalesce(v_report.folio, 'un reporte')
        || ' (' || case when v_report.status = 'CANCELLED' then 'cancelado' else 'ya enviado' end || '). No se aplicaron.');
  end if;

  -- ------------------------------------------------------------------ SAVE_REPORT_FIELDS
  if v_type = 'SAVE_REPORT_FIELDS' then
    v_fields := v_p -> 'fields';
    if jsonb_typeof(v_fields) is distinct from 'object' or v_fields = '{}'::jsonb then
      return private.sync_rejected('VALIDATION', 'No hay campos que guardar.');
    end if;
    for v_key in select jsonb_object_keys(v_fields) loop
      if not (v_key = any (v_editable) or v_key in ('report_date', 'shift_id')) then
        return private.sync_rejected('VALIDATION', 'El campo "' || v_key || '" no se puede guardar.');
      end if;
    end loop;
    v_filtered := v_fields - 'report_date' - 'shift_id'; -- los fija el servidor
    v_new := jsonb_populate_record(null::public.production_reports, to_jsonb(v_report) || v_filtered);
    v_same := not exists (
      select 1 from jsonb_each(v_filtered) f where to_jsonb(v_report) -> f.key is distinct from to_jsonb(v_new) -> f.key
    );
    if v_same then
      return jsonb_build_object('status', 'duplicate', 'entity', private.sync_report_entity(v_report));
    end if;
    if v_base is not null and v_report.updated_at <> v_base then
      return jsonb_build_object('status', 'conflict', 'code', 'REPORT_CHANGED',
        'message', 'El reporte cambió en el servidor. Tus valores se enviaron a revisión del coordinador.',
        'server', private.sync_report_json(v_report),
        '_quarantine', 'REPORT_CHANGED', '_report_id', v_report.id, '_notify', 'SYNC_CONFLICT',
        '_title', 'Conflicto de sincronización',
        '_body', 'Los datos sin conexión de ' || coalesce(v_report.folio, 'un reporte')
          || ' difieren de la versión del servidor. Revísalos.');
    end if;
    -- Catálogos activos (solo los que cambian).
    if v_filtered ? 'line_id' and v_new.line_id is distinct from v_report.line_id and v_new.line_id is not null
      and not exists (select 1 from public.lines where id = v_new.line_id and active) then
      return private.sync_rejected('VALIDATION', 'La línea seleccionada no está activa.');
    end if;
    if v_filtered ? 'client_id' and v_new.client_id is distinct from v_report.client_id and v_new.client_id is not null
      and not exists (select 1 from public.clients where id = v_new.client_id and active) then
      return private.sync_rejected('VALIDATION', 'El cliente seleccionado no está activo.');
    end if;
    if v_filtered ? 'product_id' and v_new.product_id is distinct from v_report.product_id and v_new.product_id is not null
      and not exists (select 1 from public.products where id = v_new.product_id and active) then
      return private.sync_rejected('VALIDATION', 'El producto seleccionado no está activo.');
    end if;
    if v_filtered ? 'dosifier_type_id' and v_new.dosifier_type_id is distinct from v_report.dosifier_type_id
      and v_new.dosifier_type_id is not null
      and not exists (select 1 from public.dosifier_types where id = v_new.dosifier_type_id and active) then
      return private.sync_rejected('VALIDATION', 'El tipo de dosificador seleccionado no está activo.');
    end if;

    update public.production_reports r
    set production_order = v_new.production_order, line_id = v_new.line_id, client_id = v_new.client_id,
        client_name = v_new.client_name, lot = v_new.lot, product_id = v_new.product_id,
        product_name = v_new.product_name, weight = v_new.weight, g_min = v_new.g_min,
        dosifier_type_id = v_new.dosifier_type_id, started_at = v_new.started_at, ended_at = v_new.ended_at,
        programmed_hours = v_new.programmed_hours, units_produced = v_new.units_produced, waste = v_new.waste,
        process_performance = v_new.process_performance, operator_performance = v_new.operator_performance,
        observations = v_new.observations
    where r.id = v_report.id
    returning * into v_report;
    return jsonb_build_object('status', 'applied', 'entity', private.sync_report_entity(v_report));
  end if;

  -- ------------------------------------------------------------------ START_STOP
  if v_type = 'START_STOP' then
    v_stop_id := private.sync_uuid(v_p ->> 'stopId');
    v_started := private.sync_ts(v_p ->> 'startedAt');
    if v_stop_id is null or v_started is null then
      return private.sync_rejected('VALIDATION', 'Faltan el identificador o la hora de inicio de la parada.');
    end if;
    v_time_err := private.sync_time_error(v_started, v_captured);
    if v_time_err is not null then return v_time_err; end if;
    if nullif(v_p ->> 'categoryId', '') is not null then
      v_cat := private.sync_uuid(v_p ->> 'categoryId');
      if v_cat is null or not exists (select 1 from public.stop_categories where id = v_cat and active) then
        return private.sync_rejected('VALIDATION', 'Selecciona una categoría de parada activa.');
      end if;
    end if;
    select * into v_stop from public.report_stop_events where id = v_stop_id;
    if found then
      if v_stop.report_id = v_report.id then
        return jsonb_build_object('status', 'duplicate', 'entity', jsonb_build_object('type', 'stop', 'id', v_stop.id));
      end if;
      return private.sync_rejected('VALIDATION', 'El identificador de la parada ya está en uso.');
    end if;
    insert into public.report_stop_events (id, report_id, stop_category_id, description, started_at, responsible_user_id)
    values (v_stop_id, v_report.id, v_cat, nullif(btrim(coalesce(v_p ->> 'description', '')), ''), v_started, p_actor)
    returning * into v_stop;
    return jsonb_build_object('status', 'applied', 'entity', jsonb_build_object('type', 'stop', 'id', v_stop.id))
      || case when v_stop.clock_skew_review then jsonb_build_object('_notify', 'CLOCK_SKEW_REVIEW',
        '_report_id', v_report.id, '_title', 'Revisión de reloj',
        '_body', 'Una parada de ' || coalesce(v_report.folio, 'un reporte') || ' tiene una hora distinta a la del servidor.')
        else '{}'::jsonb end;
  end if;

  -- ------------------------------------------------------------------ CLOSE_STOP / SET_STOP_CATEGORY / CANCEL_STOP
  if v_type in ('CLOSE_STOP', 'SET_STOP_CATEGORY', 'CANCEL_STOP') then
    select * into v_stop from public.report_stop_events where id = v_stop_id and report_id = v_report.id for update;
    if not found then
      return private.sync_rejected('NOT_FOUND', 'La parada no existe en el servidor.');
    end if;

    if v_type = 'CLOSE_STOP' then
      v_ended := private.sync_ts(v_p ->> 'endedAt');
      if v_ended is null then
        return private.sync_rejected('VALIDATION', 'Falta la hora de fin de la parada.');
      end if;
      v_time_err := private.sync_time_error(v_ended, v_captured);
      if v_time_err is not null then return v_time_err; end if;
      if nullif(v_p ->> 'categoryId', '') is not null then
        v_cat := private.sync_uuid(v_p ->> 'categoryId');
        if v_cat is null then
          return private.sync_rejected('VALIDATION', 'Selecciona una categoría de parada activa.');
        end if;
      end if;
      if v_stop.cancelled_at is not null then
        return private.sync_rejected('VALIDATION', 'La parada fue cancelada.');
      end if;
      if v_stop.ended_at is not null then
        if v_stop.ended_at = v_ended and (v_cat is null or v_cat = v_stop.stop_category_id) then
          return jsonb_build_object('status', 'duplicate', 'entity', jsonb_build_object('type', 'stop', 'id', v_stop.id));
        end if;
        return private.sync_rejected('VALIDATION', 'La parada ya está cerrada.');
      end if;
      if v_ended < v_stop.started_at then
        return private.sync_rejected('VALIDATION', 'La hora de fin no puede ser anterior al inicio de la parada.');
      end if;
      v_cat := coalesce(v_cat, v_stop.stop_category_id);
      if v_cat is null then
        return private.sync_rejected('CATEGORY_REQUIRED', 'Selecciona la categoría de la parada antes de cerrarla.');
      end if;
      if not exists (select 1 from public.stop_categories where id = v_cat and active) then
        return private.sync_rejected('VALIDATION', 'Selecciona una categoría de parada activa.');
      end if;
      update public.report_stop_events set stop_category_id = v_cat, ended_at = v_ended
      where id = v_stop.id returning * into v_stop;
      return jsonb_build_object('status', 'applied', 'entity', jsonb_build_object('type', 'stop', 'id', v_stop.id))
        || case when v_stop.clock_skew_review then jsonb_build_object('_notify', 'CLOCK_SKEW_REVIEW',
          '_report_id', v_report.id, '_title', 'Revisión de reloj',
          '_body', 'Una parada de ' || coalesce(v_report.folio, 'un reporte') || ' tiene una hora distinta a la del servidor.')
          else '{}'::jsonb end;
    end if;

    if v_stop.ended_at is not null or v_stop.cancelled_at is not null then
      return private.sync_rejected('VALIDATION', 'La parada ya no está abierta.');
    end if;

    if v_type = 'SET_STOP_CATEGORY' then
      v_cat := private.sync_uuid(v_p ->> 'categoryId');
      if v_cat is null or not exists (select 1 from public.stop_categories where id = v_cat and active) then
        return private.sync_rejected('VALIDATION', 'Selecciona una categoría de parada activa.');
      end if;
      update public.report_stop_events set stop_category_id = v_cat where id = v_stop.id returning * into v_stop;
    else
      v_text := nullif(btrim(coalesce(v_p ->> 'reason', '')), '');
      if v_text is null then
        return private.sync_rejected('VALIDATION', 'Debes indicar el motivo de cancelación de la parada.');
      end if;
      update public.report_stop_events set cancellation_reason = v_text where id = v_stop.id returning * into v_stop;
    end if;
    return jsonb_build_object('status', 'applied', 'entity', jsonb_build_object('type', 'stop', 'id', v_stop.id));
  end if;

  -- ------------------------------------------------------------------ ADD_CHANGE
  if v_type = 'ADD_CHANGE' then
    v_change_id := private.sync_uuid(v_p ->> 'changeId');
    v_type_id := private.sync_uuid(v_p ->> 'changeTypeId');
    v_occurred := private.sync_ts(v_p ->> 'occurredAt');
    v_text := nullif(btrim(coalesce(v_p ->> 'description', '')), '');
    if v_change_id is null or v_type_id is null or v_occurred is null or v_text is null or char_length(v_text) > 500 then
      return private.sync_rejected('VALIDATION', 'Faltan datos del cambio o la descripción no es válida (1 a 500 caracteres).');
    end if;
    v_time_err := private.sync_time_error(v_occurred, v_captured);
    if v_time_err is not null then return v_time_err; end if;
    if not exists (select 1 from public.change_types where id = v_type_id and active) then
      return private.sync_rejected('VALIDATION', 'Selecciona un tipo de cambio activo.');
    end if;
    select * into v_change from public.report_change_events where id = v_change_id;
    if found then
      if v_change.report_id = v_report.id then
        return jsonb_build_object('status', 'duplicate', 'entity', jsonb_build_object('type', 'change', 'id', v_change.id));
      end if;
      return private.sync_rejected('VALIDATION', 'El identificador del cambio ya está en uso.');
    end if;
    insert into public.report_change_events (id, report_id, change_type_id, description, occurred_at, created_by)
    values (v_change_id, v_report.id, v_type_id, v_text, v_occurred, p_actor)
    returning * into v_change;
    return jsonb_build_object('status', 'applied', 'entity', jsonb_build_object('type', 'change', 'id', v_change.id))
      || case when v_change.clock_skew_review then jsonb_build_object('_notify', 'CLOCK_SKEW_REVIEW',
        '_report_id', v_report.id, '_title', 'Revisión de reloj',
        '_body', 'Un cambio de ' || coalesce(v_report.folio, 'un reporte') || ' tiene una hora distinta a la del servidor.')
        else '{}'::jsonb end;
  end if;

  -- ------------------------------------------------------------------ SUBMIT_REPORT
  if v_type = 'SUBMIT_REPORT' then
    if exists (select 1 from public.report_stop_events where report_id = v_report.id and ended_at is null and cancelled_at is null) then
      return private.sync_rejected('VALIDATION',
        'No puedes enviar el reporte mientras haya una parada activa. Detén o cancela la parada primero.');
    end if;
    if exists (select 1 from public.report_stop_events
      where report_id = v_report.id and ended_at is not null and cancelled_at is null and stop_category_id is null) then
      return private.sync_rejected('CATEGORY_REQUIRED', 'No se puede enviar un reporte con paradas sin categoría.');
    end if;
    update public.production_reports set status = 'SUBMITTED' where id = v_report.id returning * into v_report;
    return jsonb_build_object('status', 'applied', 'entity', private.sync_report_entity(v_report));
  end if;

  -- ------------------------------------------------------------------ CANCEL_REPORT
  if v_type = 'CANCEL_REPORT' then
    v_text := nullif(btrim(coalesce(v_p ->> 'reason', '')), '');
    if v_text is null then
      return private.sync_rejected('VALIDATION', 'Debes indicar el motivo de cancelación.');
    end if;
    perform set_config('app.change_reason', v_text, true);
    update public.production_reports set status = 'CANCELLED', cancellation_reason = v_text
    where id = v_report.id returning * into v_report;
    perform set_config('app.change_reason', '', true);
    return jsonb_build_object('status', 'applied', 'entity', private.sync_report_entity(v_report));
  end if;

  return private.sync_rejected('VALIDATION', 'Tipo de operación no soportado.');
end;
$$;

revoke all on function private.sync_apply_core(jsonb, uuid) from public;

-- ---------------------------------------------------------------------------
-- apply_sync_operation
-- ---------------------------------------------------------------------------
create function public.apply_sync_operation(op jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_op_id uuid;
  v_type text;
  v_prev public.sync_operation_log%rowtype;
  v_res jsonb;
  v_state text;
  v_constraint text;
  v_msg text;
  v_report_id uuid;
  v_notify text;
  v_captured timestamptz;
  v_window interval;
  v_stamp timestamptz;
  v_stale_rid uuid;
  v_types constant text[] := array['CREATE_REPORT', 'SAVE_REPORT_FIELDS', 'START_STOP', 'CLOSE_STOP',
    'SET_STOP_CATEGORY', 'CANCEL_STOP', 'ADD_CHANGE', 'SUBMIT_REPORT', 'CANCEL_REPORT'];
begin
  -- 1) Actor: userId = auth.uid(), perfil activo y rol OPERATOR (no se registra nada).
  if op is null or jsonb_typeof(op) <> 'object' then
    return private.sync_rejected('VALIDATION', 'Operación inválida.');
  end if;
  v_op_id := private.sync_uuid(op ->> 'operationId');
  if v_actor is null or private.sync_uuid(op ->> 'userId') is distinct from v_actor then
    return jsonb_build_object('operationId', v_op_id)
      || private.sync_rejected('FORBIDDEN', 'La operación no pertenece a la sesión actual.');
  end if;
  if private.current_user_role() is distinct from 'OPERATOR' then
    return jsonb_build_object('operationId', v_op_id)
      || private.sync_rejected('FORBIDDEN', 'Solo un Operario activo puede sincronizar reportes.');
  end if;

  -- 2) Forma.
  v_type := op ->> 'type';
  if v_op_id is null or v_type is null or not v_type = any (v_types) or jsonb_typeof(op -> 'payload') is distinct from 'object' then
    return jsonb_build_object('operationId', v_op_id)
      || private.sync_rejected('VALIDATION', 'La operación está incompleta o su tipo no es válido.');
  end if;

  -- 3) Idempotencia (serializa reenvíos concurrentes de la misma operación).
  perform pg_advisory_xact_lock(hashtextextended('sync:' || v_op_id::text, 0));
  select * into v_prev from public.sync_operation_log where operation_id = v_op_id;
  if found then
    if v_prev.user_id <> v_actor then
      return jsonb_build_object('operationId', v_op_id)
        || private.sync_rejected('FORBIDDEN', 'La operación no pertenece a la sesión actual.');
    end if;
    return jsonb_build_object('operationId', v_op_id, 'status', 'duplicate', 'previousStatus', v_prev.result,
      'previousCode', v_prev.detail ->> 'code', 'previousMessage', v_prev.detail ->> 'message');
  end if;

  -- 4) Contexto de auditoría y de captura (locales a la transacción; se restablecen al terminar).
  v_captured := private.sync_ts(op ->> 'capturedAt');
  perform set_config('app.captured_offline', case when (op -> 'capturedOffline') = 'true'::jsonb then 'true' else 'false' end, true);
  perform set_config('app.captured_at', coalesce(v_captured::text, ''), true);

  -- 5) La operación corre aislada: sus errores de negocio se devuelven, no se lanzan.
  begin
    v_res := private.sync_apply_core(op, v_actor);
  exception
    when exclusion_violation then
      v_res := private.sync_rejected('STOP_OVERLAP', 'La parada se solapa con otra parada del reporte.');
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      v_res := case v_constraint
        when 'one_active_per_operator' then private.sync_rejected('ACTIVE_REPORT_EXISTS',
          'Ya tienes un reporte activo. Envíalo o cancélalo antes de iniciar otro.')
        when 'one_active_per_machine' then private.sync_rejected('MACHINE_BUSY', 'La máquina ya tiene un reporte activo.')
        when 'report_stop_events_one_open_per_report' then private.sync_rejected('STOP_ALREADY_OPEN',
          'Este reporte ya tiene una parada abierta.')
        else private.sync_rejected('VALIDATION', 'El registro ya existe.')
      end;
    when others then
      v_state := sqlstate;
      v_msg := sqlerrm;
      if v_state in ('40001', '40P01', '55P03', '57014') then raise; end if;
      v_res := private.sync_rejected('VALIDATION', case
        when v_state in ('P0001', '22023', '42501') then v_msg
        when v_state = '23514' then 'Alguno de los valores está fuera del rango permitido.'
        when v_state = '23503' then 'Algún dato hace referencia a un registro inexistente.'
        when v_state in ('22P02', '22007', '22008', '22003', '22001') then 'Alguno de los valores no tiene el formato esperado.'
        else 'No fue posible aplicar la operación.' end);
  end;

  perform set_config('app.captured_offline', '', true);
  perform set_config('app.captured_at', '', true);
  perform set_config('app.sync_assignment_review', '', true);
  perform set_config('app.change_reason', '', true);

  -- 6) Cuarentena y avisos (fuera del sub-bloque, para que sobrevivan a un rechazo).
  v_report_id := nullif(v_res ->> '_report_id', '')::uuid;
  v_notify := v_res ->> '_notify';
  if v_res ? '_quarantine' then
    insert into public.sync_quarantine (operation_id, report_id, user_id, payload, reason)
    values (v_op_id, v_report_id, v_actor, op, v_res ->> '_quarantine');
  end if;
  if v_notify is not null and v_report_id is not null then
    perform private.sync_notify(v_notify, 'sync:' || v_op_id || ':' || v_notify, v_report_id, v_res ->> '_title', v_res ->> '_body');
  end if;
  v_res := v_res - '_quarantine' - '_report_id' - '_notify' - '_title' - '_body';

  -- 6b) Captura obsoleta (MAJOR-1c): una captura offline más antigua que la ventana de uso sin conexión NO se rechaza
  -- (no se pierden datos); se aplica, se deja una cuarentena STALE_CAPTURE (una abierta por reporte) y se avisa.
  if v_res ->> 'status' = 'applied' and (op -> 'capturedOffline') = 'true'::jsonb then
    select offline_login_window into v_window from public.app_settings limit 1;
    v_stamp := case when v_type = 'CREATE_REPORT' then coalesce(private.sync_ts(op -> 'payload' ->> 'startedAt'), v_captured)
      else v_captured end;
    if v_window is not null and v_stamp is not null and v_stamp < clock_timestamp() - v_window then
      v_stale_rid := coalesce(private.sync_uuid(op -> 'payload' ->> 'reportId'),
        (select s.report_id from public.report_stop_events s where s.id = private.sync_uuid(op -> 'payload' ->> 'stopId')));
      if v_stale_rid is not null and not exists (
        select 1 from public.sync_quarantine q
        where q.report_id = v_stale_rid and q.reason = 'STALE_CAPTURE' and q.status = 'OPEN'
      ) then
        insert into public.sync_quarantine (operation_id, report_id, user_id, payload, reason)
        values (v_op_id, v_stale_rid, v_actor, op, 'STALE_CAPTURE');
        perform private.sync_notify('OFFLINE_DATA_REVIEW', 'sync:' || v_op_id || ':STALE_CAPTURE', v_stale_rid,
          'Captura sin conexión antigua en revisión',
          'El operario sincronizó datos capturados hace más de ' || v_window::text || '. Revísalos antes de aprobar el reporte.');
      end if;
      if not (v_res ? 'review') then v_res := v_res || jsonb_build_object('review', 'STALE_CAPTURE'); end if;
    end if;
  end if;

  -- 7) Registro (duplicate de negocio -> applied con detail.duplicate).
  insert into public.sync_operation_log (operation_id, user_id, operation_type, result, detail, captured_at)
  values (v_op_id, v_actor, v_type,
    case when v_res ->> 'status' = 'duplicate' then 'applied' else v_res ->> 'status' end,
    case when v_res ->> 'status' = 'duplicate' then v_res || jsonb_build_object('duplicate', true) else v_res end,
    v_captured);

  return jsonb_build_object('operationId', v_op_id) || v_res;
end;
$$;

revoke all on function public.apply_sync_operation(jsonb) from public, anon;
grant execute on function public.apply_sync_operation(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- review_quarantine
-- Aplicar (p_apply = true) solo es posible con el reporte SUBMITTED/CLOSED, usando correct_report (motivo >= 5
-- caracteres). Con el reporte en DRAFT o CANCELLED solo se puede marcar como revisado (P0005 NOT_CORRECTABLE).
-- Operaciones aplicables: SAVE_REPORT_FIELDS, ADD_CHANGE, START_STOP (junto con su CLOSE_STOP/SET_STOP_CATEGORY
-- también en cuarentena), CLOSE_STOP, SET_STOP_CATEGORY y CANCEL_STOP sobre paradas existentes. CREATE_REPORT,
-- SUBMIT_REPORT, CANCEL_REPORT y ASSIGNMENT_REVOKED no tienen datos que aplicar: solo se marcan revisados.
-- ---------------------------------------------------------------------------
create function public.review_quarantine(p_item_id uuid, p_apply boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_item public.sync_quarantine%rowtype;
  v_sibling public.sync_quarantine%rowtype;
  v_report public.production_reports%rowtype;
  v_t text;
  v_p jsonb;
  v_patch jsonb;
  v_stops jsonb;
  v_changes jsonb;
  v_stop_id uuid;
  v_cat text;
  v_ended text;
  v_siblings uuid[] := '{}';
begin
  if v_actor is null or not private.is_manager() then
    raise exception 'No tienes permiso para revisar la cuarentena de sincronización' using errcode = '42501';
  end if;

  select * into v_item from public.sync_quarantine where id = p_item_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0006', detail = 'Elemento de cuarentena no encontrado.';
  end if;
  if v_item.status <> 'OPEN' then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0008', detail = 'Este elemento ya fue revisado.';
  end if;

  if coalesce(p_apply, false) then
    if v_reason is null or char_length(v_reason) < 5 then
      raise exception 'El motivo para aplicar los datos debe tener al menos 5 caracteres' using errcode = '22023';
    end if;
    select * into v_report from public.production_reports where id = v_item.report_id for update;
    if not found or v_report.status not in ('SUBMITTED', 'CLOSED') then
      raise exception 'NOT_CORRECTABLE' using errcode = 'P0005',
        detail = 'Solo se pueden aplicar datos a reportes enviados o cerrados; marca el elemento como revisado.';
    end if;

    if v_item.reason in ('ASSIGNMENT_REVOKED', 'STALE_CAPTURE') then
      raise exception 'Este elemento ya está aplicado en el reporte; solo se puede marcar como revisado.'
        using errcode = '22023';
    end if;

    v_t := v_item.payload ->> 'type';
    v_p := v_item.payload -> 'payload';
    v_stop_id := private.sync_uuid(v_p ->> 'stopId');

    if v_t = 'SAVE_REPORT_FIELDS' then
      v_patch := (v_p -> 'fields') - 'report_date' - 'shift_id';
    elsif v_t = 'ADD_CHANGE' then
      v_changes := jsonb_build_array(jsonb_build_object('id', v_p ->> 'changeId', 'change_type_id', v_p ->> 'changeTypeId',
        'description', v_p ->> 'description', 'occurred_at', v_p ->> 'occurredAt'));
    elsif v_t = 'START_STOP' then
      -- La parada solo es válida en un reporte enviado si queda cerrada y con categoría: se une con su cierre.
      select * into v_sibling from public.sync_quarantine q
      where q.report_id = v_item.report_id and q.status = 'OPEN' and q.id <> v_item.id
        and q.payload ->> 'type' = 'CLOSE_STOP' and q.payload -> 'payload' ->> 'stopId' = v_p ->> 'stopId'
      order by q.created_at limit 1;
      if not found then
        raise exception 'La parada no se puede aplicar sin su cierre en la cuarentena; marca el elemento como revisado.'
          using errcode = '22023';
      end if;
      v_siblings := v_siblings || v_sibling.id;
      v_ended := v_sibling.payload -> 'payload' ->> 'endedAt';
      v_cat := coalesce(nullif(v_sibling.payload -> 'payload' ->> 'categoryId', ''), nullif(v_p ->> 'categoryId', ''));
      if v_cat is null then
        select q.payload -> 'payload' ->> 'categoryId' into v_cat from public.sync_quarantine q
        where q.report_id = v_item.report_id and q.status = 'OPEN' and q.id <> v_item.id
          and q.payload ->> 'type' = 'SET_STOP_CATEGORY' and q.payload -> 'payload' ->> 'stopId' = v_p ->> 'stopId'
        order by q.created_at desc limit 1;
      end if;
      v_stops := jsonb_build_array(jsonb_build_object('id', v_p ->> 'stopId', 'stop_category_id', v_cat,
        'description', v_p ->> 'description', 'started_at', v_p ->> 'startedAt', 'ended_at', v_ended));
    elsif v_t in ('CLOSE_STOP', 'SET_STOP_CATEGORY', 'CANCEL_STOP') then
      if not exists (select 1 from public.report_stop_events where id = v_stop_id and report_id = v_item.report_id) then
        raise exception 'La parada no existe en el reporte; aplica primero su inicio o marca el elemento como revisado.'
          using errcode = '22023';
      end if;
      v_stops := jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object('id', v_p ->> 'stopId')
          || case v_t
            when 'CLOSE_STOP' then jsonb_build_object('ended_at', v_p ->> 'endedAt', 'stop_category_id', nullif(v_p ->> 'categoryId', ''))
            when 'SET_STOP_CATEGORY' then jsonb_build_object('stop_category_id', v_p ->> 'categoryId')
            else jsonb_build_object('cancellation_reason', v_p ->> 'reason') end));
    else
      raise exception 'Esta operación no tiene datos que aplicar a un reporte enviado; márcala como revisada.'
        using errcode = '22023';
    end if;

    perform public.correct_report(v_item.report_id, v_patch, v_stops, v_changes, v_reason);
    if cardinality(v_siblings) > 0 then
      update public.sync_quarantine
      set status = 'REVIEWED', reviewed_by = v_actor, reviewed_at = clock_timestamp(), review_note = v_reason
      where id = any (v_siblings);
    end if;
  end if;

  update public.sync_quarantine
  set status = 'REVIEWED', reviewed_by = v_actor, reviewed_at = clock_timestamp(), review_note = v_reason
  where id = v_item.id;

  return jsonb_build_object('id', v_item.id, 'status', 'REVIEWED', 'applied', coalesce(p_apply, false),
    'reportId', v_item.report_id);
end;
$$;

revoke all on function public.review_quarantine(uuid, boolean, text) from public, anon;
grant execute on function public.review_quarantine(uuid, boolean, text) to authenticated;
