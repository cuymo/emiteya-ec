// Nueva nota de crédito sobre la lista (decisión del propietario, 2026-10-22): el botón abre el
// selector de las facturas elegibles encima de la tabla y elegir una lleva al editor de la nota con
// esa factura (`/notas-credito/borradores/nueva?factura={id}`), que crea el borrador al guardar.
"use client";

import type { EligibleInvoiceView } from "@facturador/contracts";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { formatUsd } from "@/lib/decimal";
import { useCreationDialog } from "@/features/documents/new-document";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { CREDIT_NOTES_KEY, fetchEligibleInvoices } from "./credit-notes-api";

/** El editor de una nota nueva con su factura ya elegida. */
export const newCreditNoteHref = (invoiceId: string) =>
  `/notas-credito/borradores/nueva?factura=${encodeURIComponent(invoiceId)}`;

/** Las facturas autorizadas, identificadas y con valor acreditable, con búsqueda. */
export function CreditInvoicePicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (invoice: EligibleInvoiceView) => void;
}) {
  return (
    <EntityPickerDialog<EligibleInvoiceView>
      open={open}
      onOpenChange={onOpenChange}
      title="Elegir factura"
      searchLabel="Buscar por número o comprador"
      searchPlaceholder="Número o comprador"
      queryKey={[...CREDIT_NOTES_KEY, "eligible-invoices"]}
      fetchPage={fetchEligibleInvoices}
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
          <span className="text-sm tabular-nums">Disponible {formatUsd(invoice.available)}</span>
        </span>
      )}
      onSelect={onSelect}
      emptyTitle="No hay facturas elegibles"
      emptyDescription="Una nota de crédito corrige una factura autorizada, identificada y con valor acreditable."
    />
  );
}

/** «Nueva nota de crédito» de la lista: `start` abre el selector y `element` lo dibuja una vez. */
export function useNewCreditNote(enabled: boolean) {
  const router = useRouter();
  const dialog = useCreationDialog(enabled);
  // Elegir también cierra el selector: no es abandonarlo, y la URL la cambia la navegación.
  const chose = useRef(false);
  return {
    start: () => {
      chose.current = false;
      dialog.show();
    },
    pending: false,
    element: enabled ? (
      <CreditInvoicePicker
        open={dialog.open}
        onOpenChange={(next) => {
          if (next) return dialog.show();
          if (chose.current) dialog.leave();
          else dialog.close();
        }}
        onSelect={(invoice) => {
          chose.current = true;
          router.push(newCreditNoteHref(invoice.id));
        }}
      />
    ) : null,
  };
}
