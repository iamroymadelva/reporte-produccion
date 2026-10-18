-- «Reloj desfasado» (clock_skew_review) es solo para ROOT: aviso CLOCK_SKEW_REVIEW y has_pending_review.
-- No cambia la aprobación: la bandera no bloquea approve_report (solo OPEN conflict y paradas inválidas).
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into public.machines(id, code, name) values ('3d000000-0000-0000-0000-000000000801', 'CS-1', 'Máquina reloj');
insert into public.operator_machine_assignments(operator_id, machine_id, shift_id, valid_from, created_by)
select '10000000-0000-0000-0000-000000000002', '3d000000-0000-0000-0000-000000000801', id, '2000-01-01',
  '10000000-0000-0000-0000-000000000001' from public.shifts where active;

select tests.auth_as('10000000-0000-0000-0000-000000000002');
insert into public.production_reports(id, machine_id, started_at, created_by, updated_by)
values ('8d000000-0000-0000-0000-000000000801', '3d000000-0000-0000-0000-000000000801', now(),
  '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');
-- Parada capturada CON conexión pero con hora de hace 1 hora: la base la marca para revisión de reloj.
-- El trigger fuerza ended_at = null en el INSERT del operario; se cierra después con UPDATE
-- (la bandera sobrevive al cierre: old.clock_skew_review) para que approve_report no la rechace.
insert into public.report_stop_events(id, report_id, stop_category_id, started_at, responsible_user_id)
select '9d000000-0000-0000-0000-000000000801', '8d000000-0000-0000-0000-000000000801', id,
  now() - interval '70 minutes', '10000000-0000-0000-0000-000000000002'
from public.stop_categories where code = '1';
update public.report_stop_events set ended_at = now() - interval '60 minutes'
where id = '9d000000-0000-0000-0000-000000000801';
select is((select clock_skew_review from public.report_stop_events where id = '9d000000-0000-0000-0000-000000000801'),
  true, 'La parada con hora desfasada queda marcada (la medición no cambió)');

-- has_pending_review del reporte DRAFT: operario, coordinador y auditor no ven la revisión de reloj; ROOT sí.
select tests.auth_as('10000000-0000-0000-0000-000000000001');
select is((select has_pending_review from public.production_report_overview where id = '8d000000-0000-0000-0000-000000000801'),
  false, 'El coordinador no ve has_pending_review por reloj desfasado');
select tests.auth_as('10000000-0000-0000-0000-000000000003');
select is((select has_pending_review from public.production_report_overview where id = '8d000000-0000-0000-0000-000000000801'),
  false, 'El auditor no ve has_pending_review por reloj desfasado');
select tests.auth_as('10000000-0000-0000-0000-000000000004');
select is((select has_pending_review from public.production_report_overview where id = '8d000000-0000-0000-0000-000000000801'),
  true, 'ROOT sí ve has_pending_review por reloj desfasado');

-- Aviso CLOCK_SKEW_REVIEW: visibilidad por rol.
select tests.auth_reset();
insert into public.notification_events(event_key, type, resource_type, resource_id, title, body, href)
values ('cs:test', 'CLOCK_SKEW_REVIEW', 'report', '8d000000-0000-0000-0000-000000000801', 'Reloj', 'Prueba',
  '/reportes/8d000000-0000-0000-0000-000000000801');
select ok(private.notification_is_visible((select id from public.notification_events where event_key = 'cs:test'),
  '10000000-0000-0000-0000-000000000004'), 'ROOT ve CLOCK_SKEW_REVIEW');
select ok(not private.notification_is_visible((select id from public.notification_events where event_key = 'cs:test'),
  '10000000-0000-0000-0000-000000000001'), 'El coordinador no ve CLOCK_SKEW_REVIEW');
select ok(not private.notification_is_visible((select id from public.notification_events where event_key = 'cs:test'),
  '10000000-0000-0000-0000-000000000002'), 'El operario no ve CLOCK_SKEW_REVIEW');
select ok(not private.notification_is_visible((select id from public.notification_events where event_key = 'cs:test'),
  '10000000-0000-0000-0000-000000000003'), 'El auditor no ve CLOCK_SKEW_REVIEW');

-- Entrega: sync_notify solo crea entregas para ROOT activos en CLOCK_SKEW_REVIEW; OFFLINE_DATA_REVIEW sigue a ambos managers.
select private.sync_notify('CLOCK_SKEW_REVIEW', 'cs:sync:skew', '8d000000-0000-0000-0000-000000000801', 'Reloj', 'x');
select private.sync_notify('OFFLINE_DATA_REVIEW', 'cs:sync:review', '8d000000-0000-0000-0000-000000000801', 'Revisión', 'x');
select is((select count(*)::integer from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
  where e.event_key = 'cs:sync:skew'),
  (select count(*)::integer from public.profiles where role = 'ROOT' and active and removed_at is null),
  'CLOCK_SKEW_REVIEW solo se entrega a ROOT activos');
select is((select count(*)::integer from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
  join public.profiles p on p.id = d.recipient_id where e.event_key = 'cs:sync:skew' and p.role <> 'ROOT'),
  0, 'CLOCK_SKEW_REVIEW no se entrega al coordinador');
select is((select count(*)::integer from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
  where e.event_key = 'cs:sync:review'),
  (select count(*)::integer from public.profiles where role in ('ROOT', 'ADMINISTRATOR') and active and removed_at is null),
  'OFFLINE_DATA_REVIEW sigue llegando a ROOT y coordinador');

-- Aprobación intacta: la bandera de reloj no bloquea approve_report.
select tests.auth_reset();
set local session_replication_role = replica;
update public.production_reports set status = 'SUBMITTED', submitted_by = '10000000-0000-0000-0000-000000000002', submitted_at = now()
where id = '8d000000-0000-0000-0000-000000000801';
set local session_replication_role = origin;
select tests.auth_as('10000000-0000-0000-0000-000000000001');
select is((select status from public.approve_report('8d000000-0000-0000-0000-000000000801')), 'CLOSED',
  'El coordinador aprueba un reporte con clock_skew_review (la bandera no bloquea)');

select * from finish();
rollback;
