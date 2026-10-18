-- T066: apply_sync_operation y review_quarantine (feature 001, contracts/sync-protocol.md, FR-007a/b, FR-009..FR-019).
-- La RPC es security definer: valida al actor (userId = auth.uid(), perfil activo, rol OPERATOR), es idempotente por
-- operationId, nunca lanza errores de negocio al llamador y desvía a sync_quarantine lo que no puede aplicarse.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

-- ------------------------------------------------------------------ Datos
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000701', 'sy-op1@usuarios.reporte-produccion.invalid', '{"full_name":"SY Operario 1"}'),
  ('10000000-0000-0000-0000-000000000702', 'sy-op2@usuarios.reporte-produccion.invalid', '{"full_name":"SY Operario 2"}'),
  ('10000000-0000-0000-0000-000000000703', 'sy-coord@usuarios.reporte-produccion.invalid', '{"full_name":"SY Coordinador"}'),
  ('10000000-0000-0000-0000-000000000704', 'sy-viewer@usuarios.reporte-produccion.invalid', '{"full_name":"SY Auditor"}'),
  ('10000000-0000-0000-0000-000000000705', 'sy-inact@usuarios.reporte-produccion.invalid', '{"full_name":"SY Operario inactivo"}'),
  ('10000000-0000-0000-0000-000000000706', 'sy-op3@usuarios.reporte-produccion.invalid', '{"full_name":"SY Operario 3"}');
update public.profiles set role = 'OPERATOR', active = true
where id in ('10000000-0000-0000-0000-000000000701', '10000000-0000-0000-0000-000000000702', '10000000-0000-0000-0000-000000000706');
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000703';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000704';
update public.profiles set role = 'OPERATOR', active = false where id = '10000000-0000-0000-0000-000000000705';

insert into public.machines (id, code, name) values
  ('3c000000-0000-0000-0000-000000000701', 'SY-1', 'SY 1'),
  ('3c000000-0000-0000-0000-000000000702', 'SY-2', 'SY 2'),
  ('3c000000-0000-0000-0000-000000000703', 'SY-3', 'SY 3 (no asignada a op1)'),
  ('3c000000-0000-0000-0000-000000000704', 'SY-4', 'SY 4 (asignación revocada)'),
  ('3c000000-0000-0000-0000-000000000705', 'SY-5', 'SY 5 (compartida op2/op3)');

create temporary table sy_shift as select id from public.shifts where name = 'Día';
grant select on sy_shift to authenticated;
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, active, created_by)
select a.op, a.mac, (select id from sy_shift), '2000-01-01', true, '10000000-0000-0000-0000-000000000001'
from (values
  ('10000000-0000-0000-0000-000000000701'::uuid, '3c000000-0000-0000-0000-000000000701'::uuid),
  ('10000000-0000-0000-0000-000000000701'::uuid, '3c000000-0000-0000-0000-000000000702'::uuid),
  ('10000000-0000-0000-0000-000000000702'::uuid, '3c000000-0000-0000-0000-000000000703'::uuid),
  ('10000000-0000-0000-0000-000000000702'::uuid, '3c000000-0000-0000-0000-000000000705'::uuid),
  ('10000000-0000-0000-0000-000000000706'::uuid, '3c000000-0000-0000-0000-000000000705'::uuid)
) a(op, mac);
-- Asignación de op1 a SY-4: existía al capturar (09-oct 10:05) y fue revocada después (09-oct 23:00).
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, active, created_by, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000701', '3c000000-0000-0000-0000-000000000704', (select id from sy_shift),
  '2000-01-01', false, '10000000-0000-0000-0000-000000000001', '2026-10-09 08:00:00-05', '2026-10-09 23:00:00-05');
-- Turno Noche: revocada a las 22:30; sirve para probar que startedAt debe ser anterior a la revocación (MINOR-2).
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, active, created_by, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000701', '3c000000-0000-0000-0000-000000000704', (select id from public.shifts where name = 'Noche'),
  '2000-01-01', false, '10000000-0000-0000-0000-000000000001', '2026-10-09 08:00:00-05', '2026-10-09 22:30:00-05');

-- Constructor de operaciones (cliente → servidor).
-- Sin p_cap, capturedAt es el mayor de los instantes de la carga (la hora del dispositivo no puede ser anterior a lo
-- que captura) o, si no hay ninguno, 2026-10-09T10:00:00-05:00.
create function tests.mkop(p_user uuid, p_id uuid, p_type text, p_payload jsonb,
  p_cap text default null, p_offline boolean default true, p_base text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('operationId', p_id, 'userId', p_user, 'seq', 1, 'type', p_type,
    'capturedAt', coalesce(p_cap, greatest(p_payload ->> 'startedAt', p_payload ->> 'endedAt', p_payload ->> 'occurredAt',
      '2026-10-09T10:00:00-05:00')),
    'capturedOffline', p_offline, 'baseVersion', p_base, 'payload', p_payload));
$$;
grant execute on function tests.mkop(uuid, uuid, text, jsonb, text, boolean, text) to public;
-- Instante relativo a ahora en ISO UTC (para las pruebas de horas del dispositivo).
create function tests.iso(p interval) returns text language sql stable as $$
  select to_char((now() + p) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;
grant execute on function tests.iso(interval) to public;
-- Las capturas de las pruebas con fechas fijas (2026-10-09) no deben volverse obsoletas con el paso del tiempo;
-- la sección de capturas obsoletas restablece la ventana de 7 días.
update public.app_settings set offline_login_window = interval '100 years';

-- Ids fijos para poder reenviar.
-- operaciones: f1.. ; reportes R1..R7: 8c..0701..; paradas 9c..0701..; cambios ac..0701..
select tests.auth_as('10000000-0000-0000-0000-000000000701');

-- ------------------------------------------------------------------ Actor (security definer)
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000702',
    'f1000000-0000-0000-0000-000000000001', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000799","machineId":"3c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'status',
  'rejected', 'userId ajeno: rejected');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000702',
    'f1000000-0000-0000-0000-000000000001', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000799","machineId":"3c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'code',
  'FORBIDDEN', 'userId ajeno: FORBIDDEN');
