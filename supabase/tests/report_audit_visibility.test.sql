begin;
select no_plan();

insert into public.machines (id, code, name) values
  ('34000000-0000-0000-0000-000000000001', 'AUD-1', 'Máquina auditoría 1'),
  ('34000000-0000-0000-0000-000000000002', 'AUD-2', 'Máquina auditoría 2');
insert into public.lines (id, code, name) values
  ('44000000-0000-0000-0000-000000000001', 'AUD-L1', 'Línea auditoría 1'),
  ('44000000-0000-0000-0000-000000000002', 'AUD-L2', 'Línea auditoría 2');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from)
select '10000000-0000-0000-0000-000000000002', m.id, s.id, '2000-01-01'
from public.machines m cross join public.shifts s
where m.id in ('34000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000002') and s.active;

select ok(not has_table_privilege('anon', 'public.report_audit_log', 'INSERT'), 'Anon no inserta auditoría');
select ok(not has_table_privilege('anon', 'public.report_audit_log', 'UPDATE'), 'Anon no actualiza auditoría');
select ok(not has_table_privilege('anon', 'public.report_audit_log', 'DELETE'), 'Anon no elimina auditoría');
select ok(not has_table_privilege('authenticated', 'public.report_audit_log', 'INSERT'), 'Authenticated no inserta auditoría');
select ok(not has_table_privilege('authenticated', 'public.report_audit_log', 'UPDATE'), 'Authenticated no actualiza auditoría');
select ok(not has_table_privilege('authenticated', 'public.report_audit_log', 'DELETE'), 'Authenticated no elimina auditoría');
select ok(has_table_privilege('service_role', 'public.report_audit_log', 'INSERT'), 'Service role conserva INSERT de auditoría');
select ok(has_table_privilege('service_role', 'public.report_audit_log', 'UPDATE'), 'Service role conserva UPDATE de auditoría');
select ok(has_table_privilege('service_role', 'public.report_audit_log', 'DELETE'), 'Service role conserva DELETE de auditoría');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into public.production_reports (id, machine_id, started_at, created_by, updated_by) values (
  '84000000-0000-0000-0000-000000000001',
  '34000000-0000-0000-0000-000000000001',
  now(),
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002'
);
update public.production_reports set
  production_order = 'AUD-OP-1',
  line_id = '44000000-0000-0000-0000-000000000001',
  product_name = 'Producto auditoría',
  client_name = 'Cliente auditoría',
  dosifier_type_id = (select id from public.dosifier_types order by id limit 1),
  lot = 'AUD-LOTE-1',
  weight = 0,
  g_min = 0,
  started_at = now() - interval '1 hour',
  ended_at = now(),
  programmed_hours = 0,
  units_produced = 0,
  waste = 0
where id = '84000000-0000-0000-0000-000000000001';

insert into public.report_stop_events (id, report_id, stop_category_id, responsible_user_id)
select '94000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', id,
  '10000000-0000-0000-0000-000000000002'
from public.stop_categories where code = '9';
update public.report_stop_events
set stop_category_id = (select id from public.stop_categories where code = '3')
where id = '94000000-0000-0000-0000-000000000001';
update public.report_stop_events set ended_at = now()
where id = '94000000-0000-0000-0000-000000000001';

select is((select count(*) from public.report_audit_log where report_id = '84000000-0000-0000-0000-000000000001'), 0::bigint,
  'Operario no puede leer la auditoría administrativa');

update public.production_reports set status = 'SUBMITTED'
where id = '84000000-0000-0000-0000-000000000001';

insert into public.production_reports (id, machine_id, started_at, created_by, updated_by) values (
  '84000000-0000-0000-0000-000000000002',
  '34000000-0000-0000-0000-000000000002',
  now(),
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002'
);
-- Ediciones normales y una parada del operario en su borrador activo.
update public.production_reports set observations = 'Corrección de borrador ya permitida'
where id = '84000000-0000-0000-0000-000000000002';
insert into public.report_stop_events (id, report_id, stop_category_id, responsible_user_id)
select '94000000-0000-0000-0000-000000000002', '84000000-0000-0000-0000-000000000002', id,
  '10000000-0000-0000-0000-000000000002'
