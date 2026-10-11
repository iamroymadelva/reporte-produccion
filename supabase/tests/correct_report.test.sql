-- T044: correct_report (feature 001, FR-025, database-rpc.md). Solo managers, solo SUBMITTED/CLOSED,
-- motivo >= 5 caracteres, lista blanca de columnas; paradas y cambios se insertan/corrigen por aquí
-- (sin clock_skew_review, MINOR-5). Los managers ya no tienen UPDATE directo en ningún estado.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000321', 'co-root@usuarios.reporte-produccion.invalid', '{"full_name":"CO Root"}'),
  ('10000000-0000-0000-0000-000000000322', 'co-coord@usuarios.reporte-produccion.invalid', '{"full_name":"CO Coordinador"}'),
  ('10000000-0000-0000-0000-000000000323', 'co-aud@usuarios.reporte-produccion.invalid', '{"full_name":"CO Auditor"}'),
  ('10000000-0000-0000-0000-000000000324', 'co-opa@usuarios.reporte-produccion.invalid', '{"full_name":"CO Operario A"}'),
  ('10000000-0000-0000-0000-000000000325', 'co-opb@usuarios.reporte-produccion.invalid', '{"full_name":"CO Operario B"}'),
  ('10000000-0000-0000-0000-000000000326', 'co-opc@usuarios.reporte-produccion.invalid', '{"full_name":"CO Operario C"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000321';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000322';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000323';
update public.profiles set role = 'OPERATOR', active = true
where id in ('10000000-0000-0000-0000-000000000324', '10000000-0000-0000-0000-000000000325', '10000000-0000-0000-0000-000000000326');

insert into public.machines (id, code, name) values
  ('3c000000-0000-0000-0000-000000000001', 'CO-1', 'CO 1'),
  ('3c000000-0000-0000-0000-000000000002', 'CO-2', 'CO 2'),
  ('3c000000-0000-0000-0000-000000000003', 'CO-3', 'CO 3'),
  ('3c000000-0000-0000-0000-000000000004', 'CO-4', 'CO 4');

set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role,
  submitted_by, submitted_at, cancellation_reason, cancelled_at, cancelled_by, approved_by, approved_at, approver_full_name,
  started_at, ended_at, lot, observations)
values
  ('8c000000-0000-0000-0000-000000000001', 'RPT-2034-900001', '3c000000-0000-0000-0000-000000000001', 'SUBMITTED',
    '10000000-0000-0000-0000-000000000324', '10000000-0000-0000-0000-000000000324', 'CO Operario A', 'OPERATOR',
    '10000000-0000-0000-0000-000000000324', now(), null, null, null, null, null, null,
    now() - interval '10 hours', now() - interval '2 hours', 'LOTE-1', 'Obs inicial'),
  ('8c000000-0000-0000-0000-000000000002', 'RPT-2034-900002', '3c000000-0000-0000-0000-000000000002', 'CLOSED',
    '10000000-0000-0000-0000-000000000325', '10000000-0000-0000-0000-000000000325', 'CO Operario B', 'OPERATOR',
    '10000000-0000-0000-0000-000000000325', now(), null, null, null,
    '10000000-0000-0000-0000-000000000322', now(), 'CO Coordinador', now() - interval '10 hours', now() - interval '2 hours', 'LOTE-2', null),
  ('8c000000-0000-0000-0000-000000000003', 'RPT-2034-900003', '3c000000-0000-0000-0000-000000000003', 'DRAFT',
    '10000000-0000-0000-0000-000000000326', '10000000-0000-0000-0000-000000000326', 'CO Operario C', 'OPERATOR',
    null, null, null, null, null, null, null, null, now(), null, 'LOTE-3', null),
  ('8c000000-0000-0000-0000-000000000004', 'RPT-2034-900004', '3c000000-0000-0000-0000-000000000004', 'CANCELLED',
    '10000000-0000-0000-0000-000000000325', '10000000-0000-0000-0000-000000000325', 'CO Operario B', 'OPERATOR',
    null, null, 'Motivo', now(), '10000000-0000-0000-0000-000000000325', null, null, null, now(), null, 'LOTE-4', null);