select is((select count(*) from public.production_reports where id = '8c000000-0000-0000-0000-000000000799'), 0::bigint,
  'userId ajeno: no se crea nada');
select is((select count(*) from public.sync_operation_log where operation_id = 'f1000000-0000-0000-0000-000000000001'), 0::bigint,
  'userId ajeno: no se registra en sync_operation_log');
select is((select public.apply_sync_operation('{"operationId":"no-uuid","userId":"10000000-0000-0000-0000-000000000701","type":"CREATE_REPORT","payload":{}}'::jsonb)) ->> 'code',
  'VALIDATION', 'Una operación malformada se rechaza sin lanzar');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000002', 'TIPO_RARO', '{}'))) ->> 'code',
  'VALIDATION', 'Un tipo desconocido se rechaza');

-- ------------------------------------------------------------------ CREATE_REPORT
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000010', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000701","machineId":"3c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'status',
  'applied', 'CREATE_REPORT: applied');
select is((select origin from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'), 'offline',
  'CREATE_REPORT: el reporte queda con origin = offline');
select is((select shift_id from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'),
  (select id from sy_shift), 'CREATE_REPORT: el turno se resuelve de startedAt');
select is((select started_at from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'),
  '2026-10-09 10:00:00-05'::timestamptz, 'CREATE_REPORT: se conserva la hora del dispositivo');
select ok((select received_at is not null from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'),
  'CREATE_REPORT: received_at lo fija el servidor');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000010', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000701","machineId":"3c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'status',
  'duplicate', 'La misma operationId otra vez: duplicate');
select is((select count(*) from public.production_reports where created_by = '10000000-0000-0000-0000-000000000701'), 1::bigint,
  'duplicate: no se crean filas extra');
select is((select count(*) from public.sync_operation_log where operation_id = 'f1000000-0000-0000-0000-000000000010'), 1::bigint,
  'duplicate: una sola fila en sync_operation_log');
select tests.auth_reset();
select is((select count(*) from public.report_audit_log where report_id = '8c000000-0000-0000-0000-000000000701'
  and entity_type = 'report' and action = 'INSERT' and captured_offline and captured_at = '2026-10-09 10:00:00-05'), 1::bigint,
  'CREATE_REPORT: la auditoría registra captured_offline y captured_at');
select tests.auth_as('10000000-0000-0000-0000-000000000701');

-- ------------------------------------------------------------------ Paradas
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000011', 'START_STOP',
    '{"stopId":"9c000000-0000-0000-0000-000000000701","reportId":"8c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:10:00-05:00"}'))) ->> 'status',
  'applied', 'START_STOP sin categoría: applied');
select is((select captured_offline from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000701'), true,
  'START_STOP: captured_offline = true');
select is((select started_at from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000701'),
  '2026-10-09 10:10:00-05'::timestamptz, 'START_STOP: conserva la hora del dispositivo');
select ok((select received_at is not null from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000701'),
  'START_STOP: received_at fijado por el servidor');

select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000012', 'CLOSE_STOP',
    '{"stopId":"9c000000-0000-0000-0000-000000000701","reportId":"8c000000-0000-0000-0000-000000000701","endedAt":"2026-10-09T10:20:00-05:00"}'))) ->> 'code',
  'CATEGORY_REQUIRED', 'CLOSE_STOP sin categoría: rejected CATEGORY_REQUIRED');
select is((select ended_at from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000701'), null,
  'CLOSE_STOP rechazado: la parada sigue abierta');
select is((select result from public.sync_operation_log where operation_id = 'f1000000-0000-0000-0000-000000000012'), 'rejected',
  'CLOSE_STOP rechazado: queda registrado como rejected');

select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000013', 'CLOSE_STOP',
    format('{"stopId":"9c000000-0000-0000-0000-000000000701","reportId":"8c000000-0000-0000-0000-000000000701","endedAt":"2026-10-09T10:20:00-05:00","categoryId":"%s"}',
      (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'applied', 'CLOSE_STOP con categoría: applied');
select is((select ended_at from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000701'),
  '2026-10-09 10:20:00-05'::timestamptz, 'CLOSE_STOP: conserva la hora del dispositivo');
select is((select duration_seconds from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000701'), 600::bigint,
  'CLOSE_STOP: duración calculada');
select is((select clock_skew_review from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000701'), false,
  'CLOSE_STOP offline: sin revisión de reloj');

select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000014', 'START_STOP',
    '{"stopId":"9c000000-0000-0000-0000-000000000702","reportId":"8c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:15:00-05:00"}'))) ->> 'code',
  'STOP_OVERLAP', 'Parada solapada: rejected STOP_OVERLAP');
select is((select count(*) from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000702'), 0::bigint,
  'STOP_OVERLAP: la parada no se crea');

-- Parada con categoría opcional al iniciar: SET_STOP_CATEGORY y CANCEL_STOP.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000015', 'START_STOP',
    '{"stopId":"9c000000-0000-0000-0000-000000000703","reportId":"8c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:30:00-05:00"}'))) ->> 'status',
  'applied', 'START_STOP (tercera): applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000016', 'SET_STOP_CATEGORY',
    format('{"stopId":"9c000000-0000-0000-0000-000000000703","reportId":"8c000000-0000-0000-0000-000000000701","categoryId":"%s"}',
      (select id from public.stop_categories where code = '2'))::jsonb))) ->> 'status',
  'applied', 'SET_STOP_CATEGORY: applied');
select is((select stop_category_id from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000703'),
  (select id from public.stop_categories where code = '2'), 'SET_STOP_CATEGORY: categoría guardada');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000017', 'CANCEL_STOP',
    '{"stopId":"9c000000-0000-0000-0000-000000000703","reportId":"8c000000-0000-0000-0000-000000000701","reason":"Se inició por error"}',
    '2026-10-09T10:35:00-05:00'))) ->> 'status',
  'applied', 'CANCEL_STOP: applied');
