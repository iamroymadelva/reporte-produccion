-- T043: cancel_report (feature 001, FR-010a). El autor cancela su DRAFT con motivo; un manager solo si
-- el reporte está "abierto fuera de turno" (fin de turno + app_settings.off_shift_grace); nadie cancela
-- SUBMITTED ni CLOSED; VIEWER y operarios ajenos nunca.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000311', 'cr-root@usuarios.reporte-produccion.invalid', '{"full_name":"CR Root"}'),
  ('10000000-0000-0000-0000-000000000312', 'cr-coord@usuarios.reporte-produccion.invalid', '{"full_name":"CR Coordinador"}'),
  ('10000000-0000-0000-0000-000000000313', 'cr-aud@usuarios.reporte-produccion.invalid', '{"full_name":"CR Auditor"}'),
  ('10000000-0000-0000-0000-000000000314', 'cr-opa@usuarios.reporte-produccion.invalid', '{"full_name":"CR Operario A"}'),
  ('10000000-0000-0000-0000-000000000315', 'cr-opb@usuarios.reporte-produccion.invalid', '{"full_name":"CR Operario B"}'),
  ('10000000-0000-0000-0000-000000000316', 'cr-opc@usuarios.reporte-produccion.invalid', '{"full_name":"CR Operario C"}'),
  ('10000000-0000-0000-0000-000000000317', 'cr-opd@usuarios.reporte-produccion.invalid', '{"full_name":"CR Operario D"}'),
  ('10000000-0000-0000-0000-000000000318', 'cr-ope@usuarios.reporte-produccion.invalid', '{"full_name":"CR Operario E"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000311';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000312';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000313';
update public.profiles set role = 'OPERATOR', active = true
where id in ('10000000-0000-0000-0000-000000000314', '10000000-0000-0000-0000-000000000315',
  '10000000-0000-0000-0000-000000000316', '10000000-0000-0000-0000-000000000317', '10000000-0000-0000-0000-000000000318');

insert into public.machines (id, code, name) values
  ('3b000000-0000-0000-0000-000000000001', 'CR-1', 'CR 1'),
  ('3b000000-0000-0000-0000-000000000002', 'CR-2', 'CR 2'),
  ('3b000000-0000-0000-0000-000000000003', 'CR-3', 'CR 3'),
  ('3b000000-0000-0000-0000-000000000004', 'CR-4', 'CR 4'),
  ('3b000000-0000-0000-0000-000000000005', 'CR-5', 'CR 5');

-- Turno que terminó hace p_ended_ago (hora de Bogotá) y fecha operativa del reporte asociado.
create function tests.mk_shift(p_name text, p_ended_ago interval) returns uuid
language plpgsql as $$
declare
  v_local timestamp := (now() - p_ended_ago) at time zone 'America/Bogota';
  v_end time := v_local::time;
  v_start time := (v_local - interval '1 hour')::time;
  v_id uuid := gen_random_uuid();
begin
  insert into public.shifts (id, name, start_time, end_time, active) values (v_id, p_name, v_start, v_end, true);
  return v_id;
end;
$$;
create function tests.shift_report_date(p_shift uuid, p_ended_ago interval) returns date
language plpgsql as $$
declare
  v_local timestamp := (now() - p_ended_ago) at time zone 'America/Bogota';
  v_start time; v_end time;
begin
  select start_time, end_time into v_start, v_end from public.shifts where id = p_shift;
  return case when v_start < v_end then v_local::date else (v_local - interval '1 day')::date end;
end;
$$;

select tests.mk_shift('CR turno fin -10m', interval '10 minutes') as s1 \gset
select tests.mk_shift('CR turno fin -1h59m', interval '1 hour 59 minutes') as s2 \gset
select tests.mk_shift('CR turno fin -2h01m', interval '2 hours 1 minute') as s3 \gset
select tests.shift_report_date(:'s1', interval '10 minutes') as d1 \gset
select tests.shift_report_date(:'s2', interval '1 hour 59 minutes') as d2 \gset
select tests.shift_report_date(:'s3', interval '2 hours 1 minute') as d3 \gset

set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role,
  submitted_by, submitted_at, approved_by, approved_at, approver_full_name, started_at, shift_id, report_date)
