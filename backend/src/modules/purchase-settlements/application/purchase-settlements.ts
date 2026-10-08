// Consultas y operaciones sobre las liquidaciones de compra (add-purchase-settlements, design D18, D21
// y D23): la lista y el detalle desde el snapshot con su artefacto y su transmisión, el historial de
// la transmisión, la reconciliación manual y el reintento de la firma con el mismo número y la misma
// clave. La empresa sale siempre de la sesión y cada operación exige su permiso en el servidor.
import {
  PURCHASE_SETTLEMENT_TRANSMISSION_HISTORY_LIMIT,
  listPurchaseSettlementsQuerySchema,
  requestReconciliationSchema,
} from "@facturador/contracts";
import { ConflictError } from "../../../platform/http/errors.ts";
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
import type { Page } from "./drafts.ts";
import { settlementNotFound } from "./errors.ts";
import type { PurchaseSettlementListReader } from "./ports.ts";

export const PURCHASE_SETTLEMENT_DOCUMENT_TYPE = "03";

export type PurchaseSettlementDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
  authorizedArtifact: ArtifactSummary | null;
  transmission: TransmissionSummary & Readonly<{ reconcilable: boolean }>;
}>;

export type PurchaseSettlementListItem = Readonly<{
  document: StoredDocument;
  transmissionStopped: boolean;
}>;

export type PurchaseSettlementTransmission = Readonly<{
  document: StoredDocument;
  events: readonly TransmissionEvent[];
  total: number;
}>;

const notReconcilable = () =>
  new ConflictError(
    "PURCHASE_SETTLEMENT_NOT_RECONCILABLE",
    "El estado de la liquidación de compra no admite una reconciliación con el SRI.",
  );

const interactionInProgress = () =>
  new ConflictError(
    "SRI_INTERACTION_IN_PROGRESS",
    "La liquidación de compra ya tiene una interacción con el SRI en curso. Espera a que termine.",
  );

export type PurchaseSettlementsDependencies = {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
  list: PurchaseSettlementListReader;
  reconciliations: ReconciliationRequestUnitOfWork;
  /** Ventana de conclusión de una reconciliación (`SRI_CONCLUSION_WINDOW_HOURS`). */
  conclusionWindowMs: number;
  now?: () => Date;
};

export function createPurchaseSettlements(deps: PurchaseSettlementsDependencies) {
  const { documents, artifacts, authorizer } = deps;
  const now = deps.now ?? (() => new Date());

  async function details(document: StoredDocument): Promise<PurchaseSettlementDetails> {
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

  /** La liquidación de la empresa; otra empresa o un comprobante de otro tipo es `404`. */
  async function find(ctx: RequestContext, purchaseSettlementId: string): Promise<StoredDocument> {
    const document = await documents.find(ctx.companyId, purchaseSettlementId);
    if (!document || document.documentType !== PURCHASE_SETTLEMENT_DOCUMENT_TYPE) {
      throw settlementNotFound();
    }
    return document;
  }

  return {
    details,
    find,

    async get(
      ctx: RequestContext,
      purchaseSettlementId: string,
    ): Promise<PurchaseSettlementDetails> {
      authorizer.requirePermission(ctx, "purchaseSettlements.read");
      return details(await find(ctx, purchaseSettlementId));
    },

    async list(ctx: RequestContext, query: unknown): Promise<Page<PurchaseSettlementListItem>> {
      authorizer.requirePermission(ctx, "purchaseSettlements.read");
      const { search, state, page, pageSize } = parseInput(
        listPurchaseSettlementsQuerySchema,
        query,
      );
      const { items, total } = await deps.list.list(ctx.companyId, {
        search,
        state,
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

    /** Historial de la transmisión: sin respuestas originales ni XML (design D18). */
    async transmission(
      ctx: RequestContext,
      purchaseSettlementId: string,
    ): Promise<PurchaseSettlementTransmission> {
      authorizer.requirePermission(ctx, "purchaseSettlements.read");
      const document = await find(ctx, purchaseSettlementId);
      const { events, total } = await deps.transmission.history(
        ctx.companyId,
        document.id,
        PURCHASE_SETTLEMENT_TRANSMISSION_HISTORY_LIMIT,
      );
      return { document, events, total };
    },

    /**
     * Reconciliación manual de una liquidación (design D18), con la solicitud compartida de `fiscal`:
     * con el comprobante bloqueado, comprueba su estado, encola un `sri.reconcile` manual y audita la
     * solicitud en la misma transacción. Un rechazo no deja job ni evento.
     */
    async requestReconciliation(
      ctx: RequestContext,
      purchaseSettlementId: string,
      body: unknown,
    ): Promise<PurchaseSettlementDetails> {
      authorizer.requirePermission(ctx, "purchaseSettlements.reconcile");
      const { reason } = parseInput(requestReconciliationSchema, body);
      const found = await find(ctx, purchaseSettlementId);
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
            action: "purchase_settlement.reconciliation_requested",
            changes: {
              purchaseSettlementId: current.id,
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
     * Reintento de la firma de una liquidación reservada (design D2): las mismas etapas con su
     * snapshot, su número y su clave. Solo un intento que empieza se audita.
     */
    async retrySigning(
      ctx: RequestContext,
      purchaseSettlementId: string,
    ): Promise<PurchaseSettlementDetails> {
      authorizer.requirePermission(ctx, "purchaseSettlements.retrySigning");
      const document = await find(ctx, purchaseSettlementId);
      const { document: result, attempted } = await deps.pipeline.attempt(ctx, document);
      if (!attempted) return details(result);
      await deps.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "purchase_settlement.signing_retried",
        changes: {
          purchaseSettlementId: document.id,
          documentNumber: document.documentNumber,
          result: result.state === "SIGNED" ? "SIGNED" : (result.lastAttempt?.code ?? "RESERVED"),
        },
        correlationId: ctx.requestId,
      });
      return details(result);
    },
  };
}

export type PurchaseSettlements = ReturnType<typeof createPurchaseSettlements>;
