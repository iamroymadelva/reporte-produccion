-- Fase 9 / T098 (F5): tiempo real. Publica las tablas de reportes en `supabase_realtime` (postgres_changes: la RLS de cada
-- tabla decide qué fila recibe cada suscriptor) y autoriza el canal privado de presencia `plant-presence`
-- con políticas sobre `realtime.messages`:
--   * track (INSERT, extension = 'presence'): solo OPERATOR activo.
--   * escuchar (SELECT, extension = 'presence'): managers (ROOT/ADMINISTRATOR) y VIEWER activos, que es para lo que
--     existe el canal, y también OPERATOR activo: Realtime exige permiso de LECTURA para unirse a un canal privado, así que
--     sin SELECT el operario no podría ni conectarse para hacer track (verificado contra el Realtime local: "Unauthorized:
--     You do not have permissions to read from this Channel topic"). La interfaz del operario nunca lee ni muestra la
--     presencia de otros; el único dato expuesto a un operario autenticado es quién está en línea, nunca reportes ni auditoría.
-- Ningún otro tema ni extensión (broadcast) queda autorizado para `authenticated`; `anon` no tiene política.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['production_reports', 'report_stop_events', 'report_change_events', 'report_audit_log', 'sync_quarantine']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- postgres_changes depende de la RLS: todas deben tenerla activa (defensa ante un cambio futuro).
do $$
declare
  t text;
begin
  foreach t in array array['production_reports', 'report_stop_events', 'report_change_events', 'report_audit_log', 'sync_quarantine']
  loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception 'La tabla % debe tener RLS activa antes de publicarla en Realtime', t;
    end if;
  end loop;
end;
$$;

drop policy if exists plant_presence_operator_track on realtime.messages;
drop policy if exists plant_presence_reader_select on realtime.messages;

create policy plant_presence_operator_track on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) = 'plant-presence'
    and (select private.current_user_role()) = 'OPERATOR'
  );

create policy plant_presence_reader_select on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) = 'plant-presence'
    and (select private.current_user_role()) in ('ROOT', 'ADMINISTRATOR', 'VIEWER', 'OPERATOR')
  );
