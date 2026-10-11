-- T010: matriz RLS objetivo rol x acción (data-model.md, "Matriz RLS objetivo").
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000251', 'rls-root@usuarios.reporte-produccion.invalid', '{"full_name":"RLS Root"}'),
  ('10000000-0000-0000-0000-000000000252', 'rls-coord@usuarios.reporte-produccion.invalid', '{"full_name":"RLS Coordinador"}'),
  ('10000000-0000-0000-0000-000000000253', 'rls-aud@usuarios.reporte-produccion.invalid', '{"full_name":"RLS Auditor"}'),
  ('10000000-0000-0000-0000-000000000254', 'rls-opa@usuarios.reporte-produccion.invalid', '{"full_name":"RLS Operario A"}'),
  ('10000000-0000-0000-0000-000000000255', 'rls-opb@usuarios.reporte-produccion.invalid', '{"full_name":"RLS Operario B"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000251';
update public.profiles set role = 'ADMINISTRATOR', active = true where id = '10000000-0000-0000-0000-000000000252';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000253';
update public.profiles set role = 'OPERATOR', active = true
where id in ('10000000-0000-0000-0000-000000000254', '10000000-0000-0000-0000-000000000255');

insert into public.machines (id, code, name) values
  ('3f000000-0000-0000-0000-000000000001', 'RLS-1', 'RLS 1'),
  ('3f000000-0000-0000-0000-000000000002', 'RLS-2', 'RLS 2'),
  ('3f000000-0000-0000-0000-000000000003', 'RLS-3', 'RLS 3');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, created_by)
select o.id, m.id, s.id, '2000-01-01', '10000000-0000-0000-0000-000000000252'
from (values ('10000000-0000-0000-0000-000000000254'::uuid, 'RLS-1'), ('10000000-0000-0000-0000-000000000255', 'RLS-2')) o(id, code)
join public.machines m on m.code = o.code cross join public.shifts s where s.active;

-- Filas sintéticas en los cuatro estados (sin disparar triggers de negocio).
set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role,
  submitted_by, submitted_at, cancellation_reason, cancelled_at, cancelled_by, approved_by, approved_at, approver_full_name, started_at)
values
  ('8f000000-0000-0000-0000-000000000001', 'RPT-2031-900001', '3f000000-0000-0000-0000-000000000001', 'DRAFT',
    '10000000-0000-0000-0000-000000000254', '10000000-0000-0000-0000-000000000254', 'RLS Operario A', 'OPERATOR',
    null, null, null, null, null, null, null, null, now()),
  ('8f000000-0000-0000-0000-000000000002', 'RPT-2031-900002', '3f000000-0000-0000-0000-000000000002', 'SUBMITTED',
    '10000000-0000-0000-0000-000000000255', '10000000-0000-0000-0000-000000000255', 'RLS Operario B', 'OPERATOR',
    '10000000-0000-0000-0000-000000000255', now(), null, null, null, null, null, null, now()),
  ('8f000000-0000-0000-0000-000000000003', 'RPT-2031-900003', '3f000000-0000-0000-0000-000000000002', 'CANCELLED',
    '10000000-0000-0000-0000-000000000255', '10000000-0000-0000-0000-000000000255', 'RLS Operario B', 'OPERATOR',
    null, null, 'Motivo', now(), '10000000-0000-0000-0000-000000000255', null, null, null, now()),
  ('8f000000-0000-0000-0000-000000000004', 'RPT-2031-900004', '3f000000-0000-0000-0000-000000000002', 'CLOSED',
    '10000000-0000-0000-0000-000000000255', '10000000-0000-0000-0000-000000000255', 'RLS Operario B', 'OPERATOR',
    '10000000-0000-0000-0000-000000000255', now(), null, null, null,
    '10000000-0000-0000-0000-000000000252', now(), 'RLS Coordinador', now());
insert into public.report_stop_events (id, report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id) values
  ('9f000000-0000-0000-0000-000000000001', '8f000000-0000-0000-0000-000000000001',
    (select id from public.stop_categories where code = '1'), now() - interval '2 hours', now() - interval '1 hour', 3600,
    '10000000-0000-0000-0000-000000000254'),
  ('9f000000-0000-0000-0000-000000000002', '8f000000-0000-0000-0000-000000000002',
    (select id from public.stop_categories where code = '1'), now() - interval '2 hours', now() - interval '1 hour', 3600,
    '10000000-0000-0000-0000-000000000255');