select ok((select cancelled_at is not null and cancellation_reason = 'Se inició por error'
  from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000703'), 'CANCEL_STOP: parada cancelada con motivo');

-- Parada sin categoría y envío.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000018', 'START_STOP',
    '{"stopId":"9c000000-0000-0000-0000-000000000704","reportId":"8c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:40:00-05:00"}'))) ->> 'status',
  'applied', 'START_STOP (cuarta, sin categoría): applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000019', 'SUBMIT_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000701"}'))) ->> 'status',
  'rejected', 'SUBMIT_REPORT con una parada abierta sin categoría: rejected');
select is((select status from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'), 'DRAFT',
  'SUBMIT_REPORT rechazado: el reporte sigue en DRAFT');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-00000000001a', 'CLOSE_STOP',
    format('{"stopId":"9c000000-0000-0000-0000-000000000704","reportId":"8c000000-0000-0000-0000-000000000701","endedAt":"2026-10-09T10:50:00-05:00","categoryId":"%s"}',
      (select id from public.stop_categories where code = '3'))::jsonb))) ->> 'status',
  'applied', 'CLOSE_STOP (cuarta) con categoría: applied');

-- Una parada cerrada sin categoría (dato heredado) impide el envío con CATEGORY_REQUIRED.
select tests.auth_reset();
set local session_replication_role = replica;
insert into public.report_stop_events (id, report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id)
values ('9c000000-0000-0000-0000-0000000007ff', '8c000000-0000-0000-0000-000000000701', null,
  '2026-10-09 11:00:00-05', '2026-10-09 11:05:00-05', 300, '10000000-0000-0000-0000-000000000701');
set local session_replication_role = origin;
select tests.auth_as('10000000-0000-0000-0000-000000000701');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-00000000001b', 'SUBMIT_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000701"}'))) ->> 'code',
  'CATEGORY_REQUIRED', 'SUBMIT_REPORT con una parada cerrada sin categoría: rejected CATEGORY_REQUIRED');
select tests.auth_reset();
set local session_replication_role = replica;
delete from public.report_stop_events where id = '9c000000-0000-0000-0000-0000000007ff';
set local session_replication_role = origin;
select tests.auth_as('10000000-0000-0000-0000-000000000701');

-- ------------------------------------------------------------------ ADD_CHANGE
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000020', 'ADD_CHANGE',
    format('{"changeId":"ac000000-0000-0000-0000-000000000701","reportId":"8c000000-0000-0000-0000-000000000701","changeTypeId":"%s","description":"Cambio de lote","occurredAt":"2026-10-09T11:10:00-05:00"}',
      (select id from public.change_types where name = 'Lote'))::jsonb))) ->> 'status',
  'applied', 'ADD_CHANGE: applied');
select is((select captured_offline from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000701'), true,
  'ADD_CHANGE: captured_offline = true');
select is((select occurred_at from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000701'),
  '2026-10-09 11:10:00-05'::timestamptz, 'ADD_CHANGE: conserva la hora del dispositivo');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000021', 'ADD_CHANGE',
    '{"changeId":"ac000000-0000-0000-0000-000000000799","reportId":"8c000000-0000-0000-0000-000000000701","changeTypeId":"ac000000-0000-0000-0000-000000000000","description":"x","occurredAt":"2026-10-09T11:10:00-05:00"}'))) ->> 'status',
  'rejected', 'ADD_CHANGE con tipo inexistente: rejected');

-- ------------------------------------------------------------------ SAVE_REPORT_FIELDS
create temporary table sy_base as
  select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as v
  from public.production_reports where id = '8c000000-0000-0000-0000-000000000701';
grant select on sy_base to authenticated;

select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000030', 'SAVE_REPORT_FIELDS',
    format('{"reportId":"8c000000-0000-0000-0000-000000000701","fields":{"production_order":"OP-1","line_id":"%s","client_name":"Cliente SY","lot":"L-9","product_name":"Producto SY","weight":100,"g_min":50,"dosifier_type_id":"%s","started_at":"2026-10-09T10:00:00-05:00","ended_at":"2026-10-09T13:00:00-05:00","programmed_hours":3,"units_produced":1000,"waste":5,"observations":"Sin novedad"}}',
      (select id from public.lines order by sort_order limit 1), (select id from public.dosifier_types order by sort_order limit 1))::jsonb,
    '2026-10-09T12:00:00-05:00', true, (select v from sy_base)))) ->> 'status',
  'applied', 'SAVE_REPORT_FIELDS con baseVersion vigente: applied');
select is((select lot from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'), 'L-9',
  'SAVE_REPORT_FIELDS: valores guardados');

-- Versión vieja y valores distintos -> conflict + cuarentena; valores iguales -> duplicate.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000031', 'SAVE_REPORT_FIELDS',
    '{"reportId":"8c000000-0000-0000-0000-000000000701","fields":{"lot":"L-OTRO"}}',
    '2026-10-09T12:05:00-05:00', true, (select v from sy_base)))) ->> 'status',
  'conflict', 'SAVE_REPORT_FIELDS con versión vieja y valores distintos: conflict');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000032', 'SAVE_REPORT_FIELDS',
    '{"reportId":"8c000000-0000-0000-0000-000000000701","fields":{"lot":"L-OTRO"}}',
    '2026-10-09T12:05:00-05:00', true, (select v from sy_base)))) -> 'server' ->> 'lot',
  'L-9', 'conflict: devuelve la versión del servidor');
select is((select lot from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'), 'L-9',
  'conflict: no se sobrescribe el valor del servidor');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000033', 'SAVE_REPORT_FIELDS',
    '{"reportId":"8c000000-0000-0000-0000-000000000701","fields":{"lot":"L-9"}}',
    '2026-10-09T12:05:00-05:00', true, (select v from sy_base)))) ->> 'status',
  'duplicate', 'SAVE_REPORT_FIELDS con versión vieja pero valores iguales: duplicate');

