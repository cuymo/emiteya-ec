// Nueva liquidación de compra sobre la lista (decisión del propietario, 2026-10-22): el botón prepara
// el borrador con el punto de emisión predeterminado y abre su editor, sin la página intermedia que
// solo tenía un texto y un botón.
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
  PURCHASE_SETTLEMENT_DRAFTS_KEY,
  PURCHASE_SETTLEMENT_CONFLICT_MESSAGES,
  useSavePurchaseSettlementDraft,
} from "./purchase-settlements-api";

/** «Nueva liquidación de compra» de la lista: `start` prepara el borrador; `element`, la confirmación de `?nueva`. */
export function useNewPurchaseSettlement(enabled: boolean) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dialog = useCreationDialog(enabled);
  const defaultPoint = useDefaultEmissionPoint(enabled);
  const create = useSavePurchaseSettlementDraft({
    success: "Preparaste el borrador de la liquidación de compra.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...PURCHASE_SETTLEMENT_DRAFTS_KEY, "detail", draft.id], draft);
      router.push(`/liquidaciones-compra/borradores/${draft.id}`);
    },
    onError: (failure) => {
      dialog.close();
      const message = errorMessage(failure, PURCHASE_SETTLEMENT_CONFLICT_MESSAGES);
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
        title="Nueva liquidación de compra"
        description={
          <p>
            Documenta la adquisición de bienes muebles o servicios a una persona natural no obligada
            a llevar contabilidad que, sin RUC o con su RUC suspendido, no puede emitir comprobantes
            de venta por su nivel cultural o rusticidad. Al emitir confirmarás esas condiciones como
            declaraciones tuyas.
          </p>
        }
        confirmLabel="Preparar borrador"
        pending={pending}
        onConfirm={prepare}
      />
    ) : null,
  };
}
