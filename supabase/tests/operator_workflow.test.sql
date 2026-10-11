begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000105', 'workflow-owner@local.test', '{"full_name":"Operario flujo"}'),
  ('10000000-0000-0000-0000-000000000106', 'workflow-other@local.test', '{"full_name":"Otro operario"}');
update public.profiles set active = true where id in (
  '10000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000106'
);
insert into public.machines (id, code, name) values
  ('33000000-0000-0000-0000-000000000001', 'WF-1', 'Máquina flujo 1'),
  ('33000000-0000-0000-0000-000000000002', 'WF-2', 'Máquina flujo 2');
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from)
select a.operator_id, a.machine_id, s.id, '2000-01-01'
from (values
  ('10000000-0000-0000-0000-000000000105'::uuid, '33000000-0000-0000-0000-000000000001'::uuid),
  ('10000000-0000-0000-0000-000000000106'::uuid, '33000000-0000-0000-0000-000000000002'::uuid)
) a(operator_id, machine_id) cross join public.shifts s where s.active;

-- Hora del dispositivo enviada al iniciar la primera parada (se crea antes de cambiar de rol).
create temporary table workflow_sent_start as select clock_timestamp() - interval '2 seconds' as sent_at;
grant select on workflow_sent_start to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000105","role":"authenticated"}';
insert into public.production_reports (id, machine_id, started_at, created_by, updated_by) values (
  '83000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', now(),
  '10000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000105'
);
select lives_ok($$update public.production_reports set lot = 'Borrador parcial'
  where id = '83000000-0000-0000-0000-000000000001'$$, 'Los borradores parciales siguen admitiendo autosave');
update public.production_reports set production_order = 'OP-1',
  line_id = (select id from public.lines limit 1), product_name = 'Producto libre', client_name = 'Cliente libre',
  dosifier_type_id = (select id from public.dosifier_types limit 1),
  weight = 0, g_min = 0, started_at = now() - interval '1 hour', ended_at = now(),
  programmed_hours = 0, units_produced = 0, waste = 0
where id = '83000000-0000-0000-0000-000000000001';

select throws_ok(format('update public.production_reports set %I = null, status = ''SUBMITTED'' where id = ''83000000-0000-0000-0000-000000000001''', field),
  'P0001', label || ' es obligatorio.', 'El envío exige ' || label)
from (values ('report_date','Fecha'), ('product_name','Producto'), ('production_order','O.P.'), ('line_id','Área / Línea'),
  ('client_name','Cliente'), ('lot','Lote'), ('shift_id','Turno'), ('weight','Peso (gr)'), ('g_min','G/min'),
  ('dosifier_type_id','Tipo de dosificador'), ('started_at','Hora inicio'), ('ended_at','Hora finalización'),
  ('programmed_hours','Horas programadas'), ('units_produced','Unidades producidas'), ('waste','Desperdicio')) as required(field, label);
select throws_ok($$update public.production_reports set lot = E' \t\n ', status = 'SUBMITTED'
  where id = '83000000-0000-0000-0000-000000000001'$$, 'P0001', 'Lote es obligatorio.', 'Solo espacios no completan un campo');
select throws_ok($$update public.production_reports set weight = 'NaN', status = 'SUBMITTED'
  where id = '83000000-0000-0000-0000-000000000001'$$, 'P0001', 'Peso (gr) debe ser un número finito.', 'NaN no es producción válida');
select throws_ok($$update public.production_reports set machine_id = '33000000-0000-0000-0000-000000000002'
  where id = '83000000-0000-0000-0000-000000000001'$$, 'P0001', 'La máquina del reporte solo puede corregirla un Administrador', 'El Operario no puede cambiar máquina');

insert into public.report_stop_events (id, report_id, stop_category_id, responsible_user_id, started_at, duration_seconds)
select '93000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', id,
  '10000000-0000-0000-0000-000000000105', (select sent_at from workflow_sent_start), 999999 from public.stop_categories where code = '8';
select ok((select started_at = (select sent_at from workflow_sent_start) and duration_seconds is null
  from public.report_stop_events where id = '93000000-0000-0000-0000-000000000001'),
  'El servidor conserva la hora del dispositivo y controla la duración');
create temporary table workflow_original as select started_at, updated_at from public.report_stop_events
where id = '93000000-0000-0000-0000-000000000001';
create temporary table workflow_report_version as select updated_at from public.production_reports
where id = '83000000-0000-0000-0000-000000000001';

select throws_ok($$insert into public.report_stop_events (report_id, stop_category_id, responsible_user_id)
  select '83000000-0000-0000-0000-000000000001', id, '10000000-0000-0000-0000-000000000105'
  from public.stop_categories where code = '4'$$, '23505', null, 'Solo una parada activa');
select throws_ok($$update public.production_reports set status = 'SUBMITTED'
  where id = '83000000-0000-0000-0000-000000000001'$$, 'P0001',
  'No puedes enviar el reporte mientras haya una parada activa. Detén o cancela la parada primero.', 'Parada activa bloquea envío');
