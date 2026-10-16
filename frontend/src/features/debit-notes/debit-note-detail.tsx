// Detalle de una nota de débito (add-debit-notes, design D23). Usuario: administrador u operador con
// `debitNotes.read`. Objetivo: confirmar que la nota quedó autorizada y obtener sus documentos.
// Decisión: si reintentar la firma o pedir la reconciliación (administrador). Información mínima:
// estado, número, valor y factura. Acción principal: descargar el RIDE de una nota autorizada, o
// reintentar la firma de una reservada. P0: estado, número y valor total; P1: factura modificada,
// conceptos e impuestos por tratamiento; P2: forma de pago, declaración (declarada por el usuario,
// nunca verificada por el sistema), transmisión y documentos; P3 (identificadores y hashes): no se
// muestran. Todo sale del snapshot de la nota: nada se vuelve a leer de la factura ni del catálogo.
"use client";

import { DEBIT_NOTE_CAUSE_LABELS, DEBIT_NOTE_ELIGIBILITY_DECLARATION } from "@facturador/contracts";
import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { ApiError } from "@/lib/api";
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
import { useDebitNote, useRetryDebitNoteSigning } from "./debit-notes-api";
import { treatmentLabel } from "./debit-note-format";
import { useBreadcrumbLabel } from "@/components/shell/breadcrumb-label";
import { Money } from "@/components/money";

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

export function DebitNoteDetailScreen({ debitNoteId }: { debitNoteId: string }) {
  const { me } = useSession();
  const allowed = canSee(me.role, "debitNotes.read");
  const canRetry = canSee(me.role, "debitNotes.retrySigning");
  const note = useDebitNote(debitNoteId, allowed);
  // Miga final del shell: el número o el nombre del registro (adopt-premium-design-foundation-and-shell).
  useBreadcrumbLabel(note.data?.documentNumber);
  const retry = useRetryDebitNoteSigning();

  const fallback = (body: ReactNode) => (
    <section aria-labelledby="nota-titulo" className="flex flex-col gap-6">
      <h1 id="nota-titulo" className="text-3xl font-bold">
        Nota de débito
      </h1>
      {body}
    </section>
  );

  if (!allowed) {
    return fallback(
      <EmptyState
        kind="no-permission"
        title="No tienes acceso a Notas de débito"
        description="Pide a un administrador que revise tu rol."
      />,
    );
  }
  if (note.isPending) return <DebitNoteDetailSkeleton />;
  if (note.isError) {
    const missing = note.error instanceof ApiError && note.error.status === 404;
    return fallback(
      missing ? (
        <EmptyState
          kind="empty"
          title="La nota de débito no existe"
          description="Revisa el número en la lista de notas de débito."
        />
      ) : (
        <ErrorState
          message="No pudimos cargar la nota de débito."
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 id="nota-titulo" className="text-3xl font-bold tabular-nums">
            Nota de débito {data.documentNumber}
          </h1>
          <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
            <StateCell state={data.state} stopped={data.transmission.stopped !== null} />
            {formatIssueDate(data.issueDate)} · Ambiente de {ENVIRONMENT_LABELS[data.environment]} ·{" "}
            <Money amount={data.totals.total} />
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
        <DocumentDetailTabs
          label="Secciones de la nota de débito"
          tabs={[
            {
              id: "detalle",
              label: "Detalle",
              content: (
                <>
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
                    <p className="text-sm text-foreground-muted">
                      La nota de débito no cambia la factura ni su crédito.
                    </p>
                  </Section>
                  <Section title="Comprador">
                    <p className="flex flex-col text-sm">
                      <span className="text-base font-semibold break-words">
                        {data.buyer.legalName}
                      </span>
                      <span className="text-foreground-muted tabular-nums">
                        {data.buyer.identification}
                      </span>
                    </p>
                  </Section>
                  <Section title="Conceptos">
                    <ol className="flex flex-col gap-2">
                      {data.concepts.map((concept) => (
                        <li
                          key={concept.position}
                          className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="font-medium break-words">{concept.description}</span>
                            <span className="text-foreground-muted">
                              {DEBIT_NOTE_CAUSE_LABELS[concept.cause]} ·{" "}
                              {treatmentLabel(concept.taxTreatment)}
                            </span>
                          </span>
                          <Money amount={concept.amount} />
                        </li>
                      ))}
                    </ol>
                  </Section>
                </>
              ),
            },
            {
              id: "declaracion",
              label: "Declaración",
              content: (
                <>
                  <Section title="Declaración del usuario">
                    <p className="flex flex-col text-sm">
                      <span>
                        Declarada por {declarations.declaredByName ?? "un usuario"} ·{" "}
                        {formatDateTime(declarations.declaredAt)}
                      </span>
                      <span className="text-foreground-muted">
                        Es una declaración del usuario: el sistema no puede comprobarla.
                      </span>
                    </p>
                    <ul className="flex flex-col gap-2">
                      {declarations.statements.map((statement) => (
                        <li
                          key={statement.id}
                          className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                        >
                          <span>{statement.text}</span>
                          <span className="text-xs text-foreground-muted">
                            Fuente: {statement.source}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {declarations.version !== DEBIT_NOTE_ELIGIBILITY_DECLARATION.version && (
                      <p className="text-xs text-foreground-muted">
                        Texto de la versión {declarations.version} de la declaración, vigente al
                        emitir.
                      </p>
                    )}
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
            {data.totals.taxes.map((tax) => (
              <div key={tax.key} className="contents">
                <dt>Base {treatmentLabel(tax)}</dt>
                <dd className="text-right">
                  <Money amount={tax.base} className="font-normal" />
                </dd>
                <dt>{treatmentLabel(tax)}</dt>
                <dd className="text-right">
                  <Money amount={tax.amount} className="font-normal" />
                </dd>
              </div>
            ))}
            <dt className="text-base font-semibold">Valor total</dt>
            <dd className="text-right">
              <Money amount={data.totals.total} className="text-base" />
            </dd>
          </dl>
          <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
            <span className="text-foreground-muted">Forma de pago</span>
            <span className="break-words">
              {data.payment.label} · <Money amount={data.payment.amount} />
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
            <span className="text-foreground-muted">Clave de acceso</span>
            <span className="font-mono text-xs break-all">{data.accessKey}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function DebitNoteDetailSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Nota de débito</h1>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
