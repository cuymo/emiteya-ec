// Rutas de la bandeja de comprobantes bajo /api/v1 (add-document-archive, design D2 y D10). La
// empresa sale de la sesión; un comprobante de otra empresa es `404`. Ninguna ruta genera, dibuja ni
// expone hashes de forma técnica: los hashes del resumen son de consulta, no de operación.
import { Router, type Response } from "express";
import type { DocumentListItem, DocumentSummaryView, ListMeta } from "@facturador/contracts";
import { contextOf } from "../../../../identity/infrastructure/http/request-context.ts";
import type { Archive } from "../../../application/archive/archive.ts";
import type { ArchiveDocument } from "../../../application/archive/archive-ports.ts";
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

export function documentsRouter(deps: { archive: Archive }): Router {
  const { archive } = deps;
  const router = Router();

  router.get("/documents", async (req, res) => {
    const { items, meta } = await archive.list(contextOf(res), req.query);
    send(res, 200, items.map(toDocumentListItem), meta);
  });

  router.get("/documents/:documentId", async (req, res) => {
    const document = await archive.summary(contextOf(res), param(req.params.documentId));
    send(res, 200, toDocumentSummaryView(document));
  });

  return router;
}
