-- T042: approve_report (feature 001, FR-024/FR-024b). Solo un manager aprueba un reporte SUBMITTED
-- sin conflictos de sincronización abiertos; el resultado es CLOSED con approved_* y notificación.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000301', 'ap-root@usuarios.reporte-produccion.invalid', '{"full_name":"AP Root"}'),
  ('10000000-0000-0000-0000-000000000302', 'ap-coord@usuarios.reporte-produccion.invalid', '{"full_name":"AP Coordinador"}'),
  ('10000000-0000-0000-0000-000000000303', 'ap-aud@usuarios.reporte-produccion.invalid', '{"full_name":"AP Auditor"}'),
  ('10000000-0000-0000-0000-000000000304', 'ap-op@usuarios.reporte-produccion.invalid', '{"full_name":"AP Operario"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000301';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000302';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000303';
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000304';

insert into public.machines (id, code, name) values
  ('3a000000-0000-0000-0000-000000000001', 'AP-1', 'AP 1'),
  ('3a000000-0000-0000-0000-000000000002', 'AP-2', 'AP 2');

-- Filas sintéticas (sin disparar triggers de negocio).
set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role,
  submitted_by, submitted_at, cancellation_reason, cancelled_at, cancelled_by, approved_by, approved_at, approver_full_name, started_at)
values
  ('8a000000-0000-0000-0000-000000000001', 'RPT-2032-900001', '3a000000-0000-0000-0000-000000000001', 'DRAFT',
    '10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304', 'AP Operario', 'OPERATOR',
    null, null, null, null, null, null, null, null, now()),
  ('8a000000-0000-0000-0000-000000000002', 'RPT-2032-900002', '3a000000-0000-0000-0000-000000000002', 'SUBMITTED',
    '10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304', 'AP Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000304', now(), null, null, null, null, null, null, now()),
  ('8a000000-0000-0000-0000-000000000003', 'RPT-2032-900003', '3a000000-0000-0000-0000-000000000002', 'SUBMITTED',
    '10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304', 'AP Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000304', now(), null, null, null, null, null, null, now()),
  ('8a000000-0000-0000-0000-000000000004', 'RPT-2032-900004', '3a000000-0000-0000-0000-000000000002', 'CANCELLED',
    '10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304', 'AP Operario', 'OPERATOR',
    null, null, 'Motivo', now(), '10000000-0000-0000-0000-000000000304', null, null, null, now()),
  ('8a000000-0000-0000-0000-000000000005', 'RPT-2032-900005', '3a000000-0000-0000-0000-000000000002', 'CLOSED',
    '10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304', 'AP Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000304', now(), null, null, null,
    '10000000-0000-0000-0000-000000000302', now(), 'AP Coordinador', now()),
  ('8a000000-0000-0000-0000-000000000006', 'RPT-2032-900006', '3a000000-0000-0000-0000-000000000002', 'SUBMITTED',
    '10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304', 'AP Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000304', now(), null, null, null, null, null, null, now());
insert into public.sync_quarantine (id, operation_id, report_id, user_id, payload, reason) values
  ('ca000000-0000-0000-0000-000000000001', 'ba000000-0000-0000-0000-000000000001',
   '8a000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000304', '{}', 'Conflicto abierto'),
  ('ca000000-0000-0000-0000-000000000002', 'ba000000-0000-0000-0000-000000000002',
   '8a000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000304', '{}', 'Conflicto ya revisado');
update public.sync_quarantine set status = 'REVIEWED', reviewed_by = '10000000-0000-0000-0000-000000000302', reviewed_at = now()
where id = 'ca000000-0000-0000-0000-000000000002';
set local session_replication_role = origin;

-- ---------------------------------------------------------------- Rechazos de rol
select tests.auth_as('10000000-0000-0000-0000-000000000304');
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000002')$$, '42501', null,
  'El OPERATOR no puede aprobar (FORBIDDEN)');
select tests.auth_as('10000000-0000-0000-0000-000000000303');
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000002')$$, '42501', null,
  'El VIEWER no puede aprobar (FORBIDDEN)');
select tests.auth_reset();
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000002')$$, '42501', null,
  'Sin sesión no se puede aprobar (FORBIDDEN)');

