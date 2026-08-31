begin;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000103', 'authenticated', 'authenticated',
  'operario-prueba-cancelacion@local.test', extensions.crypt('Prueba123!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Operario Prueba Cancelación"}', now(), now(), '', '', '', ''
);
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000103';

insert into public.machines (id, code, name) values
  ('31000000-0000-0000-0000-000000000008', 'M-08', 'Máquina cancelación'),
  ('31000000-0000-0000-0000-000000000009', 'M-09', 'Máquina límite 1'),
  ('31000000-0000-0000-0000-000000000010', 'M-10', 'Máquina límite 2'),
  ('31000000-0000-0000-0000-000000000011', 'M-11', 'Máquina límite 3'),
  ('31000000-0000-0000-0000-000000000012', 'M-12', 'Máquina límite 4'),
  ('31000000-0000-0000-0000-000000000013', 'M-13', 'Máquina límite 5');

insert into public.operator_machine_assignments (operator_id, machine_id, created_by)
select '10000000-0000-0000-0000-000000000103', id, '10000000-0000-0000-0000-000000000001'
from public.machines where code in ('M-08', 'M-09', 'M-10', 'M-11', 'M-12', 'M-13');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000103","role":"authenticated"}';

insert into public.production_reports (id, machine_id, created_by, updated_by)
values (
  '81000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000008',
  '10000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000103'
);

select throws_ok(
  $$update public.production_reports set status = 'CANCELLED'
    where id = '81000000-0000-0000-0000-000000000001'$$,
  'P0001', 'Debes indicar el motivo de cancelación',
  'La cancelación exige un motivo'
);

select lives_ok(
  $$insert into public.report_stop_events (id, report_id, stop_category_id, responsible_user_id)
    select '91000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', id, '10000000-0000-0000-0000-000000000103'
    from public.stop_categories where code = '1'$$,
  'El reporte de prueba puede abrir una parada'
);

select throws_ok(
  $$update public.production_reports
    set status = 'CANCELLED', cancellation_reason = 'Prueba con parada abierta'
    where id = '81000000-0000-0000-0000-000000000001'$$,
  'P0001', 'No se puede cancelar un reporte con una parada abierta',
  'No se puede cancelar con una parada abierta'
);

update public.report_stop_events set ended_at = now()
where id = '91000000-0000-0000-0000-000000000001';

select lives_ok(
  $$update public.production_reports
    set status = 'CANCELLED', cancellation_reason = 'Orden cancelada por el cliente'
    where id = '81000000-0000-0000-0000-000000000001'$$,
  'El Operario puede cancelar su borrador sin parada abierta'
);

select ok(
  (select status = 'CANCELLED'
    and cancellation_reason = 'Orden cancelada por el cliente'
    and cancelled_at is not null
    and cancelled_by = '10000000-0000-0000-0000-000000000103'
   from public.production_reports where id = '81000000-0000-0000-0000-000000000001'),
  'La cancelación almacena estado, motivo, fecha y responsable'
);

select lives_ok(
  $$insert into public.production_reports (machine_id, created_by, updated_by)
    values ('31000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000103')$$,
  'Cancelar libera inmediatamente la máquina para otro borrador'
);

select lives_ok(
  $$insert into public.production_reports (machine_id, created_by, updated_by) values
    ('31000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000103'),
    ('31000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000103'),
    ('31000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000103'),
    ('31000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000103')$$,
  'El reporte cancelado no cuenta dentro de los cinco borradores'
);

select throws_ok(
  $$insert into public.production_reports (machine_id, created_by, updated_by)
    values ('31000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000103')$$,
  'P0001', 'Un Operador puede tener máximo 5 reportes en borrador',
  'El límite de cinco borradores sigue vigente'
);

update public.production_reports set observations = 'Cambio no permitido'
where id = '81000000-0000-0000-0000-000000000001';

select is(
  (select observations from public.production_reports where id = '81000000-0000-0000-0000-000000000001'),
  null,
  'El reporte cancelado queda en solo lectura para el Operario'
);

select * from finish();
rollback;
