-- T005: private.current_shift_at en America/Bogota, incluidos turnos que cruzan medianoche.
begin;
select no_plan();

select has_function('private', 'current_shift_at', array['timestamp with time zone'],
  'Existe private.current_shift_at(timestamptz)');

create temporary table shift_ids as
  select
    (select id from public.shifts where name = 'Día') as dia,
    (select id from public.shifts where name = 'Tarde') as tarde,
    (select id from public.shifts where name = 'Noche') as noche;

select is((select shift_id from private.current_shift_at('2026-10-09 10:00:00-05')),
  (select dia from shift_ids), 'Las 10:00 pertenecen al turno Día');
select is((select operational_date from private.current_shift_at('2026-10-09 10:00:00-05')),
  '2026-10-09'::date, 'La fecha operativa del turno Día es el mismo día');
select is((select shift_end from private.current_shift_at('2026-10-09 10:00:00-05')),
  '2026-10-09 14:00:00-05'::timestamptz, 'El turno Día termina a las 14:00 de Bogotá');

select is((select shift_id from private.current_shift_at('2026-10-09 06:00:00-05')),
  (select dia from shift_ids), 'Las 06:00 (inicio inclusivo) pertenecen al turno Día');
select is((select shift_id from private.current_shift_at('2026-10-09 13:59:59-05')),
  (select dia from shift_ids), 'Las 13:59:59 siguen en el turno Día');
select is((select shift_id from private.current_shift_at('2026-10-09 14:00:00-05')),
  (select tarde from shift_ids), 'Las 14:00 (inicio inclusivo) pertenecen al turno Tarde');
select is((select shift_id from private.current_shift_at('2026-10-09 18:30:00-05')),
  (select tarde from shift_ids), 'Las 18:30 pertenecen al turno Tarde');
select is((select shift_end from private.current_shift_at('2026-10-09 18:30:00-05')),
  '2026-10-09 22:00:00-05'::timestamptz, 'El turno Tarde termina a las 22:00');

select is((select shift_id from private.current_shift_at('2026-10-09 22:00:00-05')),
  (select noche from shift_ids), 'Las 22:00 pertenecen al turno Noche');
select is((select shift_id from private.current_shift_at('2026-10-09 23:30:00-05')),
  (select noche from shift_ids), 'Las 23:30 del día 9 pertenecen al turno Noche');
select is((select operational_date from private.current_shift_at('2026-10-09 23:30:00-05')),
  '2026-10-09'::date, 'A las 23:30 del día 9 la fecha operativa es el día 9');
select is((select shift_end from private.current_shift_at('2026-10-09 23:30:00-05')),
  '2026-10-10 06:00:00-05'::timestamptz, 'El turno Noche iniciado el día 9 termina el día 10 a las 06:00');
select is((select shift_id from private.current_shift_at('2026-10-10 05:30:00-05')),
  (select noche from shift_ids), 'Las 05:30 del día 10 pertenecen al turno Noche');
select is((select operational_date from private.current_shift_at('2026-10-10 05:30:00-05')),
  '2026-10-09'::date, 'A las 05:30 del día 10 la fecha operativa sigue siendo el día 9');
select is((select shift_end from private.current_shift_at('2026-10-10 05:30:00-05')),
  '2026-10-10 06:00:00-05'::timestamptz, 'A las 05:30 el turno Noche termina a las 06:00 del mismo día');

-- La zona horaria es la de Bogotá, no la de la sesión ni UTC.
select is((select shift_id from private.current_shift_at('2026-10-10 04:30:00+00')),
  (select noche from shift_ids), '04:30 UTC (23:30 en Bogotá) es turno Noche con fecha operativa del día anterior');
select is((select operational_date from private.current_shift_at('2026-10-10 04:30:00+00')),
  '2026-10-09'::date, 'La fecha operativa se calcula en hora de Bogotá');

-- Sin turno activo que contenga la hora, el resultado es vacío.
update public.shifts set active = false where name = 'Tarde';
select is((select count(*)::integer from private.current_shift_at('2026-10-09 18:30:00-05')), 0,
  'Sin turno activo que contenga la hora devuelve vacío');
select is((select shift_id from private.current_shift_at('2026-10-09 10:00:00-05')),
  (select dia from shift_ids), 'Los demás turnos activos siguen resolviéndose');
update public.shifts set active = false;
select is((select count(*)::integer from private.current_shift_at('2026-10-09 10:00:00-05')), 0,
  'Con todos los turnos inactivos devuelve vacío');

select * from finish();
rollback;
