-- Corrección MAJOR-2 de la Phase 7b: un reenvío tras una respuesta perdida (la operación ya se aplicó, p. ej. por la
-- ruta en línea que no pasa por sync_operation_log, y el cliente la reenvía por el lote con OTRA operationId) debe
-- devolver `duplicate`, sin cuarentena ni notificaciones. Los conflictos genuinos siguen siendo conflictos.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000801', 'rp-op1@usuarios.reporte-produccion.invalid', '{"full_name":"RP Operario 1"}'),
  ('10000000-0000-0000-0000-000000000802', 'rp-coord@usuarios.reporte-produccion.invalid', '{"full_name":"RP Coordinador"}');
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000801';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000802';
insert into public.machines (id, code, name) values
  ('3c000000-0000-0000-0000-000000000801', 'RP-1', 'RP 1'),
  ('3c000000-0000-0000-0000-000000000802', 'RP-2', 'RP 2');
create temporary table rp_shift as select id from public.shifts where name = 'Día';
grant select on rp_shift to authenticated;
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, active, created_by)
select '10000000-0000-0000-0000-000000000801', m, (select id from rp_shift), '2000-01-01', true, '10000000-0000-0000-0000-000000000001'
from unnest(array['3c000000-0000-0000-0000-000000000801', '3c000000-0000-0000-0000-000000000802']::uuid[]) m;
update public.app_settings set offline_login_window = interval '100 years';

create function tests.mkop(p_user uuid, p_id uuid, p_type text, p_payload jsonb, p_cap text default null)
returns jsonb language sql as $$
  select jsonb_build_object('operationId', p_id, 'userId', p_user, 'seq', 1, 'type', p_type,
    'capturedAt', coalesce(p_cap, greatest(p_payload ->> 'startedAt', p_payload ->> 'endedAt', p_payload ->> 'occurredAt',
      '2026-10-09T10:00:00-05:00')), 'capturedOffline', true, 'payload', p_payload);
$$;
grant execute on function tests.mkop(uuid, uuid, text, jsonb, text) to public;
create function tests.op_id(n int) returns uuid language sql as $$ select format('f2000000-0000-0000-0000-%s', lpad(n::text, 12, '0'))::uuid $$;
grant execute on function tests.op_id(int) to public;

select tests.auth_as('10000000-0000-0000-0000-000000000801');

-- ------------------------------------------------------------------ Preparación (cada operación con su operationId)
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(1), 'CREATE_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000801","machineId":"3c000000-0000-0000-0000-000000000801","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'status',
  'applied', 'CREATE_REPORT: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(2), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000801","reportId":"8c000000-0000-0000-0000-000000000801","startedAt":"2026-10-09T10:10:00-05:00"}'))) ->> 'status',
  'applied', 'START_STOP S1: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(3), 'SET_STOP_CATEGORY',
  format('{"stopId":"9c000000-0000-0000-0000-000000000801","reportId":"8c000000-0000-0000-0000-000000000801","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb, '2026-10-09T10:11:00-05:00'))) ->> 'status',
  'applied', 'SET_STOP_CATEGORY S1: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(4), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000801","reportId":"8c000000-0000-0000-0000-000000000801","endedAt":"2026-10-09T10:20:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'applied', 'CLOSE_STOP S1: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(5), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000802","reportId":"8c000000-0000-0000-0000-000000000801","startedAt":"2026-10-09T10:30:00-05:00"}'))) ->> 'status',
  'applied', 'START_STOP S2: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(6), 'CANCEL_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000802","reportId":"8c000000-0000-0000-0000-000000000801","reason":"Inicio accidental"}',
  '2026-10-09T10:31:00-05:00'))) ->> 'status',
  'applied', 'CANCEL_STOP S2: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(7), 'SAVE_REPORT_FIELDS',
  format('{"reportId":"8c000000-0000-0000-0000-000000000801","fields":{"production_order":"OP-RP","line_id":"%s","client_name":"Cliente RP","lot":"L-RP","product_name":"Producto RP","weight":100,"g_min":50,"dosifier_type_id":"%s","started_at":"2026-10-09T10:00:00-05:00","ended_at":"2026-10-09T12:00:00-05:00","programmed_hours":2,"units_produced":1000,"waste":5}}',
    (select id from public.lines order by sort_order limit 1), (select id from public.dosifier_types order by sort_order limit 1))::jsonb,
  '2026-10-09T12:00:00-05:00'))) ->> 'status',
  'applied', 'SAVE_REPORT_FIELDS: applied');

-- ------------------------------------------------------------------ Reenvíos con OTRA operationId (aplicados fuera del log)
-- Mientras el reporte aún es DRAFT: parada ya cancelada / ya cerrada / categoría ya igual.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(106), 'CANCEL_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000802","reportId":"8c000000-0000-0000-0000-000000000801","reason":"Inicio accidental"}',
  '2026-10-09T10:31:00-05:00'))) ->> 'status',
  'duplicate', 'Reenvío de CANCEL_STOP (parada ya cancelada, mismo motivo): duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(103), 'SET_STOP_CATEGORY',
  format('{"stopId":"9c000000-0000-0000-0000-000000000801","reportId":"8c000000-0000-0000-0000-000000000801","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb, '2026-10-09T10:11:00-05:00'))) ->> 'status',
  'duplicate', 'Reenvío de SET_STOP_CATEGORY (categoría ya igual, parada ya cerrada): duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(104), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000801","reportId":"8c000000-0000-0000-0000-000000000801","endedAt":"2026-10-09T10:20:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'duplicate', 'Reenvío de CLOSE_STOP (misma hora y categoría): duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(107), 'SAVE_REPORT_FIELDS',
  '{"reportId":"8c000000-0000-0000-0000-000000000801","fields":{"lot":"L-RP"}}', '2026-10-09T12:00:00-05:00'))) ->> 'status',
  'duplicate', 'Reenvío de SAVE_REPORT_FIELDS con valores ya iguales: duplicate');

