-- T009: tipos de cambio y eventos de cambio del reporte (FR-008).
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000241', 'cambios-op@usuarios.reporte-produccion.invalid', '{"full_name":"Operario cambios"}'),
  ('10000000-0000-0000-0000-000000000242', 'cambios-otro@usuarios.reporte-produccion.invalid', '{"full_name":"Otro operario"}'),
  ('10000000-0000-0000-0000-000000000243', 'cambios-root@usuarios.reporte-produccion.invalid', '{"full_name":"Root cambios"}'),
  ('10000000-0000-0000-0000-000000000244', 'cambios-coord@usuarios.reporte-produccion.invalid', '{"full_name":"Coordinador cambios"}'),
  ('10000000-0000-0000-0000-000000000245', 'cambios-aud@usuarios.reporte-produccion.invalid', '{"full_name":"Auditor cambios"}');
update public.profiles set role = 'OPERATOR', active = true
where id in ('10000000-0000-0000-0000-000000000241', '10000000-0000-0000-0000-000000000242');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000243';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000244';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000245';
insert into public.machines (id, code, name) values
  ('3e000000-0000-0000-0000-000000000001', 'CAM-1', 'Cambios 1'),
  ('3e000000-0000-0000-0000-000000000002', 'CAM-2', 'Cambios 2');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select o.id, m.id, s.id, '2000-01-01', '10000000-0000-0000-0000-000000000244'
from (values ('10000000-0000-0000-0000-000000000241'::uuid, 'CAM-1'), ('10000000-0000-0000-0000-000000000242', 'CAM-2')) o(id, code)
join public.machines m on m.code = o.code
cross join public.shifts s where s.active;

select has_table('public', 'change_types', 'Existe el catálogo change_types');
select has_table('public', 'report_change_events', 'Existe la tabla report_change_events');
select results_eq(
  $$select name from public.change_types order by sort_order, name$$,
  $$values ('Producto'), ('Formato'), ('Lote'), ('Otro')$$,
  'La semilla de change_types es Producto, Formato, Lote, Otro');
select throws_ok(
  $$insert into public.change_types (code, name) values ('DUP', ' producto ')$$,
  '23505', null, 'El nombre de change_types es único normalizado');

create temporary table change_fixture as
  select (select id from public.change_types where name = 'Producto') as active_type,
         gen_random_uuid() as inactive_type;
insert into public.change_types (id, code, name, active, sort_order)
select inactive_type, 'INACT', 'Tipo inactivo', false, 999 from change_fixture;
grant select on change_fixture to authenticated;

select tests.auth_as('10000000-0000-0000-0000-000000000241');
insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
values ('8e000000-0000-0000-0000-000000000001', '3e000000-0000-0000-0000-000000000001', now(),
  '10000000-0000-0000-0000-000000000241', '10000000-0000-0000-0000-000000000241');
select tests.auth_as('10000000-0000-0000-0000-000000000242');
insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
values ('8e000000-0000-0000-0000-000000000002', '3e000000-0000-0000-0000-000000000002', now(),
  '10000000-0000-0000-0000-000000000242', '10000000-0000-0000-0000-000000000242');

select tests.auth_as('10000000-0000-0000-0000-000000000241');
select lives_ok(
  format($f$insert into public.report_change_events (id, report_id, change_type_id, description, occurred_at, created_by)
    values ('9e000000-0000-0000-0000-000000000001', '8e000000-0000-0000-0000-000000000001', %L,
      'Cambio de producto a presentación de 500 g', now() - interval '10 minutes', '10000000-0000-0000-0000-000000000241')$f$,
    (select active_type from change_fixture)),
  'El operario registra un cambio en su reporte activo');
select ok((select received_at is not null and captured_offline = false and clock_skew_review = true
  from public.report_change_events where id = '9e000000-0000-0000-0000-000000000001'),
  'received_at lo fija el servidor y clock_skew_review se calcula como en las paradas');
select throws_ok(
  format($f$insert into public.report_change_events (report_id, change_type_id, description, occurred_at, created_by)
    values ('8e000000-0000-0000-0000-000000000001', %L, 'Tipo inactivo', now(), '10000000-0000-0000-0000-000000000241')$f$,
    (select inactive_type from change_fixture)),
  'P0001', 'Selecciona un tipo de cambio activo', 'No se puede registrar un cambio con un tipo inactivo');
select throws_ok(
  format($f$insert into public.report_change_events (report_id, change_type_id, description, occurred_at, created_by)
    values ('8e000000-0000-0000-0000-000000000001', %L, '', now(), '10000000-0000-0000-0000-000000000241')$f$,
    (select active_type from change_fixture)),
  '23514', null, 'La descripción vacía se rechaza');
