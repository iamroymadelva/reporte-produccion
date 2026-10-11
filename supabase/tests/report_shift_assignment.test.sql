-- T007: el INSERT fija shift_id y report_date desde started_at; la asignación se valida por turno y vigencia (FR-007, FR-007b).
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000221', 'turnos-op@usuarios.reporte-produccion.invalid', '{"full_name":"Operario turnos"}');
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000221';
insert into public.machines (id, code, name) values
  ('3c000000-0000-0000-0000-000000000001', 'TUR-D', 'Solo turno Día'),
  ('3c000000-0000-0000-0000-000000000002', 'TUR-N', 'Solo turno Noche'),
  ('3c000000-0000-0000-0000-000000000003', 'TUR-F', 'Vigencia futura'),
  ('3c000000-0000-0000-0000-000000000004', 'TUR-V', 'Vigencia vencida');
create temporary table shift_ids as
  select (select id from public.shifts where name = 'Día') as dia,
         (select id from public.shifts where name = 'Tarde') as tarde,
         (select id from public.shifts where name = 'Noche') as noche;
grant select on shift_ids to authenticated;
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, valid_to, created_by)
select '10000000-0000-0000-0000-000000000221', m.id, s.shift_id, s.valid_from::date, s.valid_to::date,
  '10000000-0000-0000-0000-000000000001'
from (values
  ('TUR-D', (select dia from shift_ids), '2000-01-01', null),
  ('TUR-N', (select noche from shift_ids), '2026-10-09', null),
  ('TUR-F', (select dia from shift_ids), '2026-10-11', null),
  ('TUR-V', (select dia from shift_ids), '2000-01-01', '2026-10-08')
) s(code, shift_id, valid_from, valid_to)
join public.machines m on m.code = s.code;

select tests.auth_as('10000000-0000-0000-0000-000000000221');

-- Los valores del cliente se ignoran: se fijan desde started_at.
select lives_ok(
  format($f$insert into public.production_reports (id, machine_id, started_at, shift_id, report_date, created_by, updated_by)
    values ('8c000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001', '2026-10-09 10:00:00-05',
      %L, '2000-01-01', '10000000-0000-0000-0000-000000000221', '10000000-0000-0000-0000-000000000221')$f$,
    (select noche from shift_ids)),
  'Un INSERT con shift_id y report_date falsos es aceptado (se sobrescriben)');
select is((select shift_id from public.production_reports where id = '8c000000-0000-0000-0000-000000000001'),
  (select dia from shift_ids), 'shift_id se resuelve desde started_at (Día), no desde el cliente');
select is((select report_date from public.production_reports where id = '8c000000-0000-0000-0000-000000000001'),
  '2026-10-09'::date, 'report_date se resuelve desde started_at, no desde el cliente');
select ok((select received_at is not null and origin = 'online' from public.production_reports
  where id = '8c000000-0000-0000-0000-000000000001'), 'received_at se fija en el servidor y origin es online por defecto');

-- started_at es obligatorio.
select throws_ok(
  $$insert into public.production_reports (machine_id, created_by, updated_by)
    values ('3c000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000221', '10000000-0000-0000-0000-000000000221')$$,
  'P0001', 'La hora de inicio del reporte es obligatoria',
  'El INSERT sin started_at se rechaza');

-- El turno y la fecha son inmutables para el operario.
select throws_ok(
  $$update public.production_reports set report_date = '2026-10-01' where id = '8c000000-0000-0000-0000-000000000001'$$,
  'P0001', 'El turno y la fecha operativa del reporte no pueden modificarse',
  'El operario no puede cambiar report_date');
select throws_ok(
  format($f$update public.production_reports set shift_id = %L where id = '8c000000-0000-0000-0000-000000000001'$f$,
    (select tarde from shift_ids)),
  'P0001', 'El turno y la fecha operativa del reporte no pueden modificarse',
  'El operario no puede cambiar shift_id');

-- Se libera al operario (un solo reporte activo) para probar las siguientes asignaciones.
update public.production_reports set status = 'CANCELLED', cancellation_reason = 'Liberar para la prueba'
where id = '8c000000-0000-0000-0000-000000000001';

-- Asignación por turno: la máquina solo del turno Día no sirve a las 15:00 (Tarde).
select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('3c000000-0000-0000-0000-000000000001', '2026-10-09 15:00:00-05',
      '10000000-0000-0000-0000-000000000221', '10000000-0000-0000-0000-000000000221')$$,
  'P0001', 'La máquina no está asignada al Operador',
  'Se rechaza la máquina asignada solo al turno Día cuando la hora cae en el turno Tarde');

-- Vigencia.
select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('3c000000-0000-0000-0000-000000000003', '2026-10-09 10:00:00-05',
      '10000000-0000-0000-0000-000000000221', '10000000-0000-0000-0000-000000000221')$$,
  'P0001', 'La máquina no está asignada al Operador',
  'Se rechaza una asignación que aún no está vigente (valid_from futuro)');
select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('3c000000-0000-0000-0000-000000000004', '2026-10-09 10:00:00-05',
      '10000000-0000-0000-0000-000000000221', '10000000-0000-0000-0000-000000000221')$$,
  'P0001', 'La máquina no está asignada al Operador',
  'Se rechaza una asignación vencida (valid_to pasado)');

-- Turno nocturno: a las 02:00 del día 10 la fecha operativa es el día 9, y la vigencia se evalúa con esa fecha.
select lives_ok(
  $$insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
    values ('8c000000-0000-0000-0000-000000000002', '3c000000-0000-0000-0000-000000000002', '2026-10-10 02:00:00-05',
      '10000000-0000-0000-0000-000000000221', '10000000-0000-0000-0000-000000000221')$$,
  'A las 02:00 del día 10 se acepta la asignación Noche vigente desde el día 9');
select is((select report_date from public.production_reports where id = '8c000000-0000-0000-0000-000000000002'),
  '2026-10-09'::date, 'La fecha operativa del turno Noche es la del día de inicio');
select is((select shift_id from public.production_reports where id = '8c000000-0000-0000-0000-000000000002'),
  (select noche from shift_ids), 'El turno resuelto a las 02:00 es Noche');

update public.production_reports set status = 'CANCELLED', cancellation_reason = 'Liberar para la prueba'
where id = '8c000000-0000-0000-0000-000000000002';
select tests.auth_reset();
update public.operator_machine_assignments set valid_from = '2026-10-10'
where machine_id = '3c000000-0000-0000-0000-000000000002';
select tests.auth_as('10000000-0000-0000-0000-000000000221');
select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('3c000000-0000-0000-0000-000000000002', '2026-10-10 02:00:00-05',
      '10000000-0000-0000-0000-000000000221', '10000000-0000-0000-0000-000000000221')$$,
  'P0001', 'La máquina no está asignada al Operador',
  'La vigencia se evalúa con la fecha operativa (día 9), no con la fecha calendario (día 10)');

select * from finish();
rollback;
