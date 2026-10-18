-- «Reloj desfasado» es un diagnóstico solo para el administrador raíz (ROOT).
-- - La notificación CLOCK_SKEW_REVIEW solo se entrega y solo es visible para ROOT (no para el coordinador).
-- - El indicador agregado has_pending_review de production_report_overview solo cuenta clock_skew_review para ROOT.
-- No cambia la medición de desfase ni las reglas de aprobación: approve_report nunca bloqueó por clock_skew_review
-- (solo por sync_quarantine OPEN y paradas inválidas).

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
        or (e.type in ('SYNC_CONFLICT', 'OFFLINE_DATA_REVIEW')
          and p.role in ('ROOT', 'ADMINISTRATOR'))
        or (e.type = 'CLOCK_SKEW_REVIEW' and p.role = 'ROOT')
        or (e.type = 'REPORT_APPROVED' and e.resource_type = 'report' and (
          p.role in ('ROOT', 'ADMINISTRATOR')
          or exists (select 1 from public.production_reports r where r.id = e.resource_id and r.created_by = p.id)
        ))
      )
  );
$$;

create or replace function private.notify_active_roots(p_event_id uuid, p_actor_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notification_deliveries(event_id, recipient_id)
  select p_event_id, p.id from public.profiles p
  where p.role = 'ROOT' and p.active and p.removed_at is null
    and p.id is distinct from p_actor_id
  on conflict (event_id, recipient_id) do nothing;
$$;

create or replace function private.sync_notify(p_type text, p_key text, p_report_id uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event_id uuid;
begin
  insert into public.notification_events(event_key, type, resource_type, resource_id, actor_id, title, body, href)
  values (p_key, p_type, 'report', p_report_id, (select auth.uid()), p_title, p_body, '/reportes/' || p_report_id)
  on conflict (event_key) do nothing returning id into v_event_id;
  if v_event_id is not null then
    if p_type = 'CLOCK_SKEW_REVIEW' then
      perform private.notify_active_roots(v_event_id, null);
    else
      perform private.notify_active_admins(v_event_id, null);
    end if;
  end if;
end;
$$;

revoke all on function private.notification_is_visible(uuid, uuid), private.notify_active_roots(uuid, uuid),
  private.sync_notify(text, text, uuid, text, text) from public;

-- Entregas históricas de CLOCK_SKEW_REVIEW a no-ROOT: ya no son visibles (notification_is_visible); se retiran.
delete from public.notification_deliveries d
using public.notification_events e, public.profiles p
where e.id = d.event_id and e.type = 'CLOCK_SKEW_REVIEW'
  and p.id = d.recipient_id and p.role is distinct from 'ROOT';

create or replace view public.production_report_overview
with (security_invoker = true)
as
select
  r.*,
  coalesce(
    r.status = 'DRAFT'
    and case
      when r.shift_id is null then
        coalesce(r.started_at, r.created_at) + interval '12 hours' + cfg.off_shift_grace < now()
      else
        sh.id is not null
        and now() > (((r.report_date + case when sh.start_time < sh.end_time then 0 else 1 end) + sh.end_time)
          at time zone 'America/Bogota') + cfg.off_shift_grace
    end,
    false
  ) as is_off_shift,
  exists (
    select 1 from public.sync_quarantine q where q.report_id = r.id and q.status = 'OPEN'
  ) as has_open_conflict,
  (
    exists (select 1 from public.sync_quarantine q where q.report_id = r.id and q.status = 'OPEN')
    or (
      r.status <> 'CLOSED'
      and private.is_root()
      and (
        exists (select 1 from public.report_stop_events s where s.report_id = r.id and s.clock_skew_review)
        or exists (select 1 from public.report_change_events c where c.report_id = r.id and c.clock_skew_review)
      )
    )
  ) as has_pending_review,
  (
    select jsonb_build_object('id', s.id, 'started_at', s.started_at, 'stop_category_id', s.stop_category_id)
    from public.report_stop_events s
    where s.report_id = r.id and s.ended_at is null and s.cancelled_at is null
    limit 1
  ) as active_stop
from public.production_reports r
left join public.shifts sh on sh.id = r.shift_id
cross join public.app_settings cfg;