select lives_ok($$update public.report_stop_events set stop_category_id = (select id from public.stop_categories where code = '4')
  where id = '93000000-0000-0000-0000-000000000001'$$, 'Puede cambiar categoría activa');
select is((select started_at from public.report_stop_events where id = '93000000-0000-0000-0000-000000000001'),
  (select started_at from workflow_original), 'Cambiar categoría conserva inicio');
select throws_ok($$update public.report_stop_events set started_at = '2000-01-01'
  where id = '93000000-0000-0000-0000-000000000001'$$, 'P0001',
  'Solo puedes cambiar la categoría, detener o cancelar una parada activa', 'No puede falsificar inicio');
select throws_ok($$update public.report_stop_events set duration_seconds = 900
  where id = '93000000-0000-0000-0000-000000000001'$$, 'P0001',
  'Solo puedes cambiar la categoría, detener o cancelar una parada activa', 'No puede falsificar duración');
select throws_ok($$update public.report_stop_events set cancellation_reason = E' \t\n '
  where id = '93000000-0000-0000-0000-000000000001'$$, 'P0001',
  'Debes indicar el motivo de cancelación de la parada', 'Cancelar exige motivo no vacío');
select lives_ok($$update public.report_stop_events set cancellation_reason = '  Iniciada por error  '
  where id = '93000000-0000-0000-0000-000000000001'$$, 'Puede cancelar parada activa');
select ok((select cancelled_at is not null and ended_at = cancelled_at and duration_seconds is null
  and cancelled_by = '10000000-0000-0000-0000-000000000105' and cancellation_reason = 'Iniciada por error'
  from public.report_stop_events where id = '93000000-0000-0000-0000-000000000001'), 'Cancelación conserva motivo y actor, sin duración válida');
select is((select updated_at from public.production_reports where id = '83000000-0000-0000-0000-000000000001'),
  (select updated_at from workflow_report_version), 'Operaciones de parada no invalidan versión del borrador offline');
select is((select total_downtime_seconds from public.production_report_metrics where id = '83000000-0000-0000-0000-000000000001'),
  0::bigint, 'Cancelada no aporta a métricas');
select results_eq($$with changed as (update public.report_stop_events set cancellation_reason = 'Reescrita'
  where id = '93000000-0000-0000-0000-000000000001' returning id) select count(*) from changed$$, array[0::bigint], 'No puede reescribir cancelada');
