-- Phase 8 / MINOR-a de la auditoría de la Phase 7b: reenvíos entre usuarios y entre reportes.
-- Un operario B que reenvía SUBMIT_REPORT / CLOSE_STOP / SET_STOP_CATEGORY sobre el reporte o la parada de A recibe
-- `rejected NOT_FOUND` (la propiedad se comprueba ANTES que la rama de `duplicate`); nunca `duplicate`, que revelaría
-- que el efecto ya existe. Un START_STOP cuya parada ya existe en OTRO reporte se rechaza.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000911', 'cu-a@usuarios.reporte-produccion.invalid', '{"full_name":"CU Operario A"}'),
  ('10000000-0000-0000-0000-000000000912', 'cu-b@usuarios.reporte-produccion.invalid', '{"full_name":"CU Operario B"}');
update public.profiles set role = 'OPERATOR', active = true where id in
  ('10000000-0000-0000-0000-000000000911', '10000000-0000-0000-0000-000000000912');
insert into public.machines (id, code, name) values
  ('3c000000-0000-0000-0000-000000000911', 'CU-1', 'CU 1'),
  ('3c000000-0000-0000-0000-000000000912', 'CU-2', 'CU 2'),
  ('3c000000-0000-0000-0000-000000000913', 'CU-3', 'CU 3');
create temporary table cu_shift as select id from public.shifts where name = 'Día';
grant select on cu_shift to authenticated;
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, active, created_by)
select o, m, (select id from cu_shift), '2000-01-01', true, '10000000-0000-0000-0000-000000000001'
from (values
  ('10000000-0000-0000-0000-000000000911'::uuid, '3c000000-0000-0000-0000-000000000911'::uuid),
  ('10000000-0000-0000-0000-000000000911'::uuid, '3c000000-0000-0000-0000-000000000913'::uuid),
  ('10000000-0000-0000-0000-000000000912'::uuid, '3c000000-0000-0000-0000-000000000912'::uuid)
) as t(o, m);
update public.app_settings set offline_login_window = interval '100 years';

create function tests.mkop(p_user uuid, p_id uuid, p_type text, p_payload jsonb, p_cap text default null)
returns jsonb language sql as $$
  select jsonb_build_object('operationId', p_id, 'userId', p_user, 'seq', 1, 'type', p_type,
    'capturedAt', coalesce(p_cap, greatest(p_payload ->> 'startedAt', p_payload ->> 'endedAt', p_payload ->> 'occurredAt',
      '2026-10-09T10:00:00-05:00')), 'capturedOffline', true, 'payload', p_payload);
$$;
grant execute on function tests.mkop(uuid, uuid, text, jsonb, text) to public;
create function tests.op_id(n int) returns uuid language sql as $$ select format('f4000000-0000-0000-0000-%s', lpad(n::text, 12, '0'))::uuid $$;
grant execute on function tests.op_id(int) to public;

-- ------------------------------------------------------------------ A prepara su reporte (RA) con una parada cerrada (S1) y una abierta (S2)
select tests.auth_as('10000000-0000-0000-0000-000000000911');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(1), 'CREATE_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000911","machineId":"3c000000-0000-0000-0000-000000000911","startedAt":"2026-10-09T10:00:00-05:00"}'))) ->> 'status',
  'applied', 'A: CREATE_REPORT RA');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(2), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000911","reportId":"8c000000-0000-0000-0000-000000000911","startedAt":"2026-10-09T10:10:00-05:00"}'))) ->> 'status',
  'applied', 'A: START_STOP S1');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(3), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000911","reportId":"8c000000-0000-0000-0000-000000000911","endedAt":"2026-10-09T10:20:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'applied', 'A: CLOSE_STOP S1 (con categoría)');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(4), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000912","reportId":"8c000000-0000-0000-0000-000000000911","startedAt":"2026-10-09T10:30:00-05:00"}'))) ->> 'status',
  'applied', 'A: START_STOP S2 (abierta)');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(5), 'SET_STOP_CATEGORY',
  format('{"stopId":"9c000000-0000-0000-0000-000000000912","reportId":"8c000000-0000-0000-0000-000000000911","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb, '2026-10-09T10:31:00-05:00'))) ->> 'status',
  'applied', 'A: SET_STOP_CATEGORY S2');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000912');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(6), 'CREATE_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000912","machineId":"3c000000-0000-0000-0000-000000000912","startedAt":"2026-10-09T11:00:00-05:00"}'))) ->> 'status',
  'applied', 'B: CREATE_REPORT RB (propio)');

