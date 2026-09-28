-- Audit rows are application-append-only and must survive their parent report.
revoke insert, update, delete on table public.report_audit_log from anon, authenticated;

alter table public.report_audit_log
  drop constraint report_audit_log_report_id_fkey,
  add constraint report_audit_log_report_id_fkey
    foreign key (report_id) references public.production_reports(id) on delete restrict;

drop policy if exists audit_admin_select on public.report_audit_log;
drop policy if exists audit_admin_viewer_select on public.report_audit_log;
create policy audit_admin_viewer_select on public.report_audit_log
  for select to authenticated
  using (
    private.current_user_role() = 'ADMINISTRATOR'
    or (
      private.current_user_role() = 'VIEWER'
      and exists (
        select 1
        from public.production_reports report
        where report.id = report_audit_log.report_id
      )
    )
  );

-- Preserve a human-readable catalog snapshot in future report audit entries.
create function private.report_audit_value_snapshot(field_name text, raw_value jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  target_id uuid;
  display_label text;
begin
  if raw_value is null or jsonb_typeof(raw_value) = 'null'
    or field_name not in ('machine_id', 'line_id', 'client_id', 'product_id', 'shift_id', 'dosifier_type_id') then
    return raw_value;
  end if;

  begin
    target_id := (raw_value #>> '{}')::uuid;
  exception when invalid_text_representation then
    return raw_value;
  end;

  case field_name
    when 'machine_id' then
      select concat_ws(' · ', code, name) into display_label from public.machines where id = target_id;
    when 'line_id' then
      select concat_ws(' · ', code, name) into display_label from public.lines where id = target_id;
    when 'client_id' then
      select concat_ws(' · ', code, name) into display_label from public.clients where id = target_id;
    when 'product_id' then
      select concat_ws(' · ', code, name) into display_label from public.products where id = target_id;
    when 'shift_id' then
      select concat_ws(
        ' · ',
        nullif(name, ''),
        to_char(start_time, 'HH24:MI') || ' - ' || to_char(end_time, 'HH24:MI')
      ) into display_label
      from public.shifts where id = target_id;
    when 'dosifier_type_id' then
      select concat_ws(' · ', code, name) into display_label from public.dosifier_types where id = target_id;
  end case;

  return jsonb_build_object('id', target_id, 'label', coalesce(display_label, target_id::text));
end;
$$;

create or replace function private.audit_report_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  old_data jsonb;
  new_data jsonb;
  item record;
begin
  -- This records only updates already authorized by the existing report policies/API.
  if private.current_user_role() <> 'ADMINISTRATOR' then
    return new;
  end if;

  old_data := to_jsonb(old) - array['updated_at', 'updated_by'];
  new_data := to_jsonb(new) - array['updated_at', 'updated_by'];
  for item in select key, value from jsonb_each(new_data)
  loop
    if old_data -> item.key is distinct from item.value then
      insert into public.report_audit_log (report_id, changed_by, field_name, old_value, new_value)
      values (
        new.id,
        actor_id,
        item.key,
        private.report_audit_value_snapshot(item.key, old_data -> item.key),
        private.report_audit_value_snapshot(item.key, item.value)
      );
    end if;
  end loop;
  return new;
end;
$$;

create function private.stop_audit_snapshot(stop_event public.report_stop_events)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  category_snapshot jsonb;
begin
  select jsonb_build_object('id', id, 'code', code, 'name', name)
  into category_snapshot
  from public.stop_categories
  where id = stop_event.stop_category_id;

  return to_jsonb(stop_event) || jsonb_build_object('stop_category', category_snapshot);
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
begin
  if actor_id is not null and private.current_user_role() in ('ADMINISTRATOR', 'OPERATOR') then
    insert into public.report_audit_log (report_id, changed_by, field_name, old_value, new_value)
    values (
      coalesce(new.report_id, old.report_id),
      actor_id,
      'stop_event.' || lower(tg_op),
      case when tg_op = 'INSERT' then null else private.stop_audit_snapshot(old) end,
      case when tg_op = 'DELETE' then null else private.stop_audit_snapshot(new) end
    );
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.report_audit_value_snapshot(text, jsonb) from public;
revoke all on function private.stop_audit_snapshot(public.report_stop_events) from public;
revoke all on function private.audit_report_correction() from public;
revoke all on function private.audit_stop_correction() from public;
