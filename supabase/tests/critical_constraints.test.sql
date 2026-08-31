begin;
select plan(22);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000102', 'authenticated', 'authenticated',
  'operario-prueba-reglas@local.test', extensions.crypt('Prueba123!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Operario Prueba Reglas"}', now(), now(), '', '', '', ''
);
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000102';

select has_table('public', 'shifts', 'Existe el catálogo de turnos');
select has_column('public', 'production_reports', 'client_name', 'El reporte conserva el texto del Cliente');
select has_column('public', 'production_reports', 'product_name', 'El reporte conserva el texto del Producto');
select has_column('public', 'production_reports', 'shift_id', 'El reporte puede referenciar un Turno');
select lives_ok(
  $$insert into public.shifts (name, start_time, end_time, sort_order)
    values ('Cruce de medianoche', '22:00', '06:00', 99)$$,
  'Los turnos pueden cruzar medianoche'
);

insert into public.machines (id, code, name) values
  ('30000000-0000-0000-0000-000000000004', 'M-04', 'Empacadora 4'),
  ('30000000-0000-0000-0000-000000000005', 'M-05', 'Empacadora 5'),
  ('30000000-0000-0000-0000-000000000006', 'M-06', 'Empacadora 6'),
  ('30000000-0000-0000-0000-000000000007', 'M-07', 'Empacadora no asignada'),
  ('30000000-0000-0000-0000-000000000008', 'M-08', 'Empacadora 8'),
  ('30000000-0000-0000-0000-000000000009', 'M-09', 'Empacadora 9'),
  ('30000000-0000-0000-0000-000000000010', 'M-10', 'Empacadora 10');
insert into public.operator_machine_assignments (operator_id, machine_id, created_by)
select '10000000-0000-0000-0000-000000000102', id, '10000000-0000-0000-0000-000000000001'
from public.machines where code in ('M-04', 'M-05', 'M-06', 'M-08', 'M-09', 'M-10');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000102","role":"authenticated"}';

select lives_ok(
  $$select public.save_frequent_catalog_value('products', 'Producto frecuente de prueba')$$,
  'El Operador puede guardar un Producto frecuente mediante la función limitada'
);

select is(
  (select count(*) from public.products where name = 'Producto frecuente de prueba'),
  1::bigint,
  'El Producto frecuente no se duplica ni se pierde'
);

select lives_ok(
  $$insert into public.production_reports (id, machine_id, client_id, client_name, product_id, product_name, created_by, updated_by)
    values (
      '80000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000004',
      '50000000-0000-0000-0000-000000000001',
      'Cliente histórico',
      '60000000-0000-0000-0000-000000000001',
      'Producto histórico',
      '10000000-0000-0000-0000-000000000102',
      '10000000-0000-0000-0000-000000000102'
    )$$,
  'El Operador crea un borrador para una máquina asignada'
);

select throws_ok(
  $$insert into public.production_reports (machine_id, created_by, updated_by)
    values ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102')$$,
  'P0001', 'La máquina no está asignada al Operador',
  'El Operador no puede crear un reporte para una máquina no asignada'
);

select throws_ok(
  $$insert into public.production_reports (machine_id, created_by, updated_by)
    values ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102')$$,
  '23505', null,
  'Solo existe un borrador global por máquina'
);

select lives_ok(
  $$insert into public.production_reports (machine_id, created_by, updated_by) values
    ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102'),
    ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102'),
    ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102'),
    ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102')$$,
  'El Operador puede mantener cinco borradores'
);

select throws_ok(
  $$insert into public.production_reports (machine_id, created_by, updated_by)
    values ('30000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102')$$,
  'P0001', 'Un Operador puede tener máximo 5 reportes en borrador',
  'La base de datos rechaza el sexto borrador'
);

select lives_ok(
  $$insert into public.report_stop_events (id, report_id, stop_category_id, responsible_user_id)
    select '90000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', id, '10000000-0000-0000-0000-000000000102'
    from public.stop_categories where code = '1'$$,
  'Se puede abrir una parada en un borrador propio'
);

select throws_ok(
  $$insert into public.report_stop_events (report_id, stop_category_id, responsible_user_id)
    select '80000000-0000-0000-0000-000000000001', id, '10000000-0000-0000-0000-000000000102'
    from public.stop_categories where code = '2'$$,
  '23505', null,
  'Solo puede existir una parada abierta por reporte'
);

update public.production_reports set ended_at = now()
where id = '80000000-0000-0000-0000-000000000001';

select throws_ok(
  $$update public.production_reports set status = 'SUBMITTED'
    where id = '80000000-0000-0000-0000-000000000001'$$,
  'P0001', 'No se puede enviar un reporte con una parada abierta',
  'No se puede enviar con una parada abierta'
);

update public.report_stop_events set ended_at = now()
where id = '90000000-0000-0000-0000-000000000001';

update public.production_reports set ended_at = null
where id = '80000000-0000-0000-0000-000000000001';

select throws_ok(
  $$update public.production_reports set status = 'SUBMITTED'
    where id = '80000000-0000-0000-0000-000000000001'$$,
  'P0001', 'Debes registrar la hora de finalización antes de enviar el reporte',
  'La base de datos exige hora final para enviar'
);

update public.production_reports set ended_at = now()
where id = '80000000-0000-0000-0000-000000000001';

select lives_ok(
  $$update public.production_reports set status = 'SUBMITTED'
    where id = '80000000-0000-0000-0000-000000000001'$$,
  'El reporte puede enviarse después de cerrar la parada'
);

update public.production_reports set observations = 'Cambio no permitido'
where id = '80000000-0000-0000-0000-000000000001';

select is(
  (select observations from public.production_reports where id = '80000000-0000-0000-0000-000000000001'),
  null,
  'El Operador no puede modificar su reporte enviado'
);

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*) from public.production_reports where id = '80000000-0000-0000-0000-000000000001'),
  1::bigint,
  'Consulta puede ver reportes enviados'
);

update public.production_reports set observations = 'Cambio de Consulta'
where id = '80000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.production_reports where id = '80000000-0000-0000-0000-000000000001' and observations is null),
  1::bigint,
  'Consulta no puede modificar reportes'
);

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$update public.products set name = 'Producto frecuente renombrado'
    where id = '60000000-0000-0000-0000-000000000001'$$,
  'El Administrador puede renombrar un Producto frecuente'
);

select is(
  (select product_name from public.production_reports where id = '80000000-0000-0000-0000-000000000001'),
  'Producto histórico',
  'Renombrar el catálogo no modifica el snapshot histórico del reporte'
);

select * from finish();
rollback;
