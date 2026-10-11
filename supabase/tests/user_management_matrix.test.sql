-- T031: manage_user_assignments respeta la matriz de gestión (FR-028), la invariante ROOT (FR-005),
-- el bloqueo por datos pendientes (FR-005a) y report_device_sync_status solo escribe filas de auth.uid().
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

-- Fixtures: ROOT, coordinador, auditor y dos operarios propios de esta prueba.
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000301', 'mx-root@usuarios.reporte-produccion.invalid', '{"full_name":"MX Root","username":"mx-root"}'),
  ('10000000-0000-0000-0000-000000000302', 'mx-coord@usuarios.reporte-produccion.invalid', '{"full_name":"MX Coord","username":"mx-coord"}'),
  ('10000000-0000-0000-0000-000000000303', 'mx-aud@usuarios.reporte-produccion.invalid', '{"full_name":"MX Auditor","username":"mx-aud"}'),
  ('10000000-0000-0000-0000-000000000304', 'mx-opa@usuarios.reporte-produccion.invalid', '{"full_name":"MX Op A","username":"mx-opa"}'),
  ('10000000-0000-0000-0000-000000000305', 'mx-opb@usuarios.reporte-produccion.invalid', '{"full_name":"MX Op B","username":"mx-opb"}'),
  ('10000000-0000-0000-0000-000000000306', 'mx-new@usuarios.reporte-produccion.invalid', '{"full_name":"MX Nuevo","username":"mx-new"}'),
  ('10000000-0000-0000-0000-000000000307', 'mx-new2@usuarios.reporte-produccion.invalid', '{"full_name":"MX Nuevo 2","username":"mx-new2"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000301';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000302';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000303';
update public.profiles set role = 'OPERATOR', active = true where id in ('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000305');
insert into public.machines (id, code, name) values
  ('3c000000-0000-0000-0000-000000000001', 'MX-1', 'MX Máquina 1'),
  ('3c000000-0000-0000-0000-000000000002', 'MX-2', 'MX Máquina inactiva');
update public.machines set active = false where id = '3c000000-0000-0000-0000-000000000002';
select set_config('test.shift', (select id::text from public.shifts where active order by sort_order, start_time limit 1), true);

select ok(to_regprocedure('public.manage_user_assignments(uuid,uuid,jsonb,jsonb)') is not null, 'Existe manage_user_assignments');
select ok(to_regprocedure('public.replace_operator_assignments(uuid,uuid[],uuid,jsonb)') is null, 'replace_operator_assignments fue eliminada');
select ok(not has_function_privilege('authenticated', 'public.manage_user_assignments(uuid,uuid,jsonb,jsonb)', 'EXECUTE'),
  'authenticated no ejecuta manage_user_assignments');
select ok(has_function_privilege('service_role', 'public.manage_user_assignments(uuid,uuid,jsonb,jsonb)', 'EXECUTE'),
  'service_role ejecuta manage_user_assignments');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- Matriz: coordinador (ADMINISTRATOR) solo gestiona OPERATOR y solo con rol OPERATOR.
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302',
  '{"job_title":"Empacador"}'::jsonb, null)$$, 'El coordinador edita a un operario');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302',
  '{"role":"VIEWER"}'::jsonb, null)$$, '42501', null, 'El coordinador no puede asignar el rol VIEWER');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302',
  '{"role":"ADMINISTRATOR"}'::jsonb, null)$$, '42501', null, 'El coordinador no puede asignar el rol ADMINISTRATOR');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000303', '10000000-0000-0000-0000-000000000302',
  '{"job_title":"x"}'::jsonb, null)$$, '42501', null, 'El coordinador no gestiona a un auditor');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000301', '10000000-0000-0000-0000-000000000302',
  '{"job_title":"x"}'::jsonb, null)$$, '42501', null, 'El coordinador no gestiona a un ROOT');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000302', '10000000-0000-0000-0000-000000000302',
  '{"job_title":"x"}'::jsonb, null)$$, '42501', null, 'El coordinador no se gestiona a sí mismo');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304',
  '{"job_title":"x"}'::jsonb, null)$$, '42501', null, 'Un operario no es actor válido');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000303',
  '{"job_title":"x"}'::jsonb, null)$$, '42501', null, 'Un auditor no es actor válido');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000306', '10000000-0000-0000-0000-000000000302',
  '{"role":"ADMINISTRATOR","active":true,"audit_action":"USER_CREATED"}'::jsonb, '[]'::jsonb)$$, '42501', null,
  'El coordinador no puede crear un ADMINISTRATOR');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000306', '10000000-0000-0000-0000-000000000302',
  '{"role":"VIEWER","active":true,"audit_action":"USER_CREATED"}'::jsonb, '[]'::jsonb)$$, '42501', null,
  'El coordinador no puede crear un VIEWER');

