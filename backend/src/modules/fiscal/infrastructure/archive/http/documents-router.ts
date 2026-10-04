// Rutas de la bandeja de comprobantes bajo /api/v1 (add-document-archive, design D2 y D10). La
// empresa sale de la sesión; un comprobante de otra empresa es `404`. Ninguna ruta genera, dibuja ni
// expone hashes de forma técnica: los hashes del resumen son de consulta, no de operación.
import { Router, type Response } from "express";
import type {
  DeliveryView,
  DocumentListItem,
  DocumentSummaryView,
  ListMeta,
} from "@facturador/contracts";
import { contextOf } from "../../../../identity/infrastructure/http/request-context.ts";
import type { Archive } from "../../../application/archive/archive.ts";
import type { ArchiveDocument } from "../../../application/archive/archive-ports.ts";
import type { StoredDelivery } from "../../../application/archive/delivery-ports.ts";
import type { Downloads, ServedArtifact } from "../../../application/archive/downloads.ts";
import type { ArtifactKind } from "../../../domain/document.ts";
import { availabilityOf, rideStatusOf } from "../../../application/archive/availability.ts";

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

const param = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export function toDocumentListItem(document: ArchiveDocument): DocumentListItem {
  return {
    id: document.id,
    documentType: document.documentType,
    number: document.documentNumber,
    issueDate: document.issueDate,
    buyer: { name: document.buyerName, identification: document.buyerIdentification },
    total: document.total,
    state: document.state,
    transmissionStopped: document.transmissionStopped,
    documents: availabilityOf(document),
  };
}

export function toDocumentSummaryView(document: ArchiveDocument): DocumentSummaryView {
  const status = rideStatusOf(document);
  const stopped = status === "STOPPED" ? document.rideJob : null;
  return {
    ...toDocumentListItem(document),
    artifacts: document.artifacts.map((artifact) => ({
      kind: artifact.kind,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      createdAt: artifact.createdAt.toISOString(),
      provenance:
        artifact.provenance === "AUTHORIZED_XML" || artifact.provenance === "SIGNED_XML_FALLBACK"
          ? artifact.provenance
          : null,
    })),
    rideGeneration: {
      status,
      reason: stopped?.lastErrorCode ?? null,
      stoppedAt: stopped?.completedAt?.toISOString() ?? null,
      retryable: status === "STOPPED",
    },
  };
}

/**
 * Responde con los bytes verificados: tipo, tamaño, descarga con su nombre, sin rastreo de tipo y
 * sin caché, y el SHA-256 como ETag.
 */
function serve(res: Response, artifact: ServedArtifact) {
  res
    .status(200)
    .set({
      "Content-Type": artifact.mediaType,
      "Content-Length": String(artifact.sizeBytes),
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      ETag: `"${artifact.sha256}"`,
    })
    .end(artifact.content);
}

const deliveryView = (delivery: StoredDelivery): DeliveryView => ({
  ...delivery,
  occurredAt: delivery.occurredAt.toISOString(),
});

const DOWNLOADS: readonly (readonly [string, ArtifactKind])[] = [
  ["ride", "RIDE_PDF"],
  ["authorized-xml", "AUTHORIZED_XML"],
  ["signed-xml", "SIGNED_XML"],
];

export function documentsRouter(deps: { archive: Archive; downloads: Downloads }): Router {
  const { archive, downloads } = deps;
  const router = Router();

  router.get("/documents", async (req, res) => {
    const { items, meta } = await archive.list(contextOf(res), req.query);
    send(res, 200, items.map(toDocumentListItem), meta);
  });

  router.get("/documents/:documentId", async (req, res) => {
    const document = await archive.summary(contextOf(res), param(req.params.documentId));
    send(res, 200, toDocumentSummaryView(document));
  });

  // Descargas: los bytes guardados, verificados, con la descarga registrada (design D8).
  for (const [path, kind] of DOWNLOADS) {
    router.get(`/documents/:documentId/${path}`, async (req, res) => {
      serve(res, await downloads.download(contextOf(res), param(req.params.documentId), kind));
    });
  }

  // La impresión es una acción explícita: un GET nunca registra una solicitud de impresión.
  router.post("/documents/:documentId/print-requests", async (req, res) => {
    const recorded = await downloads.requestPrint(contextOf(res), param(req.params.documentId));
    send(res, 201, { id: recorded.id, occurredAt: recorded.occurredAt.toISOString() });
  });

  router.get("/documents/:documentId/deliveries", async (req, res) => {
    const { items, total } = await downloads.deliveries(
      contextOf(res),
      param(req.params.documentId),
    );
    send(res, 200, { items: items.map(deliveryView), total });
  });

  return router;
}
