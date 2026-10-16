// "Emitir nota de débito" en el detalle de la factura (add-debit-notes, design D23): solo para una
// factura autorizada, que no es a consumidor final, del ambiente vigente y con `debitNotes.draft`. Es
// una opción del menú de más acciones del encabezado. Es presentación: la API vuelve a comprobar la
// elegibilidad al crear el borrador y al emitir.
"use client";

import type { InvoiceView } from "@facturador/contracts";
import { FilePlus } from "lucide-react";
import type { HeaderAction } from "@/components/layout/header-actions-menu";
import { useSession } from "@/components/session";
import { canSee } from "@/lib/permissions";
import { useCompanyStatus } from "@/features/company/company-api";

export function useInvoiceDebitNoteAction(
  invoice: Pick<InvoiceView, "id" | "state" | "environment"> & {
    buyer: Pick<InvoiceView["buyer"], "consumerFinal">;
  },
): HeaderAction | null {
  const { me } = useSession();
  const canDraft = canSee(me.role, "debitNotes.draft");
  const status = useCompanyStatus();
  const eligible =
    invoice.state === "AUTHORIZED" &&
    !invoice.buyer.consumerFinal &&
    status.data?.environment === invoice.environment;
  if (!canDraft || !eligible) return null;
  return {
    key: "nota-debito",
    label: "Emitir nota de débito",
    icon: FilePlus,
    href: `/notas-debito/borradores/nueva?factura=${encodeURIComponent(invoice.id)}`,
  };
}
