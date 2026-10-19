-- T058: el VIEWER (auditor) es de solo lectura (FR-032, SC-007): no puede crear, editar, cancelar, aprobar,
-- corregir ni eliminar nada, ni por ninguna tabla (PostgREST) ni por ninguna RPC expuesta.
begin;
select no_plan();
\set skip_selftest 1
\ir helpers/auth_as.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000501', 'vr-root@usuarios.reporte-produccion.invalid', '{"full_name":"VR Root","username":"vr-root"}'),
  ('10000000-0000-0000-0000-000000000503', 'vr-aud@usuarios.reporte-produccion.invalid', '{"full_name":"VR Auditor","username":"vr-aud"}'),
  ('10000000-0000-0000-0000-000000000504', 'vr-op@usuarios.reporte-produccion.invalid', '{"full_name":"VR Operario","username":"vr-op"}');
update public.profiles set role = 'ROOT', active = true where id = '10000000-0000-0000-0000-000000000501';
update public.profiles set role = 'VIEWER', active = true where id = '10000000-0000-0000-0000-000000000503';
update public.profiles set role = 'OPERATOR', active = true where id = '10000000-0000-0000-0000-000000000504';

insert into public.machines (id, code, name) values ('3f000000-0000-0000-0000-000000000001', 'VR-1', 'VR 1');
insert into public.stop_categories (id, code, name) values ('1f000000-0000-0000-0000-000000000001', '9961', 'VR Parada');
insert into public.change_types (id, code, name) values ('8f000000-0000-0000-0000-000000000001', 'VR-CT', 'VR Cambio');

-- Filas sintéticas en cada estado, para que "0 filas afectadas" sea significativo.
set local session_replication_role = replica;
insert into public.production_reports (id, folio, machine_id, status, created_by, updated_by, creator_full_name, creator_role,
  submitted_by, submitted_at, cancellation_reason, cancelled_at, cancelled_by, approved_by, approved_at, approver_full_name, started_at)
values
  ('8f000000-0000-0000-0000-000000000001', 'RPT-2033-900001', '3f000000-0000-0000-0000-000000000001', 'DRAFT',
    '10000000-0000-0000-0000-000000000504', '10000000-0000-0000-0000-000000000504', 'VR Operario', 'OPERATOR',
    null, null, null, null, null, null, null, null, now()),
  ('8f000000-0000-0000-0000-000000000002', 'RPT-2033-900002', '3f000000-0000-0000-0000-000000000001', 'SUBMITTED',
    '10000000-0000-0000-0000-000000000504', '10000000-0000-0000-0000-000000000504', 'VR Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000504', now(), null, null, null, null, null, null, now()),
  ('8f000000-0000-0000-0000-000000000003', 'RPT-2033-900003', '3f000000-0000-0000-0000-000000000001', 'CLOSED',
    '10000000-0000-0000-0000-000000000504', '10000000-0000-0000-0000-000000000504', 'VR Operario', 'OPERATOR',
    '10000000-0000-0000-0000-000000000504', now(), null, null, null,
    '10000000-0000-0000-0000-000000000501', now(), 'VR Root', now());
insert into public.report_stop_events (report_id, stop_category_id, started_at, responsible_user_id)
values ('8f000000-0000-0000-0000-000000000001', '1f000000-0000-0000-0000-000000000001', now(), '10000000-0000-0000-0000-000000000504');
insert into public.report_change_events (report_id, change_type_id, description, created_by)
values ('8f000000-0000-0000-0000-000000000001', '8f000000-0000-0000-0000-000000000001', 'Cambio VR', '10000000-0000-0000-0000-000000000504');
set local session_replication_role = origin;

-- ---------------------------------------------------------------- Tablas: INSERT / UPDATE / DELETE
create temp table viewer_violations (kind text, detail text);
grant all on viewer_violations to authenticated;

select tests.auth_as('10000000-0000-0000-0000-000000000503');
do $$
declare
  t record;
  v_col text;
  v_rows bigint;
  v_attempted integer := 0;
