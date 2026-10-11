-- T022: bloqueo de inicio de sesión (5 fallos consecutivos -> 15 min) y resolución de correo (FR-001a).
begin;
select no_plan();

select ok(to_regprocedure('private.check_login_allowed(text)') is not null, 'Existe private.check_login_allowed(text)');
select ok(to_regprocedure('private.register_login_result(text, boolean)') is not null, 'Existe private.register_login_result(text, boolean)');
select ok(to_regprocedure('public.resolve_login_email(text)') is not null, 'Existe public.resolve_login_email(text)');

select is(private.check_login_allowed('nadie_existe'), true, 'Usuario inexistente sin intentos: permitido');

-- 4 fallos no bloquean
select private.register_login_result('nadie_existe', false) from generate_series(1, 4);
select is(private.check_login_allowed('nadie_existe'), true, '4 fallos consecutivos no bloquean (usuario inexistente)');
select is((select failed_count from private.login_attempts where username = 'nadie_existe'), 4, 'El contador acumula 4 fallos');

-- 5.º fallo bloquea 15 min
select private.register_login_result('nadie_existe', false);
select is(private.check_login_allowed('nadie_existe'), false, 'El 5.º fallo consecutivo bloquea');
select ok(
  (select locked_until from private.login_attempts where username = 'nadie_existe')
    between now() + interval '14 minutes 59 seconds' and now() + interval '15 minutes 1 second',
  'El bloqueo dura 15 minutos');

-- normalización: mayúsculas/espacios apuntan a la misma fila
select is(private.check_login_allowed('  NADIE_Existe '), false, 'El nombre de usuario se normaliza (trim + minúsculas)');

-- mientras dura el bloqueo no se extiende
select private.register_login_result('nadie_existe', false);
select ok(
  (select locked_until from private.login_attempts where username = 'nadie_existe') <= now() + interval '15 minutes 1 second',
  'Un fallo durante el bloqueo no lo extiende');

-- bloqueo vencido: permitido y el conteo reinicia
update private.login_attempts set locked_until = now() - interval '1 second' where username = 'nadie_existe';
select is(private.check_login_allowed('nadie_existe'), true, 'Con el bloqueo vencido vuelve a permitirse');
select private.register_login_result('nadie_existe', false);
select is((select failed_count from private.login_attempts where username = 'nadie_existe'), 1, 'Tras vencer el bloqueo el conteo reinicia en 1');
select is(private.check_login_allowed('nadie_existe'), true, 'Un fallo tras vencer el bloqueo no bloquea de nuevo');

-- éxito reinicia el contador
select private.register_login_result('operario_x', false) from generate_series(1, 4);
select private.register_login_result('operario_x', true);
select is((select failed_count from private.login_attempts where username = 'operario_x'), 0, 'Un éxito reinicia el contador');
select private.register_login_result('operario_x', false);
select is(private.check_login_allowed('operario_x'), true, 'Tras un éxito, un fallo aislado no bloquea');

-- resolve_login_email
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-0000000000b1', 'real.person@empresa.com', '{"full_name":"Persona Real","username":"persona.real"}');
update public.profiles set active = true where id = '10000000-0000-0000-0000-0000000000b1';
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-0000000000b2', 'inactivo@empresa.com', '{"full_name":"Persona Inactiva","username":"inactivo"}');
update public.profiles set active = false where id = '10000000-0000-0000-0000-0000000000b2';

select is(public.resolve_login_email('  Persona.Real '), 'real.person@empresa.com', 'Resuelve el correo real del usuario (normalizando)');
select is(public.resolve_login_email('inactivo'), 'inactivo@empresa.com', 'Usuarios inactivos también resuelven su correo');
select is(public.resolve_login_email('No.Existe'), 'no.existe@usuarios.reporte-produccion.invalid', 'Usuario inexistente devuelve un correo falso con la misma forma');

-- permisos: solo service_role
select is(has_function_privilege('anon', 'public.resolve_login_email(text)', 'execute'), false, 'anon no ejecuta resolve_login_email');
select is(has_function_privilege('authenticated', 'public.resolve_login_email(text)', 'execute'), false, 'authenticated no ejecuta resolve_login_email');
select is(has_function_privilege('service_role', 'public.resolve_login_email(text)', 'execute'), true, 'service_role ejecuta resolve_login_email');
select is(has_function_privilege('authenticated', 'private.check_login_allowed(text)', 'execute'), false, 'authenticated no ejecuta check_login_allowed');
select is(has_function_privilege('authenticated', 'private.register_login_result(text, boolean)', 'execute'), false, 'authenticated no ejecuta register_login_result');
select is(has_function_privilege('service_role', 'private.check_login_allowed(text)', 'execute'), true, 'service_role ejecuta check_login_allowed');
select is(has_function_privilege('service_role', 'private.register_login_result(text, boolean)', 'execute'), true, 'service_role ejecuta register_login_result');
select is(has_function_privilege('anon', 'public.login_check_allowed(text)', 'execute'), false, 'anon no ejecuta el envoltorio login_check_allowed');
select is(has_function_privilege('authenticated', 'public.login_register_result(text, boolean)', 'execute'), false, 'authenticated no ejecuta el envoltorio login_register_result');
select is(has_function_privilege('service_role', 'public.login_check_allowed(text)', 'execute'), true, 'service_role ejecuta login_check_allowed');
select is(has_function_privilege('service_role', 'public.login_register_result(text, boolean)', 'execute'), true, 'service_role ejecuta login_register_result');

select * from finish();
rollback;
