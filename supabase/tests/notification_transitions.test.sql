begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

insert into public.machines(id, code, name)
values ('39000000-0000-0000-0000-000000000091', 'N-TEST', 'Máquina aviso');
insert into public.operator_machine_assignments(operator_id, machine_id, created_by)
values ('10000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000091',
  '10000000-0000-0000-0000-000000000001');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.production_reports(id, machine_id, created_by, updated_by)
values ('89000000-0000-0000-0000-000000000091', '39000000-0000-0000-0000-000000000091',
  '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');
select is((select count(*)::integer from public.notification_events where resource_id =
  '89000000-0000-0000-0000-000000000091'), 0, 'Crear borrador no avisa');

insert into public.report_stop_events(id, report_id, stop_category_id, responsible_user_id)
select '99000000-0000-0000-0000-000000000091', '89000000-0000-0000-0000-000000000091', id,
  '10000000-0000-0000-0000-000000000002' from public.stop_categories where code = '1';
select is((select count(*)::integer from public.notification_events where event_key =
  'stop:99000000-0000-0000-0000-000000000091'), 1, 'Inicio crea un solo evento');
select is((select count(*)::integer from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
  where e.event_key = 'stop:99000000-0000-0000-0000-000000000091'),
  (select count(*)::integer from public.profiles where role = 'ADMINISTRATOR' and active and removed_at is null),
  'Inicio se entrega a administradores activos');

update public.notification_deliveries set read_at = '2026-01-01T00:00:00Z'
where event_id = (select id from public.notification_events where event_key =
  'stop:99000000-0000-0000-0000-000000000091');
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
update public.report_stop_events set ended_at = now()
where id = '99000000-0000-0000-0000-000000000091';
select is((select stop_status from public.notification_events where event_key =
  'stop:99000000-0000-0000-0000-000000000091'), 'CLOSED', 'Cierre actualiza estado del aviso original');
select ok((select bool_and(read_at = '2026-01-01T00:00:00Z'::timestamptz)
  from public.notification_deliveries where event_id = (select id from public.notification_events where event_key =
  'stop:99000000-0000-0000-0000-000000000091')), 'Cierre conserva lectura de todos');
select is((select count(*)::integer from public.notification_events where resource_type = 'stop' and resource_id =
  '99000000-0000-0000-0000-000000000091'), 1, 'Cierre no crea otro aviso');

insert into public.report_stop_events(id, report_id, stop_category_id, responsible_user_id)
select '99000000-0000-0000-0000-000000000092', '89000000-0000-0000-0000-000000000091', id,
  '10000000-0000-0000-0000-000000000002' from public.stop_categories where code = '1';
update public.notification_deliveries set read_at = '2026-01-01T00:00:00Z'
where event_id = (select id from public.notification_events where event_key =
  'stop:99000000-0000-0000-0000-000000000092');
update public.report_stop_events set cancellation_reason = 'Parada inválida'
where id = '99000000-0000-0000-0000-000000000092';
select is((select stop_status from public.notification_events where event_key =
  'stop:99000000-0000-0000-0000-000000000092'), 'CANCELLED', 'Anulación actualiza aviso de parada');
select ok((select bool_and(read_at = '2026-01-01T00:00:00Z'::timestamptz)
  from public.notification_deliveries where event_id = (select id from public.notification_events where event_key =
  'stop:99000000-0000-0000-0000-000000000092')), 'Anulación conserva lectura');

update public.production_reports set status = 'CANCELLED', cancellation_reason = 'Prueba de avisos'
where id = '89000000-0000-0000-0000-000000000091';
select is((select count(*)::integer from public.notification_events where type = 'REPORT_CANCELLED' and resource_id =
  '89000000-0000-0000-0000-000000000091'), 1, 'Cancelar reporte crea un solo aviso');
select is((select count(*)::integer from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
  where e.type = 'REPORT_CANCELLED' and e.resource_id = '89000000-0000-0000-0000-000000000091'),
  (select count(*)::integer from public.profiles where role = 'ADMINISTRATOR' and active and removed_at is null),
  'Cancelación llega a administradores');
select is((select actor_id from public.notification_events where type = 'REPORT_CANCELLED' and resource_id =
  '89000000-0000-0000-0000-000000000091'), '10000000-0000-0000-0000-000000000002'::uuid,
  'El aviso conserva el actor de la transición');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.production_reports set observations = 'Primera corrección'
where id = '89000000-0000-0000-0000-000000000091';
update public.production_reports set observations = 'Segunda corrección'
where id = '89000000-0000-0000-0000-000000000091';
select is((select count(*)::integer from public.notification_events where type = 'REPORT_CORRECTED' and resource_id =
  '89000000-0000-0000-0000-000000000091'), 1, 'Correcciones del reporte en una transacción se agrupan');
select is((select count(*)::integer from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
  where e.type = 'REPORT_CORRECTED' and e.resource_id = '89000000-0000-0000-0000-000000000091'
    and d.recipient_id = '10000000-0000-0000-0000-000000000002'), 1, 'Autor recibe una corrección');
