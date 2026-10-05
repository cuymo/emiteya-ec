// Sección "Documentos" del detalle de un comprobante (add-document-archive, design D13; la factura y
// la nota de crédito la comparten con textos por tipo, add-credit-notes D15). Usuario:
// administrador u operador. Objetivo: entregar el comprobante autorizado. Decisión: qué documento
// descargar o si imprimir. P0: el estado del RIDE y "Descargar RIDE"; P1: "Imprimir", "XML
// autorizado" y "XML firmado" (rotulado como firmado); P2: historial de entregas plegable; P3
// (hashes, versiones del renderer y procedencia): no se muestran.
"use client";

import {
  ARTIFACT_KIND_LABELS,
  DELIVERY_EVENT_LABELS,
  type DocumentSummaryView,
  type DocumentType,
} from "@facturador/contracts";
import { CirclePause, Download, FileCode2, LoaderCircle, Printer, RefreshCw } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { ErrorState, Skeleton } from "@/components/states";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { formatDateTime } from "@/features/invoices/invoice-format";
import {
  useDocumentDeliveries,
  useDocumentSummary,
  useDownloadDocument,
  usePrintRide,
  useRetryRide,
  type DownloadKind,
} from "./archive-api";
import { stopReason } from "./archive-format";
import { documentKind, withArticle, type DocumentKind } from "./document-kinds";

/** Historial plegable: descargas servidas y solicitudes de impresión, sin datos técnicos. */
function DeliveryHistory({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const history = useDocumentDeliveries(documentId, open);
  let content: ReactNode = null;
  if (open) {
    if (history.isPending) content = <Skeleton className="h-8 w-full" />;
    else if (history.isError)
      content = (
        <ErrorState
          message="No pudimos cargar el historial de entregas."
          onRetry={() => void history.refetch()}
        />
      );
    else if (history.data.items.length === 0)
      content = <p className="text-foreground-muted">Todavía no hay descargas ni impresiones.</p>;
    else
      content = (
        <>
          <ol aria-label="Historial de entregas" className="flex flex-col gap-1">
            {history.data.items.map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-col gap-0.5 border-l-2 border-border pl-1.5"
              >
                <span className="font-medium">
                  {DELIVERY_EVENT_LABELS[delivery.event]} ·{" "}
                  {ARTIFACT_KIND_LABELS[delivery.artifactKind]}
                </span>
                <span className="text-foreground-muted">
                  {formatDateTime(delivery.occurredAt)} · {delivery.actorName}
                </span>
              </li>
            ))}
          </ol>
          {history.data.total > history.data.items.length && (
            <p className="text-foreground-muted">
              Se muestran las {history.data.items.length} entregas más recientes de{" "}
              {history.data.total}.
            </p>
          )}
        </>
      );
  }
  return (
    <details
      className="rounded-lg border border-border bg-surface"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary className="flex min-h-5.5 cursor-pointer items-center px-1.5 font-medium">
        Historial de entregas
      </summary>
      <div className="flex flex-col gap-1 border-t border-border px-1.5 py-1 text-sm">
        {content}
      </div>
    </details>
  );
}

function rideMessage(kind: DocumentKind, summary: DocumentSummaryView): ReactNode {
  switch (summary.documents.ride) {
    case "AVAILABLE":
      return "El RIDE está listo para entregarse.";
    case "PENDING":
      return (
        <span className="inline-flex items-center gap-1">
          <LoaderCircle aria-hidden="true" className="size-2 motion-safe:animate-spin" />
          Estamos preparando el RIDE. Aparecerá aquí en unos segundos.
        </span>
      );
    case "STOPPED":
      return null;
    case "NOT_APPLICABLE":
      return summary.state === "RESERVED"
        ? `Los documentos estarán disponibles cuando ${withArticle(kind)} se firme.`
        : `El RIDE estará disponible cuando el SRI autorice ${withArticle(kind)}.`;
  }
}

/** Lo que la sección necesita del comprobante: su identificador y su tipo. */
export type ArchivedDocument = Readonly<{ id: string; documentType: DocumentType }>;

