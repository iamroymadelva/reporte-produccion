type DatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const duplicateMessages = [
  { names: ["machines_code_key", "machines_code_normalized_unique"], message: "Ya existe una máquina con este código." },
  { names: ["machines_name_normalized_unique"], message: "Ya existe una máquina con este nombre." },
  { names: ["products_code_key", "products_code_normalized_unique"], message: "Ya existe un producto con este código." },
  { names: ["products_name_case_insensitive_unique"], message: "Ya existe un producto con este nombre." },
  { names: ["clients_code_key", "clients_code_normalized_unique"], message: "Ya existe un cliente con este código." },
  { names: ["clients_name_case_insensitive_unique"], message: "Ya existe un cliente con este nombre." },
  { names: ["lines_code_key", "lines_code_normalized_unique"], message: "Ya existe un área/línea con este código." },
  { names: ["lines_name_normalized_unique"], message: "Ya existe un área/línea con este nombre." },
  { names: ["dosifier_types_code_key", "dosifier_types_code_normalized_unique"], message: "Ya existe un tipo de dosificador con este código." },
  { names: ["dosifier_types_name_normalized_unique"], message: "Ya existe un tipo de dosificador con este nombre." },
  { names: ["shifts_name_normalized_unique"], message: "Ya existe un turno con este nombre." },
  { names: ["stop_categories_code_key", "stop_categories_numeric_code_unique"], message: "Ya existe una categoría de parada con este código." },
  { names: ["stop_categories_name_normalized_unique"], message: "Ya existe una categoría de parada con este nombre." },
] as const;

export function adminCatalogErrorMessage(error: DatabaseError | null | undefined, fallback: string) {
  if (error?.code !== "23505") return fallback;
  const diagnostic = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  const match = duplicateMessages.find((item) => item.names.some((name) => diagnostic.includes(name)));
  return match?.message ?? "Ya existe otro registro con los mismos datos únicos.";
}
