// Pestañas del detalle de un comprobante (decisión del propietario, 2026-10-16): separan la
// información para no saturar la pantalla. El encabezado, con el estado y las acciones, y el panel de
// totales quedan fuera, siempre a la vista. La primera pestaña es la del contenido del comprobante;
// las demás, la transmisión al SRI, el RIDE y el XML, y lo propio de cada tipo. La pestaña elegida va
// en la dirección (`?seccion=`), para volver a ella al recargar o al compartir el enlace; una
// pestaña con algo que atender lleva un punto con su nombre accesible.
"use client";

import type { InvoiceState } from "@facturador/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DetailTab = {
  id: string;
  label: string;
  content: ReactNode;
  /** Algo de esta pestaña pide atención, como una transmisión detenida. */
  attention?: boolean;
};

/** Estados de la transmisión que piden que alguien la revise; también la transmisión detenida. */
const ATTENTION_STATES: readonly InvoiceState[] = [
  "SEND_UNKNOWN",
  "MANUAL_REVIEW",
  "RETURNED",
  "NOT_AUTHORIZED",
];
export const transmissionNeedsAttention = (state: InvoiceState, stopped: boolean) =>
  stopped || ATTENTION_STATES.includes(state);

export function DocumentDetailTabs({ tabs, label }: { tabs: readonly DetailTab[]; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("seccion");
  const [active, setActive] = useState(
    tabs.some((tab) => tab.id === requested) ? requested! : tabs[0]!.id,
  );
  const select = (id: string) => {
    setActive(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id === tabs[0]!.id) params.delete("seccion");
    else params.set("seccion", id);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  return (
    // `min-w-0`: en la rejilla del detalle, las pestañas que no caben se desplazan en su fila en lugar
    // de ensanchar la página (a 390 px, cuatro pestañas desbordaban 96 px).
    <Tabs
      value={active}
      onValueChange={select}
      data-slot="document-detail-tabs"
      className="min-w-0"
    >
      <TabsList aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
            {tab.attention && (
              <>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                <span className="sr-only">, requiere atención</span>
              </>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
