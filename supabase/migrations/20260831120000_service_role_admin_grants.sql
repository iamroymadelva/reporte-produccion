-- Acceso mínimo requerido por createSupabaseAdminClient().
grant usage on schema public to service_role;

-- Invitación, edición, retiro y reactivación de perfiles existentes.
revoke insert, delete on table public.profiles from service_role;
grant select, update on table public.profiles to service_role;

-- Validación de máquinas activas durante la reactivación.
grant select on table public.machines to service_role;

-- Edición, retiro, reactivación y compensación de asignaciones.
grant select, insert, update, delete
on table public.operator_machine_assignments
to service_role;

-- Auditoría explícita de retiro y reactivación.
grant insert
on table public.administrative_audit_log
to service_role;

-- Generación del identity de administrative_audit_log.id.
grant usage
on sequence public.administrative_audit_log_id_seq
to service_role;