-- ROOT gestiona a todos y puede crear cualquier rol.
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000303', '10000000-0000-0000-0000-000000000301',
  '{"job_title":"Auditor jefe"}'::jsonb, null)$$, 'ROOT edita a un auditor');
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000306', '10000000-0000-0000-0000-000000000301',
  '{"role":"ADMINISTRATOR","active":true,"job_title":"Coordinador nuevo","audit_action":"USER_CREATED"}'::jsonb, '[]'::jsonb)$$,
  'ROOT crea un coordinador');
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000307', '10000000-0000-0000-0000-000000000302',
  '{"role":"OPERATOR","active":true,"job_title":"Operario nuevo","audit_action":"USER_CREATED"}'::jsonb,
  ('[{"machine_id":"3c000000-0000-0000-0000-000000000001","shift_id":"' || current_setting('test.shift') || '","valid_from":"2026-01-01"}]')::jsonb)$$,
  'El coordinador crea un operario con una asignación');

reset role;
select is((select role::text || '/' || active::text || '/' || coalesce(created_by::text, '-') from public.profiles where id = '10000000-0000-0000-0000-000000000306'),
  'ADMINISTRATOR/true/10000000-0000-0000-0000-000000000301', 'El perfil creado conserva rol, estado y created_by');
select is((select count(*)::integer from public.operator_machine_assignments
  where operator_id = '10000000-0000-0000-0000-000000000307' and active), 1, 'La asignación máquina × turno se guardó');
select is((select actor_role::text from public.administrative_audit_log
  where action = 'USER_CREATED' and entity_id = '10000000-0000-0000-0000-000000000307'), 'ADMINISTRATOR',
  'USER_CREATED se audita con el rol del actor');
select is((select count(*)::integer from public.notification_events where event_key like 'assignment:10000000-0000-0000-0000-000000000307:%'), 1,
  'La asignación inicial notifica ASSIGNMENTS_CHANGED');

-- Asignaciones: solo máquinas y turnos activos, solo operarios, vigencia coherente.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302', null,
  ('[{"machine_id":"3c000000-0000-0000-0000-000000000002","shift_id":"' || current_setting('test.shift') || '","valid_from":"2026-01-01"}]')::jsonb)$$,
  'P0001', 'Only active machines may be assigned', 'No se asignan máquinas inactivas');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302', null,
  '[{"machine_id":"3c000000-0000-0000-0000-000000000001","shift_id":"00000000-0000-0000-0000-000000000099","valid_from":"2026-01-01"}]'::jsonb)$$,
  'P0001', 'Only active shifts may be assigned', 'No se asignan turnos inexistentes o inactivos');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302', null,
  ('[{"machine_id":"3c000000-0000-0000-0000-000000000001","shift_id":"' || current_setting('test.shift') || '","valid_from":"2026-02-01","valid_to":"2026-01-01"}]')::jsonb)$$,
  'P0001', null, 'La vigencia hasta no puede ser anterior a desde');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000303', '10000000-0000-0000-0000-000000000301', null,
  ('[{"machine_id":"3c000000-0000-0000-0000-000000000001","shift_id":"' || current_setting('test.shift') || '","valid_from":"2026-01-01"}]')::jsonb)$$,
  'P0001', null, 'Solo los operarios tienen asignaciones');

