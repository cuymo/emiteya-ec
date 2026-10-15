// Detalle de una guía de remisión (add-shipping-guides, design D25). Usuario: administrador u operador
// con `shippingGuides.read`. Objetivo: confirmar que la guía quedó autorizada y entregar sus
// documentos. Decisión: si reintentar la firma o pedir la reconciliación (administrador). Información
// mínima: estado, número, transportista y destinatarios. Acción principal: descargar el RIDE de una
// guía autorizada, o reintentar la firma de una reservada. P0: estado y número; P1: transportista,
// placa, fechas y destinatarios con su sustento (la factura con su enlace, o la excepción "declarada
// por" el usuario con su momento); P2: detalle de cada destinatario, partida, transmisión y
// documentos; P3 (identificadores y hashes): no se muestran. Todo sale del snapshot de la guía: nada
// se vuelve a leer de terceros, establecimientos, productos ni facturas.
"use client";

import type { ShippingGuideView } from "@facturador/contracts";
import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { ApiError } from "@/lib/api";
import { formatDecimal } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
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
  TRANSPORTER_SOURCE_LABELS,
  departureSourceLabel,
  detailCountLabel,
  recipientCountLabel,
} from "./shipping-guide-format";
import { useRetryShippingGuideSigning, useShippingGuide } from "./shipping-guides-api";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";

type Recipient = ShippingGuideView["recipients"][number];

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

/** El sustento de un destinatario: la factura con su enlace, o la excepción declarada por el usuario. */
function SupportText({ support }: { support: Recipient["support"] }) {
  if (support.kind === "INTERNAL_INVOICE") {
    const { invoice } = support;
    return (
      <p className="flex flex-col">
        <span>
          Factura{" "}
          <Link
            href={`/facturas/${invoice.id}`}
            className="font-medium whitespace-nowrap tabular-nums underline-offset-2 hover:underline"
          >
            {invoice.documentNumber}
          </Link>{" "}
          del {formatIssueDate(invoice.issueDate)}
        </span>
        <span className="text-foreground-muted">
          Autorización{" "}
          <span className="font-mono text-xs break-all">{invoice.authorizationNumber}</span>
        </span>
      </p>
    );
  }
  const { declaration } = support;
  return (
    <p className="flex flex-col">
      <span className="font-medium break-words">
        Sin factura: {declaration.label} (art. 30, numeral 8, literal {declaration.literal})
      </span>
      <span>
        Declarada por {declaration.declaredByName ?? "un usuario"} ·{" "}
        {formatDateTime(declaration.declaredAt)}
      </span>
      <span className="text-foreground-muted">
        Es una declaración del usuario: el sistema no puede comprobarla.
      </span>
    </p>
  );
}

