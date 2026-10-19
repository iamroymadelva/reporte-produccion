-- 002-indicators-dashboard: resumen de indicadores de produccion (solo lectura).
-- Funcion `security invoker`: todo lo que lee pasa por las politicas RLS del llamador.
-- Reglas: specs/002-indicators-dashboard/research.md (R-03, R-04, R-07) y contracts/http-api.md.

create index production_reports_report_date_status_idx
  on public.production_reports (report_date, status);

create or replace function public.indicators_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_days integer;
  v_cards jsonb;
  v_daily jsonb;
  v_machines jsonb;
  v_categories jsonb;
begin
  if not (private.is_manager() or private.current_user_role() = 'VIEWER') then
    raise exception 'No tienes permiso para consultar los indicadores.' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_from > p_to or (p_to - p_from) + 1 > 366 then
    raise exception 'El rango de fechas no es valido.' using errcode = '22023';
  end if;

  v_days := (p_to - p_from) + 1;


  with rep as (
    select r.id, r.status, r.report_date, r.approved_at, s.start_time, s.end_time
    from public.production_reports r
    left join public.shifts s on s.id = r.shift_id
    where r.status in ('SUBMITTED', 'CLOSED')
      and r.report_date between p_from and p_to
  ),
  stops as (
    select e.report_id, e.stop_category_id, e.duration_seconds
    from public.report_stop_events e
    join rep on rep.id = e.report_id
    where e.ended_at is not null and e.cancelled_at is null and e.duration_seconds is not null
  ),
  appr as (
    select greatest(
        extract(epoch from (
          rep.approved_at
          - (((rep.report_date + rep.end_time) at time zone 'America/Bogota')
             + case when rep.end_time <= rep.start_time then interval '1 day' else interval '0' end)
        )), 0) as secs
    from rep
    where rep.status = 'CLOSED' and rep.end_time is not null and rep.approved_at is not null
  )
  select jsonb_build_object(
    'reports', (select count(*) from rep),
    'approved', (select count(*) from rep where status = 'CLOSED'),
    'approvedRatio', case when (select count(*) from rep) = 0 then null
      else (select count(*) filter (where status = 'CLOSED')::numeric / count(*) from rep) end,
    'avgApprovalSeconds', (select round(avg(secs))::bigint from appr),
    'stopSeconds', coalesce((select sum(duration_seconds) from stops), 0)::bigint
  ) into v_cards;

  select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'seconds', coalesce(x.secs, 0)::bigint)
                            order by d.day), '[]'::jsonb)
  into v_daily
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d(day)
  left join (
    select r.report_date, sum(e.duration_seconds) as secs
    from public.production_reports r
    join public.report_stop_events e on e.report_id = r.id
    where r.status in ('SUBMITTED', 'CLOSED')
      and r.report_date between p_from and p_to
      and e.ended_at is not null and e.cancelled_at is null and e.duration_seconds is not null
    group by r.report_date
  ) x on x.report_date = d.day::date;

  select coalesce(jsonb_agg(jsonb_build_object('machineId', t.machine_id, 'code', t.code, 'name', t.name,
                                               'seconds', t.secs::bigint) order by t.secs desc, t.code asc), '[]'::jsonb)
  into v_machines
  from (
    select m.id as machine_id, m.code, m.name, sum(e.duration_seconds) as secs
    from public.production_reports r
    join public.report_stop_events e on e.report_id = r.id
    join public.machines m on m.id = r.machine_id
    where r.status in ('SUBMITTED', 'CLOSED')
      and r.report_date between p_from and p_to
      and e.ended_at is not null and e.cancelled_at is null and e.duration_seconds is not null
    group by m.id, m.code, m.name
    having sum(e.duration_seconds) > 0
    order by sum(e.duration_seconds) desc, m.code asc
    limit 10
  ) t;

  with grp as (
    select e.stop_category_id as category_id, c.name, sum(e.duration_seconds) as secs
    from public.production_reports r
    join public.report_stop_events e on e.report_id = r.id
    left join public.stop_categories c on c.id = e.stop_category_id
    where r.status in ('SUBMITTED', 'CLOSED')
      and r.report_date between p_from and p_to
      and e.ended_at is not null and e.cancelled_at is null and e.duration_seconds is not null
    group by e.stop_category_id, c.name
    having sum(e.duration_seconds) > 0
  ),
  ranked as (
    select grp.*, row_number() over (order by secs desc, name asc nulls last, category_id) as rn,
           count(*) over () as total_groups
    from grp
  ),
  segs as (
    select case when category_id is null then 'uncategorized' else 'category' end as kind,
           category_id, name, secs, 0 as ord, rn
    from ranked
    where total_groups <= 6 or rn <= 5
    union all
    select 'other', null, null, sum(secs), 1, 0
    from ranked
    where total_groups > 6 and rn > 5
    having count(*) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'categoryId', category_id, 'name', name,
                                               'seconds', secs::bigint) order by ord, rn), '[]'::jsonb)
  into v_categories
  from segs;

  return jsonb_build_object(
    'range', jsonb_build_object('from', to_char(p_from, 'YYYY-MM-DD'), 'to', to_char(p_to, 'YYYY-MM-DD'), 'days', v_days),
    'cards', v_cards,
    'daily', v_daily,
    'machines', v_machines,
    'categories', v_categories
  );
end;
$$;

revoke all on function public.indicators_summary(date, date) from public, anon;
grant execute on function public.indicators_summary(date, date) to authenticated;