-- Invariante ROOT: nadie desactiva ni degrada su propio ROOT.
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000301', '10000000-0000-0000-0000-000000000301',
  '{"active":false}'::jsonb, null)$$, '42501', null, 'ROOT no puede desactivarse a sí mismo');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000301', '10000000-0000-0000-0000-000000000301',
  '{"role":"ADMINISTRATOR"}'::jsonb, null)$$, '42501', null, 'ROOT no puede degradarse a sí mismo');
reset role;
select ok((select count(*) from public.profiles where role = 'ROOT' and active) >= 1, 'Siempre queda al menos un ROOT activo');

-- FR-005a: DRAFT o pendientes bloquean desactivar y retirar.
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select '10000000-0000-0000-0000-000000000304', '3c000000-0000-0000-0000-000000000001', s.id, '2000-01-01',
  '10000000-0000-0000-0000-000000000301'
from public.shifts s where s.active;
insert into public.production_reports (id, machine_id, started_at, created_by, updated_by) values
  ('8c000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001', now(),
   '10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304');
insert into public.device_sync_status (user_id, device_id, pending_count) values
  ('10000000-0000-0000-0000-000000000305', '9c000000-0000-0000-0000-000000000001', 3);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302',
  '{"active":false}'::jsonb, '[]'::jsonb)$$, 'P0004', 'USER_HAS_PENDING_DATA', 'Desactivar con un DRAFT se bloquea');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302',
  '{"audit_action":"REMOVE_USER"}'::jsonb, '[]'::jsonb)$$, 'P0004', 'USER_HAS_PENDING_DATA', 'Retirar con un DRAFT se bloquea');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000302',
  '{"active":false}'::jsonb, '[]'::jsonb)$$, 'P0004', 'USER_HAS_PENDING_DATA', 'Desactivar con pendientes en un dispositivo se bloquea');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000302',
  '{"audit_action":"REMOVE_USER"}'::jsonb, '[]'::jsonb)$$, 'P0004', 'USER_HAS_PENDING_DATA', 'Retirar con pendientes en un dispositivo se bloquea');
reset role;
update public.device_sync_status set pending_count = 0 where user_id = '10000000-0000-0000-0000-000000000305';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000302',
  '{"audit_action":"REMOVE_USER"}'::jsonb, '[]'::jsonb)$$, 'Retirar con 0 pendientes y sin DRAFT es válido');
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000302',
  '{"active":true,"audit_action":"REACTIVATE_USER"}'::jsonb, '[]'::jsonb)$$, 'El coordinador reactiva a un operario retirado');
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000302',
  '{"audit_action":"PASSWORD_RESET"}'::jsonb, null)$$, 'El coordinador audita un restablecimiento de contraseña');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000303', '10000000-0000-0000-0000-000000000302',
  '{"audit_action":"PASSWORD_RESET"}'::jsonb, null)$$, '42501', null, 'El coordinador no restablece la contraseña de un auditor');
reset role;
select is((select active::text || '/' || (removed_at is null)::text from public.profiles where id = '10000000-0000-0000-0000-000000000305'),
  'true/true', 'La reactivación limpia removed_at');
select ok((select count(*) = 1 from public.administrative_audit_log where action = 'REMOVE_USER' and entity_id = '10000000-0000-0000-0000-000000000305'
  and actor_role = 'ADMINISTRATOR'), 'REMOVE_USER se audita con actor_role');
select ok((select count(*) = 1 from public.administrative_audit_log where action = 'REACTIVATE_USER' and entity_id = '10000000-0000-0000-0000-000000000305'),
  'REACTIVATE_USER se audita');
select ok((select count(*) = 1 from public.administrative_audit_log where action = 'PASSWORD_RESET' and entity_id = '10000000-0000-0000-0000-000000000305'
  and actor_role = 'ADMINISTRATOR' and coalesce(details::text, '') not ilike '%password%'), 'PASSWORD_RESET se audita sin contraseña');