-- Horas manuales: Hora inicio / Hora finalización son valores escritos a mano por el operario (no son la hora del
-- dispositivo). Se aceptan aunque no coincidan con el reloj (días atrás o varias horas adelante); solo fin >= inicio.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000034', 'SAVE_REPORT_FIELDS',
    format('{"reportId":"8c000000-0000-0000-0000-000000000701","fields":{"started_at":"%s","ended_at":"%s"}}',
      to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(now() + interval '4 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::jsonb,
    to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), false))) ->> 'status',
  'applied', 'Horas manuales (2 días atrás / 4 h adelante) se aceptan y no se comparan con el reloj');
select ok((select ended_at > now() + interval '3 hours' and started_at < now() - interval '1 day'
  from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'), 'Horas manuales: se guardan tal como se escribieron');
select throws_ok($$update public.production_reports set ended_at = started_at - interval '1 hour'
  where id = '8c000000-0000-0000-0000-000000000701'$$, '23514', null, 'Hora fin anterior al inicio sigue rechazada');
-- Se restauran las horas originales para no afectar el resto de la prueba.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000035', 'SAVE_REPORT_FIELDS',
    '{"reportId":"8c000000-0000-0000-0000-000000000701","fields":{"started_at":"2026-10-09T10:00:00-05:00","ended_at":"2026-10-09T13:00:00-05:00"}}',
    '2026-10-09T12:05:00-05:00', true))) ->> 'status',
  'applied', 'Horas manuales restauradas');

select tests.auth_reset();
select is((select count(*) from public.sync_quarantine where report_id = '8c000000-0000-0000-0000-000000000701'
  and reason = 'REPORT_CHANGED' and status = 'OPEN'), 2::bigint, 'REPORT_CHANGED: dos conflictos en cuarentena OPEN');
select is((select count(*) from public.notification_events e
  join public.notification_deliveries d on d.event_id = e.id
  where e.type = 'SYNC_CONFLICT' and e.resource_id = '8c000000-0000-0000-0000-000000000701'
    and d.recipient_id = '10000000-0000-0000-0000-000000000703'), 2::bigint,
  'REPORT_CHANGED: el coordinador recibe SYNC_CONFLICT');
select tests.auth_as('10000000-0000-0000-0000-000000000701');

-- ------------------------------------------------------------------ SUBMIT_REPORT
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000040', 'SUBMIT_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000701"}', '2026-10-09T13:05:00-05:00'))) ->> 'status',
  'applied', 'SUBMIT_REPORT completo: applied');
select is((select status::text from public.production_reports where id = '8c000000-0000-0000-0000-000000000701'), 'SUBMITTED',
  'SUBMIT_REPORT: el reporte queda SUBMITTED');
select tests.auth_reset();
select ok((select count(*) >= 4 from public.report_audit_log
  where report_id = '8c000000-0000-0000-0000-000000000701' and captured_offline and captured_at is not null),
  'La auditoría marca captured_offline en las operaciones sincronizadas');
select ok((select count(*) = 0 from public.report_audit_log
  where report_id = '8c000000-0000-0000-0000-000000000701' and entity_type = 'stop' and not captured_offline),
  'Todas las filas de auditoría de paradas son captured_offline');
select tests.auth_as('10000000-0000-0000-0000-000000000701');

-- Reporte ya enviado: conflict REPORT_NOT_DRAFT + cuarentena + OFFLINE_DATA_REVIEW.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000041', 'ADD_CHANGE',
    format('{"changeId":"ac000000-0000-0000-0000-000000000702","reportId":"8c000000-0000-0000-0000-000000000701","changeTypeId":"%s","description":"Cambio tardío","occurredAt":"2026-10-09T12:30:00-05:00"}',
      (select id from public.change_types where name = 'Formato'))::jsonb))) ->> 'code',
  'REPORT_NOT_DRAFT', 'Operación sobre un reporte enviado: conflict REPORT_NOT_DRAFT');
select is((select count(*) from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000702'), 0::bigint,
  'REPORT_NOT_DRAFT: el cambio no se inserta');

-- ------------------------------------------------------------------ Reporte cancelado por un manager fuera de turno
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000050', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000702","machineId":"3c000000-0000-0000-0000-000000000702","startedAt":"2026-10-09T11:00:00-05:00"}',
    '2026-10-09T11:00:00-05:00'))) ->> 'status',
  'applied', 'CREATE_REPORT (segundo reporte): applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000051', 'START_STOP',
    '{"stopId":"9c000000-0000-0000-0000-000000000711","reportId":"8c000000-0000-0000-0000-000000000702","startedAt":"2026-10-09T11:10:00-05:00"}'))) ->> 'status',
  'applied', 'START_STOP en el segundo reporte: applied');
select tests.auth_as('10000000-0000-0000-0000-000000000703');
select lives_ok($$select public.cancel_report('8c000000-0000-0000-0000-000000000702', 'Abierto fuera de turno')$$,
  'El coordinador cancela el borrador abierto fuera de turno');
select tests.auth_as('10000000-0000-0000-0000-000000000701');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000052', 'CLOSE_STOP',
    format('{"stopId":"9c000000-0000-0000-0000-000000000711","reportId":"8c000000-0000-0000-0000-000000000702","endedAt":"2026-10-09T11:30:00-05:00","categoryId":"%s"}',
      (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'code',
  'REPORT_CANCELLED', 'Cerrar una parada de un reporte cancelado: conflict REPORT_CANCELLED');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000053', 'START_STOP',
    '{"stopId":"9c000000-0000-0000-0000-000000000712","reportId":"8c000000-0000-0000-0000-000000000702","startedAt":"2026-10-09T11:40:00-05:00"}'))) ->> 'status',
  'conflict', 'Iniciar una parada en un reporte cancelado: conflict');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000054', 'SAVE_REPORT_FIELDS',
    '{"reportId":"8c000000-0000-0000-0000-000000000702","fields":{"lot":"L-X"}}'))) ->> 'code',
  'REPORT_CANCELLED', 'Guardar campos en un reporte cancelado: conflict REPORT_CANCELLED');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000055', 'CANCEL_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000702","reason":"Cancelar tras el coordinador"}'))) ->> 'status',
  'duplicate', 'Cancelar un reporte ya cancelado: duplicate');
