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

-- ---------------------------------------------------------------- Fixtures T018 / T023 (fechas propias, sin tocar 2033-03-01..06)
set local session_replication_role = replica;

-- T018 (d): 12 maquinas, un reporte SUBMITTED el 2033-05-10 cada una. Segundos: M01..M09 = 100*k, M10 = M11 = 1000 (empate), M12 solo con parada cancelada.
insert into public.machines (id, code, name)
select ('3e000000-0000-0000-0001-0000000000' || lpad(k::text, 2, '0'))::uuid, 'IS-M' || lpad(k::text, 2, '0'), 'IS Maq ' || k
from generate_series(1, 12) k;
insert into public.production_reports (id, folio, report_date, machine_id, shift_id, status, created_by, updated_by,
  creator_full_name, creator_role, submitted_by, submitted_at, started_at)
select ('9e000000-0000-0000-0001-0000000000' || lpad(k::text, 2, '0'))::uuid, 'RPT-2033-9100' || lpad(k::text, 2, '0'), '2033-05-10',
  ('3e000000-0000-0000-0001-0000000000' || lpad(k::text, 2, '0'))::uuid, null, 'SUBMITTED',
  '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
  '10000000-0000-0000-0000-000000000604', '2033-05-10 14:00-05', '2033-05-10 06:00-05'
from generate_series(1, 12) k;
insert into public.report_stop_events (report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id,
  cancellation_reason, cancelled_at, cancelled_by)
select ('9e000000-0000-0000-0001-0000000000' || lpad(k::text, 2, '0'))::uuid, '1e000000-0000-0000-0000-000000000001',
  '2033-05-10 07:00-05', '2033-05-10 07:00-05'::timestamptz + (case when k = 11 then 1000 else 100 * k end) * interval '1 second',
  case when k = 11 then 1000 else 100 * k end, '10000000-0000-0000-0000-000000000604', null, null, null
from generate_series(1, 11) k;
insert into public.report_stop_events (report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id,
  cancellation_reason, cancelled_at, cancelled_by)
values ('9e000000-0000-0000-0001-000000000012', '1e000000-0000-0000-0000-000000000001', '2033-05-10 07:00-05', '2033-05-10 08:00-05', null,
  '10000000-0000-0000-0000-000000000604', 'Error', '2033-05-10 08:00-05', '10000000-0000-0000-0000-000000000602');

-- T018 (e): reporte con report_date 2033-03-20 cuyas fechas UTC caen en otro dia (03-21 03:00Z = 03-20 22:00 Bogota).
insert into public.production_reports (id, folio, report_date, machine_id, shift_id, status, created_by, updated_by,
  creator_full_name, creator_role, submitted_by, submitted_at, started_at, created_at)
values ('9e000000-0000-0000-0002-000000000001', 'RPT-2033-930001', '2033-03-20', '3e000000-0000-0000-0000-000000000001', null, 'SUBMITTED',
  '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
  '10000000-0000-0000-0000-000000000604', '2033-03-21 05:00+00', '2033-03-21 03:00+00', '2033-03-21 03:00+00');
insert into public.report_stop_events (report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id)
values ('9e000000-0000-0000-0002-000000000001', '1e000000-0000-0000-0000-000000000001', '2033-03-21 04:00+00', '2033-03-21 05:00+00', 3600,
  '10000000-0000-0000-0000-000000000604');

-- T023: 8 categorias propias (cat k = 100*k segundos) y un reporte SUBMITTED por escenario (2033-06-01..05).
insert into public.stop_categories (id, code, name)
select ('1e000000-0000-0000-0001-0000000000' || lpad(k::text, 2, '0'))::uuid, '99' || (80 + k), 'IS Cat ' || k
from generate_series(1, 8) k;
insert into public.production_reports (id, folio, report_date, machine_id, shift_id, status, created_by, updated_by,
  creator_full_name, creator_role, submitted_by, submitted_at, started_at)
select ('9e000000-0000-0000-0003-00000000000' || d)::uuid, 'RPT-2033-92000' || d, ('2033-06-0' || d)::date, '3e000000-0000-0000-0000-000000000001', null, 'SUBMITTED',
  '10000000-0000-0000-0000-000000000604', '10000000-0000-0000-0000-000000000604', 'IS Operario', 'OPERATOR',
  '10000000-0000-0000-0000-000000000604', ('2033-06-0' || d || ' 14:00-05')::timestamptz, ('2033-06-0' || d || ' 06:00-05')::timestamptz
