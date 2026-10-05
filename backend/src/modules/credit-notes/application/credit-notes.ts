// Consultas y operaciones sobre las notas de crédito emitidas (add-credit-notes, design D13 y D16):
// el detalle desde el snapshot con su artefacto y su transmisión, el reintento de la firma con el
// mismo número y la misma clave, y las facturas elegibles. La empresa sale siempre de la sesión.
import { listEligibleInvoicesQuerySchema } from "@facturador/contracts";
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
import { creditNoteNotFound } from "./errors.ts";
import type { EligibleInvoice, EligibleInvoiceReader } from "./ports.ts";
import type { Page } from "./drafts.ts";

export const CREDIT_NOTE_DOCUMENT_TYPE = "04";

export type CreditNoteDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
  authorizedArtifact: ArtifactSummary | null;
  transmission: TransmissionSummary & Readonly<{ reconcilable: boolean }>;
  /** Nombre del usuario que declaró la elegibilidad, si sigue en la empresa. */
  declaredByName: string | null;
}>;

export type CreditNotesDependencies = {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
  eligible: EligibleInvoiceReader;
  /** Nombre visible de un usuario de la empresa, para "declarado por". */
  userName: (companyId: string, userId: string) => Promise<string | null>;
};

export function createCreditNotes(deps: CreditNotesDependencies) {
  const { documents, artifacts, authorizer } = deps;

  async function details(document: StoredDocument): Promise<CreditNoteDetails> {
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
  async function find(ctx: RequestContext, creditNoteId: string): Promise<StoredDocument> {
    const document = await documents.find(ctx.companyId, creditNoteId);
    if (!document || document.documentType !== CREDIT_NOTE_DOCUMENT_TYPE)
      throw creditNoteNotFound();
    return document;
  }

  return {
    details,
    find,

    async get(ctx: RequestContext, creditNoteId: string): Promise<CreditNoteDetails> {
      authorizer.requirePermission(ctx, "creditNotes.read");
      return details(await find(ctx, creditNoteId));
    },

    /**
     * Reintento de la firma de una nota reservada (design D2): las mismas etapas con su snapshot,
     * su número y su clave. Solo un intento que empieza se audita; la capacidad sigue reservada.
     */
    async retrySigning(ctx: RequestContext, creditNoteId: string): Promise<CreditNoteDetails> {
      authorizer.requirePermission(ctx, "creditNotes.retrySigning");
      const document = await find(ctx, creditNoteId);
      const { document: result, attempted } = await deps.pipeline.attempt(ctx, document);
      if (!attempted) return details(result);
      await deps.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "credit_note.signing_retried",
        changes: {
          creditNoteId: document.id,
          documentNumber: document.documentNumber,
          result: result.state === "SIGNED" ? "SIGNED" : (result.lastAttempt?.code ?? "RESERVED"),
        },
        correlationId: ctx.requestId,
      });
      return details(result);
    },

    /** Facturas autorizadas, sin consumidor final y con capacidad, por número o comprador. */
    async eligibleInvoices(ctx: RequestContext, query: unknown): Promise<Page<EligibleInvoice>> {
      authorizer.requirePermission(ctx, "creditNotes.draft");
      const { search, page, pageSize } = parseInput(listEligibleInvoicesQuerySchema, query);
      const { items, total } = await deps.eligible.list(ctx.companyId, { search, page, pageSize });
      return { items, meta: { page, pageSize, total } };
    },
  };
}

export type CreditNotes = ReturnType<typeof createCreditNotes>;