select is((select status::text from public.production_reports where id = '8c000000-0000-0000-0000-000000000702'), 'CANCELLED',
  'El reporte cancelado por el coordinador no se reactiva');
select tests.auth_reset();
select is((select count(*) from public.sync_quarantine where report_id = '8c000000-0000-0000-0000-000000000702' and status = 'OPEN'), 3::bigint,
  'Cuarentena OPEN con los 3 datos recibidos para el reporte cancelado');
select is((select payload ->> 'type' from public.sync_quarantine where operation_id = 'f1000000-0000-0000-0000-000000000052'), 'CLOSE_STOP',
  'La cuarentena conserva la operación original');
select ok((select count(*) >= 3 from public.notification_events e
  join public.notification_deliveries d on d.event_id = e.id
  where e.type = 'OFFLINE_DATA_REVIEW' and e.resource_id = '8c000000-0000-0000-0000-000000000702'
    and d.recipient_id = '10000000-0000-0000-0000-000000000703'), 'El coordinador recibe OFFLINE_DATA_REVIEW');
select tests.auth_as('10000000-0000-0000-0000-000000000701');

-- ------------------------------------------------------------------ Asignación y límites de FR-007a
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000060', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000703","machineId":"3c000000-0000-0000-0000-000000000703","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'code',
  'NO_ASSIGNMENT', 'CREATE_REPORT en una máquina no asignada: rejected NO_ASSIGNMENT');
select ok((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000061', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000703","machineId":"3c000000-0000-0000-0000-000000000703","startedAt":"2026-10-09T10:00:00-05:00"}')) ->> 'message' like '%coordinador%'),
  'NO_ASSIGNMENT: el mensaje indica solicitar la asignación al coordinador');

-- Una captura online (no offline) con la asignación revocada no se acepta.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000065', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000709","machineId":"3c000000-0000-0000-0000-000000000704","startedAt":"2026-10-09T10:05:00-05:00"}',
    '2026-10-09T10:05:00-05:00', false))) ->> 'code',
  'NO_ASSIGNMENT', 'Online con la asignación revocada: rejected NO_ASSIGNMENT');

-- MINOR-2: capturedAt anterior a la revocación (22:28 < 22:30) pero startedAt posterior (22:31): no se acepta.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000066', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000722","machineId":"3c000000-0000-0000-0000-000000000704","startedAt":"2026-10-09T22:31:00-05:00"}',
    '2026-10-09T22:28:00-05:00'))) ->> 'code',
  'NO_ASSIGNMENT', 'Un inicio posterior a la revocación no cuenta como revocada después de la captura');

-- Asignación revocada después de la captura (capturado sin conexión).
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000062', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000704","machineId":"3c000000-0000-0000-0000-000000000704","startedAt":"2026-10-09T10:05:00-05:00"}',
    '2026-10-09T10:05:00-05:00'))) ->> 'status',
  'applied', 'CREATE_REPORT con asignación revocada después de la captura: applied');
select is((select count(*) from public.production_reports where id = '8c000000-0000-0000-0000-000000000704'), 1::bigint,
  'Asignación revocada después de la captura: el reporte existe');
select tests.auth_reset();
select is((select reason from public.sync_quarantine where report_id = '8c000000-0000-0000-0000-000000000704' and status = 'OPEN'),
  'ASSIGNMENT_REVOKED', 'El reporte queda marcado para revisión (cuarentena ASSIGNMENT_REVOKED)');
select is((select count(*) from public.notification_events e
  join public.notification_deliveries d on d.event_id = e.id
  where e.type = 'OFFLINE_DATA_REVIEW' and e.resource_id = '8c000000-0000-0000-0000-000000000704'
    and d.recipient_id = '10000000-0000-0000-0000-000000000703'), 1::bigint,
  'Asignación revocada: el coordinador recibe OFFLINE_DATA_REVIEW');
select tests.auth_as('10000000-0000-0000-0000-000000000701');

-- FR-007a: el operario ya tiene un reporte activo (R4).
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000063', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000705","machineId":"3c000000-0000-0000-0000-000000000704","startedAt":"2026-10-09T10:05:00-05:00"}',
    '2026-10-09T10:05:00-05:00', false))) ->> 'code',
  'ACTIVE_REPORT_EXISTS', 'FR-007a: ya hay un reporte activo del operario (ACTIVE_REPORT_EXISTS)');

-- Reloj: una captura online con hora muy desfasada pide revisión de reloj y notifica CLOCK_SKEW_REVIEW.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000064', 'ADD_CHANGE',
    format('{"changeId":"ac000000-0000-0000-0000-000000000703","reportId":"8c000000-0000-0000-0000-000000000704","changeTypeId":"%s","description":"Cambio online desfasado","occurredAt":"2026-10-07T08:00:00-05:00"}',
      (select id from public.change_types where name = 'Lote'))::jsonb,
    '2026-10-07T08:00:00-05:00', false))) ->> 'status',
  'applied', 'ADD_CHANGE online desfasado: applied');
