-- Limpieza de los datos de demostracion del tablero de Indicadores (002-indicators-dashboard), pensada para correr A MANO
-- en el SQL Editor de Supabase en la NUBE (rol postgres). Es la contraparte de scripts/seed-demo-indicators.sql.
--
-- USO
--   1. Pega el script completo en el SQL Editor y ejecutalo TAL CUAL: modo seguro (do_delete = false), no borra nada.
--      Devuelve una tabla "concepto / antes / despues" con lo que existe hoy (y lo que se borraria).
--   2. Revisa el conteo. Para borrar, cambia SOLO `do_delete boolean := false` por `true` en el bloque DO y vuelve a ejecutar.
--      Con true, todo ocurre en una sola transaccion (begin/commit); si algo falla, no se borra nada.
--   Prueba local: docker exec -i supabase_db_reporte-produccion psql -U postgres -v ON_ERROR_STOP=1 < scripts/cleanup-demo-indicators.sql
--
-- QUE BORRA (solo con do_delete = true)
--   - Reportes con production_order like 'DEMO-%' (la misma marca del seed) y todo lo que depende de ellos:
--       report_stop_events (FK cascade, se borran antes de forma explicita), report_audit_log, report_change_events,
--       sync_quarantine (FK ON DELETE RESTRICT: hay que borrarlas antes que el reporte) y notification_events del reporte
--       y de sus paradas (notification_deliveries cae por cascade).
--   - Categorias de parada demo (code ~ '^D[0-9]+$' y name = 'Demo categoria N') SOLO si ninguna otra parada las referencia
--     (FK ON DELETE RESTRICT hacia report_stop_events). Las que sigan en uso se conservan y se informan.
--   - NO toca administrative_audit_log (historial administrativo): borrar una categoria demo agrega alli su fila de auditoria.
--
-- TRIGGERS (revisados en supabase/migrations)
--   - production_reports: ningun trigger se dispara en DELETE (solo INSERT/UPDATE). No se necesita desactivar nada.
--   - report_stop_events: notify_stop_change_after_write se dispara en DELETE, pero notify_stop_correction sale sin hacer nada
--     cuando no hay usuario autenticado (auth.uid() es null en el SQL Editor), asi que no crea notificaciones.
--   - stop_categories: stop_categories_admin_audit registra la baja en administrative_audit_log (actor null); es deseable y no bloquea.
--   - report_audit_log / report_change_events / sync_quarantine: sin triggers de borrado; solo se les revocó DELETE a anon/authenticated,
--     el rol postgres del editor si puede borrar.
--   Por eso NO se usa session_replication_role = replica ni `alter table ... disable trigger`. Si una migracion futura agrega un
--   trigger que bloquee el DELETE, el script fallara y revertira la transaccion completa (no deja datos a medias).
--
-- GUARDAS: aborta si hay mas de 2000 reportes DEMO-% o alguno con un status fuera de DRAFT/SUBMITTED/CLOSED/CANCELLED.
-- NO contiene credenciales. NUNCA borra filas sin la marca DEMO-%.
begin;

create temporary table limpieza_resumen (
  orden int primary key,
  concepto text not null,
  antes bigint,
  despues bigint
) on commit drop;

-- Reportes y paradas demo identificados una sola vez (antes de cualquier borrado).
create temporary table demo_reportes on commit drop as
select id, status::text as status from public.production_reports where production_order like 'DEMO-%';

create temporary table demo_paradas on commit drop as
select id from public.report_stop_events where report_id in (select id from demo_reportes);

create temporary table demo_categorias on commit drop as
select id, code from public.stop_categories where code ~ '^D[0-9]+$' and name = 'Demo categoria ' || substr(code, 2);

do $$
declare
  do_delete boolean := false;  -- <<< CAMBIAR A true PARA BORRAR (por defecto solo cuenta)
  max_reportes constant int := 2000;
  v_n bigint;
  v_en_uso bigint;
