// "Nueva guía de remisión" en el detalle de la factura (add-shipping-guides, design D12 y D25): solo
// para una factura autorizada del ambiente vigente y con `shippingGuides.draft`, también a consumidor
// final (el destinatario de la guía es otro tercero identificado). Crea el borrador propuesto desde la
// factura (su comprador, la factura como sustento y las mercancías sugeridas) y abre el editor. Es
// presentación: la API vuelve a comprobar la factura al crear el borrador y al emitir.
"use client";

import type { InvoiceView } from "@facturador/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { canSee } from "@/lib/permissions";
import { useCompanyStatus } from "@/features/company/company-api";
import { SHIPPING_GUIDE_DRAFTS_KEY, useSaveShippingGuideDraft } from "./shipping-guides-api";

export function InvoiceShippingGuideAction({
  invoice,
}: {
  invoice: Pick<InvoiceView, "id" | "state" | "environment">;
}) {
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
  if (!canDraft || !eligible) return null;
  return (
    <AsyncButton
      variant="outline"
      pending={create.isPending}
      onClick={() => create.mutate({ id: null, input: { fromInvoiceId: invoice.id } })}
    >
      <Truck aria-hidden="true" />
      Nueva guía de remisión
    </AsyncButton>
  );
}