insert into public.report_change_events (id, report_id, change_type_id, description, occurred_at, created_by) values
  ('af000000-0000-0000-0000-000000000001', '8f000000-0000-0000-0000-000000000001',
    (select id from public.change_types where name = 'Lote'), 'Cambio de lote', now(), '10000000-0000-0000-0000-000000000254'),
  ('af000000-0000-0000-0000-000000000002', '8f000000-0000-0000-0000-000000000002',
    (select id from public.change_types where name = 'Lote'), 'Cambio de lote', now(), '10000000-0000-0000-0000-000000000255');
insert into public.report_audit_log (report_id, changed_by, field_name, old_value, new_value, entity_type, entity_id, action) values
  ('8f000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000252', 'lot', '"A"', '"B"', 'report', '8f000000-0000-0000-0000-000000000002', 'UPDATE'),
  ('8f000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000254', 'lot', '"A"', '"B"', 'report', '8f000000-0000-0000-0000-000000000001', 'UPDATE');
insert into public.administrative_audit_log (action, entity_type, entity_id, performed_by)
values ('INSERT', 'rls_matrix_fixture', 'fixture', '10000000-0000-0000-0000-000000000252');
insert into public.sync_operation_log (operation_id, user_id, operation_type, result, captured_at)
values ('bf000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000255', 'CREATE_REPORT', 'applied', now());
insert into public.sync_quarantine (id, operation_id, report_id, user_id, payload, reason)
values ('cf000000-0000-0000-0000-000000000001', 'bf000000-0000-0000-0000-000000000002',
  '8f000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000255', '{}', 'Conflicto de prueba');
insert into public.device_sync_status (user_id, device_id, pending_count, last_seen_at)
values ('10000000-0000-0000-0000-000000000255', 'df000000-0000-0000-0000-000000000001', 2, now());
set local session_replication_role = origin;

-- ---------------------------------------------------------------- Reportes: SELECT
select tests.auth_as('10000000-0000-0000-0000-000000000251');
select is((select count(*)::integer from public.production_reports where folio like 'RPT-2031-9000%'), 4, 'ROOT ve los reportes en todos los estados');
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select is((select count(*)::integer from public.production_reports where folio like 'RPT-2031-9000%'), 4, 'El coordinador ve los reportes en todos los estados');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select is((select count(*)::integer from public.production_reports where folio like 'RPT-2031-9000%'), 4,
  'El auditor ve los reportes en TODOS los estados (DRAFT, SUBMITTED, CANCELLED y CLOSED)');
select is((select count(*)::integer from public.production_report_overview where folio like 'RPT-2031-9000%'), 4,
  'El auditor ve la vista production_report_overview completa');
select tests.auth_as('10000000-0000-0000-0000-000000000254');
select is((select count(*)::integer from public.production_reports where folio like 'RPT-2031-9000%'), 1, 'El operario A solo ve sus reportes');
select tests.auth_as('10000000-0000-0000-0000-000000000255');
select is((select count(*)::integer from public.production_reports where folio like 'RPT-2031-9000%'), 3, 'El operario B solo ve sus reportes');

-- ---------------------------------------------------------------- Paradas y cambios: SELECT
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select is((select count(*)::integer from public.report_stop_events where id::text like '9f0%'), 2, 'El auditor ve las paradas de reportes en cualquier estado');
select is((select count(*)::integer from public.report_change_events where id::text like 'af0%'), 2, 'El auditor ve los cambios de reportes en cualquier estado');
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select is((select count(*)::integer from public.report_stop_events where id::text like '9f0%'), 2, 'El coordinador ve todas las paradas');
select tests.auth_as('10000000-0000-0000-0000-000000000254');
select is((select count(*)::integer from public.report_stop_events where id::text like '9f0%'), 1, 'El operario A solo ve sus paradas');
select is((select count(*)::integer from public.report_change_events where id::text like 'af0%'), 1, 'El operario A solo ve sus cambios');

