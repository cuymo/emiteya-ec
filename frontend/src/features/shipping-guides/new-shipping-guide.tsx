// Nueva guía de remisión sobre la lista (decisión del propietario, 2026-10-22): el botón prepara el
// borrador con el punto de emisión predeterminado y abre su editor, sin la página intermedia que solo
// tenía un texto y un botón.
// La creación rápida llega con `?nueva` y no crea por sí misma (spec «Creación rápida»): la lista
// pide confirmar antes de preparar el borrador.
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage, toast } from "@/components/feedback";
import { useCreationDialog } from "@/features/documents/new-document";
import { useDefaultEmissionPoint } from "@/features/establishments/establishments-api";
import {
  SHIPPING_GUIDE_DRAFTS_KEY,
  SHIPPING_GUIDE_CONFLICT_MESSAGES,
  useSaveShippingGuideDraft,
} from "./shipping-guides-api";

/** «Nueva guía de remisión» de la lista: `start` prepara el borrador; `element`, la confirmación de `?nueva`. */
export function useNewShippingGuide(enabled: boolean) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dialog = useCreationDialog(enabled);
  const defaultPoint = useDefaultEmissionPoint(enabled);
  const create = useSaveShippingGuideDraft({
    success: "Preparaste el borrador de la guía de remisión.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...SHIPPING_GUIDE_DRAFTS_KEY, "detail", draft.id], draft);
      router.push(`/guias-remision/borradores/${draft.id}`);
    },
    onError: (failure) => {
      dialog.close();
      const message = errorMessage(failure, SHIPPING_GUIDE_CONFLICT_MESSAGES);
      toast.error(message, { id: message });
      return true;
    },
  });
  const prepare = () => {
    const point = defaultPoint.data?.available ? defaultPoint.data.emissionPoint.id : null;
    create.mutate({ id: null, input: point ? { emissionPointId: point } : {} });
  };
  const pending = create.isPending || defaultPoint.isPending;
  return {
    start: prepare,
    pending,
    element: enabled ? (
      <ConfirmDialog
        open={dialog.open}
        onOpenChange={(next) => (next ? dialog.show() : dialog.close())}
        title="Nueva guía de remisión"
        description={
          <p>
            Prepara la guía antes de que salga la mercadería: el transportista, la placa, las fechas
            y cada destinatario con su sustento. Para una venta, también puedes empezar desde el
            detalle de una factura autorizada.
          </p>
        }
        confirmLabel="Preparar borrador"
        pending={pending}
        onConfirm={prepare}
      />
    ) : null,
  };
}
