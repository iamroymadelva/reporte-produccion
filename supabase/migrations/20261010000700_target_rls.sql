-- Fase F1 / T017: RLS objetivo (feature 001, data-model.md "Matriz RLS objetivo").
-- - Toda política que comparaba `= 'ADMINISTRATOR'` usa private.is_manager() (ROOT o coordinador).
-- - El auditor (VIEWER) lee reportes, paradas, cambios y auditoría en TODOS los estados.
-- - Los managers pierden el UPDATE directo sobre reportes, paradas y cambios en DRAFT
--   (en SUBMITTED/CLOSED se conserva hasta que exista correct_report, T050).
-- - administrative_audit_log solo lo lee ROOT.

-- ---------------------------------------------------------------------------
-- Catálogos, máquinas y turnos: escritura de managers.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['machines', 'lines', 'clients', 'products', 'dosifier_types', 'stop_categories', 'shifts']
  loop
    execute format('drop policy %I on public.%I', t || '_admin_insert', t);
    execute format('drop policy %I on public.%I', t || '_admin_update', t);
    execute format('drop policy %I on public.%I', t || '_admin_delete', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.is_manager())',
      t || '_manager_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (private.is_manager()) with check (private.is_manager())',
      t || '_manager_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.is_manager())',
      t || '_manager_delete', t);
  end loop;
end;
$$;

-- Asignaciones
drop policy assignments_select on public.operator_machine_assignments;
drop policy assignments_admin_insert on public.operator_machine_assignments;
drop policy assignments_admin_update on public.operator_machine_assignments;
drop policy assignments_admin_delete on public.operator_machine_assignments;
create policy assignments_select on public.operator_machine_assignments
  for select to authenticated
  using (
    private.is_manager()
    or (private.current_user_is_active() and operator_id = (select auth.uid()))
  );
create policy assignments_manager_insert on public.operator_machine_assignments
  for insert to authenticated with check (private.is_manager());
create policy assignments_manager_update on public.operator_machine_assignments
  for update to authenticated
  using (private.is_manager()) with check (private.is_manager());
create policy assignments_manager_delete on public.operator_machine_assignments
  for delete to authenticated using (private.is_manager());

-- Perfiles: ROOT edita a cualquiera; el coordinador solo a operarios (matriz de gestión, FR-028).
drop policy profiles_admin_update on public.profiles;
create policy profiles_manager_update on public.profiles
  for update to authenticated
  using (private.is_root() or (private.is_manager() and role = 'OPERATOR'))
  with check (private.is_root() or (private.is_manager() and role = 'OPERATOR'));

-- ---------------------------------------------------------------------------
-- Reportes
-- ---------------------------------------------------------------------------
drop policy reports_select_by_role on public.production_reports;
create policy reports_select_by_role on public.production_reports
  for select to authenticated
  using (
    private.is_manager()
    or private.current_user_role() = 'VIEWER'
    or (private.current_user_role() = 'OPERATOR' and created_by = (select auth.uid()))
  );

drop policy reports_update_by_role on public.production_reports;
create policy reports_update_by_role on public.production_reports
  for update to authenticated
  using (
    (private.is_manager() and status <> 'DRAFT')
    or (private.current_user_role() = 'OPERATOR' and created_by = (select auth.uid()) and status = 'DRAFT')
  )
  with check (
    (private.is_manager() and status <> 'DRAFT')
    or (
      private.current_user_role() = 'OPERATOR'
      and created_by = (select auth.uid())
      and status in ('DRAFT', 'SUBMITTED', 'CANCELLED')
    )
  );

-- ---------------------------------------------------------------------------
-- Paradas
-- ---------------------------------------------------------------------------
drop policy stops_select_by_report_access on public.report_stop_events;
create policy stops_select_by_report_access on public.report_stop_events
  for select to authenticated
  using (
    exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and (
          private.is_manager()
          or private.current_user_role() = 'VIEWER'
          or (private.current_user_role() = 'OPERATOR' and r.created_by = (select auth.uid()))
        )
    )
  );

drop policy stops_insert_by_role on public.report_stop_events;
create policy stops_insert_by_role on public.report_stop_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and (
          (private.is_manager() and r.status <> 'DRAFT')
          or (
            private.current_user_role() = 'OPERATOR'
            and report_stop_events.responsible_user_id = (select auth.uid())
            and r.created_by = (select auth.uid())
            and r.status = 'DRAFT'
          )
        )
    )
  );

