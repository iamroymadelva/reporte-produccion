-- Bootstrap del primer administrador raíz (ROOT) en producción. Feature 001, T041.
--
-- Promueve a ROOT activo a un usuario YA EXISTENTE (identificado por nombre de usuario o correo).
-- Es idempotente: se puede ejecutar varias veces con el mismo valor y deja el mismo estado.
-- NO lo ejecutan ni las migraciones ni el seed: se corre una sola vez, a mano, tras desplegar las migraciones.
--
-- Uso (la conexión a producción NUNCA se guarda en el repositorio):
--   psql "$DATABASE_URL" -v identifier='mi.usuario' -f supabase/bootstrap-root.sql
--   psql "$DATABASE_URL" -v identifier='persona@empresa.com' -f supabase/bootstrap-root.sql
--
-- Falla (sin cambios) si el valor no existe o coincide con más de un usuario.

\set ON_ERROR_STOP on

\if :{?identifier}
\else
  \echo 'Falta la variable identifier. Uso: psql "$DATABASE_URL" -v identifier=''usuario_o_correo'' -f supabase/bootstrap-root.sql'
  \quit
\endif

begin;

select set_config('bootstrap.identifier', lower(btrim(:'identifier')), true);

do $$
declare
  v_identifier text := current_setting('bootstrap.identifier');
  v_matches integer;
  v_id uuid;
  v_label text;
begin
  select count(*) into v_matches
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.username = v_identifier or lower(u.email) = v_identifier;

  if v_matches <> 1 then
    raise exception 'bootstrap-root: el identificador "%" debe coincidir con exactamente un usuario existente (coincidencias: %).',
      v_identifier, v_matches;
  end if;

  select p.id, p.full_name into v_id, v_label
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.username = v_identifier or lower(u.email) = v_identifier;

  update public.profiles
  set role = 'ROOT', active = true, removed_at = null, removed_by = null
  where id = v_id;

  -- Si la cuenta estuvo retirada, restaura también el acceso de autenticación.
  update auth.users set banned_until = null where id = v_id;

  insert into public.administrative_audit_log (action, entity_type, entity_id, entity_label, details)
  values ('BOOTSTRAP_ROOT', 'profiles', v_id::text, v_label, jsonb_build_object('identifier', v_identifier));

  raise notice 'bootstrap-root: % (%) es ahora ROOT activo.', v_label, v_id;
end;
$$;

commit;

-- Verificación: debe listar al menos un ROOT activo.
select p.username, p.full_name, p.role, p.active
from public.profiles p
where p.role = 'ROOT' and p.active
order by p.username;
