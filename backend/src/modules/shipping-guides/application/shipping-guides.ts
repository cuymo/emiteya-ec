// Consultas y operaciones sobre las guías de remisión (add-shipping-guides, design D2, D17 y D22): el
// detalle desde el snapshot con su artefacto y su transmisión, y el reintento de la firma con el mismo
// número, la misma clave y la misma fecha de emisión. La empresa sale siempre de la sesión y cada
// operación exige su permiso en el servidor.
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type {
  ArtifactStore,
  ArtifactSummary,
  DocumentRepository,
  StoredDocument,
} from "../../fiscal/application/ports.ts";
import type { SigningPipeline } from "../../fiscal/application/signing-pipeline.ts";
import type {
  TransmissionReader,
  TransmissionSummary,
} from "../../fiscal/application/transmission-ports.ts";
import { RECONCILABLE_STATES } from "../../fiscal/domain/transmission.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { shippingGuideNotFound } from "./errors.ts";

export const SHIPPING_GUIDE_DOCUMENT_TYPE = "06";

export type ShippingGuideDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
  authorizedArtifact: ArtifactSummary | null;
  transmission: TransmissionSummary & Readonly<{ reconcilable: boolean }>;
}>;

export type ShippingGuidesDependencies = {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
};

export function createShippingGuides(deps: ShippingGuidesDependencies) {
  const { documents, artifacts, authorizer } = deps;

  async function details(document: StoredDocument): Promise<ShippingGuideDetails> {
    const [artifact, authorizedArtifact, transmission] = await Promise.all([
      document.state === "RESERVED"
        ? null
        : artifacts.summary(document.companyId, document.id, "SIGNED_XML"),
      document.state === "AUTHORIZED"
        ? artifacts.summary(document.companyId, document.id, "AUTHORIZED_XML")
        : null,
      deps.transmission.summary(document.companyId, document.id),
    ]);
    return {
      document,
      artifact,
      authorizedArtifact,
      transmission: {
        ...transmission,
        reconcilable: RECONCILABLE_STATES.has(document.state) && !transmission.inProgress,
      },
    };
  }

  /** La guía de la empresa; otra empresa o un comprobante de otro tipo es `404`. */
  async function find(ctx: RequestContext, shippingGuideId: string): Promise<StoredDocument> {
    const document = await documents.find(ctx.companyId, shippingGuideId);
    if (!document || document.documentType !== SHIPPING_GUIDE_DOCUMENT_TYPE) {
      throw shippingGuideNotFound();
    }
    return document;
  }

  return {
    details,
    find,

    async get(ctx: RequestContext, shippingGuideId: string): Promise<ShippingGuideDetails> {
      authorizer.requirePermission(ctx, "shippingGuides.read");
      return details(await find(ctx, shippingGuideId));
    },

    /**
     * Reintento de la firma de una guía reservada (design D2): las mismas etapas con su snapshot, su
     * número, su clave y su fecha de emisión. Solo un intento que empieza se audita.
     */
    async retrySigning(
      ctx: RequestContext,
      shippingGuideId: string,
    ): Promise<ShippingGuideDetails> {
      authorizer.requirePermission(ctx, "shippingGuides.retrySigning");
      const document = await find(ctx, shippingGuideId);
      const { document: result, attempted } = await deps.pipeline.attempt(ctx, document);
      if (!attempted) return details(result);
      await deps.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "shipping_guide.signing_retried",
        changes: {
          shippingGuideId: document.id,
          documentNumber: document.documentNumber,
          result: result.state === "SIGNED" ? "SIGNED" : (result.lastAttempt?.code ?? "RESERVED"),
        },
        correlationId: ctx.requestId,
      });
      return details(result);
    },
  };
}

export type ShippingGuides = ReturnType<typeof createShippingGuides>;