-- ---------------------------------------------------------------- Reportes: INSERT
select tests.auth_as('10000000-0000-0000-0000-000000000251');
select throws_ok($$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
  values ('3f000000-0000-0000-0000-000000000003', now(), '10000000-0000-0000-0000-000000000251', '10000000-0000-0000-0000-000000000251')$$,
  null, null, 'ROOT no crea reportes');
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select throws_ok($$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
  values ('3f000000-0000-0000-0000-000000000003', now(), '10000000-0000-0000-0000-000000000252', '10000000-0000-0000-0000-000000000252')$$,
  null, null, 'El coordinador no crea reportes');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select throws_ok($$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
  values ('3f000000-0000-0000-0000-000000000003', now(), '10000000-0000-0000-0000-000000000253', '10000000-0000-0000-0000-000000000253')$$,
  null, null, 'El auditor no crea reportes');

-- ---------------------------------------------------------------- Reportes: UPDATE en DRAFT
select tests.auth_as('10000000-0000-0000-0000-000000000251');
select results_eq($$with changed as (update public.production_reports set observations = 'x'
  where id = '8f000000-0000-0000-0000-000000000001' returning id) select count(*)::integer from changed$$,
  array[0], 'ROOT no actualiza un reporte DRAFT');
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select results_eq($$with changed as (update public.production_reports set observations = 'x'
  where id = '8f000000-0000-0000-0000-000000000001' returning id) select count(*)::integer from changed$$,
  array[0], 'El coordinador no actualiza un reporte DRAFT');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select results_eq($$with changed as (update public.production_reports set observations = 'x'
  where id in ('8f000000-0000-0000-0000-000000000001', '8f000000-0000-0000-0000-000000000002') returning id) select count(*)::integer from changed$$,
  array[0], 'El auditor no actualiza ningún reporte');
select tests.auth_as('10000000-0000-0000-0000-000000000254');
select results_eq($$with changed as (update public.production_reports set observations = 'x'
  where id = '8f000000-0000-0000-0000-000000000001' returning id) select count(*)::integer from changed$$,
  array[1], 'El operario actualiza su reporte DRAFT');
select results_eq($$with changed as (update public.production_reports set observations = 'x'
  where id = '8f000000-0000-0000-0000-000000000002' returning id) select count(*)::integer from changed$$,
  array[0], 'El operario A no actualiza el reporte de B');

-- ---------------------------------------------------------------- Paradas y cambios: UPDATE en DRAFT
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select results_eq($$with changed as (update public.report_stop_events set description = 'x'
  where id = '9f000000-0000-0000-0000-000000000001' returning id) select count(*)::integer from changed$$,
  array[0], 'El coordinador no actualiza paradas de un reporte DRAFT');
select results_eq($$with changed as (update public.report_change_events set description = 'x'
  where id = 'af000000-0000-0000-0000-000000000001' returning id) select count(*)::integer from changed$$,
  array[0], 'El coordinador no actualiza cambios de un reporte DRAFT');
select tests.auth_as('10000000-0000-0000-0000-000000000251');
select results_eq($$with changed as (update public.report_stop_events set description = 'x'
  where id = '9f000000-0000-0000-0000-000000000001' returning id) select count(*)::integer from changed$$,
  array[0], 'ROOT no actualiza paradas de un reporte DRAFT');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select results_eq($$with changed as (update public.report_stop_events set description = 'x'
  where id in ('9f000000-0000-0000-0000-000000000001', '9f000000-0000-0000-0000-000000000002') returning id) select count(*)::integer from changed$$,
  array[0], 'El auditor no actualiza paradas');

-- ---------------------------------------------------------------- Catálogos: escritura
select tests.auth_as('10000000-0000-0000-0000-000000000254');
select throws_ok($$insert into public.clients (code, name) values ('RLS-C1', 'Cliente RLS operario')$$, '42501', null, 'El operario no escribe clientes');
select throws_ok($$insert into public.machines (code, name) values ('RLS-M', 'Máquina RLS operario')$$, '42501', null, 'El operario no escribe máquinas');
select throws_ok($$insert into public.stop_categories (code, name) values ('77', 'Categoría RLS operario')$$, '42501', null, 'El operario no escribe categorías de parada');
select throws_ok($$insert into public.change_types (code, name) values ('RLS', 'Tipo RLS operario')$$, '42501', null, 'El operario no escribe tipos de cambio');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'save_frequent_catalog_value'), 0::bigint,
  'T077: save_frequent_catalog_value ya no existe');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select throws_ok($$insert into public.clients (code, name) values ('RLS-C2', 'Cliente RLS auditor')$$, '42501', null, 'El auditor no escribe clientes');
