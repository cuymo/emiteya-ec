// Derivado de la plantilla «Studio Admin» 2.2.0, `src/hooks/use-mobile.ts` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Adaptado (adopt-premium-design-foundation-and-shell, design D6):
// se suscribe a `matchMedia` con `useSyncExternalStore` en lugar de copiar el estado en un efecto, y
// expone `useMediaQuery` para las demás decisiones por anchura del shell.
import { useCallback, useSyncExternalStore } from "react";

/** Corte de móvil de navigation-responsive.md: por debajo, la barra lateral es un panel. */
export const MOBILE_BREAKPOINT = 768;

/** true mientras la consulta de medios se cumple; en el servidor, siempre false. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
