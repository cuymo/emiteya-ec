// Detalle de una liquidación de compra (add-purchase-settlements, design D24). Usuario: administrador
// u operador con `purchaseSettlements.read`. Objetivo: confirmar que la liquidación quedó autorizada
// y entregar sus documentos. Decisión: si reintentar la firma o pedir la reconciliación
// (administrador). Información mínima: estado, número, proveedor e importe total. Acción principal:
// descargar el RIDE de una liquidación autorizada, o reintentar la firma de una reservada. P0: estado
// y número; P1: proveedor congelado, importe total, las cuatro declaraciones "declaradas por" el
// usuario con su momento y el aviso de la retención; P2: líneas, IVA por tarifa, pagos con su plazo,
// transmisión y documentos; P3 (identificadores y hashes): no se muestran. Todo sale del snapshot de
// la liquidación: nada se vuelve a leer de terceros, productos ni catálogos.
"use client";

import type { PurchaseSettlementView } from "@facturador/contracts";
import { Info, RotateCw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { ApiError } from "@/lib/api";
import { formatDecimal, formatPercentage, formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import {
  DocumentDetailTabs,
  transmissionNeedsAttention,
} from "@/features/documents/document-detail-tabs";
import { DocumentsSection } from "@/features/archive/documents-section";
import { TransmissionSection } from "@/features/archive/transmission-section";
import { ENVIRONMENT_LABELS } from "@/features/company/company-api";
import {
  CLASS_LABELS,
  STAGE_LABELS,
  formatDateTime,
  formatIssueDate,
} from "@/features/invoices/invoice-format";
import { StateCell } from "@/features/documents/document-status-badge";
import {
  usePurchaseSettlement,
  useRetryPurchaseSettlementSigning,
} from "./purchase-settlements-api";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";

type Line = PurchaseSettlementView["lines"][number];

/** Tipos de identificación que la liquidación admite (design D4). */
const IDENTIFICATION_LABELS: Record<string, string> = { "05": "Cédula", "06": "Pasaporte" };

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

/** Una línea con sus códigos y su unidad cuando los tiene, su cantidad, su precio y su IVA. */
function LineItem({ line }: { line: Line }) {
  const codes = [line.mainCode, line.auxiliaryCode].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <span className="flex min-w-0 flex-col">
        <span className="font-medium break-words">{line.description}</span>
        <span className="text-foreground-muted tabular-nums">
          {formatDecimal(line.quantity)}
          {line.unit ? ` ${line.unit}` : ""} × {formatUsd(line.unitPrice)}
          {line.discount !== "0.00" && ` · Descuento ${formatUsd(line.discount)}`} · IVA{" "}
          {line.tax.label}
        </span>
        {codes && <span className="text-xs text-foreground-muted">Código {codes}</span>}
      </span>
      <span className="whitespace-nowrap tabular-nums">{formatUsd(line.taxableBase)}</span>
    </li>
  );
}

/** Las declaraciones tal como se congelaron: del usuario, nunca verificadas por el sistema. */
function DeclarationsSection({
  eligibility,
}: {
  eligibility: PurchaseSettlementView["eligibility"];
}) {
  return (
    <Section title="Procedencia">
      <p className="text-sm text-foreground-muted">
        Art. 13, letra c, del Reglamento de Comprobantes de Venta (versión{" "}
        {eligibility.policyVersion} de la política del sistema).
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {eligibility.declarations.map((declaration) => (
          <li
            key={declaration.statementId}
            className="flex flex-col rounded-md border border-border bg-surface px-3 py-2"
          >
            <span className="break-words">{declaration.text}</span>
            <span className="text-foreground-muted">
              Declarada por {declaration.declaredByName ?? "un usuario"} ·{" "}
              {formatDateTime(declaration.declaredAt)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-foreground-muted">
        Son declaraciones del usuario: el sistema no puede comprobarlas y no consulta el estado del
        RUC.
      </p>
    </Section>
  );
}

export function PurchaseSettlementDetailScreen({
  purchaseSettlementId,
}: {
  purchaseSettlementId: string;
}) {
  const { me } = useSession();
  const allowed = canSee(me.role, "purchaseSettlements.read");
  const canRetry = canSee(me.role, "purchaseSettlements.retrySigning");
  const settlement = usePurchaseSettlement(purchaseSettlementId, allowed);
  // Miga final del shell: el número o el nombre del registro (adopt-premium-design-foundation-and-shell).
  useBreadcrumbLabel(settlement.data?.documentNumber);
  const retry = useRetryPurchaseSettlementSigning();

  const fallback = (body: ReactNode) => (
    <section aria-labelledby="liquidacion-titulo" className="flex flex-col gap-6">
      <h1 id="liquidacion-titulo" className="text-3xl font-bold">
        Liquidación de compra
      </h1>
      {body}
    </section>
  );

  if (!allowed) {
    return fallback(
      <EmptyState
        kind="no-permission"
        title="No tienes acceso a Liquidaciones de compra"
        description="Pide a un administrador que revise tu rol."
      />,
    );
  }
  if (settlement.isPending) return <PurchaseSettlementDetailSkeleton />;
  if (settlement.isError) {
    const missing = settlement.error instanceof ApiError && settlement.error.status === 404;
    return fallback(
      missing ? (
        <EmptyState
          kind="empty"
          title="La liquidación no existe"
          description="Revisa el número en la lista de liquidaciones de compra."
        />
      ) : (
        <ErrorState
          message="No pudimos cargar la liquidación."
          onRetry={() => void settlement.refetch()}
        />
      ),
    );
  }

  const data = settlement.data;
  const reserved = data.state === "RESERVED";
  return (
    <section aria-labelledby="liquidacion-titulo" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="liquidacion-titulo" className="text-3xl font-bold tabular-nums">
            Liquidación de compra <span className="whitespace-nowrap">{data.documentNumber}</span>
          </h1>
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
              La liquidación tiene su número y su clave, y la firma está en curso o se interrumpió.
              Reintenta la firma para completarla.
            </p>
          )}
        </div>
      )}

      <p
        role="note"
        className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
      >
        <Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-warning" />
        <span>{data.withholdingNotice}</span>
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DocumentDetailTabs
          label="Secciones de la liquidación de compra"
          tabs={[
            {
              id: "detalle",
              label: "Detalle",
              content: (
                <>
                  <Section title="Proveedor">
                    <p className="flex flex-col text-sm">
                      <span className="font-medium break-words">{data.supplier.legalName}</span>
                      <span className="text-foreground-muted tabular-nums">
                        {IDENTIFICATION_LABELS[data.supplier.identificationType] ??
                          "Identificación"}{" "}
                        {data.supplier.identification}
                      </span>
                      <span className="text-foreground-muted break-words">
                        {data.supplier.address}
                      </span>
                    </p>
                  </Section>
                  <Section title="Líneas">
                    <ul className="flex flex-col gap-2">
                      {data.lines.map((line) => (
                        <LineItem key={line.position} line={line} />
                      ))}
                    </ul>
                  </Section>
                  <Section title="Pagos">
                    <ul className="flex flex-col gap-1 text-sm">
                      {data.payments.map((payment) => (
                        <li
                          key={payment.position}
                          className="flex flex-wrap justify-between gap-2 tabular-nums"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="break-words">
                              {payment.code} · {payment.label}
                            </span>
                            <span className="text-foreground-muted">
                              Plazo {formatDecimal(payment.term)} {payment.timeUnit}
                            </span>
                          </span>
                          <span className="whitespace-nowrap">{formatUsd(payment.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                </>
              ),
            },
            {
              id: "procedencia",
              label: "Procedencia",
              content: (
                <>
                  <DeclarationsSection eligibility={data.eligibility} />
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
            {data.totals.taxes.map((tax) => (
              <div key={`base-${tax.rateCode}`} className="contents">
                <dt>Subtotal {tax.label}</dt>
                <dd className="text-right">{formatUsd(tax.base)}</dd>
              </div>
            ))}
            <dt>Subtotal sin impuestos</dt>
            <dd className="text-right">{formatUsd(data.totals.withoutTaxes)}</dd>
            <dt>Descuento</dt>
            <dd className="text-right">{formatUsd(data.totals.discount)}</dd>
            {data.totals.taxes
              .filter((tax) => tax.rateKind === "PERCENTAGE" && tax.percentage !== "0")
              .map((tax) => (
                <div key={`iva-${tax.rateCode}`} className="contents">
                  <dt>IVA {formatPercentage(tax.percentage)}</dt>
                  <dd className="text-right">{formatUsd(tax.amount)}</dd>
                </div>
              ))}
            <dt className="font-semibold">Importe total</dt>
            <dd className="text-right font-semibold">{formatUsd(data.totals.total)}</dd>
          </dl>
          <p className="text-xs text-foreground-muted">Moneda: dólar de los Estados Unidos.</p>
          <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
            <span className="text-foreground-muted">Clave de acceso</span>
            <span className="font-mono text-xs break-all">{data.accessKey}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function PurchaseSettlementDetailSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Liquidación de compra</h1>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
