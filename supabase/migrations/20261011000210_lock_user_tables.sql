-- Fase F2 / Phase 4 re-auditoría (MAJOR-A): profiles y operator_machine_assignments solo se escriben
-- mediante public.manage_user_assignments (security definer, service_role). Se cierran las escrituras
-- directas por PostgREST con la sesión de un manager, que se saltaban la matriz de gestión, FR-005a y la auditoría.
-- Se conservan las políticas SELECT. El trigger handle_new_user (definer) y la RPC no dependen de estos grants.
drop policy if exists profiles_manager_update on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists assignments_manager_insert on public.operator_machine_assignments;
drop policy if exists assignments_manager_update on public.operator_machine_assignments;
drop policy if exists assignments_manager_delete on public.operator_machine_assignments;
drop policy if exists assignments_admin_insert on public.operator_machine_assignments;
drop policy if exists assignments_admin_update on public.operator_machine_assignments;
drop policy if exists assignments_admin_delete on public.operator_machine_assignments;

revoke insert, update, delete, truncate on public.profiles from authenticated, anon;
revoke insert, update, delete, truncate on public.operator_machine_assignments from authenticated, anon;
