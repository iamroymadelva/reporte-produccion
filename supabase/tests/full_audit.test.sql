-- T056: auditoría completa (feature 001, FR-029, trigger audit_report_entity). Toda inserción y
-- modificación de reportes, paradas y cambios, por cualquier rol, queda en report_audit_log con
-- actor_role, reason, captured_offline/captured_at y received_at; el cliente no puede escribir en ella.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000331', 'fa-coord@usuarios.reporte-produccion.invalid', '{"full_name":"FA Coordinador"}'),
  ('10000000-0000-0000-0000-000000000332', 'fa-aud@usuarios.reporte-produccion.invalid', '{"full_name":"FA Auditor"}'),
  ('10000000-0000-0000-0000-000000000333', 'fa-op@usuarios.reporte-produccion.invalid', '{"full_name":"FA Operario"}'),
  ('10000000-0000-0000-0000-000000000334', 'fa-root@usuarios.reporte-produccion.invalid', '{"full_name":"FA Root"}');
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000331';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000332';
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000333';
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000334';

insert into public.machines (id, code, name) values ('3d000000-0000-0000-0000-000000000001', 'FA-1', 'FA 1');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select '10000000-0000-0000-0000-000000000333', '3d000000-0000-0000-0000-000000000001', s.id, '2000-01-01',
  '10000000-0000-0000-0000-000000000331'
from public.shifts s where s.active;

-- Lector con privilegios del dueño: las filas de auditoría no son legibles por el operario (RLS).
create function tests.audit() returns setof public.report_audit_log
language sql security definer set search_path = '' as $$ select * from public.report_audit_log $$;
grant execute on function tests.audit() to public;

-- ---------------------------------------------------------------- Operario: INSERT / UPDATE de reporte
select tests.auth_as('10000000-0000-0000-0000-000000000333');
insert into public.production_reports (id, machine_id, started_at, created_by, updated_by) values
  ('8d000000-0000-0000-0000-000000000001', '3d000000-0000-0000-0000-000000000001', now(),
   '10000000-0000-0000-0000-000000000333', '10000000-0000-0000-0000-000000000333');
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and entity_type = 'report' and action = 'INSERT'
    and actor_role = 'OPERATOR' and changed_by = '10000000-0000-0000-0000-000000000333'
    and captured_offline = false and captured_at is null and received_at is not null and reason is null),
  'El INSERT del reporte por el operario queda auditado con rol, received_at y sin captura offline');

update public.production_reports set lot = 'L-1', observations = 'Primera' where id = '8d000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and action = 'UPDATE' and entity_type = 'report'), 2,
  'Un UPDATE de dos campos genera una fila por campo cambiado');
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and field_name = 'lot' and old_value is null
    and new_value = '"L-1"'::jsonb and actor_role = 'OPERATOR' and entity_id = '8d000000-0000-0000-0000-000000000001'),
  'La fila de lot trae valor anterior/nuevo, rol y entity_id');

update public.production_reports set lot = 'L-1' where id = '8d000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and action = 'UPDATE' and entity_type = 'report'), 2,
  'Un UPDATE que no cambia nada no genera filas');
select is((select count(*)::integer from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and field_name in ('updated_at', 'updated_by')), 0,
  'updated_at y updated_by no se auditan');

-- Captura sin conexión: las variables app.* viajan a la fila de auditoría.
select set_config('app.captured_offline', 'true', true);
select set_config('app.captured_at', '2026-10-01T08:15:00Z', true);
update public.production_reports set production_order = 'OP-77' where id = '8d000000-0000-0000-0000-000000000001';
select set_config('app.captured_offline', '', true);
select set_config('app.captured_at', '', true);
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and field_name = 'production_order'
    and captured_offline = true and captured_at = '2026-10-01T08:15:00Z'::timestamptz),
  'captured_offline y captured_at se registran');
update public.production_reports set weight = 12 where id = '8d000000-0000-0000-0000-000000000001';
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and field_name = 'weight'
    and captured_offline = false and captured_at is null),
  'Sin variables, el valor por defecto es captured_offline=false y captured_at nulo');

-- ---------------------------------------------------------------- Operario: paradas y cambios
insert into public.report_stop_events (id, report_id, stop_category_id, responsible_user_id)
select '9d000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-000000000001', id, '10000000-0000-0000-0000-000000000333'
from public.stop_categories where code = '1';
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and entity_type = 'stop'
    and entity_id = '9d000000-0000-0000-0000-000000000001' and action = 'INSERT' and actor_role = 'OPERATOR'
    and received_at is not null),
  'El INSERT de una parada queda auditado');
update public.report_stop_events set ended_at = now() + interval '1 second' where id = '9d000000-0000-0000-0000-000000000001';
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and entity_type = 'stop'
    and entity_id = '9d000000-0000-0000-0000-000000000001' and action = 'UPDATE' and actor_role = 'OPERATOR'
    and old_value ->> 'ended_at' is null and new_value ->> 'ended_at' is not null),
  'El cierre de la parada queda auditado con instantáneas anterior y nueva');

