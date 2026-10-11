-- Usuarios locales de desarrollo (solo existen en el stack local).
-- Todas las cuentas usan la contraseña "Planta2026!" y el correo sintético <usuario>@usuarios.reporte-produccion.invalid.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'root@usuarios.reporte-produccion.invalid', extensions.crypt('Planta2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Administrador Raíz","username":"root"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'coord1@usuarios.reporte-produccion.invalid', extensions.crypt('Planta2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Coordinador Uno","username":"coord1"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'auditor1@usuarios.reporte-produccion.invalid', extensions.crypt('Planta2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Auditor Uno","username":"auditor1"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'op1@usuarios.reporte-produccion.invalid', extensions.crypt('Planta2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Operario Uno","username":"op1"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'op2@usuarios.reporte-produccion.invalid', extensions.crypt('Planta2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Operario Dos","username":"op2"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', '{"sub":"10000000-0000-0000-0000-000000000004","email":"root@usuarios.reporte-produccion.invalid"}', 'email', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '{"sub":"10000000-0000-0000-0000-000000000001","email":"coord1@usuarios.reporte-produccion.invalid"}', 'email', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '{"sub":"10000000-0000-0000-0000-000000000003","email":"auditor1@usuarios.reporte-produccion.invalid"}', 'email', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '{"sub":"10000000-0000-0000-0000-000000000002","email":"op1@usuarios.reporte-produccion.invalid"}', 'email', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', '{"sub":"10000000-0000-0000-0000-000000000005","email":"op2@usuarios.reporte-produccion.invalid"}', 'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

update public.profiles set role = 'ROOT', active = true, job_title = 'Administrador raíz'
where id = '10000000-0000-0000-0000-000000000004';
update public.profiles set role = 'ADMINISTRATOR', active = true, job_title = 'Coordinador'
where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set role = 'VIEWER', active = true, job_title = 'Auditor'
where id = '10000000-0000-0000-0000-000000000003';
update public.profiles set role = 'OPERATOR', active = true, job_title = 'Operario'
where id = '10000000-0000-0000-0000-000000000002';
update public.profiles set role = 'OPERATOR', active = true, job_title = 'Operario'
where id = '10000000-0000-0000-0000-000000000005';

insert into public.machines (id, code, name) values
  ('30000000-0000-0000-0000-000000000001', 'M-01', 'Empacadora 1'),
  ('30000000-0000-0000-0000-000000000002', 'M-02', 'Empacadora 2'),
  ('30000000-0000-0000-0000-000000000003', 'M-03', 'Empacadora 3')
on conflict (id) do nothing;

-- Asignaciones por turno: op1 trabaja las tres máquinas en todos los turnos;
-- op2 trabaja M-02 y M-03 en los turnos Tarde y Noche.
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, active, created_by)
select '10000000-0000-0000-0000-000000000002', m.id, s.id, '2026-01-01', true, '10000000-0000-0000-0000-000000000001'
from public.machines m cross join public.shifts s
where m.code in ('M-01', 'M-02', 'M-03') and s.active
on conflict (operator_id, machine_id, shift_id) where active do nothing;
insert into public.operator_machine_assignments (operator_id, machine_id, shift_id, valid_from, active, created_by)
select '10000000-0000-0000-0000-000000000005', m.id, s.id, '2026-01-01', true, '10000000-0000-0000-0000-000000000001'
from public.machines m cross join public.shifts s
where m.code in ('M-02', 'M-03') and s.name in ('Tarde', 'Noche') and s.active
on conflict (operator_id, machine_id, shift_id) where active do nothing;

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
