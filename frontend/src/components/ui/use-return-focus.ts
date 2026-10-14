// Devolución del foco de las capas modales controladas (diálogo y panel lateral). Radix solo devuelve
// el foco a su propio disparador; un diálogo que se abre desde otro control (un menú, un atajo de
// teclado, el botón de menú del shell) recuerda quién tenía el foco al abrirse y se lo devuelve al
// cerrarse, si sigue en el documento.
import { useRef } from "react";

type AutoFocusHandler = (event: Event) => void;

export function useReturnFocus(handlers: {
  onOpenAutoFocus?: AutoFocusHandler;
  onCloseAutoFocus?: AutoFocusHandler;
}): { onOpenAutoFocus: AutoFocusHandler; onCloseAutoFocus: AutoFocusHandler } {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event) => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      handlers.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event) => {
      handlers.onCloseAutoFocus?.(event);
      if (!event.defaultPrevented && opener.current?.isConnected) {
        event.preventDefault();
        opener.current.focus();
      }
    },
  };
}