values
  ('8b000000-0000-0000-0000-000000000001', 'RPT-2033-900001', '3b000000-0000-0000-0000-000000000001', 'DRAFT',
    '10000000-0000-0000-0000-000000000314', '10000000-0000-0000-0000-000000000314', 'CR Operario A', 'OPERATOR',
    null, null, null, null, null, now(), :'s1', :'d1'),
  ('8b000000-0000-0000-0000-000000000002', 'RPT-2033-900002', '3b000000-0000-0000-0000-000000000002', 'DRAFT',
    '10000000-0000-0000-0000-000000000315', '10000000-0000-0000-0000-000000000315', 'CR Operario B', 'OPERATOR',
    null, null, null, null, null, now(), :'s2', :'d2'),
  ('8b000000-0000-0000-0000-000000000003', 'RPT-2033-900003', '3b000000-0000-0000-0000-000000000003', 'DRAFT',
    '10000000-0000-0000-0000-000000000316', '10000000-0000-0000-0000-000000000316', 'CR Operario C', 'OPERATOR',
    null, null, null, null, null, now(), :'s3', :'d3'),
  ('8b000000-0000-0000-0000-000000000004', 'RPT-2033-900004', '3b000000-0000-0000-0000-000000000004', 'SUBMITTED',
    '10000000-0000-0000-0000-000000000317', '10000000-0000-0000-0000-000000000317', 'CR Operario D', 'OPERATOR',
    '10000000-0000-0000-0000-000000000317', now(), null, null, null, now(), :'s3', :'d3'),
  ('8b000000-0000-0000-0000-000000000005', 'RPT-2033-900005', '3b000000-0000-0000-0000-000000000004', 'CLOSED',
    '10000000-0000-0000-0000-000000000317', '10000000-0000-0000-0000-000000000317', 'CR Operario D', 'OPERATOR',
    '10000000-0000-0000-0000-000000000317', now(),
    '10000000-0000-0000-0000-000000000312', now(), 'CR Coordinador', now(), :'s3', :'d3');
insert into public.report_stop_events (id, report_id, stop_category_id, started_at, responsible_user_id) values
  ('9b000000-0000-0000-0000-000000000001', '8b000000-0000-0000-0000-000000000003',
    (select id from public.stop_categories where code = '1'), now() - interval '3 hours', '10000000-0000-0000-0000-000000000316');
set local session_replication_role = origin;

select ok((select is_off_shift from public.production_report_overview where id = '8b000000-0000-0000-0000-000000000003'),
  'Fixture: el DRAFT con turno terminado hace 2 h 01 min es "fuera de turno"');
select ok(not (select is_off_shift from public.production_report_overview where id = '8b000000-0000-0000-0000-000000000002'),
  'Fixture: el DRAFT con turno terminado hace 1 h 59 min no es "fuera de turno"');

-- ---------------------------------------------------------------- Autor
select tests.auth_as('10000000-0000-0000-0000-000000000314');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000001', '   ')$$, '22023', null,
  'El motivo es obligatorio');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000002', 'No es mi reporte')$$, '42501', null,
  'Otro operario no cancela un DRAFT ajeno (FORBIDDEN)');
select lives_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000001', 'Iniciado por error')$$,
  'El autor cancela su DRAFT con motivo (aunque no esté fuera de turno)');
select tests.auth_reset();
select is((select status::text from public.production_reports where id = '8b000000-0000-0000-0000-000000000001'), 'CANCELLED',
  'El reporte queda CANCELLED');
select is((select cancellation_reason from public.production_reports where id = '8b000000-0000-0000-0000-000000000001'),
  'Iniciado por error', 'Se guarda el motivo');
select is((select cancelled_by from public.production_reports where id = '8b000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-000000000314'::uuid, 'cancelled_by es el autor');
select ok(exists(select 1 from public.report_audit_log
  where report_id = '8b000000-0000-0000-0000-000000000001' and field_name = 'status' and action = 'STATUS'
    and reason = 'Iniciado por error' and actor_role = 'OPERATOR'),
  'La cancelación del autor queda auditada con motivo y rol');

-- ---------------------------------------------------------------- Manager y fuera de turno
select tests.auth_as('10000000-0000-0000-0000-000000000312');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000002', 'Intento temprano')$$, 'P0003', 'NOT_CANCELLABLE',
  'El coordinador no cancela 1 h 59 min después del fin del turno');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000003', '')$$, '22023', null,
  'El manager también necesita motivo');
select tests.auth_reset();
update public.app_settings set off_shift_grace = interval '3 hours';
select tests.auth_as('10000000-0000-0000-0000-000000000312');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000003', 'Margen mayor')$$, 'P0003', 'NOT_CANCELLABLE',
  'Con margen de 3 h, 2 h 01 min ya no basta');