drop policy stops_update_by_role on public.report_stop_events;
create policy stops_update_by_role on public.report_stop_events
  for update to authenticated
  using (
    exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and (
          (private.is_manager() and r.status <> 'DRAFT')
          or (
            private.current_user_role() = 'OPERATOR'
            and report_stop_events.ended_at is null and report_stop_events.cancelled_at is null
            and r.created_by = (select auth.uid())
            and r.status = 'DRAFT'
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.production_reports r
      where r.id = report_stop_events.report_id
        and (
          (private.is_manager() and r.status <> 'DRAFT')
          or (
            private.current_user_role() = 'OPERATOR'
            and report_stop_events.responsible_user_id = (select auth.uid())
            and r.created_by = (select auth.uid())
            and r.status = 'DRAFT'
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------------
drop policy audit_admin_viewer_select on public.report_audit_log;
create policy audit_manager_viewer_select on public.report_audit_log
  for select to authenticated
  using (private.is_manager() or private.current_user_role() = 'VIEWER');

drop policy administrative_audit_admin_select on public.administrative_audit_log;
create policy administrative_audit_root_select on public.administrative_audit_log
  for select to authenticated
  using (private.is_root());

-- Higiene de privilegios heredados por defecto de Supabase.
revoke truncate on all tables in schema public from anon, authenticated;
revoke all on public.shifts from anon;

-- Las tablas de auditoría son inmutables para los clientes: sin INSERT/UPDATE/DELETE.
-- (Las tablas creadas después de la migración inicial heredaron los privilegios por defecto de Supabase.)
revoke all on public.administrative_audit_log from anon;
revoke insert, update, delete, truncate on public.administrative_audit_log from authenticated;
revoke all on public.report_audit_log from anon;
revoke insert, update, delete, truncate on public.report_audit_log from authenticated;
-- El contador de folios solo lo usa el trigger security definer.
revoke all on public.report_folio_counters from anon, authenticated;

-- Los triggers de auditoría vigentes incluyen a ROOT, el estado CLOSED y las columnas nuevas.
-- (audit_report_entity las reemplazará en la Fase 5.)
create or replace function private.audit_report_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role := private.current_user_role();
  old_data jsonb;
  new_data jsonb;
  item record;
begin
  if old.status not in ('SUBMITTED', 'CANCELLED', 'CLOSED')
    or actor_role is null or actor_role not in ('ROOT', 'ADMINISTRATOR') then
    return new;
  end if;

  old_data := to_jsonb(old) - array['updated_at', 'updated_by'];
  new_data := to_jsonb(new) - array['updated_at', 'updated_by'];
  for item in select key, value from jsonb_each(new_data)
  loop
    if old_data -> item.key is distinct from item.value then
      insert into public.report_audit_log (
        report_id, changed_by, field_name, old_value, new_value,
        entity_type, entity_id, action, actor_role
      ) values (
        new.id,
        actor_id,
        item.key,
        private.report_audit_value_snapshot(item.key, old_data -> item.key),
        private.report_audit_value_snapshot(item.key, item.value),
        'report', new.id, case when item.key = 'status' then 'STATUS' else 'UPDATE' end, actor_role
      );
    end if;
  end loop;
  return new;
end;
$$;

create or replace function private.audit_stop_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.app_role := private.current_user_role();
begin
  if actor_id is not null and actor_role in ('ROOT', 'ADMINISTRATOR', 'OPERATOR') then
    insert into public.report_audit_log (
      report_id, changed_by, field_name, old_value, new_value,
      entity_type, entity_id, action, actor_role
    ) values (
      coalesce(new.report_id, old.report_id),
      actor_id,
      'stop_event.' || lower(tg_op),
      case when tg_op = 'INSERT' then null else private.stop_audit_snapshot(old) end,
      case when tg_op = 'DELETE' then null else private.stop_audit_snapshot(new) end,
      'stop', coalesce(new.id, old.id), tg_op, actor_role
    );
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_report_correction() from public;
revoke all on function private.audit_stop_correction() from public;

-- ---------------------------------------------------------------------------
-- Valores frecuentes: el operario ya no puede ejecutarla (la función se elimina en T077).
-- ---------------------------------------------------------------------------
create or replace function public.save_frequent_catalog_value(target_catalog text, entered_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := nullif(btrim(entered_name), '');
  existing_id uuid;
  generated_code text;
begin
  if not private.current_user_is_active() or not private.is_manager() then
    raise exception 'No autorizado para guardar valores frecuentes';
  end if;

  if normalized_name is null then
    raise exception 'El nombre frecuente es obligatorio';
  end if;

  if target_catalog = 'clients' then
    select id into existing_id from public.clients
    where lower(btrim(name)) = lower(normalized_name) limit 1;
    if existing_id is not null then return existing_id; end if;

    generated_code := 'CLI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.clients (code, name, sort_order)
    values (generated_code, normalized_name, (select coalesce(max(sort_order), 0) + 10 from public.clients))
    returning id into existing_id;
    return existing_id;
  elsif target_catalog = 'products' then
    select id into existing_id from public.products
    where lower(btrim(name)) = lower(normalized_name) limit 1;
    if existing_id is not null then return existing_id; end if;

    generated_code := 'PROD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    insert into public.products (code, name, sort_order)
    values (generated_code, normalized_name, (select coalesce(max(sort_order), 0) + 10 from public.products))
    returning id into existing_id;
    return existing_id;
  end if;

  raise exception 'Catálogo frecuente no permitido';
end;
$$;
revoke all on function public.save_frequent_catalog_value(text, text) from public;
grant execute on function public.save_frequent_catalog_value(text, text) to authenticated;
