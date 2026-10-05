// "Emitir nota de débito" en el detalle de la factura (add-debit-notes, design D23): solo para una
// factura autorizada, que no es a consumidor final, del ambiente vigente y con `debitNotes.draft`.
// Es presentación: la API vuelve a comprobar la elegibilidad al crear el borrador y al emitir.
"use client";

import type { InvoiceView } from "@facturador/contracts";
import { FilePlus } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/components/session";
import { Button } from "@/components/ui/button";
import { canSee } from "@/lib/permissions";
import { useCompanyStatus } from "@/features/company/company-api";

export function InvoiceDebitNoteAction({
  invoice,
}: {
  invoice: Pick<InvoiceView, "id" | "state" | "environment"> & {
    buyer: Pick<InvoiceView["buyer"], "consumerFinal">;
  };
}) {
  const { me } = useSession();
  const canDraft = canSee(me.role, "debitNotes.draft");
  const status = useCompanyStatus();
  const eligible =
    invoice.state === "AUTHORIZED" &&
    !invoice.buyer.consumerFinal &&
    status.data?.environment === invoice.environment;
  if (!canDraft || !eligible) return null;
  return (
    <Button asChild variant="outline">
      <Link href={`/notas-debito/borradores/nueva?factura=${encodeURIComponent(invoice.id)}`}>
        <FilePlus aria-hidden="true" />
        Emitir nota de débito
      </Link>
    </Button>
  );
}
