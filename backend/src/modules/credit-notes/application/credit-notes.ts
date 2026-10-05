// Consultas y operaciones sobre las notas de crédito emitidas (add-credit-notes, design D13 y D16):
// el detalle desde el snapshot con su artefacto y su transmisión, el reintento de la firma con el
// mismo número y la misma clave, y las facturas elegibles. La empresa sale siempre de la sesión.
import {
  CREDIT_NOTE_TRANSMISSION_HISTORY_LIMIT,
  listCreditNotesQuerySchema,
  listEligibleInvoicesQuerySchema,
  requestReconciliationSchema,
} from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type {
  ArtifactStore,
  ArtifactSummary,
  DocumentRepository,
  StoredDocument,
} from "../../fiscal/application/ports.ts";
import type { SigningPipeline } from "../../fiscal/application/signing-pipeline.ts";
import { requestReconciliationIn } from "../../fiscal/application/reconciliation-request.ts";
import type {
  ReconciliationRequestUnitOfWork,
  TransmissionEvent,
  TransmissionReader,
  TransmissionSummary,
} from "../../fiscal/application/transmission-ports.ts";
import { RECONCILABLE_STATES } from "../../fiscal/domain/transmission.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { ConflictError } from "../../../platform/http/errors.ts";
import type { ContextReads } from "./context.ts";
import { creditNoteNotFound, invoiceNotFound } from "./errors.ts";
import type {
  CreditCapacityState,
  CreditNoteListReader,
  CreditSource,
  EligibleInvoice,
  EligibleInvoiceReader,
  ReturnCapacity,
} from "./ports.ts";
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

export type CreditNoteListItem = Readonly<{
  document: StoredDocument;
  transmissionStopped: boolean;
}>;

export type CreditNoteTransmission = Readonly<{
  document: StoredDocument;
  events: readonly TransmissionEvent[];
  total: number;
}>;

/** Crédito de una factura: su capacidad acreditable y la devolvible de sus productos. */
export type InvoiceCredit = Readonly<{
  invoice: CreditSource;
  capacity: CreditCapacityState;
  returnable: ReadonlyMap<
    string,
    Readonly<{ original: string; reserved: string; applied: string }>
  >;
}>;

const notReconcilable = () =>
  new ConflictError(
    "CREDIT_NOTE_NOT_RECONCILABLE",
    "El estado de la nota de crédito no admite una reconciliación con el SRI.",
  );

const interactionInProgress = () =>
  new ConflictError(
    "SRI_INTERACTION_IN_PROGRESS",
    "La nota de crédito ya tiene una interacción con el SRI en curso. Espera a que termine.",
  );

export type CreditNotesDependencies = {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
  eligible: EligibleInvoiceReader;
  list: CreditNoteListReader;
  /** Factura de origen y capacidades, para el crédito de una factura. */
  context: Pick<ContextReads, "invoices" | "capacity"> & {
    returns: Pick<ReturnType<ReturnCapacity>, "state">;
  };
  reconciliations: ReconciliationRequestUnitOfWork;
  /** Ventana de conclusión de una reconciliación (`SRI_CONCLUSION_WINDOW_HOURS`). */
  conclusionWindowMs: number;
  now?: () => Date;
  /** Nombre visible de un usuario de la empresa, para "declarado por". */
  userName: (companyId: string, userId: string) => Promise<string | null>;
};

export function createCreditNotes(deps: CreditNotesDependencies) {
  const { documents, artifacts, authorizer } = deps;
  const now = deps.now ?? (() => new Date());

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

    async list(ctx: RequestContext, query: unknown): Promise<Page<CreditNoteListItem>> {
      authorizer.requirePermission(ctx, "creditNotes.read");
      const { search, state, cause, page, pageSize } = parseInput(
        listCreditNotesQuerySchema,
        query,
      );
      const { items, total } = await deps.list.list(ctx.companyId, {
        search,
        state,
        cause,
        page,
        pageSize,
      });
      const stopped = await deps.transmission.stoppedAmong(
        ctx.companyId,
        items.map((document) => document.id),
      );
      return {
        items: items.map((document) => ({
          document,
          transmissionStopped: stopped.has(document.id),
        })),
        meta: { page, pageSize, total },
      };
    },

    /** Historial de la transmisión: sin respuestas originales ni XML (design D13). */
    async transmission(ctx: RequestContext, creditNoteId: string): Promise<CreditNoteTransmission> {
      authorizer.requirePermission(ctx, "creditNotes.read");
      const document = await find(ctx, creditNoteId);
      const { events, total } = await deps.transmission.history(
        ctx.companyId,
        document.id,
        CREDIT_NOTE_TRANSMISSION_HISTORY_LIMIT,
      );
      return { document, events, total };
    },

    /** Crédito de una factura de la empresa: aplicado, reservado, disponible y por línea. */
    async invoiceCredit(ctx: RequestContext, invoiceId: string): Promise<InvoiceCredit> {
      authorizer.requirePermission(ctx, "creditNotes.read");
      const invoice = await deps.context.invoices.find(ctx.companyId, invoiceId);
      if (!invoice) throw invoiceNotFound();
      const capacity = await deps.context.capacity.read(ctx.companyId, invoice.id);
      const products = [
        ...new Set(invoice.lines.filter((l) => l.inventoryAffectsStock).map((l) => l.productId)),
      ];
      const returnable =
        products.length > 0
          ? await deps.context.returns.state(ctx.companyId, invoice.id, products)
          : new Map();
      return { invoice, capacity, returnable };
    },

    /**
     * Reconciliación manual de una nota (design D13), con la solicitud compartida de `fiscal`: con el
     * comprobante bloqueado, comprueba su estado, encola un `sri.reconcile` manual y audita la
     * solicitud en la misma transacción. Un rechazo no deja job ni evento.
     */
    async requestReconciliation(
      ctx: RequestContext,
      creditNoteId: string,
      body: unknown,
    ): Promise<CreditNoteDetails> {
      authorizer.requirePermission(ctx, "creditNotes.reconcile");
      const { reason } = parseInput(requestReconciliationSchema, body);
      const found = await find(ctx, creditNoteId);
      const result = await deps.reconciliations.run((scope) =>
        requestReconciliationIn(scope, {
          companyId: ctx.companyId,
          documentId: found.id,
          userId: ctx.userId,
          reason,
          correlationId: ctx.requestId,
          runAt: now(),
          windowMs: deps.conclusionWindowMs,
          audit: (current) => ({
            action: "credit_note.reconciliation_requested",
            changes: {
              creditNoteId: current.id,
              documentNumber: current.documentNumber,
              state: current.state,
              reason,
            },
          }),
        }),
      );
      if (result.outcome === "NOT_RECONCILABLE") throw notReconcilable();
      if (result.outcome === "IN_PROGRESS") throw interactionInProgress();
      return details(result.document);
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