begin
  for t in
    select c.relname, c.oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') and c.relname <> 'viewer_violations'
    order by c.relname
  loop
    select a.attname into v_col from pg_attribute a
    where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = '' order by a.attnum limit 1;

    -- UPDATE de la primera columna sobre todas las filas visibles.
    begin
      execute format('update public.%I set %I = %I', t.relname, v_col, v_col);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        insert into viewer_violations values ('UPDATE', t.relname || ' (' || v_rows || ' filas)');
      end if;
    exception when others then
      if sqlstate not in ('42501', '55000') then
        insert into viewer_violations values ('UPDATE', t.relname || ' error ' || sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- DELETE de todas las filas visibles.
    begin
      execute format('delete from public.%I', t.relname);
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        insert into viewer_violations values ('DELETE', t.relname || ' (' || v_rows || ' filas)');
      end if;
    exception when others then
      if sqlstate not in ('42501', '55000') then
        insert into viewer_violations values ('DELETE', t.relname || ' error ' || sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- INSERT (las tablas de reportes con trigger BEFORE se prueban explícitamente más abajo): la política WITH CHECK / los privilegios se evalúan antes que NOT NULL/UNIQUE; solo 42501 es válido.
    if t.relname not in ('production_reports', 'report_stop_events', 'report_change_events') then
      begin
        execute format('insert into public.%I default values', t.relname);
        insert into viewer_violations values ('INSERT', t.relname || ' permitió la inserción');
      exception when others then
        if sqlstate not in ('42501', '55000') then
          insert into viewer_violations values ('INSERT', t.relname || ' error ' || sqlstate || ' ' || sqlerrm);
        end if;
      end;
    end if;
    v_attempted := v_attempted + 1;
  end loop;
  insert into viewer_violations values ('INFO', v_attempted::text);
end;
$$;
select tests.auth_reset();

select ok((select detail::integer from viewer_violations where kind = 'INFO') >= 20, 'Se recorrieron todas las tablas y vistas públicas');
select is((select coalesce(string_agg(kind || ': ' || detail, E'\n'), '') from viewer_violations where kind <> 'INFO'), '',
  'El VIEWER no puede insertar, actualizar ni eliminar en ninguna tabla/vista pública');

-- INSERT explícito en las tablas de reportes (tienen triggers BEFORE que impiden el sondeo genérico).
select tests.auth_as('10000000-0000-0000-0000-000000000503');
select throws_ok($$insert into public.production_reports (machine_id, started_at, created_by, updated_by)
  values ('3f000000-0000-0000-0000-000000000001', now(), '10000000-0000-0000-0000-000000000503', '10000000-0000-0000-0000-000000000503')$$,
  null, null, 'VIEWER: no puede crear reportes');
-- (rechazo por trigger de negocio o por RLS: lo relevante es que falle y que no quede ninguna fila)
select throws_ok($$insert into public.report_stop_events (report_id, stop_category_id, started_at, responsible_user_id)
  values ('8f000000-0000-0000-0000-000000000001', '1f000000-0000-0000-0000-000000000001', now(), '10000000-0000-0000-0000-000000000503')$$,
  null, null, 'VIEWER: no puede crear paradas');
select throws_ok($$insert into public.report_change_events (report_id, change_type_id, description, created_by)
  values ('8f000000-0000-0000-0000-000000000001', '8f000000-0000-0000-0000-000000000001', 'x', '10000000-0000-0000-0000-000000000503')$$,
  null, null, 'VIEWER: no puede crear cambios');
select tests.auth_reset();

-- Los datos siguen intactos.
select is((select count(*)::integer from public.production_reports where id::text like '8f000000%'), 3, 'Los reportes siguen intactos');
select is((select status::text from public.production_reports where id = '8f000000-0000-0000-0000-000000000002'), 'SUBMITTED', 'El reporte SUBMITTED no cambió');

-- ---------------------------------------------------------------- RPC expuestas
-- Inventario: toda función pública ejecutable por authenticated debe estar clasificada aquí. Una nueva RPC
-- rompe esta prueba hasta que se clasifique (mutación de reportes/catálogos => debe rechazar al VIEWER).
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'apply_sync_operation,approve_report,cancel_report,correct_report,delete_or_deactivate,indicators_summary,list_notifications,mark_all_notifications_read,mark_notification_read,record_offline_login,report_device_sync_status,review_quarantine,user_last_contact',
  'Inventario de RPC públicas ejecutables por authenticated');

select tests.auth_as('10000000-0000-0000-0000-000000000503');
select throws_ok($$select public.approve_report('8f000000-0000-0000-0000-000000000002')$$, '42501', null, 'VIEWER: approve_report rechazada');
select throws_ok($$select public.cancel_report('8f000000-0000-0000-0000-000000000001', 'Intento del auditor')$$, '42501', null, 'VIEWER: cancel_report (DRAFT) rechazada');
select throws_ok($$select public.cancel_report('8f000000-0000-0000-0000-000000000002', 'Intento del auditor')$$, '42501', null, 'VIEWER: cancel_report (SUBMITTED) rechazada');
select throws_ok($$select public.correct_report('8f000000-0000-0000-0000-000000000002', '{"lot":"X"}'::jsonb, null, null, 'Intento del auditor')$$,
  '42501', null, 'VIEWER: correct_report rechazada');
select throws_ok($$select public.delete_or_deactivate('machines', '3f000000-0000-0000-0000-000000000001')$$, '42501', null, 'VIEWER: delete_or_deactivate rechazada');
select is((select public.apply_sync_operation('{"operationId":"f2000000-0000-0000-0000-000000000001","userId":"10000000-0000-0000-0000-000000000503","type":"CREATE_REPORT","payload":{}}'::jsonb)) ->> 'code', 'FORBIDDEN', 'VIEWER: apply_sync_operation devuelve rejected FORBIDDEN');
select throws_ok($$select public.review_quarantine('00000000-0000-0000-0000-000000000000', false, null)$$, '42501', null, 'VIEWER: review_quarantine rechazada');
select throws_ok($$select public.user_last_contact('10000000-0000-0000-0000-000000000504')$$, '42501', null, 'VIEWER: user_last_contact rechazada');
-- Las RPC restantes solo tocan estado propio del usuario (notificaciones y dispositivo) y nunca reportes/catálogos.
select lives_ok($$select public.mark_all_notifications_read(now())$$, 'VIEWER: marcar sus propias notificaciones es permitido');
select tests.auth_reset();

select is((select count(*)::integer from public.production_reports where id::text like '8f000000%' and status::text = 'SUBMITTED'), 1,
  'Tras los intentos, el reporte SUBMITTED sigue SUBMITTED');
select is((select count(*)::integer from public.production_reports where id::text like '8f000000%' and status::text = 'CANCELLED'), 0,
  'Tras los intentos, ningún reporte quedó CANCELLED');
select is((select count(*)::integer from public.production_reports where id::text like '8f000000%' and status::text = 'CLOSED'), 1,
  'Tras los intentos, ningún reporte fue aprobado por el VIEWER');
select is((select count(*)::integer from public.machines where id = '3f000000-0000-0000-0000-000000000001'), 1, 'La máquina no fue eliminada');
select is((select count(*)::integer from public.clients where name = 'Cliente del auditor'), 0, 'El VIEWER no creó clientes');

select * from finish();
rollback;