begin
  -- Guardas de seguridad.
  select count(*) into v_n from demo_reportes;
  if v_n > max_reportes then
    raise exception 'Hay % reportes DEMO-%% (umbral %): no parece la siembra de demostracion, se aborta.', v_n, max_reportes;
  end if;
  if exists (select 1 from demo_reportes where status not in ('DRAFT', 'SUBMITTED', 'CLOSED', 'CANCELLED')) then
    raise exception 'Hay reportes DEMO-%% con un status inesperado: se aborta.';
  end if;

  -- Conteo "antes".
  insert into limpieza_resumen(orden, concepto, antes)
  select 10 + v.o, 'reportes DEMO-% en ' || v.s, (select count(*) from demo_reportes r where r.status = v.s)
  from (values (1, 'DRAFT'), (2, 'SUBMITTED'), (3, 'CLOSED'), (4, 'CANCELLED')) v(o, s);

  insert into limpieza_resumen(orden, concepto, antes) values
    (20, 'reportes DEMO-% (total)', (select count(*) from demo_reportes)),
    (21, 'paradas de reportes DEMO-%', (select count(*) from demo_paradas)),
    (22, 'report_audit_log de reportes DEMO-%', (select count(*) from public.report_audit_log where report_id in (select id from demo_reportes))),
    (23, 'report_change_events de reportes DEMO-%', (select count(*) from public.report_change_events where report_id in (select id from demo_reportes))),
    (24, 'sync_quarantine de reportes DEMO-%', (select count(*) from public.sync_quarantine where report_id in (select id from demo_reportes))),
    (25, 'notification_events de reportes/paradas DEMO-%', (select count(*) from public.notification_events
        where (resource_type = 'report' and resource_id in (select id from demo_reportes))
           or (resource_type = 'stop' and resource_id in (select id from demo_paradas)))),
    (26, 'categorias demo (D<n> / Demo categoria <n>)', (select count(*) from demo_categorias)),
    (27, 'categorias demo borrables (sin otras referencias)', (select count(*) from demo_categorias c
        where not exists (select 1 from public.report_stop_events e
                          where e.stop_category_id = c.id and e.id not in (select id from demo_paradas))));

  if not do_delete then
    raise notice 'MODO SEGURO (do_delete = false): solo conteo, no se borro nada. Cambia do_delete a true para borrar.';
    update limpieza_resumen set despues = antes;
    return;
  end if;

  -- Borrado: dependientes primero, luego paradas, reportes y categorias sin uso.
  delete from public.notification_events
  where (resource_type = 'report' and resource_id in (select id from demo_reportes))
     or (resource_type = 'stop' and resource_id in (select id from demo_paradas));
  delete from public.report_audit_log where report_id in (select id from demo_reportes);
  delete from public.report_change_events where report_id in (select id from demo_reportes);
  delete from public.sync_quarantine where report_id in (select id from demo_reportes);
  delete from public.report_stop_events where report_id in (select id from demo_reportes);
  delete from public.production_reports where id in (select id from demo_reportes) and production_order like 'DEMO-%';

  delete from public.stop_categories sc
  where sc.id in (select id from demo_categorias)
    and not exists (select 1 from public.report_stop_events e where e.stop_category_id = sc.id);
  select count(*) into v_en_uso from demo_categorias c where exists (select 1 from public.stop_categories sc where sc.id = c.id);
  if v_en_uso > 0 then
    raise notice '% categoria(s) demo se conservaron porque otras filas las referencian.', v_en_uso;
  end if;

  -- Conteo "despues".
  update limpieza_resumen set despues = case orden
    when 20 then (select count(*) from public.production_reports where production_order like 'DEMO-%')
    when 21 then (select count(*) from public.report_stop_events where id in (select id from demo_paradas))
    when 22 then (select count(*) from public.report_audit_log where report_id in (select id from demo_reportes))
    when 23 then (select count(*) from public.report_change_events where report_id in (select id from demo_reportes))
    when 24 then (select count(*) from public.sync_quarantine where report_id in (select id from demo_reportes))
    when 25 then (select count(*) from public.notification_events
        where (resource_type = 'report' and resource_id in (select id from demo_reportes))
           or (resource_type = 'stop' and resource_id in (select id from demo_paradas)))
    when 26 then (select count(*) from public.stop_categories where id in (select id from demo_categorias))
    when 27 then 0
    else (select count(*) from public.production_reports r
          where r.production_order like 'DEMO-%' and 'reportes DEMO-% en ' || r.status::text = concepto)
    end;
  raise notice 'BORRADO ejecutado. Reportes DEMO-%% restantes: %', (select despues from limpieza_resumen where orden = 20);
end $$;

-- Resultado (unica fila por concepto). En modo seguro "despues" = "antes".
select concepto, antes, despues from limpieza_resumen order by orden;

commit;
