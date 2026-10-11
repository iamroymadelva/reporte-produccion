-- T032: delete_or_deactivate borra sin referencias y desactiva con referencias, para cada catálogo.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

select ok(to_regprocedure('public.delete_or_deactivate(text,uuid)') is not null, 'Existe delete_or_deactivate');

-- Catálogos nuevos: una fila libre y una referenciada por catálogo.
insert into public.machines (id, code, name) values
  ('3d000000-0000-0000-0000-000000000001', 'DD-M-FREE', 'DD Máquina libre'),
  ('3d000000-0000-0000-0000-000000000002', 'DD-M-USED', 'DD Máquina usada');
insert into public.lines (id, code, name) values
  ('4d000000-0000-0000-0000-000000000001', 'DD-L-FREE', 'DD Línea libre'),
  ('4d000000-0000-0000-0000-000000000002', 'DD-L-USED', 'DD Línea usada');
insert into public.clients (id, code, name) values
  ('5d000000-0000-0000-0000-000000000001', 'DD-C-FREE', 'DD Cliente libre'),
  ('5d000000-0000-0000-0000-000000000002', 'DD-C-USED', 'DD Cliente usado');
insert into public.products (id, code, name) values
  ('6d000000-0000-0000-0000-000000000001', 'DD-P-FREE', 'DD Producto libre'),
  ('6d000000-0000-0000-0000-000000000002', 'DD-P-USED', 'DD Producto usado');
insert into public.dosifier_types (id, code, name) values
  ('7d000000-0000-0000-0000-000000000001', 'DD-D-FREE', 'DD Dosificador libre'),
  ('7d000000-0000-0000-0000-000000000002', 'DD-D-USED', 'DD Dosificador usado');
insert into public.shifts (id, name, start_time, end_time, sort_order) values
  ('2d000000-0000-0000-0000-000000000001', 'DD Turno libre', '01:00', '02:00', 900),
  ('2d000000-0000-0000-0000-000000000002', 'DD Turno usado', '02:00', '03:00', 901);
insert into public.stop_categories (id, code, name) values
  ('1d000000-0000-0000-0000-000000000001', '9901', 'DD Parada libre'),
  ('1d000000-0000-0000-0000-000000000002', '9902', 'DD Parada usada');
insert into public.change_types (id, code, name) values
  ('8d000000-0000-0000-0000-000000000001', 'DD-CT-FREE', 'DD Cambio libre'),
  ('8d000000-0000-0000-0000-000000000002', 'DD-CT-USED', 'DD Cambio usado');

-- Referencias: un reporte DRAFT con línea, cliente, producto y dosificador; paradas, cambios y asignaciones.
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select '10000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000002', s.id, '2000-01-01',
  '10000000-0000-0000-0000-000000000001'
from public.shifts s where s.active and s.id <> '2d000000-0000-0000-0000-000000000001';
insert into public.production_reports (id, machine_id, line_id, client_id, product_id, dosifier_type_id, started_at, created_by, updated_by)
values ('8d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000002', '4d000000-0000-0000-0000-000000000002',
  '5d000000-0000-0000-0000-000000000002', '6d000000-0000-0000-0000-000000000002', '7d000000-0000-0000-0000-000000000002', now(),
  '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');
insert into public.report_stop_events (report_id, stop_category_id, started_at, responsible_user_id)
values ('8d000000-0000-0000-0000-000000000001', '1d000000-0000-0000-0000-000000000002', now(), '10000000-0000-0000-0000-000000000002');
insert into public.report_change_events (report_id, change_type_id, description, created_by)
values ('8d000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-000000000002', 'Cambio de prueba', '10000000-0000-0000-0000-000000000002');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
values ('10000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000001', '2d000000-0000-0000-0000-000000000002', '2026-01-01',
  '10000000-0000-0000-0000-000000000001');

select tests.auth_as('10000000-0000-0000-0000-000000000001');

select is(public.delete_or_deactivate('machines', '3d000000-0000-0000-0000-000000000002')->>'action', 'deactivated', 'machines: con reportes se desactiva');
select is(public.delete_or_deactivate('lines', '4d000000-0000-0000-0000-000000000002')->>'action', 'deactivated', 'lines: con reportes se desactiva');
select is(public.delete_or_deactivate('clients', '5d000000-0000-0000-0000-000000000002')->>'action', 'deactivated', 'clients: con reportes se desactiva');
select is(public.delete_or_deactivate('products', '6d000000-0000-0000-0000-000000000002')->>'action', 'deactivated', 'products: con reportes se desactiva');
select is(public.delete_or_deactivate('dosifier_types', '7d000000-0000-0000-0000-000000000002')->>'action', 'deactivated', 'dosifier_types: con reportes se desactiva');
select is(public.delete_or_deactivate('shifts', '2d000000-0000-0000-0000-000000000002')->>'action', 'deactivated', 'shifts: con asignaciones se desactiva');
select is(public.delete_or_deactivate('stop_categories', '1d000000-0000-0000-0000-000000000002')->>'action', 'deactivated', 'stop_categories: con paradas se desactiva');
select is(public.delete_or_deactivate('change_types', '8d000000-0000-0000-0000-000000000002')->>'action', 'deactivated', 'change_types: con cambios se desactiva');