export function DocumentsSection({ document }: { document: ArchivedDocument }) {
  const kind = documentKind(document.documentType);
  return kind ? <KindDocumentsSection kind={kind} documentId={document.id} /> : null;
}

function KindDocumentsSection({ kind, documentId }: { kind: DocumentKind; documentId: string }) {
  const { me } = useSession();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canRead = canSee(me.role, "archive.read");
  const canDownload = canSee(me.role, "archive.download");
  const canRetry = canSee(me.role, "archive.retryRide");
  const summary = useDocumentSummary(documentId, canRead);
  const download = useDownloadDocument();
  const print = usePrintRide();
  const retry = useRetryRide({ onSuccess: () => headingRef.current?.focus() });
  const [pendingKind, setPendingKind] = useState<DownloadKind | null>(null);

  if (!canRead) return null;

  const downloadButton = (
    artifact: DownloadKind,
    label: string,
    variant: "primary" | "outline",
  ) => (
    <AsyncButton
      variant={variant}
      pending={download.isPending && pendingKind === artifact}
      pendingLabel={`Descargando ${label.toLowerCase()}`}
      disabled={download.isPending}
      onClick={() => {
        setPendingKind(artifact);
        download.mutate({ id: documentId, kind: artifact });
      }}
    >
      {artifact === "ride" ? <Download aria-hidden="true" /> : <FileCode2 aria-hidden="true" />}
      {label}
    </AsyncButton>
  );

  let body: ReactNode;
  if (summary.isPending) body = <Skeleton className="h-6 w-full" />;
  else if (summary.error instanceof ApiError && summary.error.status === 403)
    body = (
      <p className="text-sm text-foreground-muted">
        No tienes acceso a los documentos de esta {kind.noun}. Pide a un administrador que revise tu
        rol.
      </p>
    );
  else if (summary.isError)
    body = (
      <ErrorState
        message={`No pudimos cargar los documentos de ${withArticle(kind)}.`}
        onRetry={() => void summary.refetch()}
      />
    );
  else {
    const data = summary.data;
    const { documents, rideGeneration } = data;
    body = (
      <>
        {documents.ride === "STOPPED" ? (
          <div
            role="status"
            className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-1 text-sm"
          >
            <CirclePause aria-hidden="true" className="mt-0.5 size-2 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">La preparación del RIDE se detuvo.</p>
              <p>{stopReason(rideGeneration.reason)}</p>
              <p className="text-foreground-muted">
                {rideGeneration.stoppedAt && `${formatDateTime(rideGeneration.stoppedAt)} · `}
                {withArticle(kind, true)} sigue autorizada.
                {!canRetry && " Pide a un administrador que la reintente."}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm">{rideMessage(kind, data)}</p>
        )}
        {(canDownload || (canRetry && rideGeneration.retryable)) && (
          <div className="flex flex-wrap items-center gap-1">
            {canDownload && documents.ride === "AVAILABLE" && (
              <>
                {downloadButton("ride", "Descargar RIDE", "primary")}
                <AsyncButton
                  variant="outline"
                  pending={print.isPending}
                  pendingLabel="Preparando la impresión"
                  onClick={() => print.mutate({ id: documentId })}
                >
                  <Printer aria-hidden="true" />
                  Imprimir
                </AsyncButton>
              </>
            )}
            {canRetry && rideGeneration.retryable && (
              <AsyncButton
                pending={retry.isPending}
                pendingLabel="Reintentando"
                onClick={() => retry.mutate({ id: documentId })}
              >
                <RefreshCw aria-hidden="true" />
                Reintentar generación
              </AsyncButton>
            )}
            {canDownload &&
              documents.authorizedXml &&
              downloadButton("authorized-xml", "XML autorizado", "outline")}
            {canDownload &&
              documents.signedXml &&
              downloadButton("signed-xml", "XML firmado", "outline")}
          </div>
        )}
        {(documents.signedXml || documents.ride !== "NOT_APPLICABLE") && (
          <DeliveryHistory documentId={documentId} />
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
        Documentos
      </h2>
      {body}
    </section>
  );
}
