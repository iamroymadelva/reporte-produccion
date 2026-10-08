-- Persistent notifications are written only by trusted database transitions.
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  type text not null check (type in ('REPORT_SUBMITTED', 'REPORT_CANCELLED', 'REPORT_CORRECTED', 'ASSIGNMENTS_CHANGED', 'STOP_STARTED')),
  resource_type text not null check (resource_type in ('report', 'stop', 'assignment')),
  resource_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  stop_status text check (stop_status in ('OPEN', 'CLOSED', 'CANCELLED')),
  title text not null,
  body text not null,
  href text not null check (left(href, 1) = '/'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (event_id, recipient_id)
);

create index notification_deliveries_recipient_page_idx
  on public.notification_deliveries(recipient_id, created_at desc, id desc);
create index notification_deliveries_unread_idx
  on public.notification_deliveries(recipient_id, created_at desc, id desc) where read_at is null;
create index notification_events_resource_idx on public.notification_events(resource_type, resource_id);

alter table public.notification_events enable row level security;
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_events, public.notification_deliveries from public, anon, authenticated;

create function private.notification_is_visible(p_event_id uuid, p_recipient_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.notification_events e
    join public.profiles p on p.id = p_recipient_id and p.active and p.removed_at is null
    where e.id = p_event_id
      and (
        (e.type = 'ASSIGNMENTS_CHANGED' and e.resource_type = 'assignment'
          and e.resource_id = p.id and p.role = 'OPERATOR')
        or (e.type in ('REPORT_SUBMITTED', 'REPORT_CANCELLED')
          and p.role = 'ADMINISTRATOR' and e.resource_type = 'report' and exists (
          select 1 from public.production_reports r
          where r.id = e.resource_id
        ))
        or (e.type = 'REPORT_CORRECTED'
          and e.resource_type = 'report' and exists (
          select 1 from public.production_reports r where r.id = e.resource_id and r.created_by = p.id
            and (p.role = 'ADMINISTRATOR' or p.role = 'OPERATOR'
              or (p.role = 'VIEWER' and r.status = 'SUBMITTED'))
        ))
        or (e.type = 'STOP_STARTED' and p.role = 'ADMINISTRATOR'
          and e.resource_type = 'stop' and exists (
          select 1 from public.report_stop_events s
          join public.production_reports r on r.id = s.report_id where s.id = e.resource_id
        ))
      )
  );
$$;

create policy notification_delivery_self_read on public.notification_deliveries
  for select to authenticated
  using (recipient_id = (select auth.uid()) and private.notification_is_visible(event_id, recipient_id));

