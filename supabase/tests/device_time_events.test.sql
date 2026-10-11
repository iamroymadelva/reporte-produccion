-- T008: las paradas conservan las horas del dispositivo; el servidor fija received_at y clock_skew_review (FR-008a).
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000231', 'paradas-op@usuarios.reporte-produccion.invalid', '{"full_name":"Operario paradas"}'),
  ('10000000-0000-0000-0000-000000000232', 'paradas-root@usuarios.reporte-produccion.invalid', '{"full_name":"Root paradas"}'),
  ('10000000-0000-0000-0000-000000000233', 'paradas-coord@usuarios.reporte-produccion.invalid', '{"full_name":"Coordinador paradas"}'),
  ('10000000-0000-0000-0000-000000000234', 'paradas-aud@usuarios.reporte-produccion.invalid', '{"full_name":"Auditor paradas"}');
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000231';
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000232';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000233';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000234';
insert into public.machines (id, code, name) values ('3d000000-0000-0000-0000-000000000001', 'DEV-1', 'Hora dispositivo');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select '10000000-0000-0000-0000-000000000231', '3d000000-0000-0000-0000-000000000001', id, '2000-01-01',
  '10000000-0000-0000-0000-000000000233'
from public.shifts where active;
create temporary table stop_categories_fixture as
  select (select id from public.stop_categories where code = '1') as active_category,
         (select id from public.stop_categories where code = '2') as inactive_category;
update public.stop_categories set active = false where code = '2';
grant select on stop_categories_fixture to authenticated;

select tests.auth_as('10000000-0000-0000-0000-000000000231');
insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
values ('8d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000001',
  date_trunc('second', now()) - interval '5 hours',
  '10000000-0000-0000-0000-000000000231', '10000000-0000-0000-0000-000000000231');

-- Parada iniciada online con una hora del dispositivo de hace 3 horas, sin categoría.
select lives_ok(
  $$insert into public.report_stop_events (id, report_id, started_at, responsible_user_id, received_at)
    values ('9d000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-000000000001',
      date_trunc('second', now()) - interval '3 hours', '10000000-0000-0000-0000-000000000231',
      '2000-01-01 00:00:00+00')$$,
  'Una parada puede iniciarse sin categoría');
