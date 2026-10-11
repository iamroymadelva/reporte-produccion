-- Siembra sintetica de un mes de produccion SOLO PARA LA BASE LOCAL (SC-006: exportar un mes en < 30 s).
--   900 reportes (30 dias x 30), 6 paradas cerradas con categoria y 3 cambios por reporte, 8 filas de historial por reporte.
--   docker exec -i supabase_db_reporte-produccion psql -U postgres -v ON_ERROR_STOP=1 < scripts/seed-month.sql
-- Se revierte con `bun run db:reset`. NUNCA se ejecuta contra produccion.
begin;
set local session_replication_role = replica; -- evita miles de triggers de auditoria/notificacion; las filas se insertan completas

create temporary table seed_ids as
select n, gen_random_uuid() as report_id,
  date '2026-09-10' + ((n - 1) / 30) as report_date,
  ((n - 1) % 30) as slot
from generate_series(1, 900) n;

insert into public.production_reports(
  id, folio, report_date, machine_id, status, created_by, updated_by, submitted_by, submitted_at, created_at, updated_at,
  creator_full_name, creator_role, shift_id, started_at, ended_at, programmed_hours, g_min, weight, units_produced, waste,
  production_order, lot, product_name, client_name, approved_by, approved_at, approver_full_name, origin, received_at)
select s.report_id, 'RPT-2026-' || lpad((100000 + s.n)::text, 6, '0'), s.report_date,
  ('30000000-0000-0000-0000-00000000000' || (1 + s.slot % 3))::uuid,
  case when s.n % 3 = 0 then 'CLOSED'::public.report_status else 'SUBMITTED'::public.report_status end,
  case when s.slot % 2 = 0 then '10000000-0000-0000-0000-000000000002'::uuid else '10000000-0000-0000-0000-000000000005'::uuid end,
  '10000000-0000-0000-0000-000000000002',
  case when s.slot % 2 = 0 then '10000000-0000-0000-0000-000000000002'::uuid else '10000000-0000-0000-0000-000000000005'::uuid end,
  (s.report_date + time '06:00') at time zone 'America/Bogota' + interval '8 hours',
  (s.report_date + time '06:00') at time zone 'America/Bogota',
  (s.report_date + time '06:00') at time zone 'America/Bogota' + interval '8 hours',
  case when s.slot % 2 = 0 then 'Operario Uno' else 'Operario Dos' end, 'OPERATOR',
  (select id from public.shifts order by name limit 1 offset (s.slot % 3)),
  (s.report_date + time '06:00') at time zone 'America/Bogota',
  (s.report_date + time '14:00') at time zone 'America/Bogota',
  8, 120 + s.slot, 250, 40000 + s.n * 7, 150 + s.slot,
  'OP-' || (5000 + s.n), 'L' || s.n, 'Producto ' || (s.slot % 7), 'Cliente ' || (s.slot % 5),
  case when s.n % 3 = 0 then '10000000-0000-0000-0000-000000000001'::uuid end,
  case when s.n % 3 = 0 then (s.report_date + time '15:00') at time zone 'America/Bogota' end,
  case when s.n % 3 = 0 then 'Coordinador Uno' end,
  'online', (s.report_date + time '14:01') at time zone 'America/Bogota'
from seed_ids s;

insert into public.report_stop_events(id, report_id, stop_category_id, started_at, ended_at, duration_seconds, responsible_user_id, description,
  created_at, updated_at, received_at, captured_offline, clock_skew_review)
select gen_random_uuid(), s.report_id,
  (select id from public.stop_categories order by code limit 1 offset (k % 5)),
  (s.report_date + time '06:00') at time zone 'America/Bogota' + (k * interval '75 minutes'),
  (s.report_date + time '06:00') at time zone 'America/Bogota' + (k * interval '75 minutes') + ((10 + k * 3) * interval '1 minute'),
  (10 + k * 3) * 60, '10000000-0000-0000-0000-000000000002', 'Parada sintetica ' || k,
  now(), now(), now(), false, false
from seed_ids s cross join generate_series(0, 5) k;

insert into public.report_change_events(id, report_id, change_type_id, description, occurred_at, captured_offline, clock_skew_review, created_by, created_at, updated_at)
select gen_random_uuid(), s.report_id,
  (select id from public.change_types order by name limit 1 offset (k % 4)),
  'Cambio sintetico ' || k,
  (s.report_date + time '07:00') at time zone 'America/Bogota' + (k * interval '120 minutes'),
  false, false, '10000000-0000-0000-0000-000000000002', now(), now()
from seed_ids s cross join generate_series(0, 2) k;

insert into public.report_audit_log(report_id, changed_by, changed_at, field_name, old_value, new_value, entity_type, entity_id, action, actor_role, reason, captured_offline, received_at)
select s.report_id, '10000000-0000-0000-0000-000000000002',
  (s.report_date + time '06:00') at time zone 'America/Bogota' + (k * interval '30 minutes'),
  (array['lot','production_order','units_produced','waste','g_min','weight','product_name','client_name'])[k + 1],
  to_jsonb('anterior'::text), to_jsonb('nuevo'::text), 'report', s.report_id, 'UPDATE', 'OPERATOR', null, false, now()
from seed_ids s cross join generate_series(0, 7) k;

commit;
select count(*) as reportes_sembrados from public.production_reports where folio like 'RPT-2026-1%';