select is(public.delete_or_deactivate('machines', '3d000000-0000-0000-0000-000000000001')->>'action', 'deactivated',
  'machines: una asignación también es una referencia (no se borran asignaciones)');
select is(public.delete_or_deactivate('lines', '4d000000-0000-0000-0000-000000000001')->>'action', 'deleted', 'lines: sin referencias se borra');
select is(public.delete_or_deactivate('clients', '5d000000-0000-0000-0000-000000000001')->>'action', 'deleted', 'clients: sin referencias se borra');
select is(public.delete_or_deactivate('products', '6d000000-0000-0000-0000-000000000001')->>'action', 'deleted', 'products: sin referencias se borra');
select is(public.delete_or_deactivate('dosifier_types', '7d000000-0000-0000-0000-000000000001')->>'action', 'deleted', 'dosifier_types: sin referencias se borra');
select is(public.delete_or_deactivate('shifts', '2d000000-0000-0000-0000-000000000001')->>'action', 'deleted', 'shifts: sin referencias se borra');
select is(public.delete_or_deactivate('stop_categories', '1d000000-0000-0000-0000-000000000001')->>'action', 'deleted', 'stop_categories: sin referencias se borra');
select is(public.delete_or_deactivate('change_types', '8d000000-0000-0000-0000-000000000001')->>'action', 'deleted', 'change_types: sin referencias se borra');
-- Una máquina sin ninguna referencia (ni asignaciones).
select tests.auth_reset();
insert into public.machines (id, code, name) values ('3d000000-0000-0000-0000-000000000003', 'DD-M-FREE2', 'DD Máquina libre 2');
select tests.auth_as('10000000-0000-0000-0000-000000000001');
select is(public.delete_or_deactivate('machines', '3d000000-0000-0000-0000-000000000003')->>'action', 'deleted', 'machines: sin referencias se borra');

select tests.auth_reset();
select is((select count(*)::integer from public.machines where id in ('3d000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000001') and not active), 2,
  'Las máquinas referenciadas siguen existiendo, inactivas');
select is((select count(*)::integer from public.lines where id = '4d000000-0000-0000-0000-000000000001'), 0, 'La línea libre ya no existe');
select is((select count(*)::integer from public.change_types where id = '8d000000-0000-0000-0000-000000000002' and not active), 1, 'El tipo de cambio usado queda inactivo');
select is((select machine_id::text from public.production_reports where id = '8d000000-0000-0000-0000-000000000001'), '3d000000-0000-0000-0000-000000000002',
  'El reporte histórico conserva su máquina');
select is((select line_id::text || client_id::text from public.production_reports where id = '8d000000-0000-0000-0000-000000000001'),
  '4d000000-0000-0000-0000-0000000000025d000000-0000-0000-0000-000000000002', 'El reporte histórico conserva línea y cliente');
select is((select count(*)::integer from public.administrative_audit_log where action = 'DELETE' and entity_type = 'lines'
  and entity_id = '4d000000-0000-0000-0000-000000000001'), 1, 'El borrado real queda auditado');
select is((select count(*)::integer from public.administrative_audit_log where action = 'DELETE' and entity_id = '3d000000-0000-0000-0000-000000000002'), 0,
  'La desactivación no se registra como borrado');

-- Roles sin permiso y entradas inválidas.
select tests.auth_as('10000000-0000-0000-0000-000000000003');
select throws_ok($$select public.delete_or_deactivate('machines', '3d000000-0000-0000-0000-000000000002')$$, '42501', null, 'VIEWER recibe rechazo');
select tests.auth_as('10000000-0000-0000-0000-000000000002');
select throws_ok($$select public.delete_or_deactivate('machines', '3d000000-0000-0000-0000-000000000002')$$, '42501', null, 'OPERATOR recibe rechazo');
select tests.auth_as('10000000-0000-0000-0000-000000000001');
select throws_ok($$select public.delete_or_deactivate('profiles', '10000000-0000-0000-0000-000000000002')$$, 'P0001', null, 'Un catálogo no permitido se rechaza');
select throws_ok($$select public.delete_or_deactivate('machines', '3d000000-0000-0000-0000-0000000000ff')$$, 'P0002', null, 'Un elemento inexistente se rechaza');
select tests.auth_reset();
set local role anon;
select throws_ok($$select public.delete_or_deactivate('machines', '3d000000-0000-0000-0000-000000000002')$$, '42501', null, 'anon no ejecuta delete_or_deactivate');
reset role;

select * from finish();
rollback;
