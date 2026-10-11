-- Fase F1 / T109: nuevos tipos de aviso y visibilidad para managers (ROOT y coordinador).
alter table public.notification_events drop constraint notification_events_type_check;
alter table public.notification_events
  add constraint notification_events_type_check check (type in (
    'REPORT_SUBMITTED', 'REPORT_CANCELLED', 'REPORT_CORRECTED', 'ASSIGNMENTS_CHANGED', 'STOP_STARTED',
    'REPORT_APPROVED', 'SYNC_CONFLICT', 'OFFLINE_DATA_REVIEW', 'CLOCK_SKEW_REVIEW'
  ));

create or replace function private.notification_is_visible(p_event_id uuid, p_recipient_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.notification_events e
    join public.profiles p on p.id = p_recipient_id and p.active and p.removed_at is null
    where e.id = p_event_id
      and (
        (e.type = 'ASSIGNMENTS_CHANGED' and e.resource_type = 'assignment'
          and e.resource_id = p.id and p.role = 'OPERATOR')
        or (e.type in ('REPORT_SUBMITTED', 'REPORT_CANCELLED')
          and p.role in ('ROOT', 'ADMINISTRATOR') and e.resource_type = 'report' and exists (
          select 1 from public.production_reports r
          where r.id = e.resource_id
        ))
        or (e.type = 'REPORT_CORRECTED'
          and e.resource_type = 'report' and exists (
          select 1 from public.production_reports r where r.id = e.resource_id and r.created_by = p.id
            and (p.role in ('ROOT', 'ADMINISTRATOR') or p.role = 'OPERATOR'
              or (p.role = 'VIEWER' and r.status = 'SUBMITTED'))
        ))
        or (e.type = 'STOP_STARTED' and p.role in ('ROOT', 'ADMINISTRATOR')
          and e.resource_type = 'stop' and exists (
          select 1 from public.report_stop_events s
          join public.production_reports r on r.id = s.report_id where s.id = e.resource_id
        ))
        or (e.type in ('SYNC_CONFLICT', 'OFFLINE_DATA_REVIEW', 'CLOCK_SKEW_REVIEW')
          and p.role in ('ROOT', 'ADMINISTRATOR'))
        or (e.type = 'REPORT_APPROVED' and e.resource_type = 'report' and (
          p.role in ('ROOT', 'ADMINISTRATOR')
          or exists (select 1 from public.production_reports r where r.id = e.resource_id and r.created_by = p.id)
        ))
      )
  );
$$;

create or replace function private.notify_active_admins(p_event_id uuid, p_actor_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notification_deliveries(event_id, recipient_id)
  select p_event_id, p.id from public.profiles p
  where p.role in ('ROOT', 'ADMINISTRATOR') and p.active and p.removed_at is null
    and p.id is distinct from p_actor_id
  on conflict (event_id, recipient_id) do nothing;
$$;

create or replace function private.notify_report_change()
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
  elsif old.status in ('SUBMITTED', 'CANCELLED', 'CLOSED') and v_actor is not null
    and exists (select 1 from public.profiles where id = v_actor and role in ('ROOT', 'ADMINISTRATOR') and active)
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

create or replace function private.notify_stop_correction(p_report_id uuid, p_actor_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_report public.production_reports%rowtype;
v_event_id uuid;
begin
  if p_actor_id is null or not exists (select 1 from public.profiles
    where id = p_actor_id and role in ('ROOT', 'ADMINISTRATOR') and active) then
    return;
  end if;
  select * into v_report from public.production_reports where id = p_report_id;
  if v_report.status not in ('SUBMITTED', 'CANCELLED', 'CLOSED') then return; end if;
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

revoke all on function private.notification_is_visible(uuid,uuid), private.notify_active_admins(uuid,uuid),
  private.notify_report_change(), private.notify_stop_correction(uuid,uuid) from public;