select is((select clock_skew_review from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000703'), true,
  'ADD_CHANGE online desfasado: clock_skew_review');
select is((select captured_offline from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000703'), false,
  'capturedOffline = false se respeta');
select tests.auth_reset();
select is((select count(*) from public.notification_events e
  join public.notification_deliveries d on d.event_id = e.id
  where e.type = 'CLOCK_SKEW_REVIEW' and e.resource_id = '8c000000-0000-0000-0000-000000000704'
    and d.recipient_id = '10000000-0000-0000-0000-000000000703'), 0::bigint,
  'El coordinador NO recibe CLOCK_SKEW_REVIEW (solo ROOT)');
select is((select count(*) from public.notification_events e
  join public.notification_deliveries d on d.event_id = e.id
  where e.type = 'CLOCK_SKEW_REVIEW' and e.resource_id = '8c000000-0000-0000-0000-000000000704'
    and d.recipient_id = '10000000-0000-0000-0000-000000000004'), 1::bigint,
  'ROOT recibe CLOCK_SKEW_REVIEW');

-- MACHINE_BUSY: op2 ocupa SY-5 y op3 intenta crear sobre la misma máquina.
select tests.auth_as('10000000-0000-0000-0000-000000000702');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000702',
    'f1000000-0000-0000-0000-000000000070', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000706","machineId":"3c000000-0000-0000-0000-000000000705","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'status',
  'applied', 'op2 crea su reporte en SY-5');
-- Aislamiento: op2 no puede operar sobre el reporte de op1.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000702',
    'f1000000-0000-0000-0000-000000000071', 'ADD_CHANGE',
    format('{"changeId":"ac000000-0000-0000-0000-000000000704","reportId":"8c000000-0000-0000-0000-000000000704","changeTypeId":"%s","description":"Ajeno","occurredAt":"2026-10-09T12:30:00-05:00"}',
      (select id from public.change_types where name = 'Lote'))::jsonb))) ->> 'code',
  'NOT_FOUND', 'Operar sobre el reporte de otro operario: rejected NOT_FOUND');
select tests.auth_as('10000000-0000-0000-0000-000000000706');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000072', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000707","machineId":"3c000000-0000-0000-0000-000000000705","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'code',
  'MACHINE_BUSY', 'FR-007a: la máquina ya tiene un reporte activo (MACHINE_BUSY)');

-- ------------------------------------------------------------------ Horas del dispositivo (MAJOR-1, MINOR-2/3)
-- op3 (sin reporte activo) trabaja SY-6 en todos los turnos.
select tests.auth_reset();
insert into public.machines (id, code, name) values ('3c000000-0000-0000-0000-000000000706', 'SY-6', 'SY 6 (todos los turnos)');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, active, created_by)
select '10000000-0000-0000-0000-000000000706', '3c000000-0000-0000-0000-000000000706', s.id, '2000-01-01', true,
  '10000000-0000-0000-0000-000000000001'
from public.shifts s where s.active;
update public.app_settings set offline_login_window = interval '7 days';
select tests.auth_as('10000000-0000-0000-0000-000000000706');

-- (a) Futuro: startedAt, capturedAt, endedAt y occurredAt posteriores a ahora + 5 min se rechazan.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000090', 'CREATE_REPORT',
    format('{"reportId":"8c000000-0000-0000-0000-000000000720","machineId":"3c000000-0000-0000-0000-000000000706","startedAt":"%s"}',
      tests.iso('1 day'))::jsonb))) ->> 'code',
  'VALIDATION', 'startedAt en el futuro: rejected VALIDATION');
select ok((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000091', 'CREATE_REPORT',
    format('{"reportId":"8c000000-0000-0000-0000-000000000720","machineId":"3c000000-0000-0000-0000-000000000706","startedAt":"%s"}',
      tests.iso('1 day'))::jsonb)) ->> 'message' like '%futuro%'), 'El mensaje indica que la hora del dispositivo está en el futuro');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000092', 'CREATE_REPORT',
    format('{"reportId":"8c000000-0000-0000-0000-000000000720","machineId":"3c000000-0000-0000-0000-000000000706","startedAt":"%s"}',
      tests.iso('-2 hours'))::jsonb, tests.iso('1 day')))) ->> 'code',
  'VALIDATION', 'capturedAt en el futuro: rejected VALIDATION');
-- (b) Consistencia: startedAt no puede ser posterior a capturedAt + 5 min.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000093', 'CREATE_REPORT',
    format('{"reportId":"8c000000-0000-0000-0000-000000000720","machineId":"3c000000-0000-0000-0000-000000000706","startedAt":"%s"}',
      tests.iso('-1 hour'))::jsonb, tests.iso('-3 hours')))) ->> 'code',
  'VALIDATION', 'startedAt posterior a capturedAt + 5 min: rejected VALIDATION');
select is((select count(*) from public.production_reports where id = '8c000000-0000-0000-0000-000000000720'), 0::bigint,
  'Las horas inválidas no crean el reporte');

-- Captura normal de hace 2 horas: applied y sin cuarentena.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000094', 'CREATE_REPORT',
    format('{"reportId":"8c000000-0000-0000-0000-000000000720","machineId":"3c000000-0000-0000-0000-000000000706","startedAt":"%s"}',
      tests.iso('-2 hours'))::jsonb))) ->> 'status',
  'applied', 'Captura offline de hace 2 horas: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000095', 'START_STOP',
    format('{"stopId":"9c000000-0000-0000-0000-000000000720","reportId":"8c000000-0000-0000-0000-000000000720","startedAt":"%s"}',
      tests.iso('-90 minutes'))::jsonb))) ->> 'status',
  'applied', 'START_STOP de hace 90 minutos: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000096', 'START_STOP',
    format('{"stopId":"9c000000-0000-0000-0000-000000000721","reportId":"8c000000-0000-0000-0000-000000000720","startedAt":"%s"}',
      tests.iso('-30 minutes'))::jsonb, tests.iso('-2 hours')))) ->> 'code',
  'VALIDATION', 'START_STOP con startedAt posterior a capturedAt + 5 min: rejected VALIDATION');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000097', 'CLOSE_STOP',
    format('{"stopId":"9c000000-0000-0000-0000-000000000720","reportId":"8c000000-0000-0000-0000-000000000720","endedAt":"%s","categoryId":"%s"}',
      tests.iso('1 hour'), (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'code',
  'VALIDATION', 'endedAt en el futuro: rejected VALIDATION');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000098', 'CLOSE_STOP',
    format('{"stopId":"9c000000-0000-0000-0000-000000000720","reportId":"8c000000-0000-0000-0000-000000000720","endedAt":"%s","categoryId":"%s"}',
      tests.iso('-30 minutes'), (select id from public.stop_categories where code = '1'))::jsonb, tests.iso('-60 minutes')))) ->> 'code',
  'VALIDATION', 'endedAt posterior a capturedAt + 5 min: rejected VALIDATION');
