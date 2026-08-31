begin;
select plan(10);

select has_table('public', 'report_folio_counters', 'Existe el contador anual de folios');
select has_table('public', 'administrative_audit_log', 'Existe la auditoría administrativa');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000104', 'authenticated', 'authenticated',
  'operario-prueba-final@local.test', extensions.crypt('Prueba123!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"Operario Histórico"}', now(), now(), '', '', '', ''
);
update public.profiles
set role = 'OPERATOR', active = true, job_title = 'Empacador sénior'
where id = '10000000-0000-0000-0000-000000000104';

insert into public.machines (id, code, name) values
  ('32000000-0000-0000-0000-000000000001', 'F-01', 'Máquina folio 1'),
  ('32000000-0000-0000-0000-000000000002', 'F-02', 'Máquina folio 2');
insert into public.operator_machine_assignments (operator_id, machine_id, created_by)
select '10000000-0000-0000-0000-000000000104', id, '10000000-0000-0000-0000-000000000001'
from public.machines where code in ('F-01', 'F-02');

insert into public.products (id, code, name, sort_order)
values ('62000000-0000-0000-0000-000000000001', 'F-PROD-1', 'Producto histórico final', 990);
insert into public.products (id, code, name, sort_order)
values ('62000000-0000-0000-0000-000000000002', 'F-PROD-2', 'Producto eliminable', 991);

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000104","role":"authenticated"}';

insert into public.production_reports (id, report_date, machine_id, product_id, product_name, created_by, updated_by) values
  ('82000000-0000-0000-0000-000000000001', '2031-01-10', '32000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', 'Producto histórico final', '10000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000104'),
  ('82000000-0000-0000-0000-000000000002', '2031-01-11', '32000000-0000-0000-0000-000000000002', null, null, '10000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000104');

select is(
  (select folio from public.production_reports where id = '82000000-0000-0000-0000-000000000001'),
  'RPT-2031-000001',
  'El primer reporte del año recibe el primer folio'
);
select is(
  (select folio from public.production_reports where id = '82000000-0000-0000-0000-000000000002'),
  'RPT-2031-000002',
  'Una inserción posterior recibe un folio único y consecutivo'
);
select throws_ok(
  $$update public.production_reports set folio = 'RPT-2031-999999'
    where id = '82000000-0000-0000-0000-000000000001'$$,
  'P0001', 'El folio y la identidad histórica del creador son inmutables',
  'El folio no puede modificarse'
);

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$delete from public.products where id = '62000000-0000-0000-0000-000000000002'$$,
  'El Administrador puede eliminar un catálogo nunca referenciado'
);
select is(
  (select count(*) from public.administrative_audit_log
    where action = 'DELETE' and entity_id = '62000000-0000-0000-0000-000000000002'),
  1::bigint,
  'La eliminación administrativa queda auditada'
);
select throws_ok(
  $$delete from public.products where id = '62000000-0000-0000-0000-000000000001'$$,
  '23503', null,
  'No se elimina un catálogo referenciado históricamente'
);

update public.profiles
set active = false, removed_at = now(), removed_by = '10000000-0000-0000-0000-000000000001'
where id = '10000000-0000-0000-0000-000000000104';

select ok(
  (select creator_full_name = 'Operario Histórico'
    and creator_job_title = 'Empacador sénior'
    and creator_role = 'OPERATOR'
   from public.production_reports where id = '82000000-0000-0000-0000-000000000001'),
  'Retirar al usuario conserva su identidad histórica en el reporte'
);
select ok(
  (select not active and removed_at is not null and removed_by is not null
   from public.profiles where id = '10000000-0000-0000-0000-000000000104'),
  'El retiro archiva el perfil sin eliminarlo'
);

select * from finish();
rollback;