select throws_ok(
  format($f$insert into public.report_change_events (report_id, change_type_id, description, occurred_at, created_by)
    values ('8e000000-0000-0000-0000-000000000001', %L, repeat('x', 501), now(), '10000000-0000-0000-0000-000000000241')$f$,
    (select active_type from change_fixture)),
  '23514', null, 'Una descripción de más de 500 caracteres se rechaza');
select lives_ok(
  format($f$insert into public.report_change_events (report_id, change_type_id, description, occurred_at, created_by)
    values ('8e000000-0000-0000-0000-000000000001', %L, repeat('x', 500), now(), '10000000-0000-0000-0000-000000000241')$f$,
    (select active_type from change_fixture)),
  'Una descripción de exactamente 500 caracteres se acepta');
select throws_ok(
  format($f$insert into public.report_change_events (report_id, change_type_id, description, occurred_at, created_by)
    values ('8e000000-0000-0000-0000-000000000002', %L, 'En reporte ajeno', now(), '10000000-0000-0000-0000-000000000241')$f$,
    (select active_type from change_fixture)),
  'P0001', 'Solo puedes modificar cambios de tus reportes en borrador',
  'El operario no puede registrar cambios en el reporte de otro operario');

-- Lectura: managers y auditor ven todo; el otro operario no ve los cambios ajenos.
select tests.auth_as('10000000-0000-0000-0000-000000000243');
select is((select count(*)::integer from public.report_change_events where report_id = '8e000000-0000-0000-0000-000000000001'), 2,
  'ROOT lee los cambios');
select tests.auth_as('10000000-0000-0000-0000-000000000244');
select is((select count(*)::integer from public.report_change_events where report_id = '8e000000-0000-0000-0000-000000000001'), 2,
  'El coordinador lee los cambios');
select tests.auth_as('10000000-0000-0000-0000-000000000245');
select is((select count(*)::integer from public.report_change_events where report_id = '8e000000-0000-0000-0000-000000000001'), 2,
  'El auditor lee los cambios de un reporte activo');
select tests.auth_as('10000000-0000-0000-0000-000000000242');
select is((select count(*)::integer from public.report_change_events where report_id = '8e000000-0000-0000-0000-000000000001'), 0,
  'Otro operario no ve los cambios ajenos');

-- Los cambios no se editan por vía directa de managers sobre un DRAFT ni los borra nadie.
select tests.auth_as('10000000-0000-0000-0000-000000000244');
select results_eq(
  $$with changed as (update public.report_change_events set description = 'Manipulado'
    where id = '9e000000-0000-0000-0000-000000000001' returning id) select count(*)::integer from changed$$,
  array[0], 'El coordinador no actualiza cambios de un reporte DRAFT');
select tests.auth_reset();
select ok(not has_table_privilege('authenticated', 'public.report_change_events', 'DELETE'),
  'authenticated no tiene el privilegio DELETE sobre los cambios');
select is((select count(*)::integer from pg_policies where schemaname = 'public'
  and tablename = 'report_change_events' and cmd = 'DELETE'), 0, 'No existe ninguna política DELETE sobre los cambios');
select tests.auth_as('10000000-0000-0000-0000-000000000243');
select throws_ok($$delete from public.report_change_events where id = '9e000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'ROOT no borra cambios');
select tests.auth_as('10000000-0000-0000-0000-000000000244');
select throws_ok($$delete from public.report_change_events where id = '9e000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'El coordinador no borra cambios');
select tests.auth_as('10000000-0000-0000-0000-000000000245');
select throws_ok($$delete from public.report_change_events where id = '9e000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'El auditor no borra cambios');
select tests.auth_as('10000000-0000-0000-0000-000000000241');
select throws_ok($$delete from public.report_change_events where id = '9e000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'El operario no borra cambios');

-- El operario solo inserta en su DRAFT: tras enviar ya no puede.
update public.production_reports set
  production_order = 'OP-CAM', line_id = (select id from public.lines order by id limit 1),
  product_name = 'Producto', client_name = 'Cliente', lot = 'L-1', weight = 0, g_min = 0,
  dosifier_type_id = (select id from public.dosifier_types order by id limit 1),
  programmed_hours = 0, units_produced = 0, waste = 0, ended_at = now() + interval '1 hour'
where id = '8e000000-0000-0000-0000-000000000001';
update public.production_reports set status = 'SUBMITTED' where id = '8e000000-0000-0000-0000-000000000001';
select throws_ok(
  format($f$insert into public.report_change_events (report_id, change_type_id, description, occurred_at, created_by)
    values ('8e000000-0000-0000-0000-000000000001', %L, 'Tras enviar', now(), '10000000-0000-0000-0000-000000000241')$f$,
    (select active_type from change_fixture)),
  'P0001', 'Solo puedes modificar cambios de tus reportes en borrador',
  'El operario no registra cambios en un reporte ya enviado');

select * from finish();
rollback;
