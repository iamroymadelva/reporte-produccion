-- Siembra de demostracion del tablero de Indicadores (002-indicators-dashboard) para la NUBE (Supabase).
-- Pegar COMPLETO en el SQL Editor de Supabase (rol postgres) y ejecutar una sola vez.
--
-- *** ADVERTENCIA: ESCRIBE EN LA BASE DE PRODUCCION. ***
--   Inserta ~500 reportes y ~1000 paradas DEMO (production_order 'DEMO-nnnnn') que SE VERAN en el tablero /indicadores,
--   en listados y en exportaciones, mezclados con los datos reales, hasta que se limpien.
--
-- QUE SIEMBRA
--   ~90 dias hasta hoy (America/Bogota), maquinas M-01..M-03 x 3 turnos activos en dias habiles (con huecos), solo turnos YA terminados,
--   mayoria CLOSED en lo antiguo y mas SUBMITTED en lo reciente, tiempo de aprobacion que mejora (~30 h -> ~6 h), 8 categorias de
--   parada existentes (codes '3','4','2','15','16','8','1','11') con distribucion desigual, M-02 claramente peor, paradas que cruzan la
--   medianoche y filas que el tablero debe EXCLUIR (CANCELLED y paradas canceladas).
--   Todos los reportes los crea "Operario Prueba" y los aprueba "Coordinador Test" (UUID definidos una sola vez en demo_cfg).
--   NO siembra borradores ni paradas abiertas (hay operarios reales; evita los indices unicos one_active_per_operator/_machine).
--   NO crea categorias, maquinas, turnos ni perfiles.
--
-- GUARDAS (abortan sin escribir nada; todo ocurre en una transaccion)
--   - Si ya existen reportes DEMO-%: NO se borra automaticamente; ejecuta primero scripts/cleanup-demo-indicators.sql.
--   - Si faltan los perfiles (OPERATOR / ADMINISTRATOR), las maquinas M-01..M-03, 3 turnos activos o las 8 categorias activas.
--   - Si algun trigger de usuario de production_reports/report_stop_events ya esta deshabilitado, o si hay folios 9xxxxx reales.
--
-- TRIGGERS
--   En la nube `set session_replication_role = replica` puede estar denegado, por eso se usa
--   `alter table ... disable trigger user` (solo triggers de usuario; los de FK/internos siguen activos) sobre production_reports y
--   report_stop_events. Es transaccional (DDL), se reactiva ANTES del commit y un DO final aborta (rollback) si algun trigger queda
--   deshabilitado. Motivo: los triggers fuerzan status DRAFT al insertar, recalculan turno/fecha, exigen asignacion operador-maquina,
--   reasignan el folio desde report_folio_counters y escriben auditoria/notificaciones; nada de eso aplica a datos historicos.
--   Costo: el ALTER TABLE toma un bloqueo breve (SHARE ROW EXCLUSIVE) sobre ambas tablas mientras dura el script (segundos);
--   escrituras de operarios en ese lapso esperan, no se pierden.
--
-- FOLIOS
--   production_reports.folio es UNIQUE con formato ^RPT-[0-9]{4}-[0-9]{6}$ y lo asigna un trigger desde report_folio_counters.
--   Con el trigger apagado NO se toca el contador; los folios demo usan el rango RPT-<anio>-9nnnnn (900001+), muy lejos de los
--   reales (consecutivos desde 000001). Guarda: aborta si ya hay folios 9xxxxx o el contador llego a 900000.
--
-- INDICES UNICOS / SLOTS REALES
--   Los unicos relevantes son one_active_per_operator / one_active_per_machine (solo DRAFT: no se siembran borradores) y folio.
--   No hay unico por maquina/turno/fecha, pero para no duplicar produccion real el seed OMITE (no falla) los slots
--   (maquina, turno, fecha) que ya tengan cualquier reporte no DEMO.
--
-- REVERTIR: scripts/cleanup-demo-indicators.sql (primero en modo seguro, luego do_delete := true).
-- NO contiene credenciales.
begin;

-- Configuracion unica (para sustituir los UUID/nombres facilmente).
create temporary table demo_cfg on commit drop as
select '6cce10c8-9d49-4624-a9e3-d988f4544d90'::uuid as operator_id, 'Operario Prueba'::text as operator_name,
       '25750b5c-dee3-4c83-a9cb-88e683a69e7b'::uuid as approver_id, 'Coordinador Test'::text as approver_name;

-- Categorias por code explicito; ci = prioridad (ci 1 es la mas frecuente).
create temporary table demo_cats on commit drop as
select c.id, v.ci
from (values ('3', 1), ('4', 2), ('2', 3), ('15', 4), ('16', 5), ('8', 6), ('1', 7), ('11', 8)) v(code, ci)
join public.stop_categories c on c.code = v.code and c.active;