from generate_series(1, 5) d;
-- (d=1) 8 categorias; (d=2) 6; (d=3) 3; (d=4) 1 categoria + sin categoria grande;
-- (d=5) 6 categorias de 1000..500 + sin categoria de 10 s (cae en "Otras").
insert into public.report_stop_events (report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id)
select ('9e000000-0000-0000-0003-00000000000' || x.d)::uuid,
  case when x.k = 0 then null else ('1e000000-0000-0000-0001-0000000000' || lpad(x.k::text, 2, '0'))::uuid end,
  ('2033-06-0' || x.d || ' 06:00-05')::timestamptz + x.k * interval '1 hour',
  ('2033-06-0' || x.d || ' 06:00-05')::timestamptz + x.k * interval '1 hour' + x.secs * interval '1 second',
  x.secs, '10000000-0000-0000-0000-000000000604'
from (
  select 1 as d, k, 100 * k as secs from generate_series(1, 8) k
  union all select 2, k, 100 * k from generate_series(1, 6) k
  union all select 3, k, 100 * k from generate_series(1, 3) k
  union all select 4, 1, 500
  union all select 4, 0, 300
  union all select 5, k, 1000 - 100 * (k - 1) from generate_series(1, 6) k
  union all select 5, 0, 10
) x;
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

-- ---------------------------------------------------------------- T018: daily y machines
select is((select jsonb_array_length(j->'daily') from is_res), 10, '(T018 a) daily tiene exactamente days elementos');
select is((select array_agg(e->>'date' order by ord) from is_res, jsonb_array_elements(j->'daily') with ordinality t(e, ord)),
  array['2033-03-01','2033-03-02','2033-03-03','2033-03-04','2033-03-05','2033-03-06','2033-03-07','2033-03-08','2033-03-09','2033-03-10'],
  '(T018 a) daily en orden ascendente por fecha');
select is((select (j->'daily'->1->>'seconds')::bigint from is_res), 0::bigint, '(T018 a) dia sin paradas = 0');
select is((select sum((e->>'seconds')::bigint)::bigint from is_res, jsonb_array_elements(j->'daily') e), 9600::bigint,
  '(T018 a) suma de daily = cards.stopSeconds');
select is((select (j->'daily'->0->>'seconds')::bigint from is_res), 5400::bigint,
  '(T018 b) 03-01 solo suma paradas cerradas no canceladas (3600+1800); excluye abierta y cancelada');
select is((select (j->'daily'->5->>'seconds')::bigint from is_res), 0::bigint,
  '(T018 b) 03-06 (DRAFT y CANCELLED) no suma paradas');
select is((select (j->'daily'->2->>'seconds')::bigint from is_res), 4200::bigint,
  '(T018 c) la parada que cruza la medianoche cuenta completa en el report_date (3600+600)');
select is((select (j->'daily'->3->>'seconds')::bigint from is_res), 0::bigint,
  '(T018 c) nada en el dia siguiente a la parada que cruza la medianoche');
select is((select jsonb_array_length(public.indicators_summary('2033-05-10', '2033-05-10')->'machines')), 10,
  '(T018 d) machines devuelve maximo 10 con 12 maquinas');
select is((select array_agg(e->>'code' order by ord) from jsonb_array_elements(public.indicators_summary('2033-05-10', '2033-05-10')->'machines') with ordinality t(e, ord)),
  array['IS-M10','IS-M11','IS-M09','IS-M08','IS-M07','IS-M06','IS-M05','IS-M04','IS-M03','IS-M02'],
  '(T018 d) orden descendente por segundos con desempate por code; M01 queda fuera del top 10');
select is((select count(*)::int from jsonb_array_elements(public.indicators_summary('2033-05-10', '2033-05-10')->'machines') e where (e->>'seconds')::bigint <= 0),
  0, '(T018 d) solo maquinas con seconds > 0');
select is((select count(*)::int from jsonb_array_elements(public.indicators_summary('2033-05-10', '2033-05-10')->'machines') e where e->>'code' = 'IS-M12'),
  0, '(T018 d) maquina con solo parada cancelada no aparece');
select is((select (public.indicators_summary('2033-03-20', '2033-03-21')->'daily'->0->>'seconds')::bigint), 3600::bigint,
  '(T018 e) reporte creado cerca de medianoche UTC se agrupa en su report_date');
select is((select (public.indicators_summary('2033-03-20', '2033-03-21')->'daily'->1->>'seconds')::bigint), 0::bigint,
  '(T018 e) el dia UTC siguiente no recibe segundos');

