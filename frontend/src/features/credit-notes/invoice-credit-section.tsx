// Crédito de una factura autorizada en su detalle (add-credit-notes, design D19). Usuario:
// administrador u operador. Decisión: si la factura admite otra nota de crédito. Información mínima:
// el crédito aplicado (notas autorizadas), el reservado (notas en curso) y el disponible. Acción:
// "Emitir nota de crédito", solo si la factura es elegible y el usuario puede preparar notas.
"use client";

import { compareDecimalStrings, type InvoiceView } from "@facturador/contracts";
import { FileMinus } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { useSession } from "@/components/session";
import { ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { useInvoiceCredit } from "./credit-notes-api";

export function InvoiceCreditSection({ invoice }: { invoice: Pick<InvoiceView, "id" | "state"> }) {
  const { me } = useSession();
  const headingId = useId();
  const canRead = canSee(me.role, "creditNotes.read");
  const canDraft = canSee(me.role, "creditNotes.draft");
  const authorized = invoice.state === "AUTHORIZED";
  const credit = useInvoiceCredit(invoice.id, canRead && authorized);
  // Sin acceso a las notas, la sección no se muestra: la API vuelve a autorizar cada operación.
  const forbidden = credit.error instanceof ApiError && credit.error.status === 403;
  if (!canRead || !authorized || forbidden) return null;

  let body;
  if (credit.isPending) body = <Skeleton className="h-6 w-full" />;
  else if (credit.isError)
    body = (
      <ErrorState
        message="No pudimos cargar el crédito de la factura."
        onRetry={() => void credit.refetch()}
      />
    );
  else {
    const data = credit.data;
    const available = compareDecimalStrings(data.available, "0") > 0;
    body = (
      <>
        <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-sm tabular-nums sm:max-w-sm">
          <dt>Aplicado en notas autorizadas</dt>
          <dd className="text-right">{formatUsd(data.applied)}</dd>
          <dt>Reservado por notas en curso</dt>
          <dd className="text-right">{formatUsd(data.reserved)}</dd>
          <dt className="font-semibold">Disponible</dt>
          <dd className="text-right font-semibold">{formatUsd(data.available)}</dd>
        </dl>
        {data.consumerFinal ? (
          <p className="text-sm text-foreground-muted">
            Es una factura a consumidor final: no admite notas de crédito.
          </p>
        ) : !available ? (
          <p className="text-sm text-foreground-muted">La factura ya no tiene valor acreditable.</p>
        ) : (
          canDraft && (
            <Button asChild variant="outline" className="self-start">
              <Link
                href={`/notas-credito/borradores/nueva?factura=${encodeURIComponent(data.invoiceId)}`}
              >
                <FileMinus aria-hidden="true" />
                Emitir nota de crédito
              </Link>
            </Button>
          )
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h2 id={headingId} className="text-lg font-semibold">
        Notas de crédito
      </h2>
      {body}
    </section>
  );
}
