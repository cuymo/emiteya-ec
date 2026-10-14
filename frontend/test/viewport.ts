// Anchura simulada para las consultas de medios (`matchMedia`) de jsdom: evalúa `min-width` y
// `max-width` en píxeles contra la anchura dada. El setup deja todas las consultas en `false`.
const original = window.matchMedia;

function evaluate(query: string, width: number): boolean {
  const max = /max-width:\s*(\d+)px/.exec(query);
  const min = /min-width:\s*(\d+)px/.exec(query);
  if (!max && !min) return false;
  return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
}

export function setViewportWidth(width: number): void {
  window.matchMedia = ((query: string) => ({
    matches: evaluate(query, width),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

export function resetViewport(): void {
  window.matchMedia = original;
}
