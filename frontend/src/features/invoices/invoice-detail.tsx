// Detalle de una factura (add-invoice-emission, design D15; add-sri-transmission, design D20).
// Usuario: administrador u operador. Objetivo: entender una factura, saber si quedó autorizada y
// destrabarla. Decisión: si reintentar la firma, si la factura está lista para entregarse o si
// necesita una reconciliación. Información mínima: estado, diagnóstico o transmisión, número, clave
// y totales. Acciones: Reintentar firma (RESERVED) y Reconciliar con el SRI (administrador, estado
// admitido). P0: estado y acción; P1: mensajes del SRI, autorización, totales y comprador; P2:
// historial, líneas, pagos y el crédito de las notas con "Emitir nota de crédito" (add-credit-notes,
// design D19); P3 (versiones y metadatos técnicos): no se muestran.
"use client";

import type { InvoiceView } from "@facturador/contracts";
import { RotateCw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { ApiError } from "@/lib/api";
import { formatDecimal, formatPercentage } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { ENVIRONMENT_LABELS } from "@/features/company/company-api";
import { useCatalogEntries } from "@/features/fiscal-catalogs/catalogs-api";
import { CLASS_LABELS, STAGE_LABELS, formatDateTime, formatIssueDate } from "./invoice-format";
import { useInvoice, useRetrySigning } from "./invoices-api";
import {
  DocumentDetailTabs,
  transmissionNeedsAttention,
} from "@/features/documents/document-detail-tabs";
import { StateCell } from "@/features/documents/document-status-badge";
import { LineItemList } from "@/features/documents/line-item-list";
import { DocumentsSection } from "@/features/archive/documents-section";
import { TransmissionSection } from "@/features/archive/transmission-section";
import { InvoiceCreditSection } from "@/features/credit-notes/invoice-credit-section";
import { useInvoiceDebitNoteAction } from "@/features/debit-notes/invoice-debit-note-action";
import { useInvoiceShippingGuideAction } from "@/features/shipping-guides/invoice-shipping-guide-action";
import { HeaderActionsMenu, type HeaderAction } from "@/components/layout/header-actions-menu";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";
import { Money, formatMoney } from "@/components/money";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Más acciones de la factura, en el menú «⋯» del título: crear otro comprobante desde ella. Cada
 * opción aparece solo si la factura y el rol la admiten.
 */
function InvoiceMoreActions({ invoice }: { invoice: InvoiceView }) {
  const debitNote = useInvoiceDebitNoteAction(invoice);
  const guide = useInvoiceShippingGuideAction(invoice);
  const actions = [debitNote, guide.action].filter(
    (action): action is HeaderAction => action !== null,
  );
  return (
    <HeaderActionsMenu
      label={`Más acciones de la factura ${invoice.documentNumber}`}
      actions={actions}
      busy={guide.pending}
    />
  );
}

export function InvoiceDetailScreen({ invoiceId }: { invoiceId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "invoices.read");
  const canRetry = canSee(me.role, "invoices.retrySigning");
  const invoice = useInvoice(invoiceId, allowed);
  // Miga final del shell: el número o el nombre del registro (adopt-premium-design-foundation-and-shell).
  useBreadcrumbLabel(invoice.data?.documentNumber);
  const retry = useRetrySigning();
  const methods = useCatalogEntries("payment-method", allowed);
  const methodLabel = (code: string) => {
    const entry = methods.data?.entries.find((candidate) => candidate.code === code);
    return entry
      ? (entry.applicable ?? entry.versions.at(-1)!).officialLabel
      : `Forma de pago ${code}`;
  };

  if (!allowed) {
    return (
      <section aria-labelledby="factura-titulo" className="flex flex-col gap-6">
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
      <section aria-labelledby="factura-titulo" className="flex flex-col gap-6">
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
    <section aria-labelledby="factura-titulo" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 id="factura-titulo" className="text-3xl font-bold tabular-nums">
              Factura {data.documentNumber}
            </h1>
            <InvoiceMoreActions invoice={data} />
          </div>
          <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
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
      </div>

      {reserved && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DocumentDetailTabs
          label="Secciones de la factura"
          tabs={[
            {
              id: "detalle",
              label: "Detalle",
              content: (
                <>
                  <Section title="Comprador">
                    <p className="flex flex-col text-sm">
                      <span className="text-base font-semibold break-words">
                        {data.buyer.legalName}
                      </span>
                      <span className="text-foreground-muted tabular-nums">
                        {data.buyer.identification}
                      </span>
                      {data.buyer.address && (
                        <span className="text-foreground-muted break-words">
                          {data.buyer.address}
                        </span>
                      )}
                    </p>
                  </Section>
                  <Section title="Productos">
                    <LineItemList
                      items={data.lines}
                      getKey={(line) => line.position}
                      getSearchText={(line) => `${line.description} ${line.mainCode ?? ""}`}
                      noun={{ one: "producto", many: "productos" }}
                      renderItem={(line) => (
                        <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
                          <span className="flex min-w-0 flex-col">
                            <span className="font-medium break-words">{line.description}</span>
                            <span className="text-foreground-muted tabular-nums">
                              {formatDecimal(line.quantity)} × {formatMoney(line.unitPrice)}
                              {line.discount !== "0.00" &&
                                ` · Descuento ${formatMoney(line.discount)}`}
                              {line.taxes.map(
                                (tax) => ` · IVA ${formatPercentage(tax.percentage)}`,
                              )}
                            </span>
                          </span>
                          <Money amount={line.taxableBase} />
                        </li>
                      )}
                    />
                  </Section>
                  <Section title="Formas de pago">
                    <ul className="flex flex-col gap-1 text-sm">
                      {data.payments.map((payment, index) => (
                        <li key={index} className="flex justify-between gap-2 tabular-nums">
                          <span className="break-words">{methodLabel(payment.code)}</span>
                          <Money amount={payment.amount} />
                        </li>
                      ))}
                    </ul>
                  </Section>
                </>
              ),
            },
            ...(reserved
              ? []
              : [
                  {
                    id: "transmision",
                    label: "Transmisión al SRI",
                    attention: transmissionNeedsAttention(
                      data.state,
                      data.transmission.stopped !== null,
                    ),
                    content: <TransmissionSection document={data} />,
                  },
                ]),
            {
              id: "documentos",
              label: "RIDE y XML",
              content: <DocumentsSection document={data} />,
            },
            {
              id: "notas-credito",
              label: "Notas de crédito",
              content: <InvoiceCreditSection invoice={data} />,
            },
          ]}
        />
        <aside
          aria-labelledby="totales-titulo"
          className="flex flex-col gap-3 self-start rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="totales-titulo" className="text-lg font-semibold">
            Totales
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt>Subtotal sin impuestos</dt>
            <dd className="text-right">
              <Money amount={data.totals.withoutTaxes} className="font-normal" />
            </dd>
            <dt>Descuento</dt>
            <dd className="text-right">
              <Money amount={data.totals.discount} className="font-normal" />
            </dd>
            {data.totals.taxes.map((tax) => (
              <div key={`${tax.taxCode}-${tax.rateCode}`} className="contents">
                <dt>IVA {formatPercentage(tax.percentage)}</dt>
                <dd className="text-right">
                  <Money amount={tax.amount} className="font-normal" />
                </dd>
              </div>
            ))}
            <dt className="text-base font-semibold">Total</dt>
            <dd className="text-right">
              <Money amount={data.totals.total} className="text-base" />
            </dd>
          </dl>
          <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
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
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Factura</h1>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
