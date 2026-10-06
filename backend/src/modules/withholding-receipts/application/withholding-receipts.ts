// Consultas y operaciones sobre los comprobantes de retención (add-withholding-receipts, design D18,
// D21 y D23): el detalle desde el snapshot con su artefacto y su transmisión, y el reintento de la
// firma con el mismo número y la misma clave. La empresa sale siempre de la sesión y cada operación
// exige su permiso en el servidor.
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
import { withholdingNotFound } from "./errors.ts";

export const WITHHOLDING_DOCUMENT_TYPE = "07";

export type WithholdingReceiptDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
  authorizedArtifact: ArtifactSummary | null;
  transmission: TransmissionSummary & Readonly<{ reconcilable: boolean }>;
}>;

export type WithholdingReceiptsDependencies = {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
};

export function createWithholdingReceipts(deps: WithholdingReceiptsDependencies) {
  const { documents, artifacts, authorizer } = deps;

  async function details(document: StoredDocument): Promise<WithholdingReceiptDetails> {
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

  /** La retención de la empresa; otra empresa o un comprobante de otro tipo es `404`. */
  async function find(ctx: RequestContext, withholdingReceiptId: string): Promise<StoredDocument> {
    const document = await documents.find(ctx.companyId, withholdingReceiptId);
    if (!document || document.documentType !== WITHHOLDING_DOCUMENT_TYPE) {
      throw withholdingNotFound();
    }
    return document;
  }

  return {
    details,
    find,

    /**
     * Reintento de la firma de una retención reservada (design D2): las mismas etapas con su
     * snapshot, su número y su clave. Solo un intento que empieza se audita.
     */
    async retrySigning(
      ctx: RequestContext,
      withholdingReceiptId: string,
    ): Promise<WithholdingReceiptDetails> {
      authorizer.requirePermission(ctx, "withholdings.retrySigning");
      const document = await find(ctx, withholdingReceiptId);
      const { document: result, attempted } = await deps.pipeline.attempt(ctx, document);
      if (!attempted) return details(result);
      await deps.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "withholding_receipt.signing_retried",
        changes: {
          withholdingReceiptId: document.id,
          documentNumber: document.documentNumber,
          result: result.state === "SIGNED" ? "SIGNED" : (result.lastAttempt?.code ?? "RESERVED"),
        },
        correlationId: ctx.requestId,
      });
      return details(result);
    },
  };
}

export type WithholdingReceipts = ReturnType<typeof createWithholdingReceipts>;
