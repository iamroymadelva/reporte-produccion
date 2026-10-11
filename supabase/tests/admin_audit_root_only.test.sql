-- T057: auditoría administrativa (FR-029a): INSERT/UPDATE/DELETE sobre tablas administrativas generan filas
-- con old_value/new_value y sin secretos; solo ROOT lee administrative_audit_log; sin duplicados con
-- manage_user_assignments.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000401', 'aa-root@usuarios.reporte-produccion.invalid', '{"full_name":"AA Root","username":"aa-root"}'),
  ('10000000-0000-0000-0000-000000000402', 'aa-coord@usuarios.reporte-produccion.invalid', '{"full_name":"AA Coord","username":"aa-coord"}'),
  ('10000000-0000-0000-0000-000000000403', 'aa-aud@usuarios.reporte-produccion.invalid', '{"full_name":"AA Auditor","username":"aa-aud"}'),
  ('10000000-0000-0000-0000-000000000404', 'aa-op@usuarios.reporte-produccion.invalid', '{"full_name":"AA Operario","username":"aa-op"}'),
  ('10000000-0000-0000-0000-000000000405', 'aa-new@usuarios.reporte-produccion.invalid', '{"full_name":"AA Nuevo","username":"aa-new"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000401';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000402';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000403';
update public.profiles set role = 'OPERATOR', active = true where id in ('10000000-0000-0000-0000-000000000404', '10000000-0000-0000-0000-000000000405');
-- Parte de un registro limpio: lo anterior son fixtures.
delete from public.administrative_audit_log;

select ok(to_regprocedure('private.audit_administrative_deletion()') is null, 'audit_administrative_deletion fue reemplazada');
select ok(to_regprocedure('private.audit_admin_entity()') is not null, 'Existe audit_admin_entity');

-- Catálogos y entidades: INSERT, UPDATE (nombre), DEACTIVATE, REACTIVATE y DELETE.
insert into public.machines (id, code, name) values ('3e000000-0000-0000-0000-000000000001', 'AA-M', 'AA Máquina');
insert into public.lines (id, code, name) values ('4e000000-0000-0000-0000-000000000001', 'AA-L', 'AA Línea');
insert into public.clients (id, code, name) values ('5e000000-0000-0000-0000-000000000001', 'AA-C', 'AA Cliente');
insert into public.products (id, code, name) values ('6e000000-0000-0000-0000-000000000001', 'AA-P', 'AA Producto');
insert into public.dosifier_types (id, code, name) values ('7e000000-0000-0000-0000-000000000001', 'AA-D', 'AA Dosificador');
insert into public.shifts (id, name, start_time, end_time, sort_order) values ('2e000000-0000-0000-0000-000000000001', 'AA Turno', '01:00', '02:00', 950);
insert into public.stop_categories (id, code, name) values ('1e000000-0000-0000-0000-000000000001', '9951', 'AA Parada');
insert into public.change_types (id, code, name) values ('8e000000-0000-0000-0000-000000000001', 'AA-CT', 'AA Cambio');

update public.machines set name = 'AA Máquina 2' where id = '3e000000-0000-0000-0000-000000000001';
update public.lines set name = 'AA Línea 2' where id = '4e000000-0000-0000-0000-000000000001';
update public.clients set name = 'AA Cliente 2' where id = '5e000000-0000-0000-0000-000000000001';
update public.products set name = 'AA Producto 2' where id = '6e000000-0000-0000-0000-000000000001';
update public.dosifier_types set name = 'AA Dosificador 2' where id = '7e000000-0000-0000-0000-000000000001';
update public.shifts set name = 'AA Turno 2' where id = '2e000000-0000-0000-0000-000000000001';
update public.stop_categories set name = 'AA Parada 2' where id = '1e000000-0000-0000-0000-000000000001';
update public.change_types set name = 'AA Cambio 2' where id = '8e000000-0000-0000-0000-000000000001';

select is((select count(*)::integer from public.administrative_audit_log where action = 'INSERT' and entity_type = t), 1, 'INSERT auditado en ' || t)
from unnest(array['machines', 'lines', 'clients', 'products', 'dosifier_types', 'shifts', 'stop_categories', 'change_types']) t;
select is((select count(*)::integer from public.administrative_audit_log where action = 'UPDATE' and entity_type = t
  and old_value ->> 'name' like 'AA %' and new_value ->> 'name' like 'AA % 2' and not (new_value ? 'code')), 1,
  'UPDATE auditado en ' || t || ' solo con el campo que cambió')
from unnest(array['machines', 'lines', 'clients', 'products', 'dosifier_types', 'shifts', 'stop_categories', 'change_types']) t;
select ok(not exists (select 1 from public.administrative_audit_log where new_value ? 'updated_at' or old_value ? 'updated_at'),
  'updated_at no se guarda en old_value/new_value');

-- active: DEACTIVATE / REACTIVATE.
update public.machines set active = false where id = '3e000000-0000-0000-0000-000000000001';
update public.machines set active = true where id = '3e000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.administrative_audit_log where entity_type = 'machines' and action = 'DEACTIVATE'
  and old_value = '{"active":true}' and new_value = '{"active":false}'), 1, 'DEACTIVATE con old/new de active');