select ok((select count(*) >= 1 from public.administrative_audit_log where action = 'UPDATE' and entity_id = '10000000-0000-0000-0000-000000000304'),
  'UPDATE se audita');

-- Regresión: una asignación conservada sin claves de vigencia NO cambia valid_from/valid_to.
update public.operator_machine_assignments set valid_to = '2030-01-01', valid_from = '2001-02-03'
where id = (select id from public.operator_machine_assignments
  where operator_id = '10000000-0000-0000-0000-000000000304' and active order by shift_id limit 1);
update public.operator_machine_assignments set valid_to = '2031-06-30'
where id = (select id from public.operator_machine_assignments
  where operator_id = '10000000-0000-0000-0000-000000000304' and active order by shift_id desc limit 1);
create temporary table vig_before as
  select id, valid_from, valid_to from public.operator_machine_assignments
  where operator_id = '10000000-0000-0000-0000-000000000304' and active;
grant select on vig_before to public;
select ok((select count(distinct valid_to) from vig_before) >= 2, 'Fixture: vigencias distintas (2030, 2031 y sin fin)');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302',
  '{"job_title":"Solo cargo"}'::jsonb,
  (select jsonb_agg(jsonb_build_object('machine_id', machine_id, 'shift_id', shift_id))
   from public.operator_machine_assignments where operator_id = '10000000-0000-0000-0000-000000000304' and active))$$,
  'Guardar sin claves de vigencia es válido');
reset role;
select is((select count(*)::integer from public.operator_machine_assignments a join vig_before b on b.id = a.id
  where a.active and a.valid_from is not distinct from b.valid_from and a.valid_to is not distinct from b.valid_to),
  (select count(*)::integer from vig_before), 'Sin claves de vigencia, las asignaciones conservadas no cambian');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000302',
  null,
  (select jsonb_agg(jsonb_build_object('machine_id', machine_id, 'shift_id', shift_id, 'valid_to', '2040-12-31'))
   from public.operator_machine_assignments where operator_id = '10000000-0000-0000-0000-000000000304' and active))$$,
  'Con valid_to explícito se aplica a todas');
reset role;
select is((select count(*)::integer from public.operator_machine_assignments
  where operator_id = '10000000-0000-0000-0000-000000000304' and active and valid_to = '2040-12-31'),
  (select count(*)::integer from vig_before), 'valid_to explícito sobrescribe');
select is((select a.valid_from from public.operator_machine_assignments a join vig_before b on b.id = a.id
  where b.valid_from = '2001-02-03'), '2001-02-03'::date, 'valid_from ausente se conserva aunque se cambie valid_to');

-- report_device_sync_status: solo la fila del propio auth.uid().
select tests.auth_as('10000000-0000-0000-0000-000000000304');
select lives_ok($$select public.report_device_sync_status('9c000000-0000-0000-0000-000000000002', 4, now() - interval '1 hour')$$,
  'Un usuario activo reporta su estado de sincronización');
select throws_ok($$select public.report_device_sync_status('9c000000-0000-0000-0000-000000000002', -1, null)$$, null, null,
  'Los pendientes negativos se rechazan');
select tests.auth_reset();
select is((select count(*)::integer from public.device_sync_status where device_id = '9c000000-0000-0000-0000-000000000002'
  and user_id = '10000000-0000-0000-0000-000000000304' and pending_count = 4), 1, 'La fila pertenece a auth.uid()');
select is((select count(*)::integer from public.device_sync_status where device_id = '9c000000-0000-0000-0000-000000000002'), 1,
  'No se escribieron filas de otros usuarios');
select tests.auth_as('10000000-0000-0000-0000-000000000304');
select lives_ok($$select public.report_device_sync_status('9c000000-0000-0000-0000-000000000002', 1, null)$$, 'El upsert actualiza la fila propia');
select tests.auth_reset();
select is((select pending_count from public.device_sync_status where device_id = '9c000000-0000-0000-0000-000000000002'), 1,
  'El upsert reemplaza los pendientes');
