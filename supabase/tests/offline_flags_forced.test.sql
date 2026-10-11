-- T066 (MINOR-3/4 de la auditoría de la Phase 2): una escritura directa no puede declararse "offline".
-- origin = 'online' y captured_offline = false se fuerzan en el servidor; solo la GUC app.captured_offline = 'true',
-- fijada por apply_sync_operation, las toma como capturadas sin conexión.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000801', 'flags-op@usuarios.reporte-produccion.invalid', '{"full_name":"Flags Operario"}');
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000801';
insert into public.machines (id, code, name) values ('3c000000-0000-0000-0000-000000000801', 'FLG-1', 'Flags 1');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select '10000000-0000-0000-0000-000000000801', '3c000000-0000-0000-0000-000000000801', s.id, '2000-01-01',
  '10000000-0000-0000-0000-000000000001'
from public.shifts s where s.name = 'Día';

select tests.auth_as('10000000-0000-0000-0000-000000000801');

-- Reporte: origin se fuerza a 'online' aunque el cliente envíe 'offline'.
select lives_ok(
  $$insert into public.production_reports (id, machine_id, started_at, origin, created_by, updated_by)
    values ('8c000000-0000-0000-0000-000000000801', '3c000000-0000-0000-0000-000000000801',
      '2026-10-09 10:00:00-05', 'offline', '10000000-0000-0000-0000-000000000801', '10000000-0000-0000-0000-000000000801')$$,
  'El INSERT directo con origin offline es aceptado (se sobrescribe)');
select is((select origin from public.production_reports where id = '8c000000-0000-0000-0000-000000000801'), 'online',
  'MINOR-4: un INSERT directo no puede declarar origin = offline');

-- Parada: captured_offline se fuerza a false en INSERT.
select lives_ok(
  $$insert into public.report_stop_events (id, report_id, started_at, responsible_user_id, captured_offline)
    values ('9c000000-0000-0000-0000-000000000801', '8c000000-0000-0000-0000-000000000801',
      '2026-10-09 10:10:00-05', '10000000-0000-0000-0000-000000000801', true)$$,
  'El INSERT directo de una parada con captured_offline = true es aceptado (se sobrescribe)');
select is((select captured_offline from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000801'), false,
  'MINOR-3: un INSERT directo de parada no puede declararse captured_offline');

-- No se puede activar el indicador con un UPDATE.
select throws_ok(
  $$update public.report_stop_events set captured_offline = true, ended_at = '2026-10-09 10:20:00-05',
      stop_category_id = (select id from public.stop_categories where code = '1')
    where id = '9c000000-0000-0000-0000-000000000801'$$,
  'P0001', 'Solo puedes cambiar la categoría, detener o cancelar una parada activa',
  'MINOR-3: un UPDATE no puede activar captured_offline');

-- Al cerrar con una hora del dispositivo muy distinta de la del servidor se marca la revisión de reloj
-- (antes se evitaba declarándose offline).
update public.report_stop_events
set ended_at = '2026-10-09 10:20:00-05', stop_category_id = (select id from public.stop_categories where code = '1')
where id = '9c000000-0000-0000-0000-000000000801';
select is((select clock_skew_review from public.report_stop_events where id = '9c000000-0000-0000-0000-000000000801'), true,
  'Una parada cerrada online con hora muy desfasada exige revisión de reloj');

-- Cambio: captured_offline se fuerza a false y el desfase marca la revisión.
select lives_ok(
  $$insert into public.report_change_events (id, report_id, change_type_id, description, occurred_at, captured_offline, created_by)
    values ('ac000000-0000-0000-0000-000000000801', '8c000000-0000-0000-0000-000000000801',
      (select id from public.change_types where name = 'Lote'), 'Cambio directo', '2026-10-09 10:30:00-05', true,
      '10000000-0000-0000-0000-000000000801')$$,
  'El INSERT directo de un cambio con captured_offline = true es aceptado (se sobrescribe)');
select is((select captured_offline from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000801'), false,
  'MINOR-3: un INSERT directo de cambio no puede declararse captured_offline');
select is((select clock_skew_review from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000801'), true,
  'El cambio directo con hora desfasada exige revisión de reloj');

-- Con la GUC que fija apply_sync_operation sí se toman como capturados sin conexión.
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000801');
select set_config('app.captured_offline', 'true', true);
select lives_ok(
  $$insert into public.report_change_events (id, report_id, change_type_id, description, occurred_at, created_by)
    values ('ac000000-0000-0000-0000-000000000802', '8c000000-0000-0000-0000-000000000801',
      (select id from public.change_types where name = 'Lote'), 'Cambio por sincronización', '2026-10-09 10:40:00-05',
      '10000000-0000-0000-0000-000000000801')$$,
  'Con la GUC de sincronización el INSERT de un cambio es aceptado');
select is((select captured_offline from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000802'), true,
  'Con app.captured_offline = true el cambio queda como capturado sin conexión');
select is((select clock_skew_review from public.report_change_events where id = 'ac000000-0000-0000-0000-000000000802'), false,
  'Lo capturado sin conexión no genera revisión de reloj');
select set_config('app.captured_offline', '', true);

select tests.auth_reset();
select * from finish();
rollback;
