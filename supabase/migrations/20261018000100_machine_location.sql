-- Ubicación de la máquina: texto libre opcional (máx. 120 caracteres) para ubicarla en planta.
-- RLS y grants no cambian: la lectura sigue abierta a usuarios activos (machines_select) y la escritura
-- queda para los gestores (ROOT y coordinador) por las políticas vigentes; los grants de tabla (insert, update)
-- cubren la nueva columna. El trigger machines_admin_audit (audit_admin_entity) compara la fila completa,
-- así que el cambio de «location» se audita igual que el de las demás columnas.
alter table public.machines add column location text;

alter table public.machines
  add constraint machines_location_length
  check (location is null or char_length(btrim(location)) between 1 and 120);
