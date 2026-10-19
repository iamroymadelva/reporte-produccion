-- Siembra de demostracion del tablero de Indicadores (002-indicators-dashboard) SOLO PARA LA BASE LOCAL.
--   ~90 dias hasta hoy (America/Bogota), 3 maquinas x 3 turnos en dias habiles (con huecos), mayoria CLOSED en lo antiguo y mas SUBMITTED
--   en lo reciente, tiempo de aprobacion que mejora (~30 h -> ~6 h), 8 categorias de parada con distribucion desigual, M-02 claramente peor,
--   paradas que cruzan la medianoche, y filas que el tablero debe EXCLUIR (DRAFT, CANCELLED, parada abierta, paradas canceladas).
--   docker exec -i supabase_db_reporte-produccion psql -U postgres -v ON_ERROR_STOP=1 < scripts/seed-demo-indicators.sql
-- Es repetible: al inicio borra solo sus filas (production_order like 'DEMO-%'). Se revierte con `bun run db:reset`.
-- NUNCA se ejecuta contra produccion. Aborta si faltan los perfiles semilla o existe una maquina distinta de M-01..M-03.
begin;

do $$
begin
  if (select count(*) from public.profiles
      where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
                   '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004',
                   '10000000-0000-0000-0000-000000000005')) <> 5 then
    raise exception 'Faltan los perfiles semilla (10000000-...-001..005): esta siembra es solo para la base local.';
  end if;
  if exists (select 1 from public.machines where code not in ('M-01', 'M-02', 'M-03')) then
    raise exception 'Existen maquinas distintas de M-01..M-03: entorno no reconocido, se aborta.';
  end if;
  if (select count(*) from public.machines where code in ('M-01', 'M-02', 'M-03')) <> 3 then
    raise exception 'Faltan las maquinas semilla M-01..M-03.';
  end if;
  if (select count(*) from public.shifts where active) < 3 then
    raise exception 'Faltan turnos activos (se necesitan 3).';
  end if;
  -- Completa hasta 8 categorias de parada activas sin tocar las existentes.
  insert into public.stop_categories (code, name)
  select 'D' || g, 'Demo categoria ' || g
  from generate_series(1, greatest(0, 8 - (select count(*)::int from public.stop_categories where active))) g
  on conflict (code) do nothing;
end $$;

set local session_replication_role = replica; -- sin triggers (tampoco FK/cascade): se borran las paradas a mano

delete from public.report_stop_events
where report_id in (select id from public.production_reports where production_order like 'DEMO-%');
delete from public.production_reports where production_order like 'DEMO-%';

create temporary table demo_cats on commit drop as
select id, (row_number() over (order by code))::int as ci
from (select id, code from public.stop_categories where active order by code limit 8) c;