set local role anon;
select throws_ok($$select public.report_device_sync_status('9c000000-0000-0000-0000-000000000003', 1, null)$$, '42501', null,
  'anon no ejecuta report_device_sync_status');
reset role;
-- Un usuario inactivo no escribe.
update public.profiles set active = false where id = '10000000-0000-0000-0000-000000000307';
select tests.auth_as('10000000-0000-0000-0000-000000000307');
select throws_ok($$select public.report_device_sync_status('9c000000-0000-0000-0000-000000000004', 1, null)$$, '42501', null,
  'Un usuario inactivo no escribe su estado');
select tests.auth_reset();

-- user_last_contact: managers según la matriz.
select tests.auth_as('10000000-0000-0000-0000-000000000302');
select is((public.user_last_contact('10000000-0000-0000-0000-000000000304')->>'pendingCount')::integer, 1, 'El coordinador ve los pendientes del operario');
select is(public.user_last_contact('10000000-0000-0000-0000-000000000304')->>'activeReportId', '8c000000-0000-0000-0000-000000000001',
  'El coordinador ve el reporte activo del operario');
select ok((public.user_last_contact('10000000-0000-0000-0000-000000000304')->>'lastSeenAt') is not null, 'Devuelve lastSeenAt');
select throws_ok($$select public.user_last_contact('10000000-0000-0000-0000-000000000303')$$, '42501', null, 'El coordinador no consulta a un auditor');
select throws_ok($$select public.user_last_contact('10000000-0000-0000-0000-000000000301')$$, '42501', null, 'El coordinador no consulta a un ROOT');
select tests.auth_as('10000000-0000-0000-0000-000000000301');
select lives_ok($$select public.user_last_contact('10000000-0000-0000-0000-000000000303')$$, 'ROOT consulta a un auditor');
select tests.auth_as('10000000-0000-0000-0000-000000000304');
select throws_ok($$select public.user_last_contact('10000000-0000-0000-0000-000000000304')$$, '42501', null, 'Un operario no usa user_last_contact');
select tests.auth_reset();

-- T113: ROOT puede forzar la desactivación pese a pendientes, con motivo; el coordinador no.
update public.device_sync_status set pending_count = 5 where user_id = '10000000-0000-0000-0000-000000000305';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000301',
  '{"active":false}'::jsonb, '[]'::jsonb)$$, 'P0004', 'USER_HAS_PENDING_DATA', 'Sin force_reason, ROOT también recibe P0004');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000302',
  '{"active":false,"force_reason":"Motivo suficientemente largo"}'::jsonb, '[]'::jsonb)$$, '42501', null, 'El coordinador no puede enviar force_reason');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000302',
  '{"active":true,"force_reason":"Motivo suficientemente largo"}'::jsonb, null)$$, '42501', null, 'El coordinador es rechazado aunque no haya bloqueo');
select throws_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000301',
  '{"active":false,"force_reason":"corto"}'::jsonb, '[]'::jsonb)$$, '22023', null, 'Un motivo corto se rechaza');
select lives_ok($$select public.manage_user_assignments('10000000-0000-0000-0000-000000000305', '10000000-0000-0000-0000-000000000301',
  '{"active":false,"force_reason":"Dispositivo perdido, se autoriza"}'::jsonb, '[]'::jsonb)$$, 'ROOT fuerza la desactivación con motivo');
reset role;
select is((select active::text || '/' || possible_unsynced_data::text from public.profiles where id = '10000000-0000-0000-0000-000000000305'),
  'false/true', 'El perfil queda inactivo y marcado con posibles datos sin subir');
select is((select new_value ->> 'reason' || '|' || (new_value ->> 'pendingCount') || '|' || actor_role::text from public.administrative_audit_log
  where action = 'FORCE_DEACTIVATE' and entity_id = '10000000-0000-0000-0000-000000000305'),
  'Dispositivo perdido, se autoriza|5|ROOT', 'FORCE_DEACTIVATE audita motivo, pendientes y rol');
select is((select count(*)::integer from public.profiles where possible_unsynced_data), 1, 'Solo el perfil forzado queda marcado');

select * from finish();
rollback;
