-- T096 (F5): publicación `supabase_realtime` y autorización del canal privado `plant-presence`
-- (contracts/realtime.md): track solo OPERATOR; escuchar solo managers y VIEWER; ningún otro tema/extensión.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000901', 'rt-root@usuarios.reporte-produccion.invalid', '{"full_name":"RT Root","username":"rt-root"}'),
  ('10000000-0000-0000-0000-000000000902', 'rt-adm@usuarios.reporte-produccion.invalid', '{"full_name":"RT Coordinador","username":"rt-adm"}'),
  ('10000000-0000-0000-0000-000000000903', 'rt-aud@usuarios.reporte-produccion.invalid', '{"full_name":"RT Auditor","username":"rt-aud"}'),
  ('10000000-0000-0000-0000-000000000904', 'rt-op@usuarios.reporte-produccion.invalid', '{"full_name":"RT Operario","username":"rt-op"}'),
  ('10000000-0000-0000-0000-000000000905', 'rt-op2@usuarios.reporte-produccion.invalid', '{"full_name":"RT Operario Inactivo","username":"rt-op2"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000901';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000902';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000903';
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000904';
update public.profiles set role = 'OPERATOR', active = false where id = '10000000-0000-0000-0000-000000000905';

-- ---------------------------------------------------------------- Publicación
select is(
  (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
    and tablename in ('production_reports', 'report_stop_events', 'report_change_events', 'report_audit_log', 'sync_quarantine')),
  5, 'las 5 tablas de reportes están en supabase_realtime');
select is(
  (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
    and tablename not in ('production_reports', 'report_stop_events', 'report_change_events', 'report_audit_log', 'sync_quarantine')),
  0, 'ninguna otra tabla de public se publica (profiles, login_attempts, etc. no salen por Realtime)');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('production_reports', 'report_stop_events', 'report_change_events', 'report_audit_log', 'sync_quarantine')
      and c.relrowsecurity),
  5, 'las 5 tablas publicadas tienen RLS activa (postgres_changes respeta la RLS)');

-- ---------------------------------------------------------------- Políticas de realtime.messages
select is(
  (select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'
    and policyname in ('plant_presence_operator_track', 'plant_presence_reader_select')),
  2, 'existen las dos políticas del canal plant-presence');
select is(
  (select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and 'anon' = any (roles)),
  0, 'anon no tiene políticas sobre realtime.messages');

-- Filas de presencia existentes, escritas por el propietario (las pruebas siguientes solo las leen).
insert into realtime.messages (topic, extension, private, payload, event)
values ('plant-presence', 'presence', true, '{}'::jsonb, 'presence'),
       ('plant-presence', 'broadcast', true, '{}'::jsonb, 'x'),
       ('otro-canal', 'presence', true, '{}'::jsonb, 'presence');

create temp table rt_result (who text, op text, ok boolean);
grant all on rt_result to authenticated;

create or replace function pg_temp.try_track(p_who text, p_topic text, p_ext text) returns void language plpgsql as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  begin
    insert into realtime.messages (topic, extension, private, payload, event) values (p_topic, p_ext, true, '{}'::jsonb, 'presence');
    insert into rt_result values (p_who, 'track:' || p_topic || ':' || p_ext, true);
  exception when insufficient_privilege then
    insert into rt_result values (p_who, 'track:' || p_topic || ':' || p_ext, false);
  end;
end;
$$;
grant execute on function pg_temp.try_track(text, text, text) to authenticated;

create or replace function pg_temp.visible(p_topic text) returns integer language plpgsql as $$
declare v integer;
begin
  perform set_config('realtime.topic', p_topic, true);
  select count(*)::int into v from realtime.messages where topic = p_topic and extension = 'presence';
  return v;
end;
$$;
grant execute on function pg_temp.visible(text) to authenticated;

-- track: solo OPERATOR activo, en plant-presence y extension presence
select tests.auth_as('10000000-0000-0000-0000-000000000904');
select pg_temp.try_track('operator', 'plant-presence', 'presence');
select pg_temp.try_track('operator', 'plant-presence', 'broadcast');
select pg_temp.try_track('operator', 'otro-canal', 'presence');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000902');
select pg_temp.try_track('administrator', 'plant-presence', 'presence');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000901');
select pg_temp.try_track('root', 'plant-presence', 'presence');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000903');
select pg_temp.try_track('viewer', 'plant-presence', 'presence');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000905');
select pg_temp.try_track('operator inactivo', 'plant-presence', 'presence');
select tests.auth_reset();