select is((select count(*)::integer from public.administrative_audit_log where entity_type = 'machines' and action = 'REACTIVATE'), 1, 'REACTIVATE auditado');

-- UPDATE sin cambios no genera fila.
create temp table aa_count as select count(*)::integer c from public.administrative_audit_log;
update public.machines set name = name where id = '3e000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.administrative_audit_log), (select c from aa_count), 'Un UPDATE sin cambios no genera fila');

-- Sistema (sin sesión): performed_by y actor_role nulos.
select ok((select performed_by is null and actor_role is null from public.administrative_audit_log
  where entity_type = 'machines' and action = 'INSERT'), 'Escritura de sistema: performed_by y actor_role nulos');

-- Asignaciones.
select set_config('test.shift', (select id::text from public.shifts where active and id <> '2e000000-0000-0000-0000-000000000001' order by sort_order limit 1), true);
insert into public.operator_machine_assignments (id, operator_id, machine_id, shift_id, valid_from, created_by)
values ('9e000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000404', '3e000000-0000-0000-0000-000000000001',
  current_setting('test.shift')::uuid, '2026-01-01', '10000000-0000-0000-0000-000000000401');
update public.operator_machine_assignments set valid_to = '2026-12-31' where id = '9e000000-0000-0000-0000-000000000001';
delete from public.operator_machine_assignments where id = '9e000000-0000-0000-0000-000000000001';
select is((select string_agg(action, ',' order by id) from public.administrative_audit_log where entity_type = 'operator_machine_assignments'),
  'INSERT,UPDATE,DELETE', 'Asignaciones: INSERT, UPDATE y DELETE auditados');
select is((select new_value ->> 'valid_to' from public.administrative_audit_log
  where entity_type = 'operator_machine_assignments' and action = 'UPDATE'), '2026-12-31', 'UPDATE de asignación con new_value');
select is((select entity_label from public.administrative_audit_log
  where entity_type = 'operator_machine_assignments' and action = 'INSERT'), 'aa-op', 'La asignación se etiqueta con el usuario del operario');

-- Perfiles: DELETE, INSERT y UPDATE directos (el alta vía auth no se audita aparte).
select is((select count(*)::integer from public.administrative_audit_log where entity_type = 'profiles'), 0,
  'El alta técnica del perfil vía auth.users no genera filas');
delete from public.profiles where id = '10000000-0000-0000-0000-000000000405';
insert into public.profiles (id, username, full_name, role, active) values
  ('10000000-0000-0000-0000-000000000405', 'aa-new', 'AA Nuevo', 'OPERATOR', true);
update public.profiles set job_title = 'Empacador' where id = '10000000-0000-0000-0000-000000000405';
select is((select string_agg(action, ',' order by id) from public.administrative_audit_log where entity_type = 'profiles'),
  'DELETE,INSERT,UPDATE', 'Perfiles: DELETE, INSERT y UPDATE auditados');
select is((select new_value::text from public.administrative_audit_log where entity_type = 'profiles' and action = 'UPDATE'),
  '{"job_title": "Empacador"}', 'UPDATE de perfil solo con el campo que cambió');
select ok(not exists (select 1 from public.administrative_audit_log where entity_type = 'profiles'
  and (coalesce(new_value, '{}') || coalesce(old_value, '{}')) ?| array['password', 'encrypted_password', 'token', 'secret']),
  'Los perfiles no guardan secretos');

-- app_settings.
update public.app_settings set off_shift_grace = interval '3 hours';
select is((select new_value ->> 'off_shift_grace' from public.administrative_audit_log where entity_type = 'app_settings' and action = 'UPDATE'),
  '03:00:00', 'app_settings: UPDATE auditado');

