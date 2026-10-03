// Claves de búsqueda de terceros y productos (add-parties-and-products, design D10): se calculan al
// escribir y el texto buscado pasa por la misma función, así la búsqueda no distingue mayúsculas,
// minúsculas ni tildes sin depender de extensiones de PostgreSQL.

/** NFD sin marcas diacríticas, en minúsculas y con los espacios colapsados. */
export function searchKey(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Escapa los comodines de LIKE (`%`, `_` y la barra) para buscar el texto literal. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
