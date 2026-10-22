// Crear un comprobante empieza sobre su propia lista (decisión del propietario, 2026-10-22): «Nueva
// nota de crédito» abre el selector de la factura encima de la tabla, sin una página intermedia con
// un texto y un botón. La creación rápida y la paleta llegan con `?nueva=1`, que abre lo mismo; la
// lista quita el parámetro al cerrarlo sin elegir.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export const NEW_PARAM = "nueva";

/** La lista de un comprobante con su creación abierta, como `/notas-credito?nueva=1`. */
export const newDocumentHref = (list: string) => `${list}?${NEW_PARAM}=1`;

/**
 * El diálogo de creación de una lista: se abre con `open()` o al llegar `?nueva`, y `close()` lo
 * cierra quitando el parámetro. `leave()` lo cierra sin tocar la URL, para cuando la creación sigue
 * en otra pantalla: quitar el parámetro competiría con esa navegación.
 */
export function useCreationDialog(enabled: boolean) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = enabled && params.has(NEW_PARAM);
  const [open, setOpen] = useState(requested);
  // Cada llegada de `?nueva` (por ejemplo, desde la creación rápida con la lista abierta) lo abre.
  const [seen, setSeen] = useState(requested);
  if (requested !== seen) {
    setSeen(requested);
    if (requested) setOpen(true);
  }
  return {
    open,
    /** Si el diálogo se abrió desde la URL: el permiso decide si la petición vale. */
    requested,
    show: () => setOpen(true),
    leave: () => setOpen(false),
    close: () => {
      setOpen(false);
      if (!params.has(NEW_PARAM)) return;
      const next = new URLSearchParams(params.toString());
      next.delete(NEW_PARAM);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
  };
}