insert into public.report_change_events (id, report_id, change_type_id, description, occurred_at, created_by)
select 'ad000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-000000000001', id, 'Cambio inicial', now(),
  '10000000-0000-0000-0000-000000000333'
from public.change_types where name = 'Lote';
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and entity_type = 'change'
    and entity_id = 'ad000000-0000-0000-0000-000000000001' and action = 'INSERT' and actor_role = 'OPERATOR'),
  'El INSERT de un cambio queda auditado');
update public.report_change_events set description = 'Cambio editado' where id = 'ad000000-0000-0000-0000-000000000001';
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and entity_type = 'change'
    and entity_id = 'ad000000-0000-0000-0000-000000000001' and action = 'UPDATE'
    and old_value ->> 'description' = 'Cambio inicial' and new_value ->> 'description' = 'Cambio editado'),
  'La edición de un cambio queda auditada');

-- ---------------------------------------------------------------- Operario: cambio de estado
update public.production_reports set status = 'CANCELLED', cancellation_reason = 'Prueba de auditoría'
where id = '8d000000-0000-0000-0000-000000000001';
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000001' and field_name = 'status' and action = 'STATUS'
    and new_value = '"CANCELLED"'::jsonb and actor_role = 'OPERATOR'),
  'La transición de estado se registra con action = STATUS');

-- ---------------------------------------------------------------- Manager vía RPC (con motivo)
select tests.auth_reset();
set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role,
  submitted_by, submitted_at, started_at, lot)
values ('8d000000-0000-0000-0000-000000000002', 'RPT-2035-900002', '3d000000-0000-0000-0000-000000000001', 'SUBMITTED',
  '10000000-0000-0000-0000-000000000333', '10000000-0000-0000-0000-000000000333', 'FA Operario', 'OPERATOR',
  '10000000-0000-0000-0000-000000000333', now(), now(), 'L-ini');
set local session_replication_role = origin;
select tests.auth_as('10000000-0000-0000-0000-000000000331');
select lives_ok($$select public.correct_report('8d000000-0000-0000-0000-000000000002', '{"lot":"L-fin"}', null, null, 'Corrección de lote')$$,
  'El manager corrige vía RPC');
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000002' and field_name = 'lot'
    and reason = 'Corrección de lote' and actor_role = 'ADMINISTRATOR' and received_at is not null),
  'La corrección del manager guarda el motivo y el rol');
select lives_ok($$select public.approve_report('8d000000-0000-0000-0000-000000000002')$$, 'El manager aprueba vía RPC');
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000002' and field_name = 'status' and action = 'STATUS'
    and new_value = '"CLOSED"'::jsonb and actor_role = 'ADMINISTRATOR'),
  'La aprobación se audita como STATUS');
select ok(not exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000002' and field_name = 'lot' and action = 'UPDATE' and reason is null),
  'El motivo no se filtra a escrituras ajenas a la RPC (variable restablecida)');

-- ---------------------------------------------------------------- Inmutabilidad para los clientes
select tests.auth_as('10000000-0000-0000-0000-000000000333');
select throws_ok($$insert into public.report_audit_log (report_id, changed_by, field_name, entity_type, entity_id, action)
  values ('8d000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000333', 'x', 'report', '8d000000-0000-0000-0000-000000000001', 'UPDATE')$$,
  '42501', null, 'OPERATOR no inserta en report_audit_log');
select throws_ok($$update public.report_audit_log set reason = 'x'$$, '42501', null, 'OPERATOR no actualiza report_audit_log');
select throws_ok($$delete from public.report_audit_log$$, '42501', null, 'OPERATOR no borra de report_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000331');
select throws_ok($$insert into public.report_audit_log (report_id, changed_by, field_name, entity_type, entity_id, action)
  values ('8d000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000331', 'x', 'report', '8d000000-0000-0000-0000-000000000001', 'UPDATE')$$,
  '42501', null, 'El coordinador no inserta en report_audit_log');
select throws_ok($$update public.report_audit_log set reason = 'x'$$, '42501', null, 'El coordinador no actualiza report_audit_log');
select throws_ok($$delete from public.report_audit_log$$, '42501', null, 'El coordinador no borra de report_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000334');
select throws_ok($$update public.report_audit_log set reason = 'x'$$, '42501', null, 'ROOT no actualiza report_audit_log');
select throws_ok($$delete from public.report_audit_log$$, '42501', null, 'ROOT no borra de report_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000332');
select throws_ok($$insert into public.report_audit_log (report_id, changed_by, field_name, entity_type, entity_id, action)
  values ('8d000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000332', 'x', 'report', '8d000000-0000-0000-0000-000000000001', 'UPDATE')$$,
  '42501', null, 'El auditor no inserta en report_audit_log');
select tests.auth_reset();

-- ---------------------------------------------------------------- Escrituras sin sesión (servicio / superusuario)
update public.production_reports set observations = 'Servicio' where id = '8d000000-0000-0000-0000-000000000002';
select ok(exists(select 1 from tests.audit()
  where report_id = '8d000000-0000-0000-0000-000000000002' and field_name = 'observations' and actor_role is null
    and changed_by is not null),
  'Una escritura sin sesión se audita con actor_role nulo');

select * from finish();
rollback;
