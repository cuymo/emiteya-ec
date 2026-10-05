// Consultas y operaciones sobre las notas de débito (add-debit-notes, design D17 y D20): la lista y
// el detalle desde el snapshot con su artefacto y su transmisión, el historial de la transmisión, la
// reconciliación manual, el reintento de la firma con el mismo número y la misma clave, y las
// facturas elegibles. La empresa sale siempre de la sesión y cada operación exige su permiso en el
// servidor.
import {
  DEBIT_NOTE_TRANSMISSION_HISTORY_LIMIT,
  listDebitEligibleInvoicesQuerySchema,
  listDebitNotesQuerySchema,
  requestReconciliationSchema,
} from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type {
  ArtifactStore,
  ArtifactSummary,
  DocumentRepository,
  StoredDocument,
} from "../../fiscal/application/ports.ts";
import { requestReconciliationIn } from "../../fiscal/application/reconciliation-request.ts";
import type { SigningPipeline } from "../../fiscal/application/signing-pipeline.ts";
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
import type { Page } from "./drafts.ts";
import { debitNoteNotFound } from "./errors.ts";
import type {
  DebitEligibleInvoice,
  DebitEligibleInvoiceReader,
  DebitNoteListReader,
  DebitNotesReads,
} from "./ports.ts";

export const DEBIT_NOTE_DOCUMENT_TYPE = "05";

export type DebitNoteDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
  authorizedArtifact: ArtifactSummary | null;
  transmission: TransmissionSummary & Readonly<{ reconcilable: boolean }>;
  /** Nombre del usuario que declaró, si sigue en la empresa. */
  declaredByName: string | null;
}>;

export type DebitNoteListItem = Readonly<{
  document: StoredDocument;
  transmissionStopped: boolean;
}>;

export type DebitNoteTransmission = Readonly<{
  document: StoredDocument;
  events: readonly TransmissionEvent[];
  total: number;
}>;

const notReconcilable = () =>
  new ConflictError(
    "DEBIT_NOTE_NOT_RECONCILABLE",
    "El estado de la nota de débito no admite una reconciliación con el SRI.",
  );

const interactionInProgress = () =>
  new ConflictError(
    "SRI_INTERACTION_IN_PROGRESS",
    "La nota de débito ya tiene una interacción con el SRI en curso. Espera a que termine.",
  );

export type DebitNotesDependencies = {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
  eligible: DebitEligibleInvoiceReader;
  list: DebitNoteListReader;
  reads: Pick<DebitNotesReads, "currentConfig">;
  reconciliations: ReconciliationRequestUnitOfWork;
  /** Ventana de conclusión de una reconciliación (`SRI_CONCLUSION_WINDOW_HOURS`). */
  conclusionWindowMs: number;
  now?: () => Date;
  /** Nombre visible de un usuario de la empresa, para "declarado por". */
  userName: (companyId: string, userId: string) => Promise<string | null>;
};

export function createDebitNotes(deps: DebitNotesDependencies) {
  const { documents, artifacts, authorizer } = deps;
  const now = deps.now ?? (() => new Date());

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

    async get(ctx: RequestContext, debitNoteId: string): Promise<DebitNoteDetails> {
      authorizer.requirePermission(ctx, "debitNotes.read");
      return details(await find(ctx, debitNoteId));
    },

    async list(ctx: RequestContext, query: unknown): Promise<Page<DebitNoteListItem>> {
      authorizer.requirePermission(ctx, "debitNotes.read");
      const { search, state, cause, page, pageSize } = parseInput(listDebitNotesQuerySchema, query);
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

    /** Historial de la transmisión: sin respuestas originales ni XML (design D17). */
    async transmission(ctx: RequestContext, debitNoteId: string): Promise<DebitNoteTransmission> {
      authorizer.requirePermission(ctx, "debitNotes.read");
      const document = await find(ctx, debitNoteId);
      const { events, total } = await deps.transmission.history(
        ctx.companyId,
        document.id,
        DEBIT_NOTE_TRANSMISSION_HISTORY_LIMIT,
      );
      return { document, events, total };
    },

    /**
     * Reconciliación manual de una nota (design D17), con la solicitud compartida de `fiscal`: con el
     * comprobante bloqueado, comprueba su estado, encola un `sri.reconcile` manual y audita la
     * solicitud en la misma transacción. Un rechazo no deja job ni evento.
     */
    async requestReconciliation(
      ctx: RequestContext,
      debitNoteId: string,
      body: unknown,
    ): Promise<DebitNoteDetails> {
      authorizer.requirePermission(ctx, "debitNotes.reconcile");
      const { reason } = parseInput(requestReconciliationSchema, body);
      const found = await find(ctx, debitNoteId);
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
            action: "debit_note.reconciliation_requested",
            changes: {
              debitNoteId: current.id,
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
