// Detalle de un comprobante de retención (add-withholding-receipts, design D24). Usuario:
// administrador u operador con `withholdings.read`. Objetivo: confirmar que la retención quedó
// autorizada y entregar sus documentos. Decisión: si reintentar la firma o pedir la reconciliación
// (administrador). Información mínima: estado, número, total retenido y proveedor. Acción principal:
// descargar el RIDE de una retención autorizada, o reintentar la firma de una reservada. P0: estado,
// número y total retenido; P1: proveedor, período y retenciones por documento; P2: impuestos y pagos
// de cada documento, parte relacionada (declarada por el usuario, nunca verificada), transmisión y
// documentos; P3 (identificadores y hashes): no se muestran. Todo sale del snapshot de la retención:
// nada se vuelve a leer del proveedor ni del catálogo.
"use client";

import type { WithholdingReceiptView } from "@facturador/contracts";
import { RotateCw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { ApiError } from "@/lib/api";
import { formatDecimal, formatPercentage } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import {
  DocumentDetailTabs,
  transmissionNeedsAttention,
} from "@/features/documents/document-detail-tabs";
import { DocumentsSection } from "@/features/archive/documents-section";
import { useEmailNeedsAttention } from "@/features/email/email-api";
import { TransmissionSection } from "@/features/archive/transmission-section";
import { ENVIRONMENT_LABELS } from "@/features/company/company-api";
import {
  CLASS_LABELS,
  STAGE_LABELS,
  formatDateTime,
  formatIssueDate,
} from "@/features/invoices/invoice-format";
import { StateCell } from "@/features/documents/document-status-badge";
import { RELATED_PARTY_LABELS, formatPeriod, formatSupportNumber } from "./withholding-format";
import { useRetryWithholdingSigning, useWithholdingReceipt } from "./withholding-receipts-api";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";
import { Money, formatMoney } from "@/components/money";

type Support = WithholdingReceiptView["supports"][number];

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

/** Un documento sustento con sus retenciones (P1) y sus impuestos y pagos declarados (P2). */
function SupportCard({ support }: { support: Support }) {
  const headingId = useId();
  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-medium">
          {support.documentTypeLabel}{" "}
          <span className="whitespace-nowrap tabular-nums">
            {formatSupportNumber(support.number)}
          </span>
        </h3>
        <span className="text-foreground-muted tabular-nums">
          {formatIssueDate(support.issueDate)}
        </span>
      </div>
      <p className="text-xs text-foreground-muted">
        Declarado por el usuario: el sistema no verifica su existencia en el SRI.
      </p>
      <p className="text-foreground-muted break-words">
        Sustento {support.supportCode}: {support.supportCodeLabel}
      </p>
      {support.authorizationNumber && (
        <p className="text-foreground-muted">
          Autorización{" "}
          <span className="font-mono text-xs break-all">{support.authorizationNumber}</span>
        </p>
      )}
      {/* Por debajo de 640 px, cada retención apilada: los importes no se parten ni desbordan. */}
      <ul aria-label="Retenciones del documento" className="flex flex-col gap-1 sm:hidden">
        {support.withholdings.map((item) => (
          <li key={item.position} className="flex flex-col border-t border-border pt-1">
            <span className="font-medium">
              {item.taxLabel} {item.code}
            </span>
            <span className="text-xs text-foreground-muted break-words">{item.label}</span>
            <span className="flex flex-wrap gap-x-2 tabular-nums">
              <span className="whitespace-nowrap">Base {formatMoney(item.base)}</span>
              <span className="whitespace-nowrap">{formatPercentage(item.percentage)}</span>
              <span className="whitespace-nowrap font-medium">
                Valor retenido <Money amount={item.amount} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-left tabular-nums sm:table">
        <caption className="sr-only">Retenciones del documento</caption>
        <thead className="text-xs text-foreground-muted">
          <tr>
            <th scope="col" className="py-1 font-medium">
              Retención
            </th>
            <th scope="col" className="py-1 pl-2 text-right font-medium">
              Base
            </th>
            <th scope="col" className="py-1 pl-2 text-right font-medium">
              Porcentaje
            </th>
            <th scope="col" className="py-1 pl-2 text-right font-medium">
              Valor retenido
            </th>
          </tr>
        </thead>
        <tbody>
          {support.withholdings.map((item) => (
            <tr key={item.position} className="border-t border-border align-top">
              <td className="py-1 pr-2">
                <span className="flex flex-col">
                  <span className="font-medium">
                    {item.taxLabel} {item.code}
                  </span>
                  <span className="text-xs text-foreground-muted break-words">{item.label}</span>
                </span>
              </td>
              <td className="py-1 pl-2 text-right whitespace-nowrap">
                <Money amount={item.base} className="font-normal" />
              </td>
              <td className="py-1 pl-2 text-right whitespace-nowrap">
                {formatPercentage(item.percentage)}
              </td>
              <td className="py-1 pl-2 text-right whitespace-nowrap">
                <Money amount={item.amount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="rounded-md border border-border px-2 py-1">
        <summary className="cursor-pointer py-1 font-medium">
          Totales, impuestos y pagos declarados
        </summary>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-1 tabular-nums">
          <dt>Total sin impuestos</dt>
          <dd className="text-right">
            <Money amount={support.totalWithoutTaxes} className="font-normal" />
          </dd>
          <dt>Importe total</dt>
          <dd className="text-right">
            <Money amount={support.importTotal} className="font-normal" />
          </dd>
          {support.taxes.map((tax) => (
            <div key={`tax-${tax.position}`} className="contents">
              <dt className="break-words">
                {tax.taxLabel} · {tax.rateLabel} · tarifa {formatDecimal(tax.rate)}
                {tax.rateBasis === "USER_DECLARED" ? " (declarada)" : ""} · base{" "}
                {formatMoney(tax.base)}
              </dt>
              <dd className="text-right">
                <Money amount={tax.amount} className="font-normal" />
              </dd>
            </div>
          ))}
          {support.payments.map((payment) => (
            <div key={`payment-${payment.position}`} className="contents">
              <dt className="break-words">Pago: {payment.label}</dt>
              <dd className="text-right">
                <Money amount={payment.total} className="font-normal" />
              </dd>
            </div>
          ))}
        </dl>
        <p className="pb-1 text-xs text-foreground-muted">
          Los impuestos y pagos del documento son los que declaraste; el sistema no los recalcula.
        </p>
      </details>
    </li>
  );
}

export function WithholdingReceiptDetailScreen({
  withholdingReceiptId,
}: {
  withholdingReceiptId: string;
}) {
  const { me } = useSession();
  const allowed = canSee(me.role, "withholdings.read");
  const canRetry = canSee(me.role, "withholdings.retrySigning");
  const receipt = useWithholdingReceipt(withholdingReceiptId, allowed);
  const emailAttention = useEmailNeedsAttention(receipt.data);
  // Miga final del shell: el número o el nombre del registro (adopt-premium-design-foundation-and-shell).
  useBreadcrumbLabel(receipt.data?.documentNumber);
  const retry = useRetryWithholdingSigning();

  const fallback = (body: ReactNode) => (
    <section aria-labelledby="retencion-titulo" className="flex flex-col gap-6">
      <h1 id="retencion-titulo" className="text-3xl font-bold">
        Comprobante de retención
      </h1>
      {body}
    </section>
  );

  if (!allowed) {
    return fallback(
      <EmptyState
        kind="no-permission"
        title="No tienes acceso a Retenciones"
        description="Pide a un administrador que revise tu rol."
      />,
    );
  }
  if (receipt.isPending) return <WithholdingReceiptDetailSkeleton />;
  if (receipt.isError) {
    const missing = receipt.error instanceof ApiError && receipt.error.status === 404;
    return fallback(
      missing ? (
        <EmptyState
          kind="empty"
          title="La retención no existe"
          description="Revisa el número en la lista de retenciones."
        />
      ) : (
        <ErrorState
          message="No pudimos cargar la retención."
          onRetry={() => void receipt.refetch()}
        />
      ),
    );
  }

  const data = receipt.data;
  const reserved = data.state === "RESERVED";
  const related = data.relatedParty;
  return (
    <section aria-labelledby="retencion-titulo" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="retencion-titulo" className="text-3xl font-bold tabular-nums">
            Retención <span className="whitespace-nowrap">{data.documentNumber}</span>
          </h1>
          <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
            <StateCell state={data.state} stopped={data.transmission.stopped !== null} />
            {formatIssueDate(data.issueDate)} · Ambiente de {ENVIRONMENT_LABELS[data.environment]} ·{" "}
            <span className="tabular-nums">
              Total retenido <Money amount={data.totals.withheld} />
            </span>
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
              La retención tiene su número y su clave, y la firma está en curso o se interrumpió.
              Reintenta la firma para completarla.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DocumentDetailTabs
          label="Secciones de la retención"
          tabs={[
            {
              id: "detalle",
              label: "Detalle",
              content: (
                <>
                  <Section title="Proveedor">
                    <p className="flex flex-col text-sm">
                      <span className="text-base font-semibold break-words">
                        {data.subject.legalName}
                      </span>
                      <span className="text-foreground-muted tabular-nums">
                        {data.subject.identification}
                      </span>
                    </p>
                  </Section>
                  <Section title="Parte relacionada">
                    <p className="flex flex-col text-sm">
                      <span>
                        {RELATED_PARTY_LABELS[related.value]} · Declarada por{" "}
                        {related.declaredByName ?? "un usuario"} ·{" "}
                        {formatDateTime(related.declaredAt)}
                      </span>
                      <span className="text-foreground-muted">
                        Es una declaración del usuario: el sistema no puede comprobarla.
                      </span>
                    </p>
                  </Section>
                </>
              ),
            },
            {
              id: "sustentos",
              label: "Documentos sustento",
              content: (
                <>
                  <Section title="Documentos sustento">
                    <ol className="flex flex-col gap-2">
                      {data.supports.map((support) => (
                        <SupportCard key={support.position} support={support} />
                      ))}
                    </ol>
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
              // El último envío por correo falló (add-email-delivery, design D14).
              attention: emailAttention,
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
            <dt>Período fiscal</dt>
            <dd className="text-right">{formatPeriod(data.fiscalPeriod)}</dd>
            {data.supports.flatMap((support) =>
              support.withholdings.map((item) => (
                <div key={`${support.position}-${item.position}`} className="contents">
                  <dt className="break-words">
                    {item.taxLabel} {item.code} ·{" "}
                    <span className="whitespace-nowrap">{formatSupportNumber(support.number)}</span>
                  </dt>
                  <dd className="text-right">
                    <Money amount={item.amount} className="font-normal" />
                  </dd>
                </div>
              )),
            )}
            <dt className="text-base font-semibold">Total retenido</dt>
            <dd className="text-right">
              <Money amount={data.totals.withheld} className="text-base" />
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

export function WithholdingReceiptDetailSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Comprobante de retención</h1>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
