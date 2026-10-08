begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

-- All fixtures and reads in this test roll back together.
insert into public.production_reports(id, machine_id, created_by, updated_by)
values ('82000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');
insert into public.notification_events(event_key, type, resource_type, resource_id, title, body, href)
values ('test:notification:report', 'REPORT_SUBMITTED', 'report',
  '82000000-0000-0000-0000-000000000001', 'Reporte', 'Prueba', '/reportes/82000000-0000-0000-0000-000000000001');
insert into public.notification_deliveries(event_id, recipient_id)
select id, '10000000-0000-0000-0000-000000000001' from public.notification_events where event_key = 'test:notification:report';
select set_config('test.delivery_id', (select id::text from public.notification_deliveries
  where recipient_id = '10000000-0000-0000-0000-000000000001' and event_id =
    (select id from public.notification_events where event_key = 'test:notification:report')), true);

select ok((select count(*) = 1 from public.notification_deliveries d
  join public.notification_events e on e.id = d.event_id where e.event_key = 'test:notification:report'),
  'El evento tiene una sola entrega');
select ok(not has_table_privilege('authenticated', 'public.notification_events', 'INSERT'), 'El navegador no crea eventos');
select ok(not has_table_privilege('authenticated', 'public.notification_deliveries', 'SELECT'),
  'La lectura directa de entregas permanece cerrada; sólo RPC autoriza');
select ok(not has_table_privilege('authenticated', 'public.notification_deliveries', 'UPDATE'), 'El navegador no modifica destinatarios ni lectura directamente');
select ok(not has_function_privilege('authenticated', 'public.replace_operator_assignments(uuid,uuid[],uuid,jsonb)', 'EXECUTE'),
  'Solo el servidor ejecuta el reemplazo transaccional');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((public.list_notifications()->>'unreadCount')::integer, 0, 'Otro usuario no ve entregas del administrador');
select is(public.mark_notification_read(current_setting('test.delivery_id')::uuid), false,
  'No puede marcar como leída una entrega ajena');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok((public.list_notifications()->>'unreadCount')::integer >= 1, 'El destinatario ve el contador');
select ok(public.mark_notification_read(current_setting('test.delivery_id')::uuid),
  'El destinatario puede marcar su aviso');
select is(public.mark_all_notifications_read(clock_timestamp()), 0, 'Marcar todo es idempotente tras lectura individual');

reset role;
-- Assignment notice compares effective before/after sets, not intermediate toggles.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok((public.replace_operator_assignments(
  '10000000-0000-0000-0000-000000000002',
  array(select machine_id from public.operator_machine_assignments
    where operator_id = '10000000-0000-0000-0000-000000000002' and active order by machine_id),
  '10000000-0000-0000-0000-000000000001', null)->'added') = '[]'::jsonb,
  'La sustitución idéntica no añade asignaciones');
select is((select count(*)::integer from public.notification_events where event_key like 'assignment:%'), 0,
  'La sustitución idéntica no crea avisos');
select ok(jsonb_array_length(public.replace_operator_assignments(
  '10000000-0000-0000-0000-000000000002',
  array(select machine_id from public.operator_machine_assignments
    where operator_id = '10000000-0000-0000-0000-000000000002' and active
      and machine_id <> '30000000-0000-0000-0000-000000000001' order by machine_id),
  '10000000-0000-0000-0000-000000000001', null)->'removed') = 1,
  'La sustitución detecta una baja neta');
select is((select count(*)::integer from public.notification_events where event_key like 'assignment:%'), 1,
  'Una baja neta crea un solo aviso');
select is((select href from public.notification_events where event_key like 'assignment:%' limit 1), '/reportes',
  'La baja no enlaza a una máquina revocada');
select throws_ok(
  $$select public.replace_operator_assignments(
    '10000000-0000-0000-0000-000000000002',
    array['00000000-0000-0000-0000-000000000099']::uuid[],
    '10000000-0000-0000-0000-000000000001', null)$$,
  'P0001', 'Only active machines may be assigned',
  'Máquina inexistente revierte la operación');
select is((select count(*)::integer from public.notification_events where event_key like 'assignment:%'), 1,
  'Fallo de asignación no agrega aviso');

reset role;
select set_config('test.original_name', (select full_name from public.profiles
  where id = '10000000-0000-0000-0000-000000000002'), true);
create function private.test_reject_notification() returns trigger language plpgsql as $$
begin
  if new.type = 'ASSIGNMENTS_CHANGED' then raise exception 'Injected notification failure'; end if;
  return new;
end;
$$;
create trigger test_reject_notification before insert on public.notification_events
for each row execute function private.test_reject_notification();
set local role service_role;
select throws_ok(
  $$select public.replace_operator_assignments(
    '10000000-0000-0000-0000-000000000002',
    array(select machine_id from public.operator_machine_assignments
      where operator_id = '10000000-0000-0000-0000-000000000002' and active)
      || array['30000000-0000-0000-0000-000000000001']::uuid[],
    '10000000-0000-0000-0000-000000000001',
    '{"full_name":"Rollback probe"}'::jsonb)$$,
  'P0001', 'Injected notification failure',
  'Fallo al emitir aviso revierte escrituras previas del RPC');
select is((select full_name from public.profiles where id = '10000000-0000-0000-0000-000000000002'),
  current_setting('test.original_name'), 'Perfil recupera su valor tras fallo del aviso');
select ok((select not active from public.operator_machine_assignments
  where operator_id = '10000000-0000-0000-0000-000000000002'
    and machine_id = '30000000-0000-0000-0000-000000000001'),
  'Asignación recupera su valor tras fallo del aviso');

select * from finish();
rollback;
