-- Phase 8 (correcciones NO-GO, FR-006c): public.record_offline_login audita los inicios de sesión sin conexión de TODOS
-- los roles; idempotente por operation_id, con límite de ritmo y sin horas futuras.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000901', 'ol-op1@usuarios.reporte-produccion.invalid', '{"full_name":"OL Operario 1"}'),
  ('10000000-0000-0000-0000-000000000902', 'ol-op2@usuarios.reporte-produccion.invalid', '{"full_name":"OL Operario 2"}'),
  ('10000000-0000-0000-0000-000000000903', 'ol-coord@usuarios.reporte-produccion.invalid', '{"full_name":"OL Coordinador"}'),
  ('10000000-0000-0000-0000-000000000904', 'ol-inactivo@usuarios.reporte-produccion.invalid', '{"full_name":"OL Inactivo"}'),
  ('10000000-0000-0000-0000-000000000905', 'ol-viewer@usuarios.reporte-produccion.invalid', '{"full_name":"OL Auditor"}');
update public.profiles set role = 'OPERATOR', active = true where id in
  ('10000000-0000-0000-0000-000000000901', '10000000-0000-0000-0000-000000000902', '10000000-0000-0000-0000-000000000904');
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000903';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000905';

create function tests.ol_id(n int) returns uuid language sql as $$ select format('f3000000-0000-0000-0000-%s', lpad(n::text, 12, '0'))::uuid $$;
grant execute on function tests.ol_id(int) to public;

-- OPERATOR
select tests.auth_as('10000000-0000-0000-0000-000000000901');
select is((select public.record_offline_login(tests.ol_id(1), timestamptz '2026-10-01 10:00:00+00')) ->> 'status', 'applied', 'OPERATOR: applied');
select is((select count(*) from public.administrative_audit_log where action = 'OFFLINE_LOGIN'), 0::bigint,
  'El operario no lee administrative_audit_log (RLS: solo ROOT)');
-- ADMINISTRATOR y VIEWER (todos los roles)
select tests.auth_as('10000000-0000-0000-0000-000000000903');
select is((select public.record_offline_login(tests.ol_id(2), now() - interval '2 hours')) ->> 'status', 'applied', 'ADMINISTRATOR: applied');
select tests.auth_as('10000000-0000-0000-0000-000000000905');
select is((select public.record_offline_login(tests.ol_id(3), now() - interval '2 hours')) ->> 'status', 'applied', 'VIEWER: applied');

select tests.auth_reset();
select is((select count(*) from public.administrative_audit_log where action = 'OFFLINE_LOGIN'), 3::bigint, 'Tres filas OFFLINE_LOGIN');
select is((select string_agg(actor_role::text, ',' order by actor_role::text) from public.administrative_audit_log where action = 'OFFLINE_LOGIN'),
  'ADMINISTRATOR,OPERATOR,VIEWER', 'actor_role de cada rol');
select is((select performed_by from public.administrative_audit_log where action = 'OFFLINE_LOGIN' and details ->> 'operation_id' = tests.ol_id(1)::text),
  '10000000-0000-0000-0000-000000000901'::uuid, 'El actor es auth.uid()');
select ok((select (details ->> 'device_started_at') is not null and (details ->> 'username') is not null and (details ->> 'received_at') is not null
  from public.administrative_audit_log where details ->> 'operation_id' = tests.ol_id(1)::text), 'details: hora del dispositivo, usuario y recepción');

-- Idempotencia por operation_id: sin segunda fila
select tests.auth_as('10000000-0000-0000-0000-000000000901');
select is((select public.record_offline_login(tests.ol_id(1), timestamptz '2026-10-01 10:00:00+00')) ->> 'status', 'duplicate', 'Mismo operation_id: duplicate');
select tests.auth_reset();
select is((select count(*) from public.administrative_audit_log where action = 'OFFLINE_LOGIN' and performed_by = '10000000-0000-0000-0000-000000000901'),
  1::bigint, 'El reenvío no duplica la fila');

-- Ajeno: otro usuario con el operation_id de 901 -> FORBIDDEN, nunca duplicate
select tests.auth_as('10000000-0000-0000-0000-000000000902');
select is((select public.record_offline_login(tests.ol_id(1), now() - interval '1 hour')) ->> 'code', 'FORBIDDEN', 'operation_id ajeno: FORBIDDEN');

-- Mismo startedAt con otro operation_id (anti-inundación): duplicate
select tests.auth_as('10000000-0000-0000-0000-000000000901');
select is((select public.record_offline_login(tests.ol_id(4), timestamptz '2026-10-01 10:00:00+00')) ->> 'status', 'duplicate',
  'Mismo usuario y mismo startedAt con otra operación: duplicate');
-- La función no lee la tabla como el usuario; se comprueba con el rol original
select tests.auth_reset();
select is((select count(*) from public.administrative_audit_log where action = 'OFFLINE_LOGIN' and performed_by = '10000000-0000-0000-0000-000000000901'),
  1::bigint, 'Sin fila nueva por el mismo startedAt');

-- Límite de ritmo: 20 por usuario y hora (distintos startedAt)
select tests.auth_as('10000000-0000-0000-0000-000000000902');
select lives_ok(format($f$select public.record_offline_login(tests.ol_id(%s), now() - (%s || ' minutes')::interval)$f$, 100 + n, n + 1), 'login ' || n)
  from generate_series(1, 20) n;
select is((select public.record_offline_login(tests.ol_id(200), now() - interval '90 seconds')) ->> 'code', 'RATE_LIMITED', 'El 21.º en una hora: RATE_LIMITED');
select tests.auth_reset();
select is((select count(*) from public.administrative_audit_log where action = 'OFFLINE_LOGIN' and performed_by = '10000000-0000-0000-0000-000000000902'),
  20::bigint, 'Se registraron exactamente 20');

-- Validación de la hora, inactivo y sin sesión
select tests.auth_as('10000000-0000-0000-0000-000000000901');
select is((select public.record_offline_login(tests.ol_id(5), now() + interval '2 hours')) ->> 'code', 'VALIDATION', 'Hora futura (> 5 min): rechazada');
select is((select public.record_offline_login(tests.ol_id(6), now() + interval '2 minutes')) ->> 'status', 'applied', 'Hasta 5 min de tolerancia: applied');
select tests.auth_reset();
update public.profiles set active = false where id = '10000000-0000-0000-0000-000000000904';
select tests.auth_as('10000000-0000-0000-0000-000000000904');
select is((select public.record_offline_login(tests.ol_id(7), now() - interval '1 hour')) ->> 'code', 'FORBIDDEN', 'Usuario inactivo: FORBIDDEN');
select tests.auth_reset();
select is((select public.record_offline_login(tests.ol_id(8), now() - interval '1 hour')) ->> 'code', 'FORBIDDEN', 'Sin sesión (auth.uid() nulo): FORBIDDEN');
select is((select count(*) from public.administrative_audit_log where action = 'OFFLINE_LOGIN' and performed_by = '10000000-0000-0000-0000-000000000904'),
  0::bigint, 'Los rechazos no dejan rastro');
select is(has_function_privilege('anon', 'public.record_offline_login(uuid, timestamptz)', 'execute'), false, 'anon no puede ejecutarla');

select * from finish();
rollback;
