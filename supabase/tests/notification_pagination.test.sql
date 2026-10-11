begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

insert into public.notification_events(event_key, type, resource_type, resource_id, title, body, href)
select 'test:page:' || n, 'ASSIGNMENTS_CHANGED', 'assignment',
  '10000000-0000-0000-0000-000000000002', 'Asignaciones', 'Prueba', '/reportes'
from generate_series(1, 25) n;
insert into public.notification_deliveries(event_id, recipient_id, created_at)
select id, '10000000-0000-0000-0000-000000000002',
  clock_timestamp() - (split_part(event_key, ':', 3)::integer * interval '1 second')
from public.notification_events where event_key like 'test:page:%';

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('test.page1', public.list_notifications()::text, true);
select is(jsonb_array_length(current_setting('test.page1')::jsonb->'items'), 20, 'La primera página contiene 20 avisos');
select ok(current_setting('test.page1')::jsonb->'nextCursor' is not null, 'La primera página anuncia continuación');
select set_config('test.page2', public.list_notifications('all',
  (current_setting('test.page1')::jsonb->>'snapshotAt')::timestamptz,
  (current_setting('test.page1')::jsonb->'nextCursor'->>'createdAt')::timestamptz,
  (current_setting('test.page1')::jsonb->'nextCursor'->>'id')::uuid)::text, true);
select ok(jsonb_array_length(current_setting('test.page2')::jsonb->'items') >= 5, 'La siguiente página recupera los avisos restantes');
select ok(not exists (
  select 1 from jsonb_array_elements(current_setting('test.page1')::jsonb->'items') first_page
  join jsonb_array_elements(current_setting('test.page2')::jsonb->'items') second_page
    on first_page->>'id' = second_page->>'id'), 'Páginas consecutivas no repiten entregas');

reset role;
insert into public.notification_events(event_key, type, resource_type, resource_id, title, body, href)
values ('test:page:later', 'ASSIGNMENTS_CHANGED', 'assignment',
  '10000000-0000-0000-0000-000000000002', 'Nueva asignación', 'Posterior', '/reportes');
insert into public.notification_deliveries(event_id, recipient_id, created_at)
select id, '10000000-0000-0000-0000-000000000002',
  (current_setting('test.page1')::jsonb->>'snapshotAt')::timestamptz + interval '1 minute'
from public.notification_events where event_key = 'test:page:later';
set local role authenticated;
select public.mark_all_notifications_read((current_setting('test.page1')::jsonb->>'snapshotAt')::timestamptz);
reset role;
select ok((select d.read_at is null from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
  where e.event_key = 'test:page:later'), 'Marcar hasta instantánea conserva avisos posteriores');

select * from finish();
rollback;