select throws_ok($$insert into public.change_types (code, name) values ('RLS2', 'Tipo RLS auditor')$$, '42501', null, 'El auditor no escribe tipos de cambio');
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select lives_ok($$insert into public.clients (code, name) values ('RLS-C3', 'Cliente RLS coordinador')$$, 'El coordinador escribe clientes');
select lives_ok($$insert into public.change_types (code, name, sort_order) values ('RLS3', 'Tipo RLS coordinador', 90)$$, 'El coordinador escribe tipos de cambio');
select tests.auth_as('10000000-0000-0000-0000-000000000251');
select lives_ok($$insert into public.clients (code, name) values ('RLS-C4', 'Cliente RLS root')$$, 'ROOT escribe clientes');
select lives_ok($$insert into public.machines (code, name) values ('RLS-M4', 'Máquina RLS root')$$, 'ROOT escribe máquinas');

-- ---------------------------------------------------------------- Usuarios (profiles): matriz de gestión
select tests.auth_as('10000000-0000-0000-0000-000000000252');
-- Las escrituras directas sobre profiles/asignaciones ya no existen para ningún rol: solo manage_user_assignments.
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select throws_ok($$update public.profiles set job_title = 'Editado' where id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'El coordinador no edita perfiles directamente');
select throws_ok($$update public.profiles set active = false, possible_unsynced_data = false where id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'El coordinador no desactiva perfiles directamente');
select throws_ok($$update public.profiles set role = 'ROOT' where id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'El coordinador no puede promover a nadie a ROOT');
select throws_ok($$delete from public.operator_machine_assignments where operator_id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'El coordinador no borra asignaciones directamente');
select throws_ok($$update public.operator_machine_assignments set active = false where operator_id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'El coordinador no modifica asignaciones directamente');
select throws_ok($$insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, created_by)
  select '10000000-0000-0000-0000-000000000253', m.id, s.id, '10000000-0000-0000-0000-000000000252' from public.machines m, public.shifts s limit 1$$,
  '42501', null, 'El coordinador no inserta asignaciones directamente (ni a un auditor)');
select tests.auth_as('10000000-0000-0000-0000-000000000251');
select throws_ok($$update public.profiles set job_title = 'Editado por root' where id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'ROOT no edita perfiles directamente');
select throws_ok($$update public.profiles set active = false where id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'ROOT no desactiva perfiles directamente');
select throws_ok($$update public.profiles set possible_unsynced_data = false where id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'ROOT no altera la marca de datos sin subir directamente');
select throws_ok($$delete from public.operator_machine_assignments where operator_id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'ROOT no borra asignaciones directamente');
select throws_ok($$update public.operator_machine_assignments set active = false where operator_id = '10000000-0000-0000-0000-000000000254'$$,
  '42501', null, 'ROOT no modifica asignaciones directamente');
select throws_ok($$insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, created_by)
  select '10000000-0000-0000-0000-000000000254', m.id, s.id, '10000000-0000-0000-0000-000000000251' from public.machines m, public.shifts s limit 1$$,
  '42501', null, 'ROOT no inserta asignaciones directamente');
select tests.auth_as('10000000-0000-0000-0000-000000000254');
select throws_ok($$update public.profiles set job_title = 'Editado' where id = '10000000-0000-0000-0000-000000000255'$$,
  '42501', null, 'El operario no edita perfiles');
select tests.auth_reset();
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE') and not has_table_privilege('anon', 'public.profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.operator_machine_assignments', 'INSERT')
  and not has_table_privilege('authenticated', 'public.operator_machine_assignments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.operator_machine_assignments', 'DELETE'),
  'authenticated/anon no tienen privilegios de escritura sobre profiles ni asignaciones');
select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT') and has_table_privilege('authenticated', 'public.operator_machine_assignments', 'SELECT'),
  'La lectura (SELECT) se conserva');

