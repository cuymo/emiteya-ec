// Tecla modificadora de los atajos del shell, solo para mostrarla: ⌘ en Mac, Ctrl en el resto. Los
// atajos aceptan las dos. En el servidor se muestra Ctrl.
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function useModifierLabel(): string {
  return useSyncExternalStore(
    subscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}
