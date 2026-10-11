-- Helper pgTAP: simula sesiones de usuario en las pruebas de base de datos.
--
-- NOTA: `supabase test db` ejecuta TODO .sql bajo supabase/tests (incluso subcarpetas), por eso
-- este archivo es a la vez helper y prueba autocontenida (begin/no_plan/finish/rollback) cuando se
-- ejecuta solo. Para reutilizarlo dentro de otra prueba (ya dentro de su propia transaccion y plan):
--
--   begin;
--   select no_plan();
--   \set skip_selftest 1
--   \ir helpers/auth_as.sql          -- ruta relativa al archivo de la prueba; si no resuelve, usar \i con la ruta absoluta
--   -- ... crear usuarios/perfiles de prueba ...
--   select tests.auth_as('10000000-0000-0000-0000-000000000105');   -- como un usuario concreto
--   select tests.auth_as_role('OPERATOR');                          -- como el primer perfil activo con ese rol
--   select tests.auth_reset();                                      -- vuelve al rol original
--
-- Roles soportados por auth_as_role: ROOT, ADMINISTRATOR, VIEWER, OPERATOR (comparacion por texto,
-- de modo que funciona aunque el enum app_role aun no incluya ROOT).
-- Las funciones viven en el esquema `tests`, dentro de la transaccion de la prueba (se descartan con rollback).

\if :{?skip_selftest}
\else
begin;
select no_plan();
\endif

create schema if not exists tests;
grant usage on schema tests to public;

create or replace function tests.auth_as(p_user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

create or replace function tests.auth_as_role(p_role text) returns uuid
language plpgsql as $$
declare
  v_user_id uuid;
begin
  -- Se resuelve con el rol original (antes de pasar a `authenticated`) para esquivar RLS.
  reset role;
  select id into v_user_id from public.profiles
  where role::text = upper(p_role) and active
  order by id limit 1;
  if v_user_id is null then
    raise exception 'tests.auth_as_role: no hay un perfil activo con rol %', p_role;
  end if;
  perform tests.auth_as(v_user_id);
  return v_user_id;
end;
$$;

create or replace function tests.auth_reset() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant execute on function tests.auth_as(uuid), tests.auth_as_role(text), tests.auth_reset() to public;

\if :{?skip_selftest}
\else
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-0000000000a1', 'helper-self@local.test', '{"full_name":"Helper self-test"}');
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-0000000000a1';

select tests.auth_as('10000000-0000-0000-0000-0000000000a1');
select is(current_user::text, 'authenticated', 'auth_as cambia al rol authenticated');
select is(auth.uid(), '10000000-0000-0000-0000-0000000000a1'::uuid, 'auth_as fija auth.uid()');
select is(auth.role(), 'authenticated', 'auth_as fija el rol del JWT');

select tests.auth_reset();
select isnt(current_user::text, 'authenticated', 'auth_reset restaura el rol original');
select is(auth.uid(), null, 'auth_reset limpia los claims');

select is(tests.auth_as_role('operator'), (select id from public.profiles where role::text = 'OPERATOR' and active order by id limit 1),
  'auth_as_role suplanta a un perfil activo del rol');
select is(auth.role(), 'authenticated', 'auth_as_role deja la sesion autenticada');
select tests.auth_reset();
select throws_ok($$select tests.auth_as_role('NO_EXISTE')$$, 'P0001', null, 'auth_as_role falla si no hay perfil con el rol');

select * from finish();
rollback;
\endif
