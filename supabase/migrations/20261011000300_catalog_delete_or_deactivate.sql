-- Fase F2 / T038: "eliminar" significa desactivar cuando el elemento está en uso (feature 001, US4).
-- Intenta el DELETE; si alguna FK lo impide, desactiva (active = false). Los triggers de auditoría de
-- borrado solo dejan huella cuando el DELETE se confirma (el sub-bloque revierte sus efectos si falla).
create function public.delete_or_deactivate(catalog text, item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found integer;
begin
  if not private.is_manager() then
    raise exception 'Management not permitted' using errcode = '42501';
  end if;
  if catalog is null or catalog <> all (array[
    'machines', 'lines', 'clients', 'products', 'dosifier_types', 'shifts', 'stop_categories', 'change_types'
  ]) then
    raise exception 'Catalog not allowed';
  end if;

  execute format('select 1 from public.%I where id = $1', catalog) into v_found using item_id;
  if v_found is null then
    raise exception 'Catalog item not found' using errcode = 'P0002';
  end if;

  begin
    execute format('delete from public.%I where id = $1', catalog) using item_id;
    return jsonb_build_object('action', 'deleted');
  exception when foreign_key_violation or restrict_violation then
    execute format('update public.%I set active = false where id = $1', catalog) using item_id;
    return jsonb_build_object('action', 'deactivated');
  end;
end;
$$;

revoke all on function public.delete_or_deactivate(text, uuid) from public, anon, authenticated;
grant execute on function public.delete_or_deactivate(text, uuid) to authenticated;