update public.report_stop_events set stop_category_id = (select id from public.stop_categories where code = '2')
where id = '99000000-0000-0000-0000-000000000091';
select is((select count(*)::integer from public.notification_events where type = 'REPORT_CORRECTED' and resource_id =
  '89000000-0000-0000-0000-000000000091'), 1, 'Cambio simple de categoría no avisa');

insert into public.machines(id, code, name)
values ('39000000-0000-0000-0000-000000000092', 'N-SUB', 'Máquina envío');
insert into public.operator_machine_assignments(operator_id, machine_id, created_by)
values ('10000000-0000-0000-0000-000000000002', '39000000-0000-0000-0000-000000000092',
  '10000000-0000-0000-0000-000000000001');
insert into public.production_reports(id, machine_id, created_by, updated_by)
values ('89000000-0000-0000-0000-000000000092', '39000000-0000-0000-0000-000000000092',
  '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001');
insert into public.report_stop_events(id, report_id, stop_category_id, responsible_user_id)
select '99000000-0000-0000-0000-000000000093', '89000000-0000-0000-0000-000000000092', id,
  '10000000-0000-0000-0000-000000000002' from public.stop_categories where code = '1';
update public.report_stop_events set ended_at = now() where id = '99000000-0000-0000-0000-000000000093';
update public.production_reports set status = 'SUBMITTED', ended_at = now()
where id = '89000000-0000-0000-0000-000000000092';
select is((select count(*)::integer from public.notification_events where type = 'REPORT_SUBMITTED'
  and resource_id = '89000000-0000-0000-0000-000000000092'), 1, 'Envío real crea un aviso');
update public.report_stop_events set stop_category_id = (select id from public.stop_categories where code = '2')
where id = '99000000-0000-0000-0000-000000000093';
select is((select count(*)::integer from public.notification_events where type = 'REPORT_CORRECTED'
  and resource_id = '89000000-0000-0000-0000-000000000092'), 0,
  'Categoría aislada de otras correcciones no crea aviso');
-- Fixture: emulate an already-open finalized stop without creating a prior correction event.
alter table public.report_stop_events disable trigger notify_stop_change_after_write;
insert into public.report_stop_events(id, report_id, stop_category_id, responsible_user_id)
select '99000000-0000-0000-0000-000000000095', '89000000-0000-0000-0000-000000000092', id,
  '10000000-0000-0000-0000-000000000002' from public.stop_categories where code = '1';
alter table public.report_stop_events enable trigger notify_stop_change_after_write;
update public.report_stop_events set ended_at = now() where id = '99000000-0000-0000-0000-000000000095';
select is((select count(*)::integer from public.notification_events where type = 'REPORT_CORRECTED'
  and resource_id = '89000000-0000-0000-0000-000000000092'), 1,
  'Cerrar parada de reporte finalizado avisa aun sin corrección previa');
delete from public.report_stop_events where id = '99000000-0000-0000-0000-000000000093';
select is((select count(*)::integer from public.notification_events where type = 'REPORT_CORRECTED'
  and resource_id = '89000000-0000-0000-0000-000000000092'), 1,
  'Eliminar parada agrupa corrección del mismo lote');
insert into public.report_stop_events(id, report_id, stop_category_id, responsible_user_id)
select '99000000-0000-0000-0000-000000000094', '89000000-0000-0000-0000-000000000092', id,
  '10000000-0000-0000-0000-000000000002' from public.stop_categories where code = '1';
select is((select count(*)::integer from public.notification_deliveries d
  join public.notification_events e on e.id = d.event_id where e.type = 'REPORT_CORRECTED'
  and e.resource_id = '89000000-0000-0000-0000-000000000092'
  and d.recipient_id = '10000000-0000-0000-0000-000000000002'), 1,
  'Insertar parada en el mismo lote conserva una sola corrección al autor');

update public.profiles set role = 'VIEWER' where id = '10000000-0000-0000-0000-000000000001';
select ok(not private.notification_is_visible((select id from public.notification_events where type = 'REPORT_CANCELLED'
  and resource_id = '89000000-0000-0000-0000-000000000091'), '10000000-0000-0000-0000-000000000001'),
  'Un administrador degradado pierde aviso administrativo');
select ok(not exists (select 1 from jsonb_array_elements(public.list_notifications()->'items') item
  where item->>'resourceId' = '89000000-0000-0000-0000-000000000091'),
  'La bandeja oculta eventos administrativos tras cambio de rol');
select ok(not public.mark_notification_read((select d.id from public.notification_deliveries d
  join public.notification_events e on e.id = d.event_id where e.type = 'REPORT_CANCELLED'
  and e.resource_id = '89000000-0000-0000-0000-000000000091'
  and d.recipient_id = '10000000-0000-0000-0000-000000000001' limit 1)),
  'No se marca un aviso cuyo permiso fue revocado');

select * from finish();
rollback;
