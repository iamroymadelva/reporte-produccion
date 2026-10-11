-- T006: un solo reporte activo (DRAFT) por operario y por máquina; ya no aplica el límite de 5 (FR-007a).
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000211', 'limites-a@usuarios.reporte-produccion.invalid', '{"full_name":"Operario A"}'),
  ('10000000-0000-0000-0000-000000000212', 'limites-b@usuarios.reporte-produccion.invalid', '{"full_name":"Operario B"}');
update public.profiles set role = 'OPERATOR', active = true
where id in ('10000000-0000-0000-0000-000000000211', '10000000-0000-0000-0000-000000000212');
insert into public.machines (id, code, name) values
  ('3b000000-0000-0000-0000-000000000001', 'LIM-1', 'Límites 1'),
  ('3b000000-0000-0000-0000-000000000002', 'LIM-2', 'Límites 2'),
  ('3b000000-0000-0000-0000-000000000003', 'LIM-3', 'Límites 3');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select o.id, m.id, s.id, '2000-01-01', '10000000-0000-0000-0000-000000000001'
from (values ('10000000-0000-0000-0000-000000000211'::uuid, 'LIM-1'), ('10000000-0000-0000-0000-000000000211', 'LIM-2'),
  ('10000000-0000-0000-0000-000000000211', 'LIM-3'), ('10000000-0000-0000-0000-000000000212', 'LIM-1')) o(id, code)
join public.machines m on m.code = o.code
cross join public.shifts s where s.active;

select is((select count(*)::integer from pg_indexes where schemaname = 'public'
  and indexname in ('one_active_per_operator', 'one_active_per_machine')), 2,
  'Existen los índices únicos parciales one_active_per_operator y one_active_per_machine');
select is((select count(*)::integer from pg_indexes where schemaname = 'public'
  and indexname = 'production_reports_one_draft_per_machine'), 0,
  'Se eliminó el índice production_reports_one_draft_per_machine');
select ok((select prosrc not like '%máximo 5%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'validate_production_report'),
  'validate_production_report ya no aplica el límite de 5 borradores');

select tests.auth_as('10000000-0000-0000-0000-000000000211');
select lives_ok(
  $$insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
    values ('8b000000-0000-0000-0000-000000000001', '3b000000-0000-0000-0000-000000000001', now(),
      '10000000-0000-0000-0000-000000000211', '10000000-0000-0000-0000-000000000211')$$,
  'El operario A inicia su reporte activo en la máquina 1');
select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('3b000000-0000-0000-0000-000000000002', now(),
      '10000000-0000-0000-0000-000000000211', '10000000-0000-0000-0000-000000000211')$$,
  '23505', null,
  'Un operario no puede tener 2 reportes DRAFT, ni siquiera en otra máquina asignada');

select tests.auth_as('10000000-0000-0000-0000-000000000212');
select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('3b000000-0000-0000-0000-000000000001', now(),
      '10000000-0000-0000-0000-000000000212', '10000000-0000-0000-0000-000000000212')$$,
  '23505', null,
  'Una máquina no puede tener 2 reportes DRAFT de operarios distintos');

-- Cancelar libera al operario y a la máquina.
select tests.auth_as('10000000-0000-0000-0000-000000000211');
select lives_ok(
  $$update public.production_reports set status = 'CANCELLED', cancellation_reason = 'Prueba de cancelación'
    where id = '8b000000-0000-0000-0000-000000000001'$$,
  'El operario cancela su reporte activo');
select lives_ok(
  $$insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
    values ('8b000000-0000-0000-0000-000000000002', '3b000000-0000-0000-0000-000000000002', now(),
      '10000000-0000-0000-0000-000000000211', '10000000-0000-0000-0000-000000000211')$$,
  'Tras cancelar, el operario inicia otro reporte en otra máquina asignada del mismo turno');
select tests.auth_as('10000000-0000-0000-0000-000000000212');
select lives_ok(
  $$insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
    values ('8b000000-0000-0000-0000-000000000003', '3b000000-0000-0000-0000-000000000001', now(),
      '10000000-0000-0000-0000-000000000212', '10000000-0000-0000-0000-000000000212')$$,
  'Cancelar libera la máquina para otro operario');

-- Enviar también libera al operario.
select tests.auth_as('10000000-0000-0000-0000-000000000211');
update public.production_reports set
  production_order = 'OP-LIM', line_id = (select id from public.lines order by id limit 1),
  product_name = 'Producto', client_name = 'Cliente', lot = 'L-1', weight = 0, g_min = 0,
  dosifier_type_id = (select id from public.dosifier_types order by id limit 1),
  programmed_hours = 0, units_produced = 0, waste = 0, ended_at = now() + interval '1 hour'
where id = '8b000000-0000-0000-0000-000000000002';
select lives_ok(
  $$update public.production_reports set status = 'SUBMITTED' where id = '8b000000-0000-0000-0000-000000000002'$$,
  'El operario envía su reporte activo');
select lives_ok(
  $$insert into public.production_reports (id, machine_id, started_at, created_by, updated_by)
    values ('8b000000-0000-0000-0000-000000000004', '3b000000-0000-0000-0000-000000000003', now(),
      '10000000-0000-0000-0000-000000000211', '10000000-0000-0000-0000-000000000211')$$,
  'Tras enviar, el operario puede iniciar otro reporte');
select is((select count(*)::integer from public.production_reports
  where created_by = '10000000-0000-0000-0000-000000000211'), 3,
  'El operario acumula reportes cancelado, enviado y activo sin ningún límite de 5');

select * from finish();
rollback;
