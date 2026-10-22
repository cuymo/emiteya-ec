// Nueva nota de débito sobre la lista (decisión del propietario, 2026-10-22): el botón abre el
// selector de las facturas elegibles encima de la tabla; elegir una crea el borrador, porque los
// tratamientos que se ofrecen son los de la factura y los devuelve la vista previa del servidor, y
// abre su editor.
"use client";

import type { DebitEligibleInvoiceView } from "@facturador/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { errorMessage, toast } from "@/components/feedback";
import { formatUsd } from "@/lib/decimal";
import { useCreationDialog } from "@/features/documents/new-document";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import {
  DEBIT_NOTE_CONFLICT_MESSAGES,
  DEBIT_NOTE_DRAFTS_KEY,
  DEBIT_NOTES_KEY,
  fetchDebitEligibleInvoices,
  useSaveDebitNoteDraft,
} from "./debit-notes-api";

/** Las facturas autorizadas, identificadas y del ambiente vigente, con búsqueda. */
export function DebitInvoicePicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (invoice: DebitEligibleInvoiceView) => void;
}) {
  return (
    <EntityPickerDialog<DebitEligibleInvoiceView>
      open={open}
      onOpenChange={onOpenChange}
      title="Elegir factura"
      searchLabel="Buscar por número o comprador"
      searchPlaceholder="Número o comprador"
      queryKey={[...DEBIT_NOTES_KEY, "eligible-invoices"]}
      fetchPage={fetchDebitEligibleInvoices}
      getKey={(invoice) => invoice.id}
      getLabel={(invoice) => `Factura ${invoice.documentNumber}, ${invoice.buyerName}`}
      renderItem={(invoice) => (
        <span className="flex w-full items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-medium tabular-nums">{invoice.documentNumber}</span>
            <span className="text-sm break-words text-foreground-muted">
              {invoice.buyerName} · {formatIssueDate(invoice.issueDate)}
            </span>
          </span>
          <span className="text-sm tabular-nums">{formatUsd(invoice.total)}</span>
        </span>
      )}
      onSelect={onSelect}
      emptyTitle="No hay facturas elegibles"
      emptyDescription="Una nota de débito modifica una factura autorizada, identificada y del ambiente vigente."
    />
  );
}

/**
 * Prepara el borrador de la nota de débito de una factura y abre su editor. Desde la lista, el
 * editor se agrega al historial y el error va en un aviso; desde la página de la factura elegida,
 * la reemplaza (volver no ofrece prepararla otra vez) y el error lo muestra esa página.
 */
export function useCreateDebitNoteDraft({
  replace = false,
  onError,
}: { replace?: boolean; onError?: (message: string) => void } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useSaveDebitNoteDraft({
    success: "Preparaste el borrador de la nota de débito.",
    onSuccess: (draft) => {
      queryClient.setQueryData([...DEBIT_NOTE_DRAFTS_KEY, "detail", draft.id], draft);
      const editor = `/notas-debito/borradores/${draft.id}`;
      if (replace) router.replace(editor);
      else router.push(editor);
    },
    onError: (failure) => {
      const message = errorMessage(failure, DEBIT_NOTE_CONFLICT_MESSAGES);
      if (onError) onError(message);
      else toast.error(message, { id: message });
      return true;
    },
  });
}

/** «Nueva nota de débito» de la lista: `start` abre el selector y `element` lo dibuja una vez. */
export function useNewDebitNote(enabled: boolean) {
  const dialog = useCreationDialog(enabled);
  // Elegir también cierra el selector: no es abandonarlo, y la URL la cambia la navegación.
  const chose = useRef(false);
  const create = useCreateDebitNoteDraft({
    onError: (message) => {
      dialog.close();
      toast.error(message, { id: message });
    },
  });
  return {
    start: () => {
      chose.current = false;
      dialog.show();
    },
    pending: create.isPending,
    element: enabled ? (
      <DebitInvoicePicker
        open={dialog.open}
        onOpenChange={(next) => {
          if (next) return dialog.show();
          if (chose.current) dialog.leave();
          else dialog.close();
        }}
        onSelect={(invoice) => {
          chose.current = true;
          create.mutate({ id: null, input: { invoiceId: invoice.id } });
        }}
      />
    ) : null,
  };
}
