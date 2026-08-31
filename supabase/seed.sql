-- Usuarios locales de demostración. Estas credenciales solo existen en el stack local.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@local.test', extensions.crypt('Admin123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Administración Local"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'operador@local.test', extensions.crypt('Operador123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Operador Local"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'visor@local.test', extensions.crypt('Visor123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Visor Local"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '{"sub":"10000000-0000-0000-0000-000000000001","email":"admin@local.test"}', 'email', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '{"sub":"10000000-0000-0000-0000-000000000002","email":"operador@local.test"}', 'email', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '{"sub":"10000000-0000-0000-0000-000000000003","email":"visor@local.test"}', 'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

update public.profiles set role = 'ADMINISTRATOR', active = true, job_title = 'Administrador'
where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set role = 'OPERATOR', active = true, job_title = 'Operador'
where id = '10000000-0000-0000-0000-000000000002';
update public.profiles set role = 'VIEWER', active = true, job_title = 'Consulta'
where id = '10000000-0000-0000-0000-000000000003';

insert into public.machines (id, code, name) values
  ('30000000-0000-0000-0000-000000000001', 'M-01', 'Empacadora 1'),
  ('30000000-0000-0000-0000-000000000002', 'M-02', 'Empacadora 2'),
  ('30000000-0000-0000-0000-000000000003', 'M-03', 'Empacadora 3')
on conflict (id) do nothing;

insert into public.operator_machine_assignments (operator_id, machine_id, active, created_by) values
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', true, '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', true, '10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', true, '10000000-0000-0000-0000-000000000001')
on conflict (operator_id, machine_id) do update set active = excluded.active;

insert into public.lines (id, code, name, sort_order) values
  ('40000000-0000-0000-0000-000000000001', 'L-01', 'Línea 1', 10),
  ('40000000-0000-0000-0000-000000000002', 'L-02', 'Línea 2', 20)
on conflict (id) do nothing;

insert into public.clients (id, code, name, sort_order) values
  ('50000000-0000-0000-0000-000000000001', 'CLI-01', 'Cliente de demostración', 10)
on conflict (id) do nothing;

insert into public.products (id, code, name, sort_order) values
  ('60000000-0000-0000-0000-000000000001', 'PROD-01', 'Producto de demostración', 10)
on conflict (id) do nothing;

insert into public.dosifier_types (id, code, name, sort_order) values
  ('70000000-0000-0000-0000-000000000001', 'DOS-01', 'Dosificador estándar', 10)
on conflict (id) do nothing;
