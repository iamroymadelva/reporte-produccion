begin;
select plan(24);

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
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000107', 'operario-prueba-segundo@local.test', '{"full_name":"Segundo operario"}');
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000107';

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
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select '10000000-0000-0000-0000-000000000102', m.id, s.id, '2000-01-01', '10000000-0000-0000-0000-000000000001'
from public.machines m cross join public.shifts s
where m.code in ('M-04', 'M-05', 'M-06', 'M-08', 'M-09', 'M-10') and s.active;
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select '10000000-0000-0000-0000-000000000107', m.id, s.id, '2000-01-01', '10000000-0000-0000-0000-000000000001'
from public.machines m cross join public.shifts s
where m.code = 'M-04' and s.active;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000102","role":"authenticated"}';

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_frequent_catalog_value'),
  0::bigint,
  'T077: save_frequent_catalog_value fue eliminada (el Operador no puede crear valores frecuentes)'
);

select is(
  (select count(*) from public.products where name = 'Producto frecuente de prueba'),
  0::bigint,
  'El intento rechazado del Operador no crea ningún Producto'
);

select lives_ok(
  $$insert into public.production_reports (id, machine_id, started_at, client_id, client_name, product_id, product_name, created_by, updated_by)
    values (
      '80000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000004',
      now(),
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
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('30000000-0000-0000-0000-000000000007', now(), '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102')$$,
  'P0001', 'La máquina no está asignada al Operador',
  'El Operador no puede crear un reporte para una máquina no asignada'
);

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000107","role":"authenticated"}';
select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('30000000-0000-0000-0000-000000000004', now(), '10000000-0000-0000-0000-000000000107', '10000000-0000-0000-0000-000000000107')$$,
  '23505', null,
  'Solo existe un reporte activo global por máquina (otro operario asignado a la misma máquina)'
);
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000102","role":"authenticated"}';

select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('30000000-0000-0000-0000-000000000005', now(), '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102')$$,
  '23505', null,
  'El Operador no puede tener un segundo reporte activo, ni siquiera en otra máquina asignada'
);

select throws_ok(
  $$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
    values ('30000000-0000-0000-0000-000000000010', now(), '10000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000102')$$,
  '23505', null,
  'La base de datos rechaza el segundo activo (ya no existe el límite de 5 borradores)'
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

update public.production_reports set ended_at = now(),
  production_order = 'OP-PRUEBA', line_id = (select id from public.lines limit 1),
  lot = 'L-PRUEBA', weight = 0, g_min = 0,
  dosifier_type_id = (select id from public.dosifier_types limit 1),
  programmed_hours = 0, units_produced = 0, waste = 0
where id = '80000000-0000-0000-0000-000000000001';

select throws_ok(
  $$update public.production_reports set status = 'SUBMITTED'
    where id = '80000000-0000-0000-0000-000000000001'$$,
  'P0001', 'No puedes enviar el reporte mientras haya una parada activa. Detén o cancela la parada primero.',
  'No se puede enviar con una parada abierta'
);

update public.report_stop_events set ended_at = now()
where id = '90000000-0000-0000-0000-000000000001';

update public.production_reports set ended_at = null
where id = '80000000-0000-0000-0000-000000000001';

select throws_ok(
  $$update public.production_reports set status = 'SUBMITTED'
    where id = '80000000-0000-0000-0000-000000000001'$$,
  'P0001', 'Hora finalización es obligatorio.',
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

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_frequent_catalog_value'),
  0::bigint,
  'T077: save_frequent_catalog_value no existe tampoco para el Administrador'
);

select is(
  (select count(*) from public.products where name = 'Producto frecuente de prueba'),
  0::bigint,
  'T077: no se crea ningún Producto frecuente (la función fue eliminada)'
);

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