-- ------------------------------------------------------------------ B reenvía operaciones sobre lo de A: NOT_FOUND, nunca duplicate
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(101), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000911","reportId":"8c000000-0000-0000-0000-000000000911","endedAt":"2026-10-09T10:20:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'code',
  'NOT_FOUND', 'B: CLOSE_STOP idéntico sobre la parada cerrada de A: NOT_FOUND (no duplicate)');
select isnt((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(102), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000912","reportId":"8c000000-0000-0000-0000-000000000911","endedAt":"2026-10-09T10:40:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'duplicate', 'B: CLOSE_STOP sobre la parada abierta de A nunca es duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(103), 'SET_STOP_CATEGORY',
  format('{"stopId":"9c000000-0000-0000-0000-000000000912","reportId":"8c000000-0000-0000-0000-000000000911","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb, '2026-10-09T10:31:00-05:00'))) ->> 'code',
  'NOT_FOUND', 'B: SET_STOP_CATEGORY idéntico sobre la parada de A: NOT_FOUND (no duplicate)');
-- Aunque B declare el reportId de SU reporte, la parada se resuelve por su dueño real.
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(104), 'SET_STOP_CATEGORY',
  format('{"stopId":"9c000000-0000-0000-0000-000000000912","reportId":"8c000000-0000-0000-0000-000000000912","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb, '2026-10-09T11:31:00-05:00'))) ->> 'code',
  'NOT_FOUND', 'B: SET_STOP_CATEGORY con el reportId de B pero la parada de A: NOT_FOUND');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(105), 'SUBMIT_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000911"}', '2026-10-09T12:05:00-05:00'))) ->> 'code',
  'NOT_FOUND', 'B: SUBMIT_REPORT sobre el reporte de A: NOT_FOUND');

-- A envía su reporte (queda SUBMITTED); B repite el envío: sigue siendo NOT_FOUND, no duplicate.
select tests.auth_as('10000000-0000-0000-0000-000000000911');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(7), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000912","reportId":"8c000000-0000-0000-0000-000000000911","endedAt":"2026-10-09T10:40:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'status',
  'applied', 'A: CLOSE_STOP S2');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(8), 'SAVE_REPORT_FIELDS',
  format('{"reportId":"8c000000-0000-0000-0000-000000000911","fields":{"production_order":"OP-CU","line_id":"%s","client_name":"Cliente CU","lot":"L-CU","product_name":"Producto CU","weight":100,"g_min":50,"dosifier_type_id":"%s","started_at":"2026-10-09T10:00:00-05:00","ended_at":"2026-10-09T12:00:00-05:00","programmed_hours":2,"units_produced":1000,"waste":5}}',
    (select id from public.lines order by sort_order limit 1), (select id from public.dosifier_types order by sort_order limit 1))::jsonb,
  '2026-10-09T12:00:00-05:00'))) ->> 'status',
  'applied', 'A: SAVE_REPORT_FIELDS');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(9), 'SUBMIT_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000911"}', '2026-10-09T12:05:00-05:00'))) ->> 'status',
  'applied', 'A: SUBMIT_REPORT');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(109), 'SUBMIT_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000911"}', '2026-10-09T12:05:00-05:00'))) ->> 'status',
  'duplicate', 'A: su propio reenvío de SUBMIT_REPORT sí es duplicate');

