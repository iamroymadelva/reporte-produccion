-- Fase F2 / T060: auditoría completa de reportes, paradas y cambios (feature 001, FR-029, hallazgo O1).
-- Un único trigger genérico (audit_report_entity) registra TODA inserción y modificación, hecha por
-- cualquier rol, en report_audit_log con: actor (changed_by + actor_role), motivo (app.change_reason),
-- indicador de captura sin conexión (app.captured_offline / app.captured_at) y received_at.
-- Reemplaza audit_report_correction y audit_stop_correction (que solo auditaban a los managers).
--
-- Granularidad de las filas:
--   * reporte, INSERT   -> una fila (field_name 'report.insert', new_value = instantánea del reporte).
--   * reporte, UPDATE   -> una fila por cada campo que cambió (action 'STATUS' para status, si no 'UPDATE');
--                          updated_at y updated_by no se auditan; un UPDATE sin cambios no genera filas.
--   * parada / cambio   -> una fila por operación ('stop_event.insert|update', 'change_event.insert|update')
--                          con instantáneas anterior y nueva (compatible con describeAuditRows).
-- Las GUC app.* son locales a la transacción (set_config(..., true)); las RPC las fijan y las restablecen.
-- Sin sesión (service-role / superusuario) la fila se audita con actor_role nulo y changed_by tomado del
-- propio registro (updated_by / responsable / autor), porque changed_by es NOT NULL.

create or replace function private.audit_report_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  v_actor_role public.app_role := private.current_user_role();
  v_reason text := nullif(btrim(coalesce(current_setting('app.change_reason', true), '')), '');
  v_offline boolean := coalesce(nullif(current_setting('app.captured_offline', true), '')::boolean, false);
  v_captured_at timestamptz := nullif(current_setting('app.captured_at', true), '')::timestamptz;
  v_entity text;
  v_report_id uuid;
  v_fallback uuid;
  v_changed_by uuid;
  old_data jsonb;
  new_data jsonb;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  item record;
begin
  if tg_table_name = 'production_reports' then
    v_entity := 'report';
    v_report_id := new.id;
    v_fallback := coalesce(new.updated_by, new.created_by);
  elsif tg_table_name = 'report_stop_events' then
    v_entity := 'stop';
    v_report_id := new.report_id;
    v_fallback := new.responsible_user_id;
  else
    v_entity := 'change';
    v_report_id := new.report_id;
    v_fallback := new.created_by;
  end if;
  v_changed_by := coalesce(actor_id, v_fallback);

  if v_entity = 'report' then
    if tg_op = 'INSERT' then
      insert into public.report_audit_log (
        report_id, changed_by, field_name, old_value, new_value,
        entity_type, entity_id, action, actor_role, reason, captured_offline, captured_at, received_at
      ) values (
        new.id, v_changed_by, 'report.insert', null, to_jsonb(new),
        'report', new.id, 'INSERT', v_actor_role, v_reason, v_offline, v_captured_at, clock_timestamp()
      );
    else
      old_data := to_jsonb(old) - array['updated_at', 'updated_by'];
      new_data := to_jsonb(new) - array['updated_at', 'updated_by'];
      for item in select key, value from jsonb_each(new_data)
      loop
        if old_data -> item.key is distinct from item.value then
          insert into public.report_audit_log (
            report_id, changed_by, field_name, old_value, new_value,
            entity_type, entity_id, action, actor_role, reason, captured_offline, captured_at, received_at
          ) values (
            new.id,
            v_changed_by,
            item.key,
            nullif(private.report_audit_value_snapshot(item.key, old_data -> item.key), 'null'::jsonb),
            nullif(private.report_audit_value_snapshot(item.key, item.value), 'null'::jsonb),
            'report', new.id,
            case when item.key = 'status' then 'STATUS' else 'UPDATE' end,
            v_actor_role, v_reason, v_offline, v_captured_at, clock_timestamp()
          );
        end if;
      end loop;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and
    (to_jsonb(old) - array['updated_at', 'updated_by']) = (to_jsonb(new) - array['updated_at', 'updated_by']) then
    return new;
  end if;

  -- Cada rama se planifica por separado: old/new tienen tipos de fila distintos según la tabla.
  if v_entity = 'stop' then
    if tg_op = 'UPDATE' then v_old_snapshot := private.stop_audit_snapshot(old); end if;
    v_new_snapshot := private.stop_audit_snapshot(new);
  else
    if tg_op = 'UPDATE' then v_old_snapshot := private.change_audit_snapshot(old); end if;
    v_new_snapshot := private.change_audit_snapshot(new);
  end if;

  insert into public.report_audit_log (
    report_id, changed_by, field_name, old_value, new_value,
    entity_type, entity_id, action, actor_role, reason, captured_offline, captured_at, received_at
  ) values (
    v_report_id,
    v_changed_by,
    (case when v_entity = 'stop' then 'stop_event.' else 'change_event.' end) || lower(tg_op),
    v_old_snapshot,
    v_new_snapshot,
    v_entity, new.id, tg_op, v_actor_role, v_reason, v_offline, v_captured_at, clock_timestamp()
  );
  return new;
end;
$$;

create or replace function private.change_audit_snapshot(change_event public.report_change_events)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  type_snapshot jsonb;
begin
  select jsonb_build_object('id', id, 'code', code, 'name', name)
  into type_snapshot
  from public.change_types
  where id = change_event.change_type_id;

  return to_jsonb(change_event) || jsonb_build_object('change_type', type_snapshot);
end;
$$;

revoke all on function private.audit_report_entity() from public;
revoke all on function private.change_audit_snapshot(public.report_change_events) from public;

drop trigger audit_report_correction_after_update on public.production_reports;
drop trigger audit_stop_correction_after_write on public.report_stop_events;
drop function private.audit_report_correction();
drop function private.audit_stop_correction();

create trigger audit_report_entity_after_write
  after insert or update on public.production_reports
  for each row execute function private.audit_report_entity();
create trigger audit_stop_entity_after_write
  after insert or update on public.report_stop_events
  for each row execute function private.audit_report_entity();
create trigger audit_change_entity_after_write
  after insert or update on public.report_change_events
  for each row execute function private.audit_report_entity();
