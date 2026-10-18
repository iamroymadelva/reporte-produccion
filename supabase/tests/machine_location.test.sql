-- Ubicación de la máquina (public.machines.location): texto libre opcional, 1..120 caracteres tras recortar.
-- Escritura solo para gestores (ROOT y coordinador); lectura para usuarios activos; auditoría administrativa.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000451', 'ml-root@usuarios.reporte-produccion.invalid', '{"full_name":"ML Root","username":"ml-root"}'),
  ('10000000-0000-0000-0000-000000000452', 'ml-coord@usuarios.reporte-produccion.invalid', '{"full_name":"ML Coord","username":"ml-coord"}'),
  ('10000000-0000-0000-0000-000000000453', 'ml-viewer@usuarios.reporte-produccion.invalid', '{"full_name":"ML Auditor","username":"ml-viewer"}'),
  ('10000000-0000-0000-0000-000000000454', 'ml-op@usuarios.reporte-produccion.invalid', '{"full_name":"ML Operario","username":"ml-op"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000451';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000452';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000453';
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000454';

insert into public.machines (id, code, name, location) values
  ('3a000000-0000-0000-0000-000000000001', 'ML-1', 'ML Máquina 1', 'Planta 2, línea norte'),
  ('3a000000-0000-0000-0000-000000000002', 'ML-2', 'ML Máquina 2', null);
delete from public.administrative_audit_log;

-- ---------------------------------------------------------------- Columna y restricción
select has_column('public', 'machines', 'location', 'machines.location existe');
select col_type_is('public', 'machines', 'location', 'text', 'location es text');
select col_is_null('public', 'machines', 'location', 'location es opcional (nullable)');
select is((select location from public.machines where code = 'ML-2'), null, 'Una máquina sin ubicación queda en null');

select lives_ok($$update public.machines set location = repeat('x', 120) where code = 'ML-2'$$, '120 caracteres es válido');
select throws_ok($$update public.machines set location = repeat('x', 121) where code = 'ML-2'$$, '23514', null, '121 caracteres se rechaza');
select throws_ok($$update public.machines set location = '' where code = 'ML-2'$$, '23514', null, 'La cadena vacía se rechaza (la app la normaliza a null)');
select throws_ok($$update public.machines set location = '   ' where code = 'ML-2'$$, '23514', null, 'Solo espacios se rechaza');
select lives_ok($$update public.machines set location = null where code = 'ML-2'$$, 'null es válido (sin ubicación)');
select throws_ok($$insert into public.machines (code, name, location) values ('ML-3', 'ML Máquina 3', repeat('y', 121))$$, '23514', null, 'INSERT con más de 120 se rechaza');

-- ---------------------------------------------------------------- Escritura: solo gestores
select tests.auth_as('10000000-0000-0000-0000-000000000454');
select throws_ok($$insert into public.machines (code, name, location) values ('ML-OP', 'ML operario', 'Planta 1')$$, '42501', null, 'OPERATOR no crea máquinas con ubicación');
select results_eq($$with changed as (update public.machines set location = 'Hackeada' where code = 'ML-1' returning id) select count(*)::integer from changed$$,
  array[0], 'OPERATOR no actualiza la ubicación');
select is((select location from public.machines where code = 'ML-1'), 'Planta 2, línea norte', 'OPERATOR puede leer la ubicación');

select tests.auth_as('10000000-0000-0000-0000-000000000453');
select throws_ok($$insert into public.machines (code, name, location) values ('ML-VW', 'ML auditor', 'Planta 1')$$, '42501', null, 'VIEWER no crea máquinas con ubicación');
select results_eq($$with changed as (update public.machines set location = 'Hackeada' where code = 'ML-1' returning id) select count(*)::integer from changed$$,
  array[0], 'VIEWER no actualiza la ubicación');
select is((select location from public.machines where code = 'ML-1'), 'Planta 2, línea norte', 'VIEWER puede leer la ubicación');

select tests.auth_as('10000000-0000-0000-0000-000000000452');
select lives_ok($$update public.machines set location = 'Bodega norte' where code = 'ML-1'$$, 'El coordinador actualiza la ubicación');
select is((select location from public.machines where code = 'ML-1'), 'Bodega norte', 'El coordinador ve el cambio');

select tests.auth_as('10000000-0000-0000-0000-000000000451');
select lives_ok($$insert into public.machines (code, name, location) values ('ML-RT', 'ML root', 'Planta 3')$$, 'ROOT crea una máquina con ubicación');
select lives_ok($$update public.machines set location = 'Planta 4' where code = 'ML-RT'$$, 'ROOT actualiza la ubicación');
select tests.auth_reset();

-- ---------------------------------------------------------------- Auditoría administrativa
select is((select count(*)::integer from public.administrative_audit_log
  where entity_type = 'machines' and action = 'UPDATE' and entity_label = 'ML-1'
    and old_value = '{"location":"Planta 2, línea norte"}'::jsonb and new_value = '{"location":"Bodega norte"}'::jsonb
    and actor_role = 'ADMINISTRATOR'), 1,
  'El cambio de ubicación del coordinador se audita con old/new de location');
select is((select count(*)::integer from public.administrative_audit_log
  where entity_type = 'machines' and action = 'INSERT' and entity_label = 'ML-RT'
    and new_value ->> 'location' = 'Planta 3' and actor_role = 'ROOT'), 1,
  'El alta con ubicación se audita con location en new_value');
select is((select count(*)::integer from public.administrative_audit_log
  where entity_type = 'machines' and action = 'UPDATE' and entity_label = 'ML-RT'
    and old_value = '{"location":"Planta 3"}'::jsonb and new_value = '{"location":"Planta 4"}'::jsonb), 1,
  'El cambio de ubicación de ROOT se audita');

select * from finish();
rollback;
