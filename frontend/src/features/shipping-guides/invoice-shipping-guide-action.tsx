// "Nueva guía de remisión" en el detalle de la factura (add-shipping-guides, design D12 y D25): solo
// para una factura autorizada del ambiente vigente y con `shippingGuides.draft`, también a consumidor
// final (el destinatario de la guía es otro tercero identificado). Es una opción del menú de más
// acciones del encabezado: crea el borrador propuesto desde la factura (su comprador, la factura como
// sustento y las mercancías sugeridas) y abre el editor. Es presentación: la API vuelve a comprobar
// la factura al crear el borrador y al emitir.
"use client";

import type { InvoiceView } from "@facturador/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import type { HeaderAction } from "@/components/layout/header-actions-menu";
import { useSession } from "@/components/session";
import { canSee } from "@/lib/permissions";
import { useCompanyStatus } from "@/features/company/company-api";
import { SHIPPING_GUIDE_DRAFTS_KEY, useSaveShippingGuideDraft } from "./shipping-guides-api";

/** La opción del menú, o `null` si la factura no la admite, y si su borrador se está creando. */
export function useInvoiceShippingGuideAction(
  invoice: Pick<InvoiceView, "id" | "state" | "environment">,
): { action: HeaderAction | null; pending: boolean } {
  const { me } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canDraft = canSee(me.role, "shippingGuides.draft");
  const status = useCompanyStatus();
  const create = useSaveShippingGuideDraft({
    success: "Preparaste la guía de remisión desde la factura.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...SHIPPING_GUIDE_DRAFTS_KEY, "detail", draft.id], draft);
      router.push(`/guias-remision/borradores/${draft.id}`);
    },
    // El aviso del error lo muestra la retroalimentación compartida.
    onError: () => false,
  });
  const eligible =
    invoice.state === "AUTHORIZED" && status.data?.environment === invoice.environment;
  const action: HeaderAction | null =
    canDraft && eligible
      ? {
          key: "guia-remision",
          label: "Nueva guía de remisión",
          icon: Truck,
          disabled: create.isPending,
          onSelect: () => create.mutate({ id: null, input: { fromInvoiceId: invoice.id } }),
        }
      : null;
  return { action, pending: create.isPending };
}
