// Etiqueta del registro en la última miga (adopt-premium-design-foundation-and-shell, design D15).
// Una pantalla de detalle aporta el número del comprobante o el nombre del producto; mientras no lo
// tiene, la miga muestra la etiqueta de la ruta. Fuera del shell no hace nada, así que las pantallas
// se prueban aisladas sin cambios.
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type BreadcrumbLabelState = {
  label: string | null;
  setLabel: (label: string | null) => void;
};

const BreadcrumbLabelContext = createContext<BreadcrumbLabelState | null>(null);

export function BreadcrumbLabelProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return (
    <BreadcrumbLabelContext.Provider value={{ label, setLabel }}>
      {children}
    </BreadcrumbLabelContext.Provider>
  );
}

/** La pantalla declara la etiqueta de su registro; se retira al desmontarse. */
export function useBreadcrumbLabel(label: string | null | undefined): void {
  const context = useContext(BreadcrumbLabelContext);
  const setLabel = context?.setLabel;
  useEffect(() => {
    if (!setLabel) return;
    setLabel(label ?? null);
    return () => setLabel(null);
  }, [label, setLabel]);
}

export function useBreadcrumbLabelValue(): string | null {
  return useContext(BreadcrumbLabelContext)?.label ?? null;
}