insert into public.report_stop_events (id, report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id) values
  ('9c000000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000001',
    (select id from public.stop_categories where code = '1'), now() - interval '9 hours', now() - interval '8 hours', 3600,
    '10000000-0000-0000-0000-000000000324'),
  ('9c000000-0000-0000-0000-000000000002', '8c000000-0000-0000-0000-000000000002',
    (select id from public.stop_categories where code = '1'), now() - interval '9 hours', now() - interval '8 hours', 3600,
    '10000000-0000-0000-0000-000000000325');
insert into public.report_change_events (id, report_id, change_type_id, description, occurred_at, created_by) values
  ('ac000000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000001',
    (select id from public.change_types where name = 'Lote'), 'Cambio de lote', now() - interval '6 hours',
    '10000000-0000-0000-0000-000000000324');
set local session_replication_role = origin;

-- ---------------------------------------------------------------- Actores no autorizados (security definer)
select tests.auth_as('10000000-0000-0000-0000-000000000324');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"lot":"X"}', null, null, 'Motivo válido')$$,
  '42501', null, 'El OPERATOR autor no corrige (FORBIDDEN)');
select throws_ok($$select public.approve_report('8c000000-0000-0000-0000-000000000001')$$, '42501', null,
  'El OPERATOR no aprueba (FORBIDDEN)');
select throws_ok($$select public.cancel_report('8c000000-0000-0000-0000-000000000002', 'Ajeno')$$, '42501', null,
  'El OPERATOR no cancela un reporte ajeno (FORBIDDEN)');
select tests.auth_as('10000000-0000-0000-0000-000000000323');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"lot":"X"}', null, null, 'Motivo válido')$$,
  '42501', null, 'El VIEWER no corrige (FORBIDDEN)');
select throws_ok($$select public.approve_report('8c000000-0000-0000-0000-000000000001')$$, '42501', null,
  'El VIEWER no aprueba (FORBIDDEN)');
select throws_ok($$select public.cancel_report('8c000000-0000-0000-0000-000000000003', 'Auditor')$$, '42501', null,
  'El VIEWER no cancela (FORBIDDEN)');

-- ---------------------------------------------------------------- Motivo y estado
select tests.auth_as('10000000-0000-0000-0000-000000000322');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"lot":"X"}', null, null, 'abc')$$,
  '22023', null, 'Un motivo de 3 caracteres se rechaza');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"lot":"X"}', null, null, 'ab   ')$$,
  '22023', null, 'El motivo se mide recortado (ab = 2 caracteres)');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"lot":"X"}', null, null, null)$$,
  '22023', null, 'El motivo es obligatorio');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000003', '{"lot":"X"}', null, null, 'Motivo válido')$$,
  'P0005', 'NOT_CORRECTABLE', 'No se corrige un DRAFT');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000004', '{"lot":"X"}', null, null, 'Motivo válido')$$,
  'P0005', 'NOT_CORRECTABLE', 'No se corrige un CANCELLED');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"status":"DRAFT"}', null, null, 'Motivo válido')$$,
  '22023', null, 'La lista blanca rechaza status');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"folio":"RPT-0000-000000"}', null, null, 'Motivo válido')$$,
  '22023', null, 'La lista blanca rechaza folio');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"approved_by":null}', null, null, 'Motivo válido')$$,
  '22023', null, 'La lista blanca rechaza approved_by');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"created_by":"10000000-0000-0000-0000-000000000325"}', null, null, 'Motivo válido')$$,
  '22023', null, 'La lista blanca rechaza created_by');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{"machine_id":"3c000000-0000-0000-0000-000000000002"}', null, null, 'Motivo válido')$$,
  '22023', null, 'La lista blanca rechaza machine_id');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{}', '[{"id":"9c000000-0000-0000-0000-000000000002","description":"ajena"}]', null, 'Motivo válido')$$,
  '22023', null, 'No se corrige una parada de otro reporte');

-- ---------------------------------------------------------------- Corrección válida de un SUBMITTED
select lives_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001',
  '{"lot":"LOTE-1B","observations":null,"units_produced":500}', null, null, 'Error de digitación')$$,
  'El coordinador corrige un SUBMITTED con motivo');
select tests.auth_reset();
select is((select lot from public.production_reports where id = '8c000000-0000-0000-0000-000000000001'), 'LOTE-1B', 'El lote cambia');
select is((select observations from public.production_reports where id = '8c000000-0000-0000-0000-000000000001'), null::text,
  'Un null explícito limpia el campo');