/** Un destinatario con su sustento (P1) y su detalle (P2). */
function RecipientCard({ recipient }: { recipient: Recipient }) {
  const headingId = useId();
  return (
    <li
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="font-medium break-words">
          {recipient.position}. {recipient.legalName}
        </h3>
        <span className="text-foreground-muted tabular-nums">{recipient.identification}</span>
      </div>
      {recipient.kind === "OWN_COMPANY" && recipient.destinationEstablishment && (
        <p className="text-foreground-muted">
          Establecimiento propio {recipient.destinationEstablishment.code}
        </p>
      )}
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1">
        <dt className="text-foreground-muted">Destino</dt>
        <dd className="break-words">{recipient.address}</dd>
        <dt className="text-foreground-muted">Motivo</dt>
        <dd className="break-words">{recipient.motive}</dd>
        {recipient.route && (
          <>
            <dt className="text-foreground-muted">Ruta</dt>
            <dd className="break-words">{recipient.route}</dd>
          </>
        )}
        {recipient.destinationEstablishmentCode && (
          <>
            <dt className="text-foreground-muted">Establecimiento de destino</dt>
            <dd className="tabular-nums">{recipient.destinationEstablishmentCode}</dd>
          </>
        )}
      </dl>
      <SupportText support={recipient.support} />
      {/* Por debajo de 640 px, cada detalle apilado: la descripción no se corta. */}
      <ul aria-label="Detalle del destinatario" className="flex flex-col gap-1 sm:hidden">
        {recipient.details.map((detail) => (
          <li key={detail.position} className="flex flex-col border-t border-border pt-1">
            <span className="break-words">{detail.description}</span>
            <span className="flex flex-wrap gap-x-2 text-foreground-muted tabular-nums">
              <span className="whitespace-nowrap">Cantidad {formatDecimal(detail.quantity)}</span>
              {detail.mainCode && <span>Código {detail.mainCode}</span>}
              {detail.auxiliaryCode && <span>Auxiliar {detail.auxiliaryCode}</span>}
            </span>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-left sm:table">
        <caption className="sr-only">Detalle del destinatario</caption>
        <thead className="text-xs text-foreground-muted">
          <tr>
            <th scope="col" className="py-1 text-right font-medium">
              Cantidad
            </th>
            <th scope="col" className="py-1 pl-2 font-medium">
              Descripción
            </th>
            <th scope="col" className="py-1 pl-2 font-medium">
              Código principal
            </th>
            <th scope="col" className="py-1 pl-2 font-medium">
              Código auxiliar
            </th>
          </tr>
        </thead>
        <tbody>
          {recipient.details.map((detail) => (
            <tr key={detail.position} className="border-t border-border align-top">
              <td className="py-1 text-right whitespace-nowrap tabular-nums">
                {formatDecimal(detail.quantity)}
              </td>
              <td className="py-1 pl-2 break-words">{detail.description}</td>
              <td className="py-1 pl-2">{detail.mainCode ?? ""}</td>
              <td className="py-1 pl-2">{detail.auxiliaryCode ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}

export function ShippingGuideDetailScreen({ shippingGuideId }: { shippingGuideId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "shippingGuides.read");
  const canRetry = canSee(me.role, "shippingGuides.retrySigning");
  const guide = useShippingGuide(shippingGuideId, allowed);
  // Miga final del shell: el número o el nombre del registro (adopt-premium-design-foundation-and-shell).
  useBreadcrumbLabel(guide.data?.documentNumber);
  const retry = useRetryShippingGuideSigning();

  const fallback = (body: ReactNode) => (
    <section aria-labelledby="guia-titulo" className="flex flex-col gap-6">
      <h1 id="guia-titulo" className="text-3xl font-bold">
        Guía de remisión
      </h1>
      {body}
    </section>
  );

  if (!allowed) {
    return fallback(
      <EmptyState
        kind="no-permission"
        title="No tienes acceso a Guías de remisión"
        description="Pide a un administrador que revise tu rol."
      />,
    );
  }
  if (guide.isPending) return <ShippingGuideDetailSkeleton />;
  if (guide.isError) {
    const missing = guide.error instanceof ApiError && guide.error.status === 404;
    return fallback(
      missing ? (
        <EmptyState
          kind="empty"
          title="La guía no existe"
          description="Revisa el número en la lista de guías de remisión."
        />
      ) : (
        <ErrorState message="No pudimos cargar la guía." onRetry={() => void guide.refetch()} />
      ),
    );
  }

  const data = guide.data;
  const reserved = data.state === "RESERVED";
  return (
    <section aria-labelledby="guia-titulo" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="guia-titulo" className="text-3xl font-bold tabular-nums">
            Guía de remisión <span className="whitespace-nowrap">{data.documentNumber}</span>
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
              La guía tiene su número y su clave, y la firma está en curso o se interrumpió.
              Reintenta la firma para completarla.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {!reserved && <TransmissionSection document={data} />}
          <DocumentsSection document={data} />
          <Section title="Transporte">
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-foreground-muted">Transportista</dt>
              <dd className="flex flex-col">
                <span className="font-medium break-words">{data.transporter.legalName}</span>
                <span className="text-foreground-muted tabular-nums">
                  {TRANSPORTER_SOURCE_LABELS[data.transporter.source]} ·{" "}
                  {data.transporter.identification}
                </span>
              </dd>
              <dt className="text-foreground-muted">Placa</dt>
              <dd className="tabular-nums">{data.plate}</dd>
              <dt className="text-foreground-muted">Fechas</dt>
              <dd className="tabular-nums">
                Del {formatIssueDate(data.transportStart)} al {formatIssueDate(data.transportEnd)}
              </dd>
              <dt className="text-foreground-muted">Partida</dt>
              <dd className="flex flex-col">
                <span className="break-words">{data.departure.address}</span>
                <span className="text-foreground-muted">
                  {departureSourceLabel(data.departure)}
                </span>
              </dd>
            </dl>
          </Section>
          <Section title="Destinatarios">
            <ol className="flex flex-col gap-2">
              {data.recipients.map((recipient) => (
                <RecipientCard key={recipient.position} recipient={recipient} />
              ))}
            </ol>
          </Section>
        </div>
        <aside
          aria-labelledby="resumen-titulo"
          className="flex flex-col gap-3 self-start rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="resumen-titulo" className="text-lg font-semibold">
            Resumen
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt>Destinatarios</dt>
            <dd className="text-right">{recipientCountLabel(data.counts.recipients)}</dd>
            <dt>Detalles</dt>
            <dd className="text-right">{detailCountLabel(data.counts.details)}</dd>
            <dt>Inicio del transporte</dt>
            <dd className="text-right">{formatIssueDate(data.transportStart)}</dd>
            <dt>Fin del transporte</dt>
            <dd className="text-right">{formatIssueDate(data.transportEnd)}</dd>
          </dl>
          <p className="text-xs text-foreground-muted">
            La guía no tiene total monetario: sustenta el traslado, no una venta.
          </p>
          <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
            <span className="text-foreground-muted">Clave de acceso</span>
            <span className="font-mono text-xs break-all">{data.accessKey}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function ShippingGuideDetailSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Guía de remisión</h1>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
