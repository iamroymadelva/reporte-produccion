interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string | null; message?: string | null } | null }>;
}

export interface CatalogDeleteLabel {
  /** Sustantivo con mayúscula inicial, p. ej. "Máquina". */
  label: string;
  /** true para sustantivos femeninos (eliminada/desactivada). */
  feminine?: boolean;
}

/**
 * "Eliminar" = borrar si no hay referencias, desactivar si el elemento está en uso (delete_or_deactivate).
 * Devuelve el resultado y el mensaje listo para mostrar.
 */
export async function deleteOrDeactivateCatalogItem(supabase: RpcClient, catalog: string, id: string, { label, feminine = false }: CatalogDeleteLabel) {
  const suffix = feminine ? "a" : "o";
  const lower = label.toLocaleLowerCase("es-CO");
  if (!id) return { ok: false as const, message: `${label} inválid${suffix}.` };
  const { data, error } = await supabase.rpc("delete_or_deactivate", { catalog, item_id: id });
  if (error) {
    if (error.code === "42501") return { ok: false as const, message: "No tienes permisos de administración." };
    if (error.code === "P0002") return { ok: false as const, message: `${label} no existe.` };
    return { ok: false as const, message: `No fue posible eliminar ${feminine ? "la" : "el"} ${lower}.` };
  }
  const action = (data as { action?: string } | null)?.action;
  if (action === "deactivated") return { ok: true as const, action, message: `${label} desactivad${suffix} porque está en uso.` };
  return { ok: true as const, action: "deleted" as const, message: `${label} eliminad${suffix}.` };
}