select throws_ok($$delete from public.report_stop_events where id = '93000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'No puede borrar cancelada (DELETE revocado)');

insert into public.report_stop_events (id, report_id, stop_category_id, responsible_user_id, started_at)
select '93000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000001', id,
  '10000000-0000-0000-0000-000000000105', clock_timestamp() from public.stop_categories where code = '8';
update public.report_stop_events set stop_category_id = (select id from public.stop_categories where code = '4')
where id = '93000000-0000-0000-0000-000000000002';
select lives_ok($$update public.report_stop_events set ended_at = '2099-01-01'
  where id = '93000000-0000-0000-0000-000000000002'$$, 'Puede detener normalmente');
select ok((select ended_at = '2099-01-01'::timestamptz and duration_seconds = floor(extract(epoch from ended_at - started_at))
  and stop_category_id = (select id from public.stop_categories where code = '4')
  from public.report_stop_events where id = '93000000-0000-0000-0000-000000000002'), 'Cierre conserva la hora del dispositivo y la categoría final');

select results_eq($$with changed as (update public.report_stop_events set stop_category_id = (select id from public.stop_categories where code = '8')
  where id = '93000000-0000-0000-0000-000000000002' returning id) select count(*) from changed$$, array[0::bigint], 'No cambia categoría cerrada');
select results_eq($$with changed as (update public.report_stop_events set started_at = '2000-01-01'
  where id = '93000000-0000-0000-0000-000000000002' returning id) select count(*) from changed$$, array[0::bigint], 'No cambia hora cerrada');
select results_eq($$with changed as (update public.report_stop_events set ended_at = null
  where id = '93000000-0000-0000-0000-000000000002' returning id) select count(*) from changed$$, array[0::bigint], 'No reabre cerrada');
select results_eq($$with changed as (update public.report_stop_events set cancellation_reason = 'Intento'
  where id = '93000000-0000-0000-0000-000000000002' returning id) select count(*) from changed$$, array[0::bigint], 'No cancela cerrada');
select throws_ok($$delete from public.report_stop_events where id = '93000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'No borra cerrada (DELETE revocado)');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000106","role":"authenticated"}';
insert into public.production_reports (id, machine_id, started_at, created_by, updated_by) values (
  '83000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000002', now(),
  '10000000-0000-0000-0000-000000000106', '10000000-0000-0000-0000-000000000106'
);
insert into public.report_stop_events (id, report_id, stop_category_id, responsible_user_id)
select '93000000-0000-0000-0000-000000000003', '83000000-0000-0000-0000-000000000002', id,
  '10000000-0000-0000-0000-000000000106' from public.stop_categories where code = '8';
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000105","role":"authenticated"}';
select results_eq($$with changed as (update public.report_stop_events set cancellation_reason = 'Intento ajeno'
  where id = '93000000-0000-0000-0000-000000000003' returning id) select count(*) from changed$$, array[0::bigint], 'No cancela parada ajena');
select results_eq($$with changed as (update public.report_stop_events set ended_at = now()
  where id = '93000000-0000-0000-0000-000000000003' returning id) select count(*) from changed$$, array[0::bigint], 'No cierra parada ajena');
select throws_ok($$insert into public.report_stop_events (report_id, stop_category_id, responsible_user_id)
  select '83000000-0000-0000-0000-000000000002', id, '10000000-0000-0000-0000-000000000105'
  from public.stop_categories where code = '8'$$, 'P0001', 'Solo puedes modificar paradas de tus reportes en borrador', 'No inicia parada en reporte ajeno');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok((select count(*) >= 5 from public.report_audit_log where report_id = '83000000-0000-0000-0000-000000000001'
  and field_name like 'stop_event.%'), 'Cambios de parada auditados');
select ok(exists(select 1 from public.report_audit_log where report_id = '83000000-0000-0000-0000-000000000001'
  and new_value ->> 'cancellation_reason' = 'Iniciada por error'
  and changed_by = '10000000-0000-0000-0000-000000000105'), 'Auditoría conserva razón y actor');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000105","role":"authenticated"}';
select lives_ok($$update public.production_reports set status = 'SUBMITTED'
  where id = '83000000-0000-0000-0000-000000000001'$$, 'Ceros válidos y Observaciones vacías permiten envío');

-- Con el reporte enviado, el coordinador corrige paradas solo vía correct_report (T050: sin escritura directa).
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($q$select public.correct_report('83000000-0000-0000-0000-000000000001', '{}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('id', '93000000-0000-0000-0000-000000000002',
      'started_at', now() - interval '20 minutes', 'ended_at', now() - interval '19 minutes'),
    jsonb_build_object('stop_category_id', (select id from public.stop_categories where code = '8'),
      'started_at', now() - interval '18 minutes', 'ended_at', now() - interval '16 minutes'),
    jsonb_build_object('stop_category_id', (select id from public.stop_categories where code = '19'),
      'started_at', now() - interval '15 minutes', 'ended_at', now() - interval '12 minutes')),
  null, 'Corrección de paradas')$q$, 'Administrador corrige paradas cerradas e inserta nuevas vía correct_report');
select is((select total_downtime_seconds from public.production_report_metrics where id = '83000000-0000-0000-0000-000000000001'),
  360::bigint, 'Métricas suman todas las categorías válidas, incluida OTROS');
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000105","role":"authenticated"}';

select is((select count(*) from public.production_reports where id = '83000000-0000-0000-0000-000000000001'), 1::bigint, 'Operario mantiene lectura del enviado');
select results_eq($$with changed as (update public.production_reports set status = 'CANCELLED', cancellation_reason = 'Intento'
  where id = '83000000-0000-0000-0000-000000000001' returning id) select count(*) from changed$$, array[0::bigint], 'No cancela reporte enviado');
select results_eq($$with changed as (update public.production_reports set lot = 'Intento'
  where id = '83000000-0000-0000-0000-000000000001' returning id) select count(*) from changed$$, array[0::bigint], 'No edita reporte enviado');
select throws_ok($$insert into public.report_stop_events (report_id, stop_category_id, responsible_user_id)
  select '83000000-0000-0000-0000-000000000001', id, '10000000-0000-0000-0000-000000000105'
  from public.stop_categories where code = '8'$$, 'P0001', 'Solo puedes modificar paradas de tus reportes en borrador', 'No inicia parada en enviado');
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.production_reports where id = '83000000-0000-0000-0000-000000000001'), 1::bigint, 'Consulta mantiene acceso');
select results_eq($$with changed as (update public.report_stop_events set description = 'Intento'
  where id = '93000000-0000-0000-0000-000000000002' returning id) select count(*) from changed$$, array[0::bigint], 'Consulta no muta paradas');
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq($$with changed as (update public.production_reports set observations = 'Corrección administrativa'
  where id = '83000000-0000-0000-0000-000000000001' returning id) select count(*) from changed$$, array[0::bigint],
  'La escritura directa del administrador sobre un reporte enviado se deniega (0 filas); corrige vía correct_report');
select results_eq($$with changed as (update public.report_stop_events set description = 'Corrección administrativa'
  where id = '93000000-0000-0000-0000-000000000002' returning id) select count(*) from changed$$, array[0::bigint],
  'La escritura directa del administrador sobre una parada de un reporte enviado se deniega (0 filas)');

select * from finish();
rollback;