from public.stop_categories where code = '9';

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(exists(
  select 1 from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000001'
    and field_name = 'stop_event.update'
    and old_value -> 'stop_category' ->> 'name' = 'CALIDAD'
    and new_value -> 'stop_category' ->> 'name' = 'AJUSTE'
), 'Cambio de categoría conserva etiquetas históricas');
-- FR-029 (T060): la edición del borrador por el operario SÍ queda auditada, con su rol y sin motivo.
select ok(exists(
  select 1 from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000001'
    and field_name = 'production_order' and new_value = '"AUD-OP-1"'::jsonb
    and actor_role = 'OPERATOR' and reason is null
), 'La edición operativa del borrador queda auditada con rol OPERATOR y sin motivo');
-- Los managers corrigen solo vía correct_report (sin UPDATE directo).
select lives_ok($q$select public.correct_report('84000000-0000-0000-0000-000000000001',
  '{"line_id":"44000000-0000-0000-0000-000000000002","production_order":"AUD-OP-FINAL","observations":"Primera corrección confirmada"}'::jsonb,
  null, null, 'Primera corrección')$q$, 'Primera corrección vía RPC');
select lives_ok($q$select public.correct_report('84000000-0000-0000-0000-000000000001',
  '{"observations":"Segunda corrección confirmada"}'::jsonb, null, null, 'Segunda corrección')$q$,
  'Segunda corrección vía RPC');
select ok(exists(
  select 1 from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000001'
    and field_name = 'line_id'
    and old_value ->> 'label' = 'AUD-L1 · Línea auditoría 1'
    and new_value ->> 'label' = 'AUD-L2 · Línea auditoría 2'
), 'Corrección de catálogo conserva valores legibles');
select is((select count(*) from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000001' and field_name = 'line_id'
    and reason = 'Primera corrección'), 1::bigint,
  'Un guardado confirmado produce un cambio final de línea');
select is((select count(*) from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000001' and field_name = 'production_order'
    and reason = 'Primera corrección'), 1::bigint,
  'El mismo guardado registra una sola O.P. final');
select is((select count(*) from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000001' and field_name = 'observations'), 2::bigint,
  'Una corrección posterior agrega otro evento sin sobrescribir el anterior');
select ok(exists(
  select 1 from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000001'
    and field_name = 'observations'
    and old_value = '"Primera corrección confirmada"'::jsonb
    and new_value = '"Segunda corrección confirmada"'::jsonb
), 'La corrección nueva conserva la anterior como origen');
select ok(exists(
  select 1 from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000002'
    and field_name = 'observations' and actor_role = 'OPERATOR' and reason is null
), 'La edición normal de un borrador queda auditada con rol OPERATOR (FR-029)');
select throws_ok(
  $$update public.report_audit_log set field_name = 'alterado' where report_id = '84000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'Administrador no puede modificar auditoría directamente'
);
select throws_ok(
  $$delete from public.report_audit_log where report_id = '84000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'Administrador no puede eliminar auditoría directamente'
);

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok((select count(*) from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000001') >= 7,
  'Consulta ve el historial completo del reporte enviado');
select ok((select count(*) from public.report_audit_log
  where report_id = '84000000-0000-0000-0000-000000000002') >= 1,
  'Consulta ve la auditoría de un reporte activo (acceso a todos los estados)');
select is((select count(*)::integer from public.production_reports
  where id = '84000000-0000-0000-0000-000000000002'), 1,
  'Consulta ve también el reporte activo (DRAFT)');

reset role;
select throws_ok(
  $$delete from public.production_reports where id = '84000000-0000-0000-0000-000000000001'$$,
  '23503', null,
  'Un reporte con auditoría no puede borrar su historial por cascada'
);

select * from finish();
rollback;