select is((select units_produced from public.production_reports where id = '8c000000-0000-0000-0000-000000000001'), 500::bigint, 'Las unidades cambian');
select is((select status::text from public.production_reports where id = '8c000000-0000-0000-0000-000000000001'), 'SUBMITTED', 'El estado no cambia');
select ok(exists(select 1 from public.report_audit_log
  where report_id = '8c000000-0000-0000-0000-000000000001' and entity_type = 'report' and field_name = 'lot'
    and old_value = '"LOTE-1"'::jsonb and new_value = '"LOTE-1B"'::jsonb
    and reason = 'Error de digitación' and actor_role = 'ADMINISTRATOR' and action = 'UPDATE'
    and changed_by = '10000000-0000-0000-0000-000000000322'),
  'El historial registra valor anterior/nuevo, motivo y rol');
select is((select count(*)::integer from public.report_audit_log
  where report_id = '8c000000-0000-0000-0000-000000000001' and reason = 'Error de digitación'), 3,
  'Solo se auditan los campos que cambian (lot, observations, units_produced)');

-- ---------------------------------------------------------------- Paradas y cambios por correct_report
select tests.auth_as('10000000-0000-0000-0000-000000000322');
select lives_ok(format($f$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{}',
  %L::jsonb,
  %L::jsonb, 'Parada y cambio olvidados')$f$,
  jsonb_build_array(
    jsonb_build_object('id', '9c000000-0000-0000-0000-000000000001', 'description', 'Corregida'),
    jsonb_build_object('id', '9c000000-0000-0000-0000-000000000003',
      'stop_category_id', (select id from public.stop_categories where code = '2'),
      'started_at', now() - interval '5 hours', 'ended_at', now() - interval '4 hours')),
  jsonb_build_array(
    jsonb_build_object('id', 'ac000000-0000-0000-0000-000000000001', 'description', 'Cambio de lote corregido'),
    jsonb_build_object('id', 'ac000000-0000-0000-0000-000000000002',
      'change_type_id', (select id from public.change_types where name = 'Producto'),
      'description', 'Cambio olvidado', 'occurred_at', now() - interval '7 hours'))),
  'Corrige una parada, inserta otra retroactiva, corrige y agrega un cambio');
