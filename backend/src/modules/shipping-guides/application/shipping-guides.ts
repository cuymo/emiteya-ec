// Consultas y operaciones sobre las guías de remisión (add-shipping-guides, design D2, D18, D21 y
// D22): la lista y el detalle desde el snapshot con su artefacto y su transmisión, el historial de la
// transmisión, la reconciliación manual y el reintento de la firma con el mismo número, la misma clave
// y la misma fecha de emisión. La empresa sale siempre de la sesión y cada operación exige su permiso
// en el servidor.
import {
  SHIPPING_GUIDE_TRANSMISSION_HISTORY_LIMIT,
  listShippingGuidesQuerySchema,
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
import { shippingGuideNotFound } from "./errors.ts";
import type { ShippingGuideListReader } from "./ports.ts";

export const SHIPPING_GUIDE_DOCUMENT_TYPE = "06";

export type ShippingGuideDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
  authorizedArtifact: ArtifactSummary | null;
  transmission: TransmissionSummary & Readonly<{ reconcilable: boolean }>;
}>;

export type ShippingGuideListItem = Readonly<{
  document: StoredDocument;
  transmissionStopped: boolean;
}>;

export type ShippingGuideTransmission = Readonly<{
  document: StoredDocument;
  events: readonly TransmissionEvent[];
  total: number;
}>;

const notReconcilable = () =>
  new ConflictError(
    "SHIPPING_GUIDE_NOT_RECONCILABLE",
    "El estado de la guía de remisión no admite una reconciliación con el SRI.",
  );

const interactionInProgress = () =>
  new ConflictError(
    "SRI_INTERACTION_IN_PROGRESS",
    "La guía de remisión ya tiene una interacción con el SRI en curso. Espera a que termine.",
  );

export type ShippingGuidesDependencies = {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
  list: ShippingGuideListReader;
  reconciliations: ReconciliationRequestUnitOfWork;
  /** Ventana de conclusión de una reconciliación (`SRI_CONCLUSION_WINDOW_HOURS`). */
  conclusionWindowMs: number;
  now?: () => Date;
};

export function createShippingGuides(deps: ShippingGuidesDependencies) {
  const { documents, artifacts, authorizer } = deps;
  const now = deps.now ?? (() => new Date());

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

    async list(ctx: RequestContext, query: unknown): Promise<Page<ShippingGuideListItem>> {
      authorizer.requirePermission(ctx, "shippingGuides.read");
      const { search, state, page, pageSize } = parseInput(listShippingGuidesQuerySchema, query);
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
      shippingGuideId: string,
    ): Promise<ShippingGuideTransmission> {
      authorizer.requirePermission(ctx, "shippingGuides.read");
      const document = await find(ctx, shippingGuideId);
      const { events, total } = await deps.transmission.history(
        ctx.companyId,
        document.id,
        SHIPPING_GUIDE_TRANSMISSION_HISTORY_LIMIT,
      );
      return { document, events, total };
    },

    /**
     * Reconciliación manual de una guía (design D18), con la solicitud compartida de `fiscal`: con el
     * comprobante bloqueado, comprueba su estado, encola un `sri.reconcile` manual y audita la
     * solicitud en la misma transacción. Un rechazo no deja job ni evento.
     */
    async requestReconciliation(
      ctx: RequestContext,
      shippingGuideId: string,
      body: unknown,
    ): Promise<ShippingGuideDetails> {
      authorizer.requirePermission(ctx, "shippingGuides.reconcile");
      const { reason } = parseInput(requestReconciliationSchema, body);
      const found = await find(ctx, shippingGuideId);
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
            action: "shipping_guide.reconciliation_requested",
            changes: {
              shippingGuideId: current.id,
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
