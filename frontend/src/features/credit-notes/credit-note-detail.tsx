// Detalle de una nota de crédito (add-credit-notes, design D19). Usuario: administrador u operador.
// Objetivo: entender la nota, saber si quedó autorizada y destrabarla. Decisión: si reintentar la
// firma, si la nota está lista para entregarse o si necesita una reconciliación. Información mínima:
// estado, factura modificada, causa, motivo, líneas con su retorno físico, declaraciones y totales.
// P0: estado y acción; P1: transmisión, documentos, factura, causa y totales; P2: líneas y
// declaraciones (declaradas por el usuario, nunca verificadas por el sistema); P3 (versiones y
// metadatos técnicos): no se muestran.
"use client";

import {
  CREDIT_NOTE_CAUSE_LABELS,
  CREDIT_NOTE_ELIGIBILITY_DECLARATION,
  compareDecimalStrings,
  type InvoiceState,
} from "@facturador/contracts";
import { ArrowLeft, RotateCw } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { ApiError } from "@/lib/api";
import { formatDecimal, formatPercentage, formatUsd } from "@/lib/decimal";
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
import { useCreditNote, useRetryCreditNoteSigning } from "./credit-notes-api";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";

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

/** Dónde está el crédito de la nota en la factura: aplicado, liberado o todavía reservado. */
function creditStatus(state: InvoiceState): string {
  if (state === "AUTHORIZED") return "Su crédito está aplicado en la factura.";
  if (state === "RETURNED" || state === "NOT_AUTHORIZED")
    return "El crédito que reservaba en la factura se liberó: la factura vuelve a tenerlo disponible.";
  return "Su crédito queda reservado en la factura hasta que el SRI autorice o rechace la nota.";
}

export function CreditNoteDetailScreen({ creditNoteId }: { creditNoteId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "creditNotes.read");
  const canRetry = canSee(me.role, "creditNotes.retrySigning");
  const note = useCreditNote(creditNoteId, allowed);
  // Miga final del shell: el número o el nombre del registro (adopt-premium-design-foundation-and-shell).
  useBreadcrumbLabel(note.data?.documentNumber);
  const retry = useRetryCreditNoteSigning();

  const header = (
    <Link
      href="/notas-credito"
      className="inline-flex items-center gap-1 self-start text-sm text-foreground-muted hover:text-foreground"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Notas de crédito
    </Link>
  );
  const fallback = (body: ReactNode) => (
    <section aria-labelledby="nota-titulo" className="flex flex-col gap-6">
      {header}
      <h1 id="nota-titulo" className="text-3xl font-bold">
        Nota de crédito
      </h1>
      {body}
    </section>
  );

  if (!allowed) {
    return fallback(
      <EmptyState
        kind="no-permission"
        title="No tienes acceso a Notas de crédito"
        description="Pide a un administrador que revise tu rol."
      />,
    );
  }
  if (note.isPending) return <CreditNoteDetailSkeleton />;
  if (note.isError) {
    const missing = note.error instanceof ApiError && note.error.status === 404;
    return fallback(
      missing ? (
        <EmptyState
          kind="empty"
          title="La nota de crédito no existe"
          description="Revisa el número en la lista de notas de crédito."
        />
      ) : (
        <ErrorState
          message="No pudimos cargar la nota de crédito."
          onRetry={() => void note.refetch()}
        />
      ),
    );
  }

  const data = note.data;
  const reserved = data.state === "RESERVED";
  const declarations = data.declarations;
  return (
    <section aria-labelledby="nota-titulo" className="flex flex-col gap-6">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="nota-titulo" className="text-3xl font-bold tabular-nums">
            Nota de crédito {data.documentNumber}
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
              La nota tiene su número y su clave, y la firma está en curso o se interrumpió.
              Reintenta la firma para completarla.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {!reserved && <TransmissionSection document={data} />}
          <DocumentsSection document={data} />
          <Section title="Factura modificada">
            <p className="flex flex-col text-sm">
              <Link
                href={`/facturas/${data.invoice.id}`}
                className="self-start font-medium tabular-nums underline-offset-2 hover:underline"
              >
                Factura {data.invoice.documentNumber}
              </Link>
              <span className="text-foreground-muted">
                Emitida el {formatIssueDate(data.invoice.issueDate)}
              </span>
            </p>
            <p className="text-sm">{creditStatus(data.state)}</p>
          </Section>
          <Section title="Causa y motivo">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-foreground-muted">Causa</dt>
              <dd>{CREDIT_NOTE_CAUSE_LABELS[data.cause]}</dd>
              <dt className="text-foreground-muted">Motivo</dt>
              <dd className="break-words">{data.reason}</dd>
            </dl>
          </Section>
          <Section title="Comprador">
            <p className="flex flex-col text-sm">
              <span className="font-medium break-words">{data.buyer.legalName}</span>
              <span className="text-foreground-muted tabular-nums">
                {data.buyer.identification}
              </span>
            </p>
          </Section>
          <Section title="Líneas">
            <ul className="flex flex-col gap-2">
              {data.lines.map((line) => (
                <li
                  key={line.position}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium break-words">{line.description}</span>
                    <span className="text-foreground-muted tabular-nums">
                      {formatDecimal(line.quantity)} × {formatUsd(line.unitPrice)}
                      {line.discount !== "0.00" && ` · Descuento ${formatUsd(line.discount)}`}
                      {line.taxes.map((tax) => ` · IVA ${formatPercentage(tax.percentage)}`)}
                    </span>
                    <span className="text-foreground-muted">
                      {compareDecimalStrings(line.physicalReturn, "0") > 0
                        ? `Retorno físico al inventario: ${formatDecimal(line.physicalReturn)}`
                        : "Sin retorno físico al inventario"}
                    </span>
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {formatUsd(line.taxableBase)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Declaraciones del usuario">
            <p className="flex flex-col text-sm">
              <span>
                Declaradas por {declarations.declaredByName ?? "un usuario"} ·{" "}
                {formatDateTime(declarations.declaredAt)}
              </span>
              <span className="text-foreground-muted">
                Son declaraciones del usuario: el sistema no puede comprobarlas.
              </span>
            </p>
            <ul className="flex flex-col gap-2">
              {declarations.statements.map((statement) => (
                <li
                  key={statement.id}
                  className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                >
                  <span>{statement.text}</span>
                  <span className="text-xs text-foreground-muted">Fuente: {statement.source}</span>
                </li>
              ))}
            </ul>
            {declarations.version !== CREDIT_NOTE_ELIGIBILITY_DECLARATION.version && (
              <p className="text-xs text-foreground-muted">
                Texto de la versión {declarations.version} de las declaraciones, vigente al emitir.
              </p>
            )}
          </Section>
        </div>
        <aside
          aria-labelledby="totales-titulo"
          className="flex flex-col gap-3 self-start rounded-lg border border-border bg-surface p-4"
        >
          <h2 id="totales-titulo" className="text-lg font-semibold">
            Totales
          </h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt>Subtotal sin impuestos</dt>
            <dd className="text-right">{formatUsd(data.totals.withoutTaxes)}</dd>
            {data.totals.taxes.map((tax) => (
              <div key={`${tax.taxCode}-${tax.rateCode}`} className="contents">
                <dt>IVA {formatPercentage(tax.percentage)}</dt>
                <dd className="text-right">{formatUsd(tax.amount)}</dd>
              </div>
            ))}
            <dt className="font-semibold">Valor de la modificación</dt>
            <dd className="text-right font-semibold">{formatUsd(data.totals.total)}</dd>
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

export function CreditNoteDetailSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Nota de crédito</h1>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
