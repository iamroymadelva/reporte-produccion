begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

-- Synthetic finalized rows avoid thousands of unrelated audit/notification triggers.
set local session_replication_role = replica;
insert into public.production_reports(
  id, folio, report_date, machine_id, status, created_by, updated_by,
  submitted_by, submitted_at, created_at, updated_at, creator_full_name, creator_role
)
select gen_random_uuid(), 'RPT-2026-' || lpad((900000 + n)::text, 6, '0'),
  case when n <= 503 then '2026-10-08'::date else '2026-10-07'::date end,
  '30000000-0000-0000-0000-000000000001', 'SUBMITTED',
  '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', now(),
  '2026-10-08T12:00:00Z'::timestamptz + n * interval '1 microsecond', now(),
  'Operador de carga', 'OPERATOR'
from generate_series(1, 1005) n;
set local session_replication_role = origin;

select is((select count(*)::integer from public.production_reports where folio between 'RPT-2026-900001' and 'RPT-2026-901005'),
  1005, 'La consulta exacta incluye más de 1000 reportes');
select is((select count(*)::integer from (
  select id from public.production_reports where folio between 'RPT-2026-900001' and 'RPT-2026-901005'
  order by created_at desc, id desc limit 25 offset 0) page), 25, 'La primera página contiene 25');
select is((select count(*)::integer from (
  select id from public.production_reports where folio between 'RPT-2026-900001' and 'RPT-2026-901005'
  order by created_at desc, id desc limit 25 offset 1000) page), 5, 'La página 41 contiene el remanente');
with pages as (
  select item.id from generate_series(0, 40) page_number
  cross join lateral (
    select id from public.production_reports
    where folio between 'RPT-2026-900001' and 'RPT-2026-901005'
    order by created_at desc, id desc limit 25 offset page_number * 25
  ) item
)
select ok(count(*) = 1005 and count(distinct id) = 1005,
  'Recorrer 41 páginas conserva todos los identificadores sin duplicados') from pages;
select is((select count(*)::integer from public.production_reports
  where folio between 'RPT-2026-900001' and 'RPT-2026-901005' and report_date = '2026-10-08'),
  503, 'Filtro del KPI de hoy coincide con total de listado');
select is((select count(*)::integer from public.production_reports
  where folio between 'RPT-2026-900001' and 'RPT-2026-901005' and report_date = '2026-10-07'),
  502, 'Filtro del otro día excluye reportes de hoy');
with export_pages as (
  select item.id from generate_series(0, 1) page_number
  cross join lateral (
    select id from public.production_reports
    where folio between 'RPT-2026-900001' and 'RPT-2026-901005'
    order by created_at desc, id desc limit 1000 offset page_number * 1000
  ) item
)
select ok(count(*) = 1005 and count(distinct id) = 1005,
  'Exportar en lotes de 1000 recupera todas las filas') from export_pages;

select * from finish();
rollback;
