// Detalle de una factura (add-invoice-emission, design D15; add-sri-transmission, design D20).
// Usuario: administrador u operador. Objetivo: entender una factura, saber si quedó autorizada y
// destrabarla. Decisión: si reintentar la firma, si la factura está lista para entregarse o si
// necesita una reconciliación. Información mínima: estado, diagnóstico o transmisión, número, clave
// y totales. Acciones: Reintentar firma (RESERVED) y Reconciliar con el SRI (administrador, estado
// admitido). P0: estado y acción; P1: mensajes del SRI, autorización, totales y comprador; P2:
// historial, líneas, pagos y el crédito de las notas con "Emitir nota de crédito" (add-credit-notes,
// design D19); P3 (versiones y metadatos técnicos): no se muestran.
"use client";

import { ArrowLeft, RotateCw } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { ApiError } from "@/lib/api";
import { formatDecimal, formatPercentage, formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { ENVIRONMENT_LABELS } from "@/features/company/company-api";
import { useCatalogEntries } from "@/features/fiscal-catalogs/catalogs-api";
import { CLASS_LABELS, STAGE_LABELS, formatDateTime, formatIssueDate } from "./invoice-format";
import { useInvoice, useRetrySigning } from "./invoices-api";
import { StateCell } from "./invoices-screen";
import { DocumentsSection } from "@/features/archive/documents-section";
import { TransmissionSection } from "@/features/archive/transmission-section";
import { InvoiceCreditSection } from "@/features/credit-notes/invoice-credit-section";
import { InvoiceDebitNoteAction } from "@/features/debit-notes/invoice-debit-note-action";
import { InvoiceShippingGuideAction } from "@/features/shipping-guides/invoice-shipping-guide-action";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function InvoiceDetailScreen({ invoiceId }: { invoiceId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "invoices.read");
  const canRetry = canSee(me.role, "invoices.retrySigning");
  const invoice = useInvoice(invoiceId, allowed);
  const retry = useRetrySigning();
  const methods = useCatalogEntries("payment-method", allowed);
  const methodLabel = (code: string) => {
    const entry = methods.data?.entries.find((candidate) => candidate.code === code);
    return entry
      ? (entry.applicable ?? entry.versions.at(-1)!).officialLabel
      : `Forma de pago ${code}`;
  };

  const header = (
    <Link
      href="/facturas"
      className="inline-flex items-center gap-0.5 self-start text-sm text-foreground-muted hover:text-foreground"
    >
      <ArrowLeft aria-hidden="true" className="size-2" />
      Facturas
    </Link>
  );

  if (!allowed) {
    return (
      <section aria-labelledby="factura-titulo" className="flex flex-col gap-3">
        {header}
        <h1 id="factura-titulo" className="text-3xl font-bold">
          Factura
        </h1>
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a Facturas"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }
  if (invoice.isPending) return <InvoiceDetailSkeleton />;
  if (invoice.isError) {
    const missing = invoice.error instanceof ApiError && invoice.error.status === 404;
    return (
      <section aria-labelledby="factura-titulo" className="flex flex-col gap-3">
        {header}
        <h1 id="factura-titulo" className="text-3xl font-bold">
          Factura
        </h1>
        {missing ? (
          <EmptyState
            kind="empty"
            title="La factura no existe"
            description="Revisa el número en la lista de facturas."
          />
        ) : (
          <ErrorState
            message="No pudimos cargar la factura."
            onRetry={() => void invoice.refetch()}
          />
        )}
      </section>
    );
  }

  const data = invoice.data;
  const reserved = data.state === "RESERVED";
  return (
    <section aria-labelledby="factura-titulo" className="flex flex-col gap-3">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 id="factura-titulo" className="text-3xl font-bold tabular-nums">
            Factura {data.documentNumber}
          </h1>
          <span className="flex flex-wrap items-center gap-1 text-sm text-foreground-muted">
            <StateCell state={data.state} stopped={data.transmission.stopped !== null} />
            {formatIssueDate(data.issueDate)} · Ambiente de {ENVIRONMENT_LABELS[data.environment]}
          </span>
        </div>
        {reserved && canRetry && (
          <AsyncButton pending={retry.isPending} onClick={() => retry.mutate(data.id)}>
            <RotateCw aria-hidden="true" />
            Reintentar firma
          </AsyncButton>
        )}
        <InvoiceDebitNoteAction invoice={data} />
        <InvoiceShippingGuideAction invoice={data} />
      </div>

      {reserved && (
        <div
          role="status"
          className="flex flex-col gap-0.5 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-1 text-sm"
        >
          {data.diagnostic ? (
            <>
              <p className="font-medium">
                No se completó la firma: {STAGE_LABELS[data.diagnostic.stage]}.
              </p>
              <p>{data.diagnostic.message}</p>
              <p className="text-foreground-muted">
                {CLASS_LABELS[data.diagnostic.class]} Intentos: {data.diagnostic.attemptCount} ·
                último intento: {formatDateTime(data.diagnostic.at)}
              </p>
            </>
          ) : (
            <p>
              La factura tiene su número y su clave, y la firma está en curso o se interrumpió.
              Reintenta la firma para completarla.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {!reserved && <TransmissionSection document={data} />}
          <DocumentsSection document={data} />
          <InvoiceCreditSection invoice={data} />
          <Section title="Comprador">
            <p className="flex flex-col text-sm">
              <span className="font-medium break-words">{data.buyer.legalName}</span>
              <span className="text-foreground-muted tabular-nums">
                {data.buyer.identification}
              </span>
              {data.buyer.address && (
                <span className="text-foreground-muted break-words">{data.buyer.address}</span>
              )}
            </p>
          </Section>
          <Section title="Productos">
            <ul className="flex flex-col gap-1">
              {data.lines.map((line) => (
                <li
                  key={line.position}
                  className="flex flex-wrap items-baseline justify-between gap-1 rounded-md border border-border bg-surface px-1.5 py-1 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium break-words">{line.description}</span>
                    <span className="text-foreground-muted tabular-nums">
                      {formatDecimal(line.quantity)} × {formatUsd(line.unitPrice)}
                      {line.discount !== "0.00" && ` · Descuento ${formatUsd(line.discount)}`}
                      {line.taxes.map((tax) => ` · IVA ${formatPercentage(tax.percentage)}`)}
                    </span>
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {formatUsd(line.taxableBase)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Formas de pago">
            <ul className="flex flex-col gap-0.5 text-sm">
              {data.payments.map((payment, index) => (
                <li key={index} className="flex justify-between gap-1 tabular-nums">
                  <span className="break-words">{methodLabel(payment.code)}</span>
                  <span className="whitespace-nowrap">{formatUsd(payment.amount)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        <aside
          aria-labelledby="totales-titulo"
          className="flex flex-col gap-1.5 self-start rounded-lg border border-border bg-surface p-2"
        >
          <h2 id="totales-titulo" className="text-lg font-semibold">
            Totales
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-sm tabular-nums">
            <dt>Subtotal sin impuestos</dt>
            <dd className="text-right">{formatUsd(data.totals.withoutTaxes)}</dd>
            <dt>Descuento</dt>
            <dd className="text-right">{formatUsd(data.totals.discount)}</dd>
            {data.totals.taxes.map((tax) => (
              <div key={`${tax.taxCode}-${tax.rateCode}`} className="contents">
                <dt>IVA {formatPercentage(tax.percentage)}</dt>
                <dd className="text-right">{formatUsd(tax.amount)}</dd>
              </div>
            ))}
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold">{formatUsd(data.totals.total)}</dd>
          </dl>
          <div className="flex flex-col gap-0.5 border-t border-border pt-1 text-sm">
            <span className="text-foreground-muted">Clave de acceso</span>
            <span className="font-mono text-xs break-all">{data.accessKey}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function InvoiceDetailSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3">
      <h1 className="text-3xl font-bold">Factura</h1>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full" />
    </section>
  );
}
