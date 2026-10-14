// Filtro de la paleta de comandos (adopt-premium-design-foundation-and-shell, design D13; spec
// web-application-shell, «Paleta de comandos»): sin distinguir mayúsculas ni tildes, sobre la etiqueta
// y las palabras clave de cada destino o acción. Determinista y sin red. Devuelve la relevancia que
// cmdk usa para ordenar: 1 si empieza por lo escrito, 0.5 si lo contiene y 0 si no coincide.

/** Minúsculas y sin diacríticos («crédito» → «credito»). */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function paletteFilter(
  value: string,
  search: string,
  keywords: readonly string[] = [],
): number {
  const query = normalize(search);
  if (query === "") return 1;
  let best = 0;
  for (const candidate of [value, ...keywords].map(normalize)) {
    if (
      candidate.startsWith(query) ||
      candidate.split(/\s+/).some((word) => word.startsWith(query))
    ) {
      return 1;
    }
    if (candidate.includes(query)) best = 0.5;
  }
  return best;
}
