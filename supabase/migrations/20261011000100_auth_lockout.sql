-- Fase F2 / T025: bloqueo de inicio de sesión (5 fallos -> 15 min) y resolución de correo por usuario.
-- Todas las funciones son security definer y solo las ejecuta service_role (servidor).

create function private.check_login_allowed(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from private.login_attempts
    where username = lower(btrim(p_username))
      and locked_until is not null
      and locked_until > now()
  );
$$;

create function private.register_login_result(p_username text, p_success boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(btrim(p_username));
  v_row private.login_attempts%rowtype;
begin
  if p_success then
    insert into private.login_attempts (username, failed_count, locked_until, updated_at)
    values (v_username, 0, null, now())
    on conflict (username) do update
      set failed_count = 0, locked_until = null, updated_at = now();
    return;
  end if;

  insert into private.login_attempts (username) values (v_username) on conflict (username) do nothing;
  select * into v_row from private.login_attempts where username = v_username for update;

  -- Mientras dura el bloqueo no se cuentan más fallos (no se extiende).
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return;
  end if;

  -- Bloqueo vencido: el conteo reinicia.
  if v_row.locked_until is not null then
    v_row.failed_count := 0;
  end if;

  v_row.failed_count := v_row.failed_count + 1;
  update private.login_attempts
  set failed_count = v_row.failed_count,
      locked_until = case when v_row.failed_count >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
  where username = v_username;
end;
$$;

create function public.resolve_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.email::text
       from public.profiles p
       join auth.users u on u.id = p.id
      where p.username = lower(btrim(p_username))
        and u.email is not null),
    lower(btrim(p_username)) || '@usuarios.reporte-produccion.invalid'
  );
$$;

-- Envoltorios públicos para PostgREST (el esquema private no se expone).
create function public.login_check_allowed(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.check_login_allowed(p_username); $$;

create function public.login_register_result(p_username text, p_success boolean)
returns void
language sql
security definer
set search_path = ''
as $$ select private.register_login_result(p_username, p_success); $$;

revoke all on function private.check_login_allowed(text) from public, anon, authenticated;
revoke all on function private.register_login_result(text, boolean) from public, anon, authenticated;
revoke all on function public.resolve_login_email(text) from public, anon, authenticated;
revoke all on function public.login_check_allowed(text) from public, anon, authenticated;
revoke all on function public.login_register_result(text, boolean) from public, anon, authenticated;

grant usage on schema private to service_role;
grant execute on function private.check_login_allowed(text) to service_role;
grant execute on function private.register_login_result(text, boolean) to service_role;
grant execute on function public.resolve_login_email(text) to service_role;
grant execute on function public.login_check_allowed(text) to service_role;
grant execute on function public.login_register_result(text, boolean) to service_role;