select is((select ended_at from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000720'), null,
  'Los cierres con horas inválidas no cierran la parada');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-000000000099', 'ADD_CHANGE',
    format('{"changeId":"ac000000-0000-0000-0000-000000000720","reportId":"8c000000-0000-0000-0000-000000000720","changeTypeId":"%s","description":"Cambio","occurredAt":"%s"}',
      (select id from public.change_types where name = 'Lote'), tests.iso('-20 minutes'))::jsonb, tests.iso('-50 minutes')))) ->> 'code',
  'VALIDATION', 'occurredAt posterior a capturedAt + 5 min: rejected VALIDATION');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-00000000009a', 'ADD_CHANGE',
    format('{"changeId":"ac000000-0000-0000-0000-000000000721","reportId":"8c000000-0000-0000-0000-000000000720","changeTypeId":"%s","description":"Cambio","occurredAt":"%s"}',
      (select id from public.change_types where name = 'Lote'), tests.iso('2 hours'))::jsonb))) ->> 'code',
  'VALIDATION', 'occurredAt en el futuro: rejected VALIDATION');

-- (MINOR-3) Una carga de más de 32 KB se rechaza.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-00000000009b', 'SAVE_REPORT_FIELDS',
    jsonb_build_object('reportId', '8c000000-0000-0000-0000-000000000720',
      'fields', jsonb_build_object('observations', repeat('x', 40000)))))) ->> 'code',
  'VALIDATION', 'Carga de más de 32 KB: rejected VALIDATION');
select is((select observations from public.production_reports where id = '8c000000-0000-0000-0000-000000000720'), null,
  'La carga excesiva no se guarda');

-- La captura normal no genera cuarentena. Se cierra y cancela para liberar al operario.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-00000000009c', 'CLOSE_STOP',
    format('{"stopId":"9c000000-0000-0000-0000-000000000720","reportId":"8c000000-0000-0000-0000-000000000720","endedAt":"%s","categoryId":"%s"}',
      tests.iso('-80 minutes'), (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'applied', 'CLOSE_STOP válido: applied');
select tests.auth_reset();
select is((select count(*) from public.sync_quarantine where report_id = '8c000000-0000-0000-0000-000000000720'), 0::bigint,
  'Una captura offline de hace 2 horas no genera cuarentena');
select tests.auth_as('10000000-0000-0000-0000-000000000706');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-00000000009d', 'CANCEL_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000720","reason":"Fin de la prueba"}', tests.iso('-70 minutes')))) ->> 'status',
  'applied', 'CANCEL_REPORT: libera al operario');

-- (c) Captura obsoleta (más antigua que la ventana de 7 días): se aplica y queda en cuarentena STALE_CAPTURE.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-0000000000a0', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000721","machineId":"3c000000-0000-0000-0000-000000000706","startedAt":"2020-01-01T10:00:00-05:00"}'))) ->> 'status',
  'applied', 'Captura de 2020: applied (los datos offline no se pierden)');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-0000000000a1', 'SAVE_REPORT_FIELDS',
    format('{"reportId":"8c000000-0000-0000-0000-000000000721","fields":{"production_order":"OP-OLD","line_id":"%s","client_name":"Cliente SY","lot":"L-OLD","product_name":"Producto SY","weight":100,"g_min":50,"dosifier_type_id":"%s","started_at":"2020-01-01T10:00:00-05:00","ended_at":"2020-01-01T12:00:00-05:00","programmed_hours":2,"units_produced":1000,"waste":5}}',
      (select id from public.lines order by sort_order limit 1), (select id from public.dosifier_types order by sort_order limit 1))::jsonb,
    '2020-01-01T12:00:00-05:00'))) ->> 'status',
  'applied', 'SAVE_REPORT_FIELDS obsoleto: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000706',
    'f1000000-0000-0000-0000-0000000000a2', 'SUBMIT_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000721"}', '2020-01-01T12:05:00-05:00'))) ->> 'review',
  'STALE_CAPTURE', 'El resultado indica review = STALE_CAPTURE');
select tests.auth_reset();
select is((select count(*) from public.sync_quarantine where report_id = '8c000000-0000-0000-0000-000000000721'
  and reason = 'STALE_CAPTURE' and status = 'OPEN'), 1::bigint, 'Una sola cuarentena OPEN STALE_CAPTURE por reporte');
select is((select count(*) from public.notification_events e
  join public.notification_deliveries d on d.event_id = e.id
  where e.type = 'OFFLINE_DATA_REVIEW' and e.resource_id = '8c000000-0000-0000-0000-000000000721'
    and d.recipient_id = '10000000-0000-0000-0000-000000000703'), 1::bigint, 'STALE_CAPTURE: el coordinador recibe OFFLINE_DATA_REVIEW');
select tests.auth_as('10000000-0000-0000-0000-000000000703');
select throws_ok($$select public.approve_report('8c000000-0000-0000-0000-000000000721')$$,
  'P0002', 'OPEN_CONFLICT', 'STALE_CAPTURE bloquea la aprobación');
select throws_ok(
  $$select public.review_quarantine((select id from public.sync_quarantine
    where report_id = '8c000000-0000-0000-0000-000000000721' and status = 'OPEN'), true, 'Motivo válido de revisión')$$,
  '22023', null, 'STALE_CAPTURE solo se puede marcar como revisado');
select is((select public.review_quarantine((select id from public.sync_quarantine
    where report_id = '8c000000-0000-0000-0000-000000000721' and status = 'OPEN'), false, 'Revisado con el operario') ->> 'status'),
  'REVIEWED', 'STALE_CAPTURE se marca revisado');
select lives_ok($$select public.approve_report('8c000000-0000-0000-0000-000000000721')$$,
  'Resuelta la revisión el reporte se aprueba');
select tests.auth_reset();

-- ------------------------------------------------------------------ Actores no autorizados
select tests.auth_as('10000000-0000-0000-0000-000000000704');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000704',
    'f1000000-0000-0000-0000-000000000080', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000708","machineId":"3c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'code',
  'FORBIDDEN', 'VIEWER: rejected FORBIDDEN');
