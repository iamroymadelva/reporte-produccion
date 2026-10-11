-- T004: rol ROOT e invariante "siempre existe al menos un ROOT activo" (FR-005).
begin;
select no_plan();

select ok(
  'ROOT' = any (enum_range(null::public.app_role)::text[]),
  'El enum app_role incluye ROOT'
);
select ok(
  to_regprocedure('private.is_root()') is not null and to_regprocedure('private.is_manager()') is not null,
  'Existen los helpers private.is_root() y private.is_manager()'
);
select is(
  (select condeferrable and condeferred from pg_constraint
   where conname = 'profiles_ensure_active_root' and conrelid = 'public.profiles'::regclass),
  true,
  'El trigger ensure_active_root es una restricción DEFERRABLE INITIALLY DEFERRED'
);

-- Estado controlado: exactamente un ROOT activo (se conserva uno y se degradan los demás).
create temporary table only_root as
  select id from public.profiles where role::text = 'ROOT' and active order by id limit 1;
update public.profiles set role = 'ADMINISTRATOR'
where role::text = 'ROOT' and id <> (select id from only_root);
select is((select count(*)::integer from public.profiles where role::text = 'ROOT' and active), 1,
  'Fixture: hay un único ROOT activo');

select lives_ok(
  $$update public.profiles set active = false where id = (select id from only_root)$$,
  'Desactivar al último ROOT no falla mientras la restricción está diferida'
);
select throws_ok(
  $$set constraints all immediate$$,
  '23514', null,
  'Al hacer commit (restricción inmediata) falla si no queda ningún ROOT activo'
);
update public.profiles set active = true where id = (select id from only_root);

select lives_ok(
  $$update public.profiles set role = 'ADMINISTRATOR' where id = (select id from only_root)$$,
  'Degradar al último ROOT no falla mientras la restricción está diferida'
);
select throws_ok(
  $$set constraints all immediate$$,
  '23514', null,
  'Degradar al último ROOT activo falla al hacer commit'
);
update public.profiles set role = 'ROOT' where id = (select id from only_root);

-- Con dos ROOT activos se puede desactivar uno.
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000201', 'root-extra@usuarios.reporte-produccion.invalid', '{"full_name":"Segundo ROOT"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000201';

select is((select count(*)::integer from public.profiles where role::text = 'ROOT' and active), 2,
  'Fixture: hay dos ROOT activos');
select lives_ok(
  $$update public.profiles set active = false where id = (select id from only_root)$$,
  'Con dos ROOT activos se puede desactivar uno'
);
select lives_ok($$set constraints all immediate$$, 'La invariante se cumple tras desactivar uno de dos ROOT');

select * from finish();
rollback;