-- ---------------------------------------------------------------- Auditoría
select tests.auth_as('10000000-0000-0000-0000-000000000251');
select is((select count(*)::integer from public.report_audit_log where field_name = 'lot'), 2, 'ROOT lee report_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select is((select count(*)::integer from public.report_audit_log where field_name = 'lot'), 2, 'El coordinador lee report_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select is((select count(*)::integer from public.report_audit_log where field_name = 'lot'), 2,
  'El auditor lee report_audit_log de reportes en cualquier estado');
select tests.auth_as('10000000-0000-0000-0000-000000000254');
select is((select count(*)::integer from public.report_audit_log where field_name = 'lot'), 0, 'El operario no lee report_audit_log');

select tests.auth_as('10000000-0000-0000-0000-000000000251');
select is((select count(*)::integer from public.administrative_audit_log where entity_type = 'rls_matrix_fixture'), 1, 'ROOT lee administrative_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select is((select count(*)::integer from public.administrative_audit_log where entity_type = 'rls_matrix_fixture'), 0, 'El coordinador no lee administrative_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select is((select count(*)::integer from public.administrative_audit_log where entity_type = 'rls_matrix_fixture'), 0, 'El auditor no lee administrative_audit_log');
select tests.auth_as('10000000-0000-0000-0000-000000000254');
select is((select count(*)::integer from public.administrative_audit_log where entity_type = 'rls_matrix_fixture'), 0, 'El operario no lee administrative_audit_log');

select tests.auth_reset();
select ok(not has_table_privilege('authenticated', 'public.report_audit_log', p), 'authenticated no tiene ' || p || ' sobre report_audit_log')
from unnest(array['INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_table_privilege('authenticated', 'public.administrative_audit_log', p), 'authenticated no tiene ' || p || ' sobre administrative_audit_log')
from unnest(array['INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_table_privilege('authenticated', t, p), 'authenticated no tiene ' || p || ' sobre ' || t)
from unnest(array['public.sync_operation_log', 'public.sync_quarantine', 'public.device_sync_status']) t
cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) p;

-- ---------------------------------------------------------------- Sincronización
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select is((select count(*)::integer from public.sync_quarantine), 1, 'El coordinador lee sync_quarantine');
select is((select count(*)::integer from public.sync_operation_log), 1, 'El coordinador lee sync_operation_log');
select is((select count(*)::integer from public.device_sync_status), 1, 'El coordinador lee device_sync_status');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select is((select count(*)::integer from public.sync_quarantine), 1, 'El auditor lee sync_quarantine');
select tests.auth_as('10000000-0000-0000-0000-000000000255');
select is((select count(*)::integer from public.sync_quarantine), 1, 'El operario B lee su sync_quarantine');
select is((select count(*)::integer from public.sync_operation_log), 1, 'El operario B lee su sync_operation_log');
select is((select count(*)::integer from public.device_sync_status), 1, 'El operario B lee su device_sync_status');
select tests.auth_as('10000000-0000-0000-0000-000000000254');
select is((select count(*)::integer from public.sync_quarantine), 0, 'El operario A no lee la cuarentena de B');
select is((select count(*)::integer from public.sync_operation_log), 0, 'El operario A no lee el log de sincronización de B');
select is((select count(*)::integer from public.device_sync_status), 0, 'El operario A no lee el estado de dispositivos de B');

-- ---------------------------------------------------------------- app_settings
select is((select count(*)::integer from public.app_settings), 1, 'app_settings tiene una fila única');
select tests.auth_as('10000000-0000-0000-0000-000000000253');
select is((select count(*)::integer from public.app_settings), 1, 'Cualquier usuario autenticado lee app_settings');
select results_eq($$with changed as (update public.app_settings set off_shift_grace = interval '3 hours' returning 1) select count(*)::integer from changed$$,
  array[0], 'El auditor no escribe app_settings');
select tests.auth_as('10000000-0000-0000-0000-000000000252');
select results_eq($$with changed as (update public.app_settings set off_shift_grace = interval '3 hours' returning 1) select count(*)::integer from changed$$,
  array[0], 'El coordinador no escribe app_settings');
select tests.auth_as('10000000-0000-0000-0000-000000000251');
select results_eq($$with changed as (update public.app_settings set off_shift_grace = interval '3 hours' returning 1) select count(*)::integer from changed$$,
  array[1], 'ROOT escribe app_settings');
select throws_ok($$insert into public.app_settings (id) values (false)$$, null, null, 'app_settings no admite una segunda fila');

select * from finish();
rollback;
