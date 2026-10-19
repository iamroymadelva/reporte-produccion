-- 002-indicators-dashboard (T005): public.indicators_summary(p_from, p_to). Fixtures compartidos con T015/T018/T023.
-- Fechas de 2033 y folios RPT-2033-9xxxxx para no chocar con otros datos.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

-- ---------------------------------------------------------------- Usuarios de prueba
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000601', 'is-root@usuarios.reporte-produccion.invalid', '{"full_name":"IS Root","username":"is-root"}'),
  ('10000000-0000-0000-0000-000000000602', 'is-adm@usuarios.reporte-produccion.invalid', '{"full_name":"IS Admin","username":"is-adm"}'),
  ('10000000-0000-0000-0000-000000000603', 'is-aud@usuarios.reporte-produccion.invalid', '{"full_name":"IS Auditor","username":"is-aud"}'),
  ('10000000-0000-0000-0000-000000000604', 'is-op@usuarios.reporte-produccion.invalid', '{"full_name":"IS Operario","username":"is-op"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000601';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000602';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000603';
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000604';

-- ---------------------------------------------------------------- Catalogos propios
insert into public.machines (id, code, name) values
  ('3e000000-0000-0000-0000-000000000001', 'IS-A', 'IS Maquina A'),
  ('3e000000-0000-0000-0000-000000000002', 'IS-B', 'IS Maquina B');
insert into public.stop_categories (id, code, name) values
  ('1e000000-0000-0000-0000-000000000001', '9971', 'IS Mecanica'),
  ('1e000000-0000-0000-0000-000000000002', '9972', 'IS Electrica');
-- Turno diurno 06:00-14:00 y nocturno 22:00-06:00 (cruza la medianoche).
insert into public.shifts (id, name, start_time, end_time) values
  ('5e000000-0000-0000-0000-000000000001', 'IS Dia', '06:00', '14:00'),
  ('5e000000-0000-0000-0000-000000000002', 'IS Noche', '22:00', '06:00');

-- ---------------------------------------------------------------- Reportes sinteticos (sin triggers)
-- 03-01 SUBMITTED dia | 03-02 CLOSED dia (aprobado 20:00 -> +6 h) | 03-03 CLOSED noche (fin 03-04 06:00; aprobado 03-04 12:00 -> +6 h)
-- 03-04 CLOSED dia aprobado ANTES del fin (-> 0) | 03-05 CLOSED sin turno (cuenta, no entra al promedio)
-- 03-06 DRAFT y CANCELLED (excluidos).
set local session_replication_role = replica;
insert into public.production_reports (id, folio, report_date, machine_id, shift_id, status, created_by, updated_by,
  creator_full_name, creator_role, submitted_by, submitted_at, approved_by, approved_at, approver_full_name,
  cancellation_reason, cancelled_at, cancelled_by, started_at)
values
  ('9e000000-0000-0000-0000-000000000001', 'RPT-2033-900001', '2033-03-01', '3e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 'SUBMITTED',
    '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000604', '2033-03-01 20:00-05', null, null, null, null, null, null, '2033-03-01 06:00-05'),
  ('9e000000-0000-0000-0000-000000000002', 'RPT-2033-900002', '2033-03-02', '3e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 'CLOSED',
    '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000604', '2033-03-02 14:00-05', '10000000-0000-0000-0000-000000000602', '2033-03-02 20:00-05', 'IS Admin',
    null, null, null, '2033-03-02 06:00-05'),
  ('9e000000-0000-0000-0000-000000000003', 'RPT-2033-900003', '2033-03-03', '3e000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000002', 'CLOSED',
    '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000604', '2033-03-04 06:00-05', '10000000-0000-0000-0000-000000000602', '2033-03-04 12:00-05', 'IS Admin',
    null, null, null, '2033-03-03 22:00-05'),
  ('9e000000-0000-0000-0000-000000000004', 'RPT-2033-900004', '2033-03-04', '3e000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000001', 'CLOSED',
    '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000604', '2033-03-04 09:00-05', '10000000-0000-0000-0000-000000000602', '2033-03-04 10:00-05', 'IS Admin',
    null, null, null, '2033-03-04 06:00-05'),
  ('9e000000-0000-0000-0000-000000000005', 'RPT-2033-900005', '2033-03-05', '3e000000-0000-0000-0000-000000000001', null, 'CLOSED',
    '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000604', '2033-03-05 14:00-05', '10000000-0000-0000-0000-000000000602', '2033-03-06 08:00-05', 'IS Admin',
    null, null, null, '2033-03-05 06:00-05'),
  ('9e000000-0000-0000-0000-000000000006', 'RPT-2033-900006', '2033-03-06', '3e000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000001', 'DRAFT',
    '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
    null, null, null, null, null, null, null, null, '2033-03-06 06:00-05'),
  ('9e000000-0000-0000-0000-000000000007', 'RPT-2033-900007', '2033-03-06', '3e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 'CANCELLED',
    '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
    null, null, null, null, null, 'Prueba', '2033-03-06 07:00-05', '10000000-0000-0000-0000-000000000602', '2033-03-06 06:00-05');

-- Paradas: cerradas (cuentan), abierta y cancelada (no cuentan), una sin categoria; una cruza la medianoche.
insert into public.report_stop_events (report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id,
  cancellation_reason, cancelled_at, cancelled_by)
values
  ('9e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', '2033-03-01 07:00-05', '2033-03-01 08:00-05', 3600, '10000000-0000-0000-0000-000000000604', null, null, null),
  ('9e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000002', '2033-03-01 09:00-05', '2033-03-01 09:30-05', 1800, '10000000-0000-0000-0000-000000000604', null, null, null),
  ('9e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', '2033-03-01 10:00-05', '2033-03-01 11:30-05', null, '10000000-0000-0000-0000-000000000604', 'Error', '2033-03-01 11:30-05', '10000000-0000-0000-0000-000000000602'),
  ('9e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-000000000001', '2033-03-01 12:00-05', null, null, '10000000-0000-0000-0000-000000000604', null, null, null),
  ('9e000000-0000-0000-0000-000000000003', '1e000000-0000-0000-0000-000000000001', '2033-03-03 23:30-05', '2033-03-04 00:30-05', 3600, '10000000-0000-0000-0000-000000000604', null, null, null),
  ('9e000000-0000-0000-0000-000000000003', null, '2033-03-04 01:00-05', '2033-03-04 01:10-05', 600, '10000000-0000-0000-0000-000000000604', null, null, null),
  -- Parada de un reporte DRAFT: no cuenta.
  ('9e000000-0000-0000-0000-000000000006', '1e000000-0000-0000-0000-000000000001', '2033-03-06 07:00-05', '2033-03-06 08:00-05', 3600, '10000000-0000-0000-0000-000000000604', null, null, null);
set local session_replication_role = origin;

-- ---------------------------------------------------------------- Como ADMINISTRATOR (d)
select tests.auth_as('10000000-0000-0000-0000-000000000602');

create temp table is_res on commit drop as
  select public.indicators_summary('2033-03-01', '2033-03-10') as j;
grant all on is_res to authenticated;

-- (a) cuenta solo SUBMITTED + CLOSED
select is((select (j->'cards'->>'reports')::int from is_res), 5, '(a) cards.reports cuenta SUBMITTED y CLOSED y excluye DRAFT y CANCELLED');
select is((select (j->'cards'->>'approved')::int from is_res), 4, '(a) cards.approved cuenta solo CLOSED');
select is((select (j->'cards'->>'stopSeconds')::bigint from is_res), 9600::bigint,
  '(a) stopSeconds suma solo paradas cerradas y no canceladas de reportes contados (3600+1800+3600+600)');

-- (b) approvedRatio
select is((select (j->'cards'->>'approvedRatio')::numeric from is_res), 0.8, '(b) approvedRatio = closed/(submitted+closed)');
select is((select public.indicators_summary('2033-04-01', '2033-04-07')->'cards'->'approvedRatio'), 'null'::jsonb,
  '(b) approvedRatio es null sin reportes');
select is((select (public.indicators_summary('2033-03-01', '2033-03-01')->'cards'->>'approvedRatio')::numeric), 0::numeric,
  '(b) approvedRatio es 0 con reportes y ninguno aprobado');

-- (c) avgApprovalSeconds: (21600 dia + 21600 noche + 0 anticipado) / 3 = 14400; el reporte sin turno no entra
select is((select (j->'cards'->>'avgApprovalSeconds')::bigint from is_res), 14400::bigint,
  '(c) avgApprovalSeconds: turno diurno, nocturno (fin = report_date + 1), aprobacion anticipada (0) y sin turno excluido');
select is((select (public.indicators_summary('2033-03-03', '2033-03-03')->'cards'->>'avgApprovalSeconds')::bigint), 21600::bigint,
  '(c) turno nocturno: el fin de turno cae en report_date + 1');
select is((select (public.indicators_summary('2033-03-04', '2033-03-04')->'cards'->>'avgApprovalSeconds')::bigint), 0::bigint,
  '(c) aprobacion anterior al fin del turno se acota a 0');
select is((select (public.indicators_summary('2033-03-05', '2033-03-05')->'cards'->>'reports')::int), 1,
  '(c) reporte sin turno se cuenta en reports');
select is((select public.indicators_summary('2033-03-05', '2033-03-05')->'cards'->'avgApprovalSeconds'), 'null'::jsonb,
  '(c) reporte sin turno no entra al promedio (null si no queda ninguno)');
select is((select public.indicators_summary('2033-03-01', '2033-03-01')->'cards'->'avgApprovalSeconds'), 'null'::jsonb,
  '(c) avgApprovalSeconds es null si no hay CLOSED');

-- Forma basica del resto de la respuesta (cubierta a fondo en T018/T023)
select is((select jsonb_array_length(j->'daily') from is_res), 10, 'daily trae un elemento por dia del rango');
select is((select (j->'range'->>'days')::int from is_res), 10, 'range.days correcto');

-- ---------------------------------------------------------------- Permisos y validacion (T015)
select is((select prosecdef from pg_proc where oid = 'public.indicators_summary(date,date)'::regprocedure), false,
  '(T015) indicators_summary es security invoker');
select is(has_function_privilege('anon', 'public.indicators_summary(date,date)', 'execute'), false,
  '(T015) anon no puede ejecutar indicators_summary');

-- ROOT, ADMINISTRATOR y VIEWER obtienen JSON con datos
select tests.auth_as('10000000-0000-0000-0000-000000000601');
select is((select (public.indicators_summary('2033-03-01', '2033-03-10')->'cards'->>'reports')::int), 5, '(T015) ROOT obtiene datos');
select tests.auth_as('10000000-0000-0000-0000-000000000602');
select is((select (public.indicators_summary('2033-03-01', '2033-03-10')->'cards'->>'reports')::int), 5, '(T015) ADMINISTRATOR obtiene datos');
select tests.auth_as('10000000-0000-0000-0000-000000000603');
select is((select (public.indicators_summary('2033-03-01', '2033-03-10')->'cards'->>'reports')::int), 5, '(T015) VIEWER obtiene datos');

-- OPERATOR denegado
select tests.auth_as('10000000-0000-0000-0000-000000000604');
select throws_ok($$select public.indicators_summary('2033-03-01', '2033-03-10')$$, '42501', null, '(T015) OPERATOR no puede consultar indicadores');

-- Rangos invalidos (como ADMINISTRATOR)
select tests.auth_as('10000000-0000-0000-0000-000000000602');
select throws_ok($$select public.indicators_summary('2033-03-10', '2033-03-01')$$, '22023', null, '(T015) rango invertido -> 22023');
select throws_ok($$select public.indicators_summary('2033-01-01', '2034-01-02')$$, '22023', null, '(T015) rango de 367 dias -> 22023');
select lives_ok($$select public.indicators_summary('2033-01-01', '2034-01-01')$$, '(T015) rango de 366 dias es valido');

select * from finish();
rollback;