-- Genuinos (valores distintos) siguen rechazándose/conflicto mientras es DRAFT.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(120), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000801","reportId":"8c000000-0000-0000-0000-000000000801","endedAt":"2026-10-09T10:25:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'rejected', 'CLOSE_STOP con otra hora de fin sobre una parada cerrada: sigue rechazada');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(121), 'CANCEL_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000802","reportId":"8c000000-0000-0000-0000-000000000801","reason":"Otro motivo distinto"}',
  '2026-10-09T10:31:00-05:00'))) ->> 'status',
  'rejected', 'CANCEL_STOP con otro motivo sobre una parada ya cancelada: sigue rechazada');

-- ------------------------------------------------------------------ SUBMIT y reenvíos con el reporte ya enviado
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(8), 'SUBMIT_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000801"}', '2026-10-09T12:05:00-05:00'))) ->> 'status',
  'applied', 'SUBMIT_REPORT: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(108), 'SUBMIT_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000801"}', '2026-10-09T12:05:00-05:00'))) ->> 'status',
  'duplicate', 'Reenvío de SUBMIT_REPORT con el reporte ya SUBMITTED: duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(109), 'CANCEL_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000802","reportId":"8c000000-0000-0000-0000-000000000801","reason":"Inicio accidental"}',
  '2026-10-09T10:31:00-05:00'))) ->> 'status',
  'duplicate', 'Reenvío de CANCEL_STOP con el reporte ya enviado: duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(110), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000801","reportId":"8c000000-0000-0000-0000-000000000801","endedAt":"2026-10-09T10:20:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'duplicate', 'Reenvío de CLOSE_STOP con el reporte ya enviado: duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(111), 'SET_STOP_CATEGORY',
  format('{"stopId":"9c000000-0000-0000-0000-000000000801","reportId":"8c000000-0000-0000-0000-000000000801","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb, '2026-10-09T10:11:00-05:00'))) ->> 'status',
  'duplicate', 'Reenvío de SET_STOP_CATEGORY con el reporte ya enviado: duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(112), 'SAVE_REPORT_FIELDS',
  '{"reportId":"8c000000-0000-0000-0000-000000000801","fields":{"lot":"L-RP"}}', '2026-10-09T12:00:00-05:00'))) ->> 'status',
  'duplicate', 'Reenvío de SAVE_REPORT_FIELDS con el reporte ya enviado y valores iguales: duplicate');
-- Un conflicto genuino sigue siéndolo: valores distintos sobre un reporte ya enviado.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(113), 'SAVE_REPORT_FIELDS',
  '{"reportId":"8c000000-0000-0000-0000-000000000801","fields":{"lot":"L-OTRO"}}', '2026-10-09T12:00:00-05:00'))) ->> 'code',
  'REPORT_NOT_DRAFT', 'SAVE_REPORT_FIELDS con valores distintos sobre un reporte enviado: conflict REPORT_NOT_DRAFT');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(114), 'CANCEL_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000801","reason":"tarde"}'))) ->> 'code',
  'REPORT_NOT_DRAFT', 'CANCEL_REPORT sobre un reporte enviado: conflict REPORT_NOT_DRAFT');

-- Solo el conflicto genuino (113) y el de CANCEL_REPORT (114) llegan a la cuarentena; los reenvíos no.
select tests.auth_reset();
select is((select count(*) from public.sync_quarantine where report_id = '8c000000-0000-0000-0000-000000000801'), 2::bigint,
  'Los reenvíos duplicate no crean filas en sync_quarantine (solo los 2 conflictos genuinos)');
select is((select count(*) from public.sync_quarantine where operation_id in (
    select tests.op_id(n) from generate_series(103, 112) n)), 0::bigint,
  'Ninguna operación de reenvío (103-112) está en cuarentena');
select tests.auth_as('10000000-0000-0000-0000-000000000801');

-- ------------------------------------------------------------------ Reporte cancelado por el autor y reenvío de CANCEL_REPORT
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(20), 'CREATE_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000802","machineId":"3c000000-0000-0000-0000-000000000802","startedAt":"2026-10-09T13:00:00-05:00"}'))) ->> 'status',
  'applied', 'CREATE_REPORT (segundo): applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(21), 'CANCEL_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000802","reason":"Error de captura"}', '2026-10-09T13:05:00-05:00'))) ->> 'status',
  'applied', 'CANCEL_REPORT: applied');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(121), 'CANCEL_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000802","reason":"Error de captura"}', '2026-10-09T13:05:00-05:00'))) ->> 'status',
  'duplicate', 'Reenvío de CANCEL_REPORT (ya cancelado por el autor, mismo motivo): duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000801', tests.op_id(122), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000890","reportId":"8c000000-0000-0000-0000-000000000802","startedAt":"2026-10-09T13:10:00-05:00"}'))) ->> 'status',
  'conflict', 'Un START_STOP nuevo sobre un reporte cancelado sigue siendo un conflicto genuino');

select * from finish();
rollback;
