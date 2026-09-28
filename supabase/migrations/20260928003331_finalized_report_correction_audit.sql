-- Draft field edits are operational work, not administrative corrections.
-- Stop-event auditing remains handled independently by audit_stop_correction().
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
  if old.status not in ('SUBMITTED', 'CANCELLED')
    or private.current_user_role() <> 'ADMINISTRATOR' then
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

revoke all on function private.audit_report_correction() from public;