select tests.auth_reset();
update public.app_settings set off_shift_grace = interval '2 hours';
select tests.auth_as('10000000-0000-0000-0000-000000000312');
select lives_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000003', 'Olvidado abierto')$$,
  'El coordinador cancela a las 2 h 01 min (margen por defecto), aun con una parada abierta');
select tests.auth_reset();
select is((select status::text from public.production_reports where id = '8b000000-0000-0000-0000-000000000003'), 'CANCELLED',
  'El reporte fuera de turno queda CANCELLED');
select is((select cancelled_by from public.production_reports where id = '8b000000-0000-0000-0000-000000000003'),
  '10000000-0000-0000-0000-000000000312'::uuid, 'cancelled_by es el coordinador');
select ok(not exists(select 1 from public.report_stop_events where report_id = '8b000000-0000-0000-0000-000000000003' and ended_at is null),
  'La parada abierta se cancela junto con el reporte');
select ok(exists(select 1 from public.report_audit_log
  where report_id = '8b000000-0000-0000-0000-000000000003' and field_name = 'status' and action = 'STATUS'
    and reason = 'Olvidado abierto' and actor_role = 'ADMINISTRATOR'),
  'La cancelación del manager queda auditada con motivo y rol');

-- El margen configurable se respeta también hacia abajo.
update public.app_settings set off_shift_grace = interval '1 hour';
select tests.auth_as('10000000-0000-0000-0000-000000000311');
select lives_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000002', 'Margen de 1 h')$$,
  'ROOT cancela a 1 h 59 min con un margen de 1 h');
select tests.auth_reset();
update public.app_settings set off_shift_grace = interval '2 hours';

-- ---------------------------------------------------------------- Borradores heredados sin turno (MINOR-3)
set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role, started_at)
values
  ('8b000000-0000-0000-0000-000000000006', 'RPT-2033-900006', '3b000000-0000-0000-0000-000000000005', 'DRAFT',
    '10000000-0000-0000-0000-000000000318', '10000000-0000-0000-0000-000000000318', 'CR Operario E', 'OPERATOR', now() - interval '13 hours'),
  ('8b000000-0000-0000-0000-000000000007', 'RPT-2033-900007', '3b000000-0000-0000-0000-000000000004', 'DRAFT',
    '10000000-0000-0000-0000-000000000317', '10000000-0000-0000-0000-000000000317', 'CR Operario D', 'OPERATOR', now() - interval '15 hours');
set local session_replication_role = origin;
select ok(not (select is_off_shift from public.production_report_overview where id = '8b000000-0000-0000-0000-000000000006'),
  'Sin turno: 13 h abiertas (< 12 h + 2 h) no es "fuera de turno"');
select ok((select is_off_shift from public.production_report_overview where id = '8b000000-0000-0000-0000-000000000007'),
  'Sin turno: 15 h abiertas (> 12 h + 2 h) es "fuera de turno"');
select tests.auth_as('10000000-0000-0000-0000-000000000312');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000006', 'Heredado reciente')$$, 'P0003', 'NOT_CANCELLABLE',
  'El coordinador no cancela un borrador sin turno con menos de 14 h');
select lives_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000007', 'Heredado olvidado')$$,
  'El coordinador cancela un borrador heredado sin turno pasadas 12 h + margen');
select tests.auth_reset();

-- ---------------------------------------------------------------- Nadie cancela SUBMITTED ni CLOSED; VIEWER nunca
select tests.auth_as('10000000-0000-0000-0000-000000000317');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000004', 'Ya enviado')$$, 'P0003', 'NOT_CANCELLABLE',
  'El autor no cancela un SUBMITTED');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000005', 'Ya cerrado')$$, 'P0003', 'NOT_CANCELLABLE',
  'El autor no cancela un CLOSED');
select tests.auth_as('10000000-0000-0000-0000-000000000312');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000004', 'Ya enviado')$$, 'P0003', 'NOT_CANCELLABLE',
  'El coordinador no cancela un SUBMITTED');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000005', 'Ya cerrado')$$, 'P0003', 'NOT_CANCELLABLE',
  'El coordinador no cancela un CLOSED');
select tests.auth_as('10000000-0000-0000-0000-000000000313');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000003', 'Auditor')$$, '42501', null,
  'El VIEWER nunca cancela (FORBIDDEN)');
select throws_ok($$select public.cancel_report('8b000000-0000-0000-0000-000000000004', 'Auditor')$$, '42501', null,
  'El VIEWER nunca cancela (FORBIDDEN), tampoco un SUBMITTED');
select tests.auth_reset();

select * from finish();
rollback;