select tests.auth_as('10000000-0000-0000-0000-000000000703');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000703',
    'f1000000-0000-0000-0000-000000000081', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000708","machineId":"3c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'code',
  'FORBIDDEN', 'Manager: rejected FORBIDDEN');
select tests.auth_as('10000000-0000-0000-0000-000000000705');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000705',
    'f1000000-0000-0000-0000-000000000082', 'CREATE_REPORT',
    '{"reportId":"8c000000-0000-0000-0000-000000000708","machineId":"3c000000-0000-0000-0000-000000000701","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'code',
  'FORBIDDEN', 'OPERATOR inactivo: rejected FORBIDDEN');
select tests.auth_reset();
select is((select count(*) from public.production_reports where id = '8c000000-0000-0000-0000-000000000708'), 0::bigint,
  'Los actores no autorizados no crean nada');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000701',
    'f1000000-0000-0000-0000-000000000083', 'CREATE_REPORT', '{}'))) ->> 'code',
  'FORBIDDEN', 'Sin sesión (auth.uid() nulo): rejected FORBIDDEN');
select is((select count(*) from public.sync_operation_log where operation_id in
  ('f1000000-0000-0000-0000-000000000080', 'f1000000-0000-0000-0000-000000000081', 'f1000000-0000-0000-0000-000000000082')), 0::bigint,
  'FORBIDDEN no se registra en sync_operation_log');

-- ------------------------------------------------------------------ review_quarantine
select tests.auth_as('10000000-0000-0000-0000-000000000701');
select throws_ok($$select public.review_quarantine((select id from public.sync_quarantine limit 1), false, null)$$,
  '42501', null, 'review_quarantine: el operario no puede revisar');
select tests.auth_as('10000000-0000-0000-0000-000000000704');
select throws_ok($$select public.review_quarantine((select id from public.sync_quarantine limit 1), false, null)$$,
  '42501', null, 'review_quarantine: el auditor no puede revisar');

select tests.auth_as('10000000-0000-0000-0000-000000000703');
-- R1 (SUBMITTED) no se puede aprobar con cuarentena OPEN.
select throws_ok($$select public.approve_report('8c000000-0000-0000-0000-000000000701')$$,
  'P0002', 'OPEN_CONFLICT', 'R1 con cuarentena OPEN no se aprueba');
select throws_ok($$select public.review_quarantine('00000000-0000-0000-0000-000000000000', false, null)$$,
  'P0006', 'NOT_FOUND', 'review_quarantine: elemento inexistente');
select throws_ok(
  $$select public.review_quarantine((select id from public.sync_quarantine
    where operation_id = 'f1000000-0000-0000-0000-000000000041'), true, 'abc')$$,
  '22023', null, 'review_quarantine: aplicar exige un motivo de al menos 5 caracteres');
select throws_ok(
  $$select public.review_quarantine((select id from public.sync_quarantine
    where operation_id = 'f1000000-0000-0000-0000-000000000053'), true, 'Motivo válido de revisión')$$,
  'P0005', 'NOT_CORRECTABLE', 'review_quarantine: no se aplica sobre un reporte cancelado');

-- Aplicar el cambio tardío al reporte enviado (vía correct_report).
select is((select public.review_quarantine((select id from public.sync_quarantine
    where operation_id = 'f1000000-0000-0000-0000-000000000041'), true, 'Cambio verificado con el operario') ->> 'applied'),
  'true', 'review_quarantine(apply): aplica el cambio al reporte enviado');
select is((select count(*) from public.report_change_events where report_id = '8c000000-0000-0000-0000-000000000701'
  and description = 'Cambio tardío'), 1::bigint, 'El cambio aplicado existe en el reporte');
select is((select status from public.sync_quarantine where operation_id = 'f1000000-0000-0000-0000-000000000041'), 'REVIEWED',
  'El elemento aplicado queda REVIEWED');
select ok((select reviewed_by = '10000000-0000-0000-0000-000000000703' and reviewed_at is not null
  from public.sync_quarantine where operation_id = 'f1000000-0000-0000-0000-000000000041'),
  'reviewed_by y reviewed_at se fijan');
select throws_ok(
  $$select public.review_quarantine((select id from public.sync_quarantine
    where operation_id = 'f1000000-0000-0000-0000-000000000041'), false, null)$$,
  'P0008', 'ALREADY_REVIEWED', 'review_quarantine: no se revisa dos veces');

-- Marcar revisado (sin aplicar) los conflictos de R1 y aprobar.
select lives_ok($$select public.review_quarantine(id, false, 'Se conserva el valor del servidor')
  from public.sync_quarantine where report_id = '8c000000-0000-0000-0000-000000000701' and status = 'OPEN'$$,
  'review_quarantine(no apply): marca revisado');
select lives_ok($$select public.approve_report('8c000000-0000-0000-0000-000000000701')$$,
  'Con la cuarentena resuelta el reporte se aprueba');
select is((select count(*) from public.sync_quarantine where report_id = '8c000000-0000-0000-0000-000000000701' and status = 'OPEN'), 0::bigint,
  'No quedan elementos OPEN en R1');
-- Reporte en borrador (R4): la cuarentena se puede marcar revisada pero no aplicar.
select throws_ok(
  $$select public.review_quarantine((select id from public.sync_quarantine
    where report_id = '8c000000-0000-0000-0000-000000000704' and status = 'OPEN'), true, 'Motivo válido de revisión')$$,
  'P0005', 'NOT_CORRECTABLE', 'review_quarantine: aplicar sobre un borrador no es posible');
select is((select public.review_quarantine((select id from public.sync_quarantine
    where report_id = '8c000000-0000-0000-0000-000000000704' and status = 'OPEN'), false, null) ->> 'status'),
  'REVIEWED', 'review_quarantine: la revisión de una asignación revocada se marca REVIEWED');

select tests.auth_reset();
select * from finish();
rollback;
