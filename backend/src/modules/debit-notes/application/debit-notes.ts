// Consultas y operaciones sobre las notas de débito (add-debit-notes, design D17 y D20): el detalle
// desde el snapshot con su artefacto y su transmisión, el reintento de la firma con el mismo número
// y la misma clave, y las facturas elegibles. La empresa sale siempre de la sesión y cada operación
// exige su permiso en el servidor.
import { listDebitEligibleInvoicesQuerySchema } from "@facturador/contracts";
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
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { Page } from "./drafts.ts";
import { debitNoteNotFound } from "./errors.ts";
import type { DebitEligibleInvoice, DebitEligibleInvoiceReader, DebitNotesReads } from "./ports.ts";

export const DEBIT_NOTE_DOCUMENT_TYPE = "05";

export type DebitNoteDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
  authorizedArtifact: ArtifactSummary | null;
  transmission: TransmissionSummary & Readonly<{ reconcilable: boolean }>;
  /** Nombre del usuario que declaró, si sigue en la empresa. */
  declaredByName: string | null;
}>;

export type DebitNotesDependencies = {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
  eligible: DebitEligibleInvoiceReader;
  reads: Pick<DebitNotesReads, "currentConfig">;
  /** Nombre visible de un usuario de la empresa, para "declarado por". */
  userName: (companyId: string, userId: string) => Promise<string | null>;
};

export function createDebitNotes(deps: DebitNotesDependencies) {
  const { documents, artifacts, authorizer } = deps;

  async function details(document: StoredDocument): Promise<DebitNoteDetails> {
    const declaredBy = (document.snapshot as { declarations?: { declaredBy?: string } })
      .declarations?.declaredBy;
    const [artifact, authorizedArtifact, transmission, declaredByName] = await Promise.all([
      document.state === "RESERVED"
        ? null
        : artifacts.summary(document.companyId, document.id, "SIGNED_XML"),
      document.state === "AUTHORIZED"
        ? artifacts.summary(document.companyId, document.id, "AUTHORIZED_XML")
        : null,
      deps.transmission.summary(document.companyId, document.id),
      declaredBy ? deps.userName(document.companyId, declaredBy) : Promise.resolve(null),
    ]);
    return {
      document,
      artifact,
      authorizedArtifact,
      transmission: {
        ...transmission,
        reconcilable: RECONCILABLE_STATES.has(document.state) && !transmission.inProgress,
      },
      declaredByName,
    };
  }

  /** La nota de la empresa; otra empresa o un comprobante de otro tipo es `404`. */
  async function find(ctx: RequestContext, debitNoteId: string): Promise<StoredDocument> {
    const document = await documents.find(ctx.companyId, debitNoteId);
    if (!document || document.documentType !== DEBIT_NOTE_DOCUMENT_TYPE) throw debitNoteNotFound();
    return document;
  }

  return {
    details,
    find,

    /**
     * Reintento de la firma de una nota reservada (design D2): las mismas etapas con su snapshot,
     * su número y su clave. Solo un intento que empieza se audita.
     */
    async retrySigning(ctx: RequestContext, debitNoteId: string): Promise<DebitNoteDetails> {
      authorizer.requirePermission(ctx, "debitNotes.retrySigning");
      const document = await find(ctx, debitNoteId);
      const { document: result, attempted } = await deps.pipeline.attempt(ctx, document);
      if (!attempted) return details(result);
      await deps.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "debit_note.signing_retried",
        changes: {
          debitNoteId: document.id,
          documentNumber: document.documentNumber,
          result: result.state === "SIGNED" ? "SIGNED" : (result.lastAttempt?.code ?? "RESERVED"),
        },
        correlationId: ctx.requestId,
      });
      return details(result);
    },

    /** Facturas autorizadas, sin consumidor final y del ambiente en que la empresa emite. */
    async eligibleInvoices(
      ctx: RequestContext,
      query: unknown,
    ): Promise<Page<DebitEligibleInvoice>> {
      authorizer.requirePermission(ctx, "debitNotes.draft");
      const { search, page, pageSize } = parseInput(listDebitEligibleInvoicesQuerySchema, query);
      const config = await deps.reads.currentConfig(ctx.companyId);
      const { items, total } = await deps.eligible.list(ctx.companyId, {
        search,
        environment: config?.environment ?? null,
        page,
        pageSize,
      });
      return { items, meta: { page, pageSize, total } };
    },
  };
}

export type DebitNotes = ReturnType<typeof createDebitNotes>;