select tests.auth_as('10000000-0000-0000-0000-000000000912');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(106), 'SUBMIT_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000911"}', '2026-10-09T12:05:00-05:00'))) ->> 'code',
  'NOT_FOUND', 'B: SUBMIT_REPORT sobre el reporte YA ENVIADO de A: NOT_FOUND (no duplicate)');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(107), 'CLOSE_STOP',
  format('{"stopId":"9c000000-0000-0000-0000-000000000912","reportId":"8c000000-0000-0000-0000-000000000911","endedAt":"2026-10-09T10:40:00-05:00","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb))) ->> 'code',
  'NOT_FOUND', 'B: CLOSE_STOP idéntico con el reporte de A ya enviado: NOT_FOUND (no duplicate)');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(108), 'SET_STOP_CATEGORY',
  format('{"stopId":"9c000000-0000-0000-0000-000000000911","reportId":"8c000000-0000-0000-0000-000000000911","categoryId":"%s"}',
    (select id from public.stop_categories where code = '1'))::jsonb, '2026-10-09T10:11:00-05:00'))) ->> 'code',
  'NOT_FOUND', 'B: SET_STOP_CATEGORY idéntico con el reporte de A ya enviado: NOT_FOUND (no duplicate)');

-- ------------------------------------------------------------------ START_STOP cuya parada existe en OTRO reporte
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(110), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000911","reportId":"8c000000-0000-0000-0000-000000000912","startedAt":"2026-10-09T11:10:00-05:00"}'))) ->> 'status',
  'rejected', 'B: START_STOP con el id de una parada de A en el reporte propio: rejected');
select isnt((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(111), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000911","reportId":"8c000000-0000-0000-0000-000000000912","startedAt":"2026-10-09T11:10:00-05:00"}'))) ->> 'status',
  'duplicate', 'B: ese START_STOP nunca es duplicate');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000912', tests.op_id(112), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000911","reportId":"8c000000-0000-0000-0000-000000000911","startedAt":"2026-10-09T11:10:00-05:00"}'))) ->> 'code',
  'NOT_FOUND', 'B: START_STOP directo sobre el reporte de A: NOT_FOUND');

-- Mismo usuario, otro reporte: A crea RA2 (otra máquina) y repite el id de una parada de RA.
select tests.auth_as('10000000-0000-0000-0000-000000000911');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(10), 'CREATE_REPORT',
  '{"reportId":"8c000000-0000-0000-0000-000000000913","machineId":"3c000000-0000-0000-0000-000000000913","startedAt":"2026-10-09T13:00:00-05:00"}'))) ->> 'status',
  'applied', 'A: CREATE_REPORT RA2');
select is((select public.apply_sync_operation(tests.mkop('10000000-0000-0000-0000-000000000911', tests.op_id(113), 'START_STOP',
  '{"stopId":"9c000000-0000-0000-0000-000000000911","reportId":"8c000000-0000-0000-0000-000000000913","startedAt":"2026-10-09T13:10:00-05:00"}'))) ->> 'status',
  'rejected', 'A: START_STOP en RA2 con el id de una parada de RA: rejected');

-- Nada de lo de A cambió por los reenvíos de B.
select tests.auth_reset();
select is((select count(*) from public.report_stop_events where report_id = '8c000000-0000-0000-0000-000000000912'), 0::bigint,
  'El reporte de B no recibió ninguna parada');
select is((select status::text from public.production_reports where id = '8c000000-0000-0000-0000-000000000911'), 'SUBMITTED',
  'El reporte de A sigue SUBMITTED');
select is((select count(*) from public.sync_quarantine where user_id = '10000000-0000-0000-0000-000000000912'), 0::bigint,
  'Los reenvíos cruzados de B no generan cuarentena');
select is((select count(*) from public.sync_operation_log where user_id = '10000000-0000-0000-0000-000000000912' and result = 'applied'
    and operation_id <> tests.op_id(6)), 0::bigint,
  'B no tiene ninguna operación applied sobre lo de A');

select * from finish();
rollback;
