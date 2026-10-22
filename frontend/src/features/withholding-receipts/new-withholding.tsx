// Nueva retención sobre la lista (decisión del propietario, 2026-10-22): el botón abre el selector de
// proveedores encima de la tabla; elegir o registrar el proveedor crea el borrador con el período del
// mes de hoy y abre su editor.
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { errorMessage, toast } from "@/components/feedback";
import { useCreationDialog } from "@/features/documents/new-document";
import { SupplierChooser } from "./supplier-chooser";
import {
  WITHHOLDING_CONFLICT_MESSAGES,
  WITHHOLDING_DRAFTS_KEY,
  useSaveWithholdingDraft,
} from "./withholding-receipts-api";

/** «Nueva retención» de la lista: `start` abre el selector y `element` lo dibuja una vez. */
export function useNewWithholding(enabled: boolean) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dialog = useCreationDialog(enabled);
  const create = useSaveWithholdingDraft({
    success: "Preparaste el borrador de la retención.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...WITHHOLDING_DRAFTS_KEY, "detail", draft.id], draft);
      router.push(`/retenciones/borradores/${draft.id}`);
    },
    onError: (failure) => {
      dialog.close();
      const message = errorMessage(failure, WITHHOLDING_CONFLICT_MESSAGES);
      toast.error(message, { id: message });
      return true;
    },
  });
  return {
    start: dialog.show,
    pending: create.isPending,
    element: enabled ? (
      <SupplierChooser
        open={dialog.open}
        // Elegir o registrar también cierran el selector: la creación sigue en el editor.
        onOpenChange={(next) => (next ? dialog.show() : dialog.leave())}
        onChoose={(subject) => create.mutate({ id: null, input: { partyId: subject.id } })}
        onDismiss={dialog.close}
      />
    ) : null,
  };
}