-- DELETE de catálogos.
delete from public.machines where id = '3e000000-0000-0000-0000-000000000001';
delete from public.lines where id = '4e000000-0000-0000-0000-000000000001';
delete from public.clients where id = '5e000000-0000-0000-0000-000000000001';
delete from public.products where id = '6e000000-0000-0000-0000-000000000001';
delete from public.dosifier_types where id = '7e000000-0000-0000-0000-000000000001';
delete from public.shifts where id = '2e000000-0000-0000-0000-000000000001';
delete from public.stop_categories where id = '1e000000-0000-0000-0000-000000000001';
delete from public.change_types where id = '8e000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.administrative_audit_log where action = 'DELETE' and entity_type = t
  and old_value ->> 'name' like 'AA %' and new_value is null), 1, 'DELETE auditado en ' || t || ' con old_value')
from unnest(array['machines', 'lines', 'clients', 'products', 'dosifier_types', 'shifts', 'stop_categories', 'change_types']) t;

-- Escritura de un usuario con sesión: performed_by y actor_role.
insert into public.machines (id, code, name) values ('3e000000-0000-0000-0000-000000000002', 'AA-M2', 'AA Máquina 2b');
delete from public.administrative_audit_log;
select tests.auth_as('10000000-0000-0000-0000-000000000402');
update public.machines set name = 'AA Máquina editada' where id = '3e000000-0000-0000-0000-000000000002';
select tests.auth_reset();
select is((select performed_by::text || '/' || actor_role::text from public.administrative_audit_log where entity_type = 'machines'),
  '10000000-0000-0000-0000-000000000402/ADMINISTRATOR', 'performed_by y actor_role provienen de la sesión');

-- Sin duplicados con manage_user_assignments: solo las filas semánticas.
delete from public.administrative_audit_log;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000404', '10000000-0000-0000-0000-000000000401',
  '{"job_title":"Jefe de línea","audit_action":"UPDATE"}'::jsonb,
  ('[{"machine_id":"3e000000-0000-0000-0000-000000000002","shift_id":"' || current_setting('test.shift') || '","valid_from":"2026-01-01"}]')::jsonb)$$,
  'manage_user_assignments edita perfil y asignaciones');
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000404', '10000000-0000-0000-0000-000000000401',
  '{"audit_action":"REMOVE_USER"}'::jsonb, '[]'::jsonb)$$, 'manage_user_assignments retira al usuario');
reset role;
select is((select string_agg(action || ':' || entity_type, ',' order by id) from public.administrative_audit_log),
  'UPDATE:profiles,REMOVE_USER:profiles', 'manage_user_assignments solo deja sus filas semánticas (sin duplicados del trigger)');
select is((select count(*)::integer from public.administrative_audit_log where performed_by = '10000000-0000-0000-0000-000000000401'
  and actor_role = 'ROOT'), 2, 'Las filas semánticas conservan el actor');
select is((select count(*)::integer from public.operator_machine_assignments where operator_id = '10000000-0000-0000-0000-000000000404' and not active), 1,
  'La asignación sí se desactivó (solo se omitió la auditoría genérica)');
-- Las GUC se limpian: después de la RPC el trigger vuelve a auditar.
update public.profiles set job_title = 'Otro' where id = '10000000-0000-0000-0000-000000000402';
select is((select count(*)::integer from public.administrative_audit_log where action = 'UPDATE' and entity_id = '10000000-0000-0000-0000-000000000402'), 1,
  'Fuera de la RPC el trigger genérico vuelve a auditar');

-- Lectura: solo ROOT.
select tests.auth_as('10000000-0000-0000-0000-000000000401');
select ok((select count(*) from public.administrative_audit_log) > 0, 'ROOT lee administrative_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000402');
select is((select count(*)::integer from public.administrative_audit_log), 0, 'ADMINISTRATOR recibe 0 filas');
select tests.auth_as('10000000-0000-0000-0000-000000000403');
select is((select count(*)::integer from public.administrative_audit_log), 0, 'VIEWER recibe 0 filas');
select tests.auth_as('10000000-0000-0000-0000-000000000404');
select is((select count(*)::integer from public.administrative_audit_log), 0, 'OPERATOR recibe 0 filas');
select tests.auth_reset();

select * from finish();
rollback;
