-- Fase F2 / T047 (corrección MINOR-3): los borradores heredados sin turno (shift_id nulo) también pueden
-- cancelarlos los managers. Sin turno se considera "abierto fuera de turno" cuando
-- coalesce(started_at, created_at) + 12 h (duración máxima de un turno, SC-003) + off_shift_grace < now().
-- private.report_is_off_shift y production_report_overview.is_off_shift usan la misma regla.

create or replace function private.report_is_off_shift(p_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.status = 'DRAFT'
      and case
        when r.shift_id is null then
          coalesce(r.started_at, r.created_at) + interval '12 hours' + cfg.off_shift_grace < now()
        else
          sh.id is not null
          and now() > (((r.report_date + case when sh.start_time < sh.end_time then 0 else 1 end) + sh.end_time)
            at time zone 'America/Bogota') + cfg.off_shift_grace
      end
    from public.production_reports r
    left join public.shifts sh on sh.id = r.shift_id
    cross join public.app_settings cfg
    where r.id = p_report_id
  ), false);
$$;
revoke all on function private.report_is_off_shift(uuid) from public;

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