-- ---------------------------------------------------------------- T023: categories
select is((select array_agg(e->>'kind' order by ord) from jsonb_array_elements(public.indicators_summary('2033-06-04', '2033-06-04')->'categories') with ordinality t(e, ord)),
  array['category','uncategorized'], '(T023 a) parada sin categoria sale como kind = uncategorized');
select is((select (e->>'seconds')::bigint from jsonb_array_elements(public.indicators_summary('2033-06-04', '2033-06-04')->'categories') e where e->>'kind' = 'uncategorized'),
  300::bigint, '(T023 a) segundos de uncategorized correctos');
select is((select jsonb_array_length(public.indicators_summary('2033-06-01', '2033-06-01')->'categories')), 6, '(T023 b) 8 categorias -> 6 elementos');
select is((select array_agg(e->>'name' order by ord) from jsonb_array_elements(public.indicators_summary('2033-06-01', '2033-06-01')->'categories') with ordinality t(e, ord) where ord <= 5),
  array['IS Cat 8','IS Cat 7','IS Cat 6','IS Cat 5','IS Cat 4'], '(T023 b) los 5 primeros son las mayores en orden');
select is((select e->>'kind' from jsonb_array_elements(public.indicators_summary('2033-06-01', '2033-06-01')->'categories') with ordinality t(e, ord) where ord = 6),
  'other', '(T023 b) other va al final');
select is((select (e->>'seconds')::bigint from jsonb_array_elements(public.indicators_summary('2033-06-01', '2033-06-01')->'categories') e where e->>'kind' = 'other'),
  600::bigint, '(T023 b) other = suma exacta de las 3 menores (100+200+300)');
select is((select jsonb_array_length(public.indicators_summary('2033-06-02', '2033-06-02')->'categories')), 6, '(T023 c) 6 categorias -> 6 elementos');
select is((select count(*)::int from jsonb_array_elements(public.indicators_summary('2033-06-02', '2033-06-02')->'categories') e where e->>'kind' = 'other'),
  0, '(T023 c) sin other con exactamente 6');
select is((select jsonb_array_length(public.indicators_summary('2033-06-03', '2033-06-03')->'categories')), 3, '(T023 d) 3 categorias -> 3 elementos');
select is((select sum((e->>'seconds')::bigint)::bigint from jsonb_array_elements(public.indicators_summary('2033-06-01', '2033-06-01')->'categories') e),
  (select (public.indicators_summary('2033-06-01', '2033-06-01')->'cards'->>'stopSeconds')::bigint), '(T023 e) 8 categorias: suma = stopSeconds');
select is((select sum((e->>'seconds')::bigint)::bigint from jsonb_array_elements(public.indicators_summary('2033-06-02', '2033-06-02')->'categories') e),
  (select (public.indicators_summary('2033-06-02', '2033-06-02')->'cards'->>'stopSeconds')::bigint), '(T023 e) 6 categorias: suma = stopSeconds');
select is((select sum((e->>'seconds')::bigint)::bigint from jsonb_array_elements(public.indicators_summary('2033-06-03', '2033-06-03')->'categories') e),
  (select (public.indicators_summary('2033-06-03', '2033-06-03')->'cards'->>'stopSeconds')::bigint), '(T023 e) 3 categorias: suma = stopSeconds');
select is((select sum((e->>'seconds')::bigint)::bigint from jsonb_array_elements(public.indicators_summary('2033-06-04', '2033-06-04')->'categories') e),
  (select (public.indicators_summary('2033-06-04', '2033-06-04')->'cards'->>'stopSeconds')::bigint), '(T023 e) con uncategorized: suma = stopSeconds');
select is((select sum((e->>'seconds')::bigint)::bigint from jsonb_array_elements(public.indicators_summary('2033-06-05', '2033-06-05')->'categories') e),
  (select (public.indicators_summary('2033-06-05', '2033-06-05')->'cards'->>'stopSeconds')::bigint), '(T023 e) con other y sin categoria: suma = stopSeconds');
select is((select count(*)::int from jsonb_array_elements(public.indicators_summary('2033-06-05', '2033-06-05')->'categories') e where e->>'kind' = 'uncategorized'),
  0, '(T023 f) Sin categoria pequena no aparece aparte');
select is((select (e->>'seconds')::bigint from jsonb_array_elements(public.indicators_summary('2033-06-05', '2033-06-05')->'categories') e where e->>'kind' = 'other'),
  510::bigint, '(T023 f) other incluye la menor categoria (500) y Sin categoria (10)');

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