select tests.auth_reset();
select is((select description from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000001'), 'Corregida',
  'La parada existente se corrige');
select ok(exists(select 1 from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000003'
  and report_id = '8c000000-0000-0000-0000-000000000001' and ended_at is not null),
  'La parada nueva se inserta en el reporte');
select is((select clock_skew_review from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000003'), false,
  'MINOR-5: la parada retroactiva insertada por el manager no queda en revisión de reloj');
select is((select description from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000001'),
  'Cambio de lote corregido', 'El cambio existente se corrige');
select is((select clock_skew_review from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000002'), false,
  'MINOR-5: el cambio retroactivo insertado por el manager no queda en revisión de reloj');
select ok(exists(select 1 from public.report_audit_log
  where report_id = '8c000000-0000-0000-0000-000000000001' and entity_type = 'stop'
    and entity_id = '9c000000-0000-0000-0000-000000000003' and action = 'INSERT'
    and reason = 'Parada y cambio olvidados' and actor_role = 'ADMINISTRATOR'),
  'La parada insertada por el manager queda auditada con motivo y rol');
select ok(exists(select 1 from public.report_audit_log
  where report_id = '8c000000-0000-0000-0000-000000000001' and entity_type = 'change'
    and entity_id = 'ac000000-0000-0000-0000-000000000001' and action = 'UPDATE'
    and reason = 'Parada y cambio olvidados' and actor_role = 'ADMINISTRATOR'),
  'El cambio corregido queda auditado con motivo y rol');

-- ---------------------------------------------------------------- CLOSED sigue CLOSED (ROOT)
select tests.auth_as('10000000-0000-0000-0000-000000000321');
select lives_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000002', '{"lot":"LOTE-2B"}', null, null, 'Corrección de ROOT')$$,
  'ROOT corrige un CLOSED');
select tests.auth_reset();
select is((select status::text from public.production_reports where id = '8c000000-0000-0000-0000-000000000002'), 'CLOSED', 'Sigue CLOSED');
select is((select approver_full_name from public.production_reports where id = '8c000000-0000-0000-0000-000000000002'), 'CO Coordinador',
  'La aprobación original no se altera');

-- ---------------------------------------------------------------- Paradas abiertas / sin categoría (MAJOR-1)
select tests.auth_as('10000000-0000-0000-0000-000000000322');
select throws_ok(format($f$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{}', %L::jsonb, null, 'Parada abierta')$f$,
  jsonb_build_array(jsonb_build_object('id', '9c000000-0000-0000-0000-000000000009',
    'stop_category_id', (select id from public.stop_categories where code = '2'), 'started_at', now() - interval '30 hours'))),
  '22023', null, 'Una corrección no puede insertar una parada abierta en un reporte enviado');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{}',
  '[{"id":"9c000000-0000-0000-0000-000000000001","ended_at":null}]', null, 'Reabrir parada')$$,
  '22023', null, 'Una corrección no puede reabrir una parada cerrada');
select throws_ok(format($f$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{}', %L::jsonb, null, 'Sin categoría')$f$,
  jsonb_build_array(jsonb_build_object('id', '9c000000-0000-0000-0000-00000000000a',
    'started_at', now() - interval '40 hours', 'ended_at', now() - interval '39 hours'))),
  '22023', null, 'Una corrección no puede insertar una parada cerrada sin categoría');
select throws_ok($$select public.correct_report('8c000000-0000-0000-0000-000000000001', '{}',
  '[{"id":"9c000000-0000-0000-0000-000000000001","stop_category_id":null}]', null, 'Quitar categoría')$$,
  '22023', null, 'Una corrección no puede quitar la categoría de una parada');
select tests.auth_reset();
select is((select count(*)::integer from public.report_stop_events
  where report_id = '8c000000-0000-0000-0000-000000000001' and cancelled_at is null
    and (ended_at is null or stop_category_id is null)), 0, 'Ninguna parada abierta o sin categoría quedó en el reporte enviado');

-- ---------------------------------------------------------------- Sin UPDATE/INSERT directo para managers
select tests.auth_as('10000000-0000-0000-0000-000000000322');
select results_eq($$with changed as (update public.production_reports set lot = 'DIRECTO' where id = '8c000000-0000-0000-0000-000000000001' returning 1) select count(*)::integer from changed$$,
  array[0], 'UPDATE directo del manager sobre SUBMITTED no afecta filas');
select results_eq($$with changed as (update public.production_reports set lot = 'DIRECTO' where id = '8c000000-0000-0000-0000-000000000002' returning 1) select count(*)::integer from changed$$,
  array[0], 'UPDATE directo del manager sobre CLOSED no afecta filas');
select results_eq($$with changed as (update public.production_reports set lot = 'DIRECTO' where id = '8c000000-0000-0000-0000-000000000003' returning 1) select count(*)::integer from changed$$,
  array[0], 'UPDATE directo del manager sobre DRAFT no afecta filas');
select results_eq($$with changed as (update public.production_reports set observations = 'DIRECTO' where id = '8c000000-0000-0000-0000-000000000004' returning 1) select count(*)::integer from changed$$,
  array[0], 'UPDATE directo del manager sobre CANCELLED no afecta filas');
select results_eq($$with changed as (update public.report_stop_events set description = 'DIRECTO' where id = '9c000000-0000-0000-0000-000000000001' returning 1) select count(*)::integer from changed$$,
  array[0], 'UPDATE directo del manager sobre una parada no afecta filas');
select results_eq($$with changed as (update public.report_change_events set description = 'DIRECTO' where id = 'ac000000-0000-0000-0000-000000000001' returning 1) select count(*)::integer from changed$$,
  array[0], 'UPDATE directo del manager sobre un cambio no afecta filas');
select throws_ok($$insert into public.report_stop_events (report_id, stop_category_id, responsible_user_id, started_at, ended_at)
  select '8c000000-0000-0000-0000-000000000001', id, '10000000-0000-0000-0000-000000000324', now() - interval '20 hours', now() - interval '19 hours'
  from public.stop_categories where code = '1'$$, '42501', null, 'INSERT directo de una parada por el manager se rechaza');
select throws_ok($$insert into public.report_change_events (report_id, change_type_id, description, occurred_at, created_by)
  select '8c000000-0000-0000-0000-000000000001', id, 'Directo', now(), '10000000-0000-0000-0000-000000000324'
  from public.change_types limit 1$$, '42501', null, 'INSERT directo de un cambio por el manager se rechaza');
select tests.auth_reset();
select is((select lot from public.production_reports where id = '8c000000-0000-0000-0000-000000000001'), 'LOTE-1B',
  'Los datos no cambiaron por los intentos directos');

select * from finish();
rollback;