select is((select ok from rt_result where who = 'operator' and op = 'track:plant-presence:presence'), true, 'OPERATOR activo puede hacer track en plant-presence');
select is((select ok from rt_result where who = 'operator' and op = 'track:plant-presence:broadcast'), false, 'OPERATOR no puede enviar broadcast en plant-presence');
select is((select ok from rt_result where who = 'operator' and op = 'track:otro-canal:presence'), false, 'OPERATOR no puede hacer track en otro canal');
select is((select ok from rt_result where who = 'administrator'), false, 'ADMINISTRATOR no puede hacer track (solo escucha)');
select is((select ok from rt_result where who = 'root'), false, 'ROOT no puede hacer track (solo escucha)');
select is((select ok from rt_result where who = 'viewer'), false, 'VIEWER no puede hacer track (solo lectura)');
select is((select ok from rt_result where who = 'operator inactivo'), false, 'un OPERATOR inactivo no puede hacer track');

-- lectura: managers, VIEWER y OPERATOR activos en plant-presence (el operario la necesita para unirse); nadie en otros temas; inactivos no
select tests.auth_as('10000000-0000-0000-0000-000000000902');
select cmp_ok(pg_temp.visible('plant-presence'), '>=', 1, 'ADMINISTRATOR lee la presencia de plant-presence');
select is(pg_temp.visible('otro-canal'), 0, 'ADMINISTRATOR no lee otros temas');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000901');
select cmp_ok(pg_temp.visible('plant-presence'), '>=', 1, 'ROOT lee la presencia de plant-presence');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000903');
select cmp_ok(pg_temp.visible('plant-presence'), '>=', 1, 'VIEWER lee la presencia de plant-presence');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000904');
select cmp_ok(pg_temp.visible('plant-presence'), '>=', 1, 'OPERATOR activo puede leer plant-presence (Realtime exige lectura para unirse y hacer track)');
select is(pg_temp.visible('otro-canal'), 0, 'OPERATOR no lee ningún otro tema');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000905');
select is(pg_temp.visible('plant-presence'), 0, 'un usuario inactivo no lee la presencia');
select tests.auth_reset();

-- ---------------------------------------------------------------- postgres_changes: lo que cada rol puede recibir lo fija la RLS
insert into public.machines (id, code, name) values ('3f000000-0000-0000-0000-000000000901', 'RT-1', 'RT 1');
set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role, started_at)
values ('8f000000-0000-0000-0000-000000000901', 'RPT-2034-900001', '3f000000-0000-0000-0000-000000000901', 'DRAFT',
  '10000000-0000-0000-0000-000000000902', '10000000-0000-0000-0000-000000000902', 'RT Coordinador', 'ADMINISTRATOR', now());
insert into public.report_audit_log (report_id, changed_by, field_name, old_value, new_value, entity_type, entity_id, action)
values ('8f000000-0000-0000-0000-000000000901', '10000000-0000-0000-0000-000000000902', 'status', null, '"DRAFT"'::jsonb, 'report', '8f000000-0000-0000-0000-000000000901', 'INSERT');
set local session_replication_role = origin;

select tests.auth_as('10000000-0000-0000-0000-000000000904');
select is((select count(*)::int from public.production_reports where id = '8f000000-0000-0000-0000-000000000901'), 0,
  'OPERATOR no recibe (RLS) reportes de otros por postgres_changes');
select is((select count(*)::int from public.report_audit_log), 0, 'OPERATOR no recibe filas de report_audit_log');
select is((select count(*)::int from public.sync_quarantine), 0, 'OPERATOR no recibe filas ajenas de sync_quarantine');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000903');
select is((select count(*)::int from public.production_reports where id = '8f000000-0000-0000-0000-000000000901'), 1, 'VIEWER recibe reportes de todos los estados');
select cmp_ok((select count(*)::int from public.report_audit_log where report_id = '8f000000-0000-0000-0000-000000000901'), '>=', 1, 'VIEWER recibe la auditoría');
select tests.auth_reset();
select tests.auth_as('10000000-0000-0000-0000-000000000902');
select is((select count(*)::int from public.production_reports where id = '8f000000-0000-0000-0000-000000000901'), 1, 'manager recibe los reportes');
select tests.auth_reset();

select * from finish();
rollback;
