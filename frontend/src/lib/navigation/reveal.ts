// Destino actual a la vista dentro de la barra lateral (adopt-premium-design-foundation-and-shell,
// design D23; spec web-application-shell, «Destino actual a la vista al cargar»). Equivale a
// `scrollIntoView({ block: "nearest" })`, pero solo desplaza la barra: nunca la página.

/** Margen que queda entre el destino y el borde de la barra al desplazarla. */
const MARGIN = 8;

/**
 * Desplaza `container` lo justo para que `element` quede entero dentro de su área visible. No hace
 * nada si ya se ve entero. Devuelve el desplazamiento aplicado, en píxeles (0 si no se movió).
 */
export function revealWithin(
  container: HTMLElement,
  element: HTMLElement,
  behavior: ScrollBehavior,
): number {
  const area = container.getBoundingClientRect();
  const target = element.getBoundingClientRect();
  let delta = 0;
  if (target.top < area.top) delta = target.top - area.top - MARGIN;
  else if (target.bottom > area.bottom) delta = target.bottom - area.bottom + MARGIN;
  if (delta !== 0) container.scrollBy({ top: delta, behavior });
  return delta;
}

/** Sin animación si el usuario pide movimiento reducido. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
