begin;
select plan(18);

insert into public.machines (code, name, active) values ('INT-M-1', 'Máquina Integridad 1', false);
select throws_ok(
  $$insert into public.machines (code, name) values (' int-m-1 ', 'Máquina Integridad 2')$$,
  '23505', null, 'Máquinas rechaza códigos normalizados duplicados'
);
select throws_ok(
  $$insert into public.machines (code, name) values ('INT-M-2', ' máquina integridad 1 ')$$,
  '23505', null, 'Máquinas rechaza nombres normalizados aunque el registro existente esté inactivo'
);

insert into public.products (code, name, active) values ('INT-P-1', 'Producto Integridad 1', false);
select throws_ok(
  $$insert into public.products (code, name) values (' int-p-1 ', 'Producto Integridad 2')$$,
  '23505', null, 'Productos rechaza códigos normalizados duplicados'
);
select throws_ok(
  $$insert into public.products (code, name) values ('INT-P-2', ' producto integridad 1 ')$$,
  '23505', null, 'Productos rechaza nombres normalizados de registros inactivos'
);

insert into public.clients (code, name) values ('INT-C-1', 'Cliente Integridad 1');
select throws_ok(
  $$insert into public.clients (code, name) values (' int-c-1 ', 'Cliente Integridad 2')$$,
  '23505', null, 'Clientes rechaza códigos normalizados duplicados'
);
select throws_ok(
  $$insert into public.clients (code, name) values ('INT-C-2', ' cliente integridad 1 ')$$,
  '23505', null, 'Clientes rechaza nombres normalizados duplicados'
);

insert into public.lines (code, name) values
  ('INT-L-1', 'Línea Integridad 1'),
  ('INT-L-2', 'Línea Integridad 2');
select throws_ok(
  $$insert into public.lines (code, name) values (' int-l-1 ', 'Línea Integridad 3')$$,
  '23505', null, 'Áreas/Líneas rechaza códigos normalizados duplicados'
);
select throws_ok(
  $$insert into public.lines (code, name) values ('INT-L-3', ' línea integridad 1 ')$$,
  '23505', null, 'Áreas/Líneas rechaza nombres normalizados duplicados'
);

insert into public.dosifier_types (code, name) values
  ('INT-D-1', 'Dosificador Integridad 1'),
  ('INT-D-2', 'Dosificador Integridad 2');
select throws_ok(
  $$insert into public.dosifier_types (code, name) values (' int-d-1 ', 'Dosificador Integridad 3')$$,
  '23505', null, 'Dosificadores rechaza códigos normalizados duplicados'
);
select throws_ok(
  $$insert into public.dosifier_types (code, name) values ('INT-D-3', ' dosificador integridad 1 ')$$,
  '23505', null, 'Dosificadores rechaza nombres normalizados duplicados'
);

select lives_ok(
  $$insert into public.shifts (name, start_time, end_time) values (null, '01:00', '02:00'), (null, '02:00', '03:00')$$,
  'Turnos permite varios nombres nulos'
);
insert into public.shifts (name, start_time, end_time) values ('Turno Integridad', '03:00', '04:00');
select throws_ok(
  $$insert into public.shifts (name, start_time, end_time) values (' turno integridad ', '04:00', '05:00')$$,
  '23505', null, 'Turnos rechaza nombres normalizados duplicados'
);

insert into public.stop_categories (code, name) values ('901', 'Categoría Integridad 901');
select throws_ok(
  $$insert into public.stop_categories (code, name) values ('0901', 'Categoría Integridad 0901')$$,
  '23505', null, 'Categorías rechaza códigos numéricos equivalentes'
);
select throws_ok(
  $$insert into public.stop_categories (code, name) values ('902', ' categoría integridad 901 ')$$,
  '23505', null, 'Categorías rechaza nombres normalizados duplicados'
);

select lives_ok(
  $$update public.lines set name = ' línea integridad 1 ' where code = 'INT-L-1'$$,
  'Editar conserva el mismo valor normalizado en la misma fila'
);
select throws_ok(
  $$update public.lines set name = 'Línea Integridad 1' where code = 'INT-L-2'$$,
  '23505', null, 'Editar rechaza el valor normalizado perteneciente a otra fila'
);

select lives_ok(
  $$insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values
    ('00000000-0000-0000-0000-000000000000', '11000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
      'nombre-repetido-1@local.test', extensions.crypt('Prueba123!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"Nombre Compartido"}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', '11000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
      'nombre-repetido-2@local.test', extensions.crypt('Prueba123!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"Nombre Compartido"}', now(), now(), '', '', '', '')$$,
  'Usuarios permite nombres completos repetidos'
);

select throws_ok(
  $$insert into public.machines (code, name) values ('   ', 'Máquina con código vacío')$$,
  '23514', null, 'Los códigos obligatorios no pueden quedar vacíos'
);

select * from finish();
rollback;