-- ---------------------------------------------------------------- Estados no aprobables
select tests.auth_as('10000000-0000-0000-0000-000000000302');
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000001')$$, 'P0001', 'NOT_SUBMITTED',
  'No se aprueba un DRAFT');
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000004')$$, 'P0001', 'NOT_SUBMITTED',
  'No se aprueba un CANCELLED');
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000005')$$, 'P0001', 'NOT_SUBMITTED',
  'No se aprueba un CLOSED');
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000003')$$, 'P0002', 'OPEN_CONFLICT',
  'No se aprueba un reporte con cuarentena OPEN (OPEN_CONFLICT)');

-- ---------------------------------------------------------------- Aprobación válida
select lives_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000002')$$,
  'El coordinador aprueba un SUBMITTED sin conflictos');
select tests.auth_reset();
select is((select status::text from public.production_reports where id = '8a000000-0000-0000-0000-000000000002'), 'CLOSED',
  'El reporte queda CLOSED');
select is((select approved_by from public.production_reports where id = '8a000000-0000-0000-0000-000000000002'),
  '10000000-0000-0000-0000-000000000302'::uuid, 'approved_by es el coordinador');
select ok((select approved_at is not null from public.production_reports where id = '8a000000-0000-0000-0000-000000000002'),
  'approved_at queda fijado');
select is((select approver_full_name from public.production_reports where id = '8a000000-0000-0000-0000-000000000002'),
  'AP Coordinador', 'approver_full_name es una instantánea del nombre');
select ok(exists(select 1 from public.notification_events
  where type = 'REPORT_APPROVED' and resource_id = '8a000000-0000-0000-0000-000000000002'),
  'Se emite el aviso REPORT_APPROVED');
select ok(exists(select 1 from public.report_audit_log
  where report_id = '8a000000-0000-0000-0000-000000000002' and field_name = 'status' and action = 'STATUS'
    and new_value = '"CLOSED"'::jsonb and actor_role = 'ADMINISTRATOR'
    and changed_by = '10000000-0000-0000-0000-000000000302'),
  'La aprobación queda en el historial con el rol del actor');

-- ROOT también aprueba; la cuarentena REVIEWED no bloquea.
select tests.auth_as('10000000-0000-0000-0000-000000000301');
select lives_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000006')$$,
  'ROOT aprueba; una cuarentena REVIEWED no bloquea');
select tests.auth_reset();
select is((select approver_full_name from public.production_reports where id = '8a000000-0000-0000-0000-000000000006'),
  'AP Root', 'La instantánea es la de ROOT');

-- ---------------------------------------------------------------- Paradas abiertas o sin categoría (INVALID_STOPS)
set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role,
  submitted_by, submitted_at, started_at)
values ('8a000000-0000-0000-0000-000000000007', 'RPT-2032-900007', '3a000000-0000-0000-0000-000000000002', 'SUBMITTED',
  '10000000-0000-0000-0000-000000000304', '10000000-0000-0000-0000-000000000304', 'AP Operario', 'OPERATOR',
  '10000000-0000-0000-0000-000000000304', now(), now());
insert into public.report_stop_events (id, report_id, started_at, responsible_user_id) values
  ('9a000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000007', now() - interval '3 hours',
   '10000000-0000-0000-0000-000000000304');
set local session_replication_role = origin;
select tests.auth_as('10000000-0000-0000-0000-000000000302');
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000007')$$, 'P0007', 'INVALID_STOPS',
  'No se aprueba un reporte con una parada abierta y sin categoría');
select tests.auth_reset();
set local session_replication_role = replica;
update public.report_stop_events set ended_at = started_at + interval '1 hour' where id = '9a000000-0000-0000-0000-000000000001';
set local session_replication_role = origin;
select tests.auth_as('10000000-0000-0000-0000-000000000302');
select throws_ok($$select public.approve_report('8a000000-0000-0000-0000-000000000007')$$, 'P0007', 'INVALID_STOPS',
  'No se aprueba un reporte con una parada cerrada pero sin categoría');
select tests.auth_reset();
-- ---------------------------------------------------------------- CLOSED solo por la RPC
select throws_ok($$update public.production_reports set status = 'CLOSED',
    approved_by = '10000000-0000-0000-0000-000000000302', approved_at = now(), approver_full_name = 'Falso'
  where id = '8a000000-0000-0000-0000-000000000003'$$, 'P0001', null,
  'Un cambio directo SUBMITTED -> CLOSED (fuera de approve_report) falla');

select * from finish();
rollback;
