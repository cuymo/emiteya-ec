// Descargas verificadas, solicitud de impresión e historial de entregas (add-document-archive,
// design D8 y D9). Antes de servir: permiso, empresa y comprobante, disponibilidad, y el SHA-256 y
// el tamaño recalculados de los bytes guardados. Si no coinciden, no sale ningún byte. Una descarga
// registra `DOWNLOAD` cuando se determina que se responde con el artefacto; la impresión es una
// acción explícita que registra `PRINT_REQUESTED`, y ninguna lectura la registra.
import { createHash } from "node:crypto";
import type { Authorizer } from "../../../identity/application/authorization.ts";
import type { RequestContext } from "../../../identity/application/request-context.ts";
import type { ArtifactKind } from "../../domain/document.ts";
import type { ArtifactStore } from "../ports.ts";
import type { ArchiveDocument, ArchiveReads } from "./archive-ports.ts";
import { availabilityOf } from "./availability.ts";
import type {
  DeliveryEvent,
  DeliveryObserver,
  DeliveryRepository,
  StoredDelivery,
} from "./delivery-ports.ts";
import { artifactIntegrityFailed, documentNotAvailable, documentNotFound } from "./errors.ts";
import { downloadFilename } from "./filenames.ts";

export const DELIVERIES_LIMIT = 100;

const MEDIA_TYPES: Readonly<Record<ArtifactKind, string>> = {
  RIDE_PDF: "application/pdf",
  AUTHORIZED_XML: "application/xml",
  SIGNED_XML: "application/xml",
};

export type ServedArtifact = Readonly<{
  content: Buffer;
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function available(document: ArchiveDocument, kind: ArtifactKind): boolean {
  const documents = availabilityOf(document);
  if (kind === "RIDE_PDF") return documents.ride === "AVAILABLE";
  if (kind === "AUTHORIZED_XML") return documents.authorizedXml;
  return documents.signedXml;
}

export function createDownloads(deps: {
  reads: ArchiveReads;
  artifacts: Pick<ArtifactStore, "read">;
  deliveries: DeliveryRepository;
  authorizer: Authorizer;
  observer?: DeliveryObserver;
  logger?: Readonly<{ error(details: object, message: string): void }>;
}) {
  const { reads, artifacts, deliveries, authorizer } = deps;

  async function documentOf(ctx: RequestContext, documentId: string) {
    const document = await reads.find(ctx.companyId, documentId);
    if (!document) throw documentNotFound();
    return document;
  }

  /** Empresa, disponibilidad e integridad, en ese orden; devuelve los bytes verificados. */
  async function verified(ctx: RequestContext, documentId: string, kind: ArtifactKind) {
    const document = await documentOf(ctx, documentId);
    if (!available(document, kind)) throw documentNotAvailable();
    const artifact = await artifacts.read(ctx.companyId, document.id, kind);
    if (!artifact) throw documentNotAvailable();
    if (
      artifact.content.length !== artifact.sizeBytes ||
      sha256(artifact.content) !== artifact.sha256
    ) {
      deps.observer?.integrityFailed(kind);
      deps.logger?.error(
        { documentId: document.id, kind, requestId: ctx.requestId },
        "un documento guardado no pasó la verificación de integridad y no se sirvió",
      );
      throw artifactIntegrityFailed();
    }
    return { document, artifact };
  }

  async function record(
    ctx: RequestContext,
    document: ArchiveDocument,
    event: DeliveryEvent,
    kind: ArtifactKind,
    artifactSha256: string,
  ) {
    const recorded = await deliveries.record({
      companyId: ctx.companyId,
      documentId: document.id,
      event,
      artifactKind: kind,
      artifactSha256,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
    });
    deps.observer?.delivered(event);
    return recorded;
  }

  return {
    /** Los bytes guardados del documento, con la descarga registrada. */
    async download(
      ctx: RequestContext,
      documentId: string,
      kind: ArtifactKind,
    ): Promise<ServedArtifact> {
      authorizer.requirePermission(ctx, "archive.download");
      const { document, artifact } = await verified(ctx, documentId, kind);
      await record(ctx, document, "DOWNLOAD", kind, artifact.sha256);
      return {
        content: artifact.content,
        mediaType: MEDIA_TYPES[kind],
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        filename: downloadFilename(document.documentType, document.documentNumber, kind),
      };
    },

    /** Solicitud de impresión del RIDE guardado: lo verifica y la registra, sin bytes. */
    async requestPrint(ctx: RequestContext, documentId: string) {
      authorizer.requirePermission(ctx, "archive.download");
      const { document, artifact } = await verified(ctx, documentId, "RIDE_PDF");
      return record(ctx, document, "PRINT_REQUESTED", "RIDE_PDF", artifact.sha256);
    },

    async deliveries(
      ctx: RequestContext,
      documentId: string,
    ): Promise<{ items: StoredDelivery[]; total: number }> {
      authorizer.requirePermission(ctx, "archive.read");
      const document = await documentOf(ctx, documentId);
      return deliveries.list(ctx.companyId, document.id, DELIVERIES_LIMIT);
    },
  };
}

export type Downloads = ReturnType<typeof createDownloads>;