create function private.notify_active_admins(p_event_id uuid, p_actor_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notification_deliveries(event_id, recipient_id)
  select p_event_id, p.id from public.profiles p
  where p.role = 'ADMINISTRATOR' and p.active and p.removed_at is null
    and p.id is distinct from p_actor_id
  on conflict (event_id, recipient_id) do nothing;
$$;

create function private.notify_report_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid;
v_type text;
v_actor uuid := coalesce((select auth.uid()), new.updated_by);
begin
  if old.status = 'DRAFT' and new.status in ('SUBMITTED', 'CANCELLED') then
    v_type := case when new.status = 'SUBMITTED' then 'REPORT_SUBMITTED' else 'REPORT_CANCELLED' end;
    insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
    values ('report:' || new.id || ':' || new.status, v_type, 'report', new.id, v_actor,
      case when new.status = 'SUBMITTED' then 'Reporte enviado' else 'Reporte cancelado' end,
      coalesce(new.folio, 'Reporte') || case when new.status = 'SUBMITTED' then ' fue enviado.' else ' fue cancelado.' end,
      '/reportes/' || new.id)
    on conflict (event_key) do nothing returning id into v_event_id;
    if v_event_id is not null then perform private.notify_active_admins(v_event_id, v_actor); end if;
  elsif old.status in ('SUBMITTED', 'CANCELLED') and v_actor is not null
    and exists (select 1 from public.profiles where id = v_actor and role = 'ADMINISTRATOR' and active)
    and (to_jsonb(old) - array['updated_at','updated_by']) is distinct from
        (to_jsonb(new) - array['updated_at','updated_by']) then
    insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
    values ('correction:' || new.id || ':' || txid_current(), 'REPORT_CORRECTED', 'report', new.id, v_actor,
      'Reporte corregido', 'Un administrador corrigió ' || coalesce(new.folio, 'tu reporte') || '.', '/reportes/' || new.id)
    on conflict (event_key) do update set updated_at = clock_timestamp()
    returning id into v_event_id;
    if new.created_by is distinct from v_actor then
      insert into public.notification_deliveries(event_id, recipient_id)
      select v_event_id, new.created_by
      where exists (select 1 from public.profiles where id = new.created_by and active and removed_at is null)
      on conflict (event_id, recipient_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

create trigger notify_report_change_after_update
  after update on public.production_reports
  for each row execute function private.notify_report_change();

create function private.notify_stop_correction(p_report_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_report public.production_reports%rowtype;
v_event_id uuid;
begin
  if p_actor_id is null or not exists (select 1 from public.profiles
    where id = p_actor_id and role = 'ADMINISTRATOR' and active) then
    return;
  end if;
  select * into v_report from public.production_reports where id = p_report_id;
  if v_report.status not in ('SUBMITTED', 'CANCELLED') then return; end if;
  insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
  values ('correction:' || p_report_id || ':' || txid_current(), 'REPORT_CORRECTED', 'report', p_report_id,
    p_actor_id, 'Reporte corregido', 'Un administrador corrigió ' || coalesce(v_report.folio, 'tu reporte') || '.',
    '/reportes/' || p_report_id)
  on conflict (event_key) do update set updated_at = clock_timestamp()
  returning id into v_event_id;
  if v_report.created_by is distinct from p_actor_id then
    insert into public.notification_deliveries(event_id, recipient_id)
    select v_event_id, v_report.created_by
    where exists (select 1 from public.profiles where id = v_report.created_by and active and removed_at is null)
    on conflict (event_id, recipient_id) do nothing;
  end if;
end;
$$;

create function private.notify_stop_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid;
v_actor uuid := (select auth.uid());
v_report public.production_reports%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.ended_at is null and new.cancelled_at is null then
      select * into v_report from public.production_reports where id = new.report_id;
      insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, stop_status, title, body, href)
      values ('stop:' || new.id, 'STOP_STARTED', 'stop', new.id, v_actor, 'OPEN', 'Parada iniciada',
        'Se inició una parada en ' || coalesce(v_report.folio, 'un reporte') || '.', '/reportes/' || new.report_id)
      on conflict (event_key) do nothing returning id into v_event_id;
      if v_event_id is not null then perform private.notify_active_admins(v_event_id, v_actor); end if;
    end if;
    perform private.notify_stop_correction(new.report_id, v_actor);
  elsif tg_op = 'UPDATE' then
    if old.ended_at is null and old.cancelled_at is null
      and (new.ended_at is not null or new.cancelled_at is not null) then
      update public.notification_events
      set title = case when new.cancelled_at is not null then 'Parada anulada' else 'Parada cerrada' end,
          body = case when new.cancelled_at is not null then 'La parada fue anulada.' else 'La parada fue cerrada.' end,
          stop_status = case when new.cancelled_at is not null then 'CANCELLED' else 'CLOSED' end,
          updated_at = clock_timestamp()
      where event_key = 'stop:' || new.id;
    end if;
    if (to_jsonb(old) - array['updated_at','stop_category_id']) is distinct from
       (to_jsonb(new) - array['updated_at','stop_category_id']) then
      perform private.notify_stop_correction(new.report_id, v_actor);
    end if;
  elsif tg_op = 'DELETE' then
    perform private.notify_stop_correction(old.report_id, v_actor);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger notify_stop_change_after_write
  after insert or update or delete on public.report_stop_events
  for each row execute function private.notify_stop_change();

-- Service-role-only atomic replacement. Comparison happens before any writes.
create function public.replace_operator_assignments(
  p_operator_id uuid, p_machine_ids uuid[], p_actor_id uuid,
  p_profile jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before uuid[];
v_after uuid[];
v_added uuid[];
v_removed uuid[];
v_event_id uuid;
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'ADMINISTRATOR' and active and removed_at is null) then
    raise exception 'Invalid administrator' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = p_operator_id for update;
  if not found then raise exception 'Operator not found'; end if;
  select coalesce(array_agg(machine_id order by machine_id), '{}'::uuid[]) into v_before
  from public.operator_machine_assignments where operator_id = p_operator_id and active;
  select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_after from unnest(coalesce(p_machine_ids, '{}'::uuid[])) x;
  if exists (select 1 from unnest(v_after) x left join public.machines m on m.id = x and m.active where m.id is null) then
    raise exception 'Only active machines may be assigned';
  end if;
  if p_profile is not null then
    update public.profiles set
      full_name = coalesce(p_profile->>'full_name', full_name),
      job_title = case when p_profile ? 'job_title' then p_profile->>'job_title' else job_title end,
      role = coalesce((p_profile->>'role')::public.app_role, role),
      active = coalesce((p_profile->>'active')::boolean, active),
      removed_at = case when p_profile ? 'removed_at' then (p_profile->>'removed_at')::timestamptz else removed_at end,
      removed_by = case when p_profile ? 'removed_by' then (p_profile->>'removed_by')::uuid else removed_by end
    where id = p_operator_id;
  end if;
  update public.operator_machine_assignments set active = false
  where operator_id = p_operator_id and active and machine_id <> all(v_after);
  insert into public.operator_machine_assignments(operator_id, machine_id, active, created_by)
  select p_operator_id, x, true, p_actor_id from unnest(v_after) x
  on conflict (operator_id, machine_id) do update set active = true;
  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_added
  from unnest(v_after) x where x <> all(v_before);
  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_removed
  from unnest(v_before) x where x <> all(v_after);
  if (cardinality(v_added) > 0 or cardinality(v_removed) > 0)
    and exists (select 1 from public.profiles where id = p_operator_id and active and removed_at is null and role = 'OPERATOR') then
    insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
    values ('assignment:' || p_operator_id || ':' || txid_current(), 'ASSIGNMENTS_CHANGED', 'assignment', p_operator_id, p_actor_id,
      'Asignaciones actualizadas',
      'Máquinas añadidas: ' || cardinality(v_added) || '. Máquinas retiradas: ' || cardinality(v_removed) || '.', '/reportes')
    returning id into v_event_id;
    insert into public.notification_deliveries(event_id, recipient_id) values (v_event_id, p_operator_id);
  end if;
  if p_profile->>'audit_action' in ('REACTIVATE_USER', 'REMOVE_USER') then
    insert into public.administrative_audit_log(action, entity_type, entity_id, entity_label, performed_by, details)
    select p_profile->>'audit_action', 'profiles', p_operator_id::text, full_name, p_actor_id,
      jsonb_build_object('added_machine_ids', v_added, 'removed_machine_ids', v_removed)
    from public.profiles where id = p_operator_id;
  end if;
  return jsonb_build_object('added', v_added, 'removed', v_removed);
end;
$$;

revoke all on function public.replace_operator_assignments(uuid,uuid[],uuid,jsonb) from public, anon, authenticated;
grant execute on function public.replace_operator_assignments(uuid,uuid[],uuid,jsonb) to service_role;

create function public.list_notifications(
  p_filter text default 'all', p_snapshot timestamptz default null,
  p_before_created timestamptz default null, p_before_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
v_snapshot timestamptz := coalesce(p_snapshot, clock_timestamp());
v_items jsonb;
v_unread integer;
v_last_created timestamptz;
v_last_id uuid;
v_more boolean;
begin
  if v_user is null or not private.current_user_is_active() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if p_filter not in ('all', 'unread') then raise exception 'Invalid filter'; end if;
  select count(*) into v_unread from public.notification_deliveries d
  where d.recipient_id = v_user and d.read_at is null and d.created_at <= v_snapshot
    and private.notification_is_visible(d.event_id, v_user);
  with page as (
    select d.*, e.type, e.resource_type, e.resource_id, e.actor_id, e.stop_status, e.title, e.body, e.href, e.updated_at
    from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
    where d.recipient_id = v_user and d.created_at <= v_snapshot
      and (p_filter = 'all' or d.read_at is null)
      and (p_before_created is null or (d.created_at, d.id) < (p_before_created, p_before_id))
      and private.notification_is_visible(d.event_id, v_user)
    order by d.created_at desc, d.id desc limit 21
  ), numbered as (select *, row_number() over (order by created_at desc, id desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'type', type, 'resourceType', resource_type, 'resourceId', resource_id,
    'actorId', actor_id, 'stopStatus', stop_status,
    'title', title, 'body', body, 'href', href, 'createdAt', created_at,
    'updatedAt', updated_at, 'readAt', read_at) order by created_at desc, id desc) filter (where rn <= 20), '[]'::jsonb),
    max(created_at) filter (where rn = 20), max(id::text) filter (where rn = 20)::uuid,
    coalesce(bool_or(rn > 20), false)
  into v_items, v_last_created, v_last_id, v_more from numbered;
  return jsonb_build_object('items', v_items, 'unreadCount', v_unread,
    'snapshotAt', v_snapshot,
    'nextCursor', case when v_more then jsonb_build_object('createdAt', v_last_created, 'id', v_last_id) else null end);
end;
$$;

create function public.mark_notification_read(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null or not private.current_user_is_active() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  update public.notification_deliveries d set read_at = clock_timestamp()
  where d.id = p_id and d.recipient_id = v_user and d.read_at is null
    and private.notification_is_visible(d.event_id, v_user);
  return exists (select 1 from public.notification_deliveries d
    where d.id = p_id and d.recipient_id = v_user and private.notification_is_visible(d.event_id, v_user));
end;
$$;

create function public.mark_all_notifications_read(p_before timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
v_count integer;
begin
  if v_user is null or not private.current_user_is_active() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if p_before is null or p_before > clock_timestamp() then raise exception 'Invalid snapshot'; end if;
  update public.notification_deliveries d set read_at = clock_timestamp()
  where d.recipient_id = v_user and d.read_at is null and d.created_at <= p_before
    and private.notification_is_visible(d.event_id, v_user);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.list_notifications(text,timestamptz,timestamptz,uuid),
  public.mark_notification_read(uuid), public.mark_all_notifications_read(timestamptz) from public, anon;
grant execute on function public.list_notifications(text,timestamptz,timestamptz,uuid),
  public.mark_notification_read(uuid), public.mark_all_notifications_read(timestamptz) to authenticated;
revoke all on function private.notification_is_visible(uuid,uuid), private.notify_active_admins(uuid,uuid),
  private.notify_report_change(), private.notify_stop_correction(uuid,uuid), private.notify_stop_change() from public;