select is((select started_at from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'),
  date_trunc('second', now()) - interval '3 hours', 'La parada conserva el started_at enviado');
select ok((select received_at > now() - interval '1 minute' from public.report_stop_events
  where id = '9d000000-0000-0000-0000-000000000001'), 'received_at lo fija el servidor, no el cliente');
select is((select clock_skew_review from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'),
  true, 'clock_skew_review es verdadero si la captura fue online y difiere más de 5 min');
select is((select captured_offline from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'),
  false, 'captured_offline es falso por defecto');

-- Cierre: la categoría es obligatoria y debe estar activa.
select throws_ok(
  $$update public.report_stop_events set ended_at = date_trunc('second', now()) - interval '2 hours 50 minutes'
    where id = '9d000000-0000-0000-0000-000000000001'$$,
  'P0001', 'Selecciona una categoría de parada activa',
  'Una parada no puede cerrarse sin categoría');
select throws_ok(
  format($f$update public.report_stop_events set ended_at = date_trunc('second', now()) - interval '2 hours 50 minutes',
      stop_category_id = %L where id = '9d000000-0000-0000-0000-000000000001'$f$,
    (select inactive_category from stop_categories_fixture)),
  'P0001', 'Selecciona una categoría de parada activa',
  'Una parada no puede cerrarse con una categoría inactiva');
select lives_ok(
  format($f$update public.report_stop_events set ended_at = date_trunc('second', now()) - interval '2 hours 50 minutes',
      stop_category_id = %L where id = '9d000000-0000-0000-0000-000000000001'$f$,
    (select active_category from stop_categories_fixture)),
  'Una parada se cierra con una categoría activa');
select is((select ended_at from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'),
  date_trunc('second', now()) - interval '2 hours 50 minutes', 'El cierre conserva el ended_at enviado');
select is((select duration_seconds from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'),
  600::bigint, 'La duración se calcula con las horas del dispositivo');

-- Capturada offline: la diferencia no marca revisión de reloj. Desde T072 (MINOR-3) solo la sincronización
-- (GUC app.captured_offline fijada por apply_sync_operation) puede declarar una captura offline.
select set_config('app.captured_offline', 'true', true);
select lives_ok(
  $$insert into public.report_stop_events (id, report_id, started_at, responsible_user_id, captured_offline)
    values ('9d000000-0000-0000-0000-000000000003', '8d000000-0000-0000-0000-000000000001',
      date_trunc('second', now()) - interval '2 hours', '10000000-0000-0000-0000-000000000231', true)$$,
  'Se registra una parada capturada offline con una hora antigua');
select is((select clock_skew_review from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000003'),
  false, 'Una parada capturada offline nunca marca clock_skew_review');
select lives_ok(
  format($f$update public.report_stop_events set ended_at = date_trunc('second', now()) - interval '1 hour 50 minutes',
      stop_category_id = %L where id = '9d000000-0000-0000-0000-000000000003'$f$,
    (select active_category from stop_categories_fixture)),
  'Se cierra la parada capturada offline con una hora del dispositivo antigua');
select is((select clock_skew_review from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000003'),
  false, 'Cerrar una parada capturada offline tampoco marca clock_skew_review');
select set_config('app.captured_offline', '', true);

-- Online y con hora cercana a la de llegada: sin revisión de reloj.
select lives_ok(
  $$insert into public.report_stop_events (id, report_id, started_at, responsible_user_id)
    values ('9d000000-0000-0000-0000-000000000002', '8d000000-0000-0000-0000-000000000001',
      clock_timestamp() - interval '30 seconds', '10000000-0000-0000-0000-000000000231')$$,
  'Se inicia una segunda parada con hora cercana a la actual');
select is((select clock_skew_review from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000002'),
  false, 'Una captura online con diferencia menor a 5 min no requiere revisión de reloj');
select lives_ok(
  format($f$update public.report_stop_events set ended_at = clock_timestamp() - interval '10 seconds',
      stop_category_id = %L where id = '9d000000-0000-0000-0000-000000000002'$f$,
    (select active_category from stop_categories_fixture)),
  'Se cierra la segunda parada');

-- Envío: no se envía con paradas cerradas sin categoría.
update public.production_reports set
  production_order = 'OP-DEV', line_id = (select id from public.lines order by id limit 1),
  product_name = 'Producto', client_name = 'Cliente', lot = 'L-1', weight = 0, g_min = 0,
  dosifier_type_id = (select id from public.dosifier_types order by id limit 1),
  programmed_hours = 0, units_produced = 0, waste = 0, ended_at = now()
where id = '8d000000-0000-0000-0000-000000000001';
select tests.auth_reset();
alter table public.report_stop_events disable trigger prepare_stop_event_before_write;
update public.report_stop_events set stop_category_id = null where id = '9d000000-0000-0000-0000-000000000002';
alter table public.report_stop_events enable trigger prepare_stop_event_before_write;
select tests.auth_as('10000000-0000-0000-0000-000000000231');
select throws_ok(
  $$update public.production_reports set status = 'SUBMITTED' where id = '8d000000-0000-0000-0000-000000000001'$$,
  'P0001', 'No se puede enviar un reporte con paradas sin categoría',
  'Un reporte no pasa a SUBMITTED con paradas cerradas sin categoría');
select tests.auth_reset();
update public.report_stop_events set stop_category_id = (select active_category from stop_categories_fixture)
where id = '9d000000-0000-0000-0000-000000000002';
select tests.auth_as('10000000-0000-0000-0000-000000000231');
select lives_ok(
  $$update public.production_reports set status = 'SUBMITTED' where id = '8d000000-0000-0000-0000-000000000001'$$,
  'Con todas las paradas cerradas categorizadas el reporte se envía');

-- Nadie puede borrar paradas.
select tests.auth_reset();
select ok(not has_table_privilege('authenticated', 'public.report_stop_events', 'DELETE'),
  'authenticated no tiene el privilegio DELETE sobre las paradas');
select is((select count(*)::integer from pg_policies where schemaname = 'public'
  and tablename = 'report_stop_events' and cmd = 'DELETE'), 0,
  'Ya no existe ninguna política DELETE sobre las paradas');
select tests.auth_as('10000000-0000-0000-0000-000000000232');
select throws_ok($$delete from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'ROOT no puede borrar paradas');
select tests.auth_as('10000000-0000-0000-0000-000000000233');
select throws_ok($$delete from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'El coordinador no puede borrar paradas');
select tests.auth_as('10000000-0000-0000-0000-000000000234');
select throws_ok($$delete from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'El auditor no puede borrar paradas');
select tests.auth_as('10000000-0000-0000-0000-000000000231');
select throws_ok($$delete from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'El operario no puede borrar paradas');

select * from finish();
rollback;