create temporary table demo_reports on commit drop as
with p as (select (now() at time zone 'America/Bogota')::date as today),
mach as (
  select id, (row_number() over (order by code))::int as mi
  from public.machines where code in ('M-01', 'M-02', 'M-03')
),
sh as (
  select id, start_time, end_time, si
  from (select id, start_time, end_time, (row_number() over (order by sort_order, name))::int as si
        from public.shifts where active) x
  where si <= 3
),
slots as (
  select (p.today - g) as d, g as age, m.id as machine_id, m.mi, s.id as shift_id, s.si,
    ((p.today - g) + s.start_time) at time zone 'America/Bogota' as start_ts,
    (((p.today - g) + s.end_time) at time zone 'America/Bogota')
      + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end as end_ts
  from p cross join generate_series(0, 89) g cross join mach m cross join sh s
  where extract(isodow from (p.today - g)) <= 5
    and (g * 7 + m.mi * 3 + s.si) % 13 <> 0
),
numbered as (
  select (row_number() over (order by d, mi, si))::int as n, * from slots where start_ts <= now()
),
calc as (
  select nb.*,
    nb.end_ts + (greatest(1, 6 + 24.0 * nb.age / 89 + ((nb.n % 5) - 2) * 0.5)::float8 * interval '1 hour') as approved_ts,
    case when nb.age > 30 then 92 when nb.age > 14 then 75 when nb.age > 3 then 45 else 15 end as pct
  from numbered nb
)
select n,
  ('d0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid as id,
  'RPT-2026-2' || lpad(n::text, 5, '0') as folio,
  d as report_date, machine_id, mi, shift_id, si, start_ts, end_ts, age,
  case when age >= 1 and n % 41 = 0 then 'CANCELLED'
       when (n * 37) % 100 < pct and approved_ts <= now() then 'CLOSED'
       else 'SUBMITTED' end as st,
  case when (mi + si) % 2 = 0 then '10000000-0000-0000-0000-000000000002'::uuid
       else '10000000-0000-0000-0000-000000000005'::uuid end as created_by,
  case when (mi + si) % 2 = 0 then 'Operario Uno' else 'Operario Dos' end as creator_name,
  approved_ts
from calc;

-- Borradores de hoy (uno por operario y por maquina, como exigen los indices unicos).
insert into demo_reports
select 9000 + mi,
  ('d0000000-0000-0000-0000-' || lpad((9000 + mi)::text, 12, '0'))::uuid,
  'RPT-2026-2' || lpad((9000 + mi)::text, 5, '0'),
  (now() at time zone 'America/Bogota')::date, m.id, mi,
  (select id from public.shifts where active order by sort_order, name limit 1), 1,
  now() - interval '1 hour', now() + interval '7 hours', 0, 'DRAFT',
  case when mi = 1 then '10000000-0000-0000-0000-000000000002'::uuid else '10000000-0000-0000-0000-000000000005'::uuid end,
  case when mi = 1 then 'Operario Uno' else 'Operario Dos' end,
  null::timestamptz
from (select id, (row_number() over (order by code))::int as mi
      from public.machines where code in ('M-01', 'M-02')) m;

insert into public.production_reports(
  id, folio, report_date, machine_id, status, created_by, updated_by, submitted_by, submitted_at, created_at, updated_at,
  creator_full_name, creator_role, shift_id, started_at, ended_at, programmed_hours, g_min, weight, units_produced, waste,
  production_order, lot, product_name, client_name, approved_by, approved_at, approver_full_name, origin, received_at,
  cancellation_reason, cancelled_at, cancelled_by)
select r.id, r.folio, r.report_date, r.machine_id, r.st::public.report_status, r.created_by, r.created_by,
  case when r.st in ('SUBMITTED', 'CLOSED') then r.created_by end,
  case when r.st in ('SUBMITTED', 'CLOSED') then least(r.end_ts + interval '10 minutes', now()) end,
  r.start_ts,
  case when r.st = 'CLOSED' then r.approved_ts when r.st = 'CANCELLED' then least(r.end_ts + interval '1 hour', now())
       else least(r.end_ts + interval '10 minutes', now()) end,
  r.creator_name, 'OPERATOR', r.shift_id, r.start_ts, r.end_ts, 8, 120 + r.n % 30, 250, 40000 + r.n * 7, 150 + r.n % 40,
  'DEMO-' || lpad(r.n::text, 5, '0'), 'DL' || r.n, 'Producto ' || (r.n % 7), 'Cliente ' || (r.n % 5),
  case when r.st = 'CLOSED' then '10000000-0000-0000-0000-000000000001'::uuid end,
  case when r.st = 'CLOSED' then r.approved_ts end,
  case when r.st = 'CLOSED' then 'Coordinador Uno' end,
  'online', least(r.end_ts + interval '10 minutes', now()),
  case when r.st = 'CANCELLED' then 'Reporte demo cancelado' end,
  case when r.st = 'CANCELLED' then least(r.end_ts + interval '1 hour', now()) end,
  case when r.st = 'CANCELLED' then r.created_by end
from demo_reports r;

-- Paradas cerradas: 1-3 por reporte (M-02 una mas), categoria con distribucion desigual, duracion mayor en M-02.
-- Los turnos nocturnos (si = 3) fuerzan en k = 1 una parada >= 45 min que cruza la medianoche.
insert into public.report_stop_events(id, report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id,
  description, created_at, updated_at, received_at, captured_offline, clock_skew_review)
select ('e0000000-0000-0000-0000-' || lpad((r.n * 10 + k)::text, 12, '0'))::uuid, r.id,
  (select id from demo_cats where ci = (array[1,1,1,1,1,1,2,2,2,2,2,3,3,3,3,4,4,4,5,5,6,6,7,8])[1 + (r.n * 7 + k * 5) % 24]),
  r.start_ts + k * interval '100 minutes',
  r.start_ts + k * interval '100 minutes' + x.dur * interval '1 minute',
  x.dur * 60, r.created_by, 'Parada demo ' || k, now(), now(), now(), false, false
from demo_reports r
cross join generate_series(0, 3) k
cross join lateral (
  select greatest(
    round((10 + ((r.n * 13 + k * 17) % 40)) * case when r.mi = 2 then 1.8 else 1.0 end)::int,
    case when r.si = 3 and k = 1 then 45 else 0 end) as dur
) x
where r.st <> 'DRAFT' and k < 1 + (r.n % 3) + case when r.mi = 2 then 1 else 0 end;

-- Paradas canceladas (se excluyen del tablero) en algunos reportes enviados/aprobados.
insert into public.report_stop_events(id, report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id,
  description, created_at, updated_at, received_at, captured_offline, clock_skew_review,
  cancellation_reason, cancelled_at, cancelled_by)
select ('e0000000-0000-0000-0000-' || lpad((r.n * 10 + 4)::text, 12, '0'))::uuid, r.id,
  (select id from demo_cats where ci = 1),
  r.start_ts + interval '400 minutes', r.start_ts + interval '405 minutes', null, r.created_by,
  'Parada demo cancelada', now(), now(), now(), false, false,
  'Parada registrada por error', r.start_ts + interval '405 minutes', r.created_by
from demo_reports r
where r.st in ('SUBMITTED', 'CLOSED') and r.n % 17 = 0;

-- Parada abierta (se excluye del tablero) en el borrador de la primera maquina.
insert into public.report_stop_events(id, report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id,
  description, created_at, updated_at, received_at, captured_offline, clock_skew_review)
select ('e0000000-0000-0000-0000-' || lpad((r.n * 10)::text, 12, '0'))::uuid, r.id,
  (select id from demo_cats where ci = 2),
  now() - interval '30 minutes', null, null, r.created_by, 'Parada demo abierta', now(), now(), now(), false, false
from demo_reports r
where r.st = 'DRAFT' and r.mi = 1;

commit;

select status, count(*) as reportes from public.production_reports where production_order like 'DEMO-%' group by status order by status;
select count(*) as paradas from public.report_stop_events where report_id in (select id from public.production_reports where production_order like 'DEMO-%');