do $$
begin
  if exists (select 1 from public.production_reports where production_order like 'DEMO-%') then
    raise exception 'Ya existen reportes DEMO-%%: no se borra nada automaticamente. Ejecuta primero scripts/cleanup-demo-indicators.sql (do_delete := true) y vuelve a correr este script.';
  end if;
  if not exists (select 1 from public.profiles p, demo_cfg c where p.id = c.operator_id and p.role = 'OPERATOR') then
    raise exception 'No existe el perfil OPERATOR esperado (demo_cfg.operator_id): entorno no reconocido, se aborta.';
  end if;
  if not exists (select 1 from public.profiles p, demo_cfg c where p.id = c.approver_id and p.role = 'ADMINISTRATOR') then
    raise exception 'No existe el perfil ADMINISTRATOR esperado (demo_cfg.approver_id): entorno no reconocido, se aborta.';
  end if;
  if (select count(*) from public.machines where code in ('M-01', 'M-02', 'M-03')) <> 3 then
    raise exception 'Faltan las maquinas M-01..M-03.';
  end if;
  if (select count(*) from public.shifts where active) < 3 then
    raise exception 'Faltan turnos activos (se necesitan 3).';
  end if;
  if (select count(*) from demo_cats) <> 8 then
    raise exception 'Faltan categorias de parada activas con code 3,4,2,15,16,8,1,11 (encontradas %).', (select count(*) from demo_cats);
  end if;
  if exists (select 1 from public.production_reports where folio ~ '^RPT-[0-9]{4}-9[0-9]{5}$')
     or exists (select 1 from public.report_folio_counters where last_value >= 900000) then
    raise exception 'Ya hay folios en el rango 9xxxxx (o el contador lo alcanzo): el rango demo no esta libre.';
  end if;
  if exists (select 1 from pg_trigger t
             where t.tgrelid in ('public.production_reports'::regclass, 'public.report_stop_events'::regclass)
               and not t.tgisinternal and t.tgenabled = 'D') then
    raise exception 'Hay triggers de usuario ya deshabilitados en production_reports/report_stop_events: se aborta para no reactivarlos.';
  end if;
end $$;

alter table public.production_reports disable trigger user;
alter table public.report_stop_events disable trigger user;

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
    -- Omite slots que ya tienen un reporte real (maquina + turno + fecha operativa).
    and not exists (select 1 from public.production_reports pr
                    where pr.machine_id = m.id and pr.shift_id = s.id and pr.report_date = (p.today - g))
),
numbered as (
  -- Solo turnos ya terminados (no se simulan reportes de un turno en curso).
  select (row_number() over (order by d, mi, si))::int as n, * from slots where end_ts <= now()
),
calc as (
  select nb.*,
    nb.end_ts + (greatest(1, 6 + 24.0 * nb.age / 89 + ((nb.n % 5) - 2) * 0.5)::float8 * interval '1 hour') as approved_ts,
    case when nb.age > 30 then 92 when nb.age > 14 then 75 when nb.age > 3 then 45 else 15 end as pct
  from numbered nb
)
select n,
  ('d0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid as id,
  'RPT-' || extract(year from d)::int::text || '-9' || lpad(n::text, 5, '0') as folio,
  d as report_date, machine_id, mi, shift_id, si, start_ts, end_ts, age,
  case when age >= 1 and n % 41 = 0 then 'CANCELLED'
       when (n * 37) % 100 < pct and approved_ts <= now() then 'CLOSED'
       else 'SUBMITTED' end as st,
  (select operator_id from demo_cfg) as created_by,
  (select operator_name from demo_cfg) as creator_name,
  approved_ts
from calc;

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
  case when r.st = 'CLOSED' then (select approver_id from demo_cfg) end,
  case when r.st = 'CLOSED' then r.approved_ts end,
  case when r.st = 'CLOSED' then (select approver_name from demo_cfg) end,
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
where k < 1 + (r.n % 3) + case when r.mi = 2 then 1 else 0 end;

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

alter table public.production_reports enable trigger user;
alter table public.report_stop_events enable trigger user;

-- Si algun trigger de usuario quedo deshabilitado, se aborta y se revierte todo.
do $$
begin
  if exists (select 1 from pg_trigger t
             where t.tgrelid in ('public.production_reports'::regclass, 'public.report_stop_events'::regclass)
               and not t.tgisinternal and t.tgenabled = 'D') then
    raise exception 'Un trigger quedo deshabilitado: se revierte la siembra.';
  end if;
end $$;

commit;

-- Verificacion (una sola consulta): reportes por status y paradas DEMO.
select concepto, cantidad from (
  select 'reportes ' || status::text as concepto, count(*) as cantidad, 1 as orden
  from public.production_reports where production_order like 'DEMO-%' group by status
  union all
  select 'paradas (total)', count(*), 2
  from public.report_stop_events where report_id in (select id from public.production_reports where production_order like 'DEMO-%')
  union all
  select 'paradas canceladas', count(*), 3
  from public.report_stop_events where cancelled_at is not null
    and report_id in (select id from public.production_reports where production_order like 'DEMO-%')
) v order by orden, concepto;
