// Consulta de facturas, reintento de su firma y reconciliación con el SRI (add-invoice-emission,
// design D10, D13 y D14; add-sri-transmission, design D15, D18 y D19). Las facturas se leen desde
// su snapshot; el reintento continúa la misma emisión con su snapshot, su número y su clave, y se
// audita con su resultado. La reconciliación manual solo encola un `sri.reconcile` y se audita: el
// job consulta al SRI y aplica las reglas de la transmisión.
import {
  INVOICE_ATTENTION_STATES,
  INVOICE_TRANSMISSION_HISTORY_LIMIT,
  listInvoicesQuerySchema,
  requestReconciliationSchema,
} from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type {
  ArtifactStore,
  ArtifactSummary,
  DocumentRepository,
  StoredDocument,
} from "../../fiscal/application/ports.ts";
import { enqueueReconciliationIn } from "../../fiscal/application/transmission-jobs.ts";
import type {
  ReconciliationRequestUnitOfWork,
  TransmissionEvent,
  TransmissionReader,
  TransmissionSummary,
} from "../../fiscal/application/transmission-ports.ts";
import { RECONCILABLE_STATES } from "../../fiscal/domain/transmission.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { invoiceNotFound, invoiceNotReconcilable, sriInteractionInProgress } from "./errors.ts";
import type { Page } from "./ports.ts";
import type { SigningPipeline } from "./signing-pipeline.ts";

export type InvoiceDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
  authorizedArtifact: ArtifactSummary | null;
  transmission: TransmissionSummary & Readonly<{ reconcilable: boolean }>;
}>;

export type InvoiceListItem = Readonly<{ document: StoredDocument; transmissionStopped: boolean }>;

export type InvoiceTransmission = Readonly<{
  document: StoredDocument;
  events: readonly TransmissionEvent[];
  total: number;
}>;

export function createInvoices(deps: {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
  transmission: TransmissionReader;
  reconciliations: ReconciliationRequestUnitOfWork;
  /** Ventana de conclusión de una reconciliación (`SRI_CONCLUSION_WINDOW_HOURS`). */
  conclusionWindowMs: number;
  now?: () => Date;
}) {
  const { documents, artifacts, authorizer } = deps;
  const now = deps.now ?? (() => new Date());

  async function details(document: StoredDocument): Promise<InvoiceDetails> {
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

  async function find(ctx: RequestContext, invoiceId: string): Promise<StoredDocument> {
    const document = await documents.find(ctx.companyId, invoiceId);
    if (!document || document.documentType !== "01") throw invoiceNotFound();
    return document;
  }

  return {
    details,

    async list(ctx: RequestContext, query: unknown): Promise<Page<InvoiceListItem>> {
      authorizer.requirePermission(ctx, "invoices.read");
      const { search, state, attention, page, pageSize } = parseInput(
        listInvoicesQuerySchema,
        query,
      );
      const { items, total } = await documents.list(ctx.companyId, {
        documentType: "01",
        search,
        state,
        ...(attention
          ? {
              attention: {
                states: INVOICE_ATTENTION_STATES,
                documentIds: await deps.transmission.stoppedDocumentIds(ctx.companyId),
              },
            }
          : {}),
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

    async get(ctx: RequestContext, invoiceId: string): Promise<InvoiceDetails> {
      authorizer.requirePermission(ctx, "invoices.read");
      return details(await find(ctx, invoiceId));
    },

    /** Historial de la transmisión: sin respuestas originales ni XML (design D18). */
    async transmission(ctx: RequestContext, invoiceId: string): Promise<InvoiceTransmission> {
      authorizer.requirePermission(ctx, "invoices.read");
      const document = await find(ctx, invoiceId);
      const { events, total } = await deps.transmission.history(
        ctx.companyId,
        document.id,
        INVOICE_TRANSMISSION_HISTORY_LIMIT,
      );
      return { document, events, total };
    },

    async retrySigning(ctx: RequestContext, invoiceId: string): Promise<InvoiceDetails> {
      authorizer.requirePermission(ctx, "invoices.retrySigning");
      const document = await find(ctx, invoiceId);
      // Solo un intento que empieza se audita: una factura firmada o un intento en curso se
      // devuelven sin efecto y sin auditoría (spec audit-trail, design D10).
      const { document: result, attempted } = await deps.pipeline.attempt(ctx, document);
      if (!attempted) return details(result);
      await deps.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "invoice.signing_retried",
        changes: {
          invoiceId: document.id,
          documentNumber: document.documentNumber,
          result: result.state === "SIGNED" ? "SIGNED" : (result.lastAttempt?.code ?? "RESERVED"),
        },
        correlationId: ctx.requestId,
      });
      return details(result);
    },

    /**
     * Reconciliación manual (design D15 y D19): con el comprobante bloqueado, comprueba su estado,
     * encola un `sri.reconcile` manual y audita la solicitud en la misma transacción. Un rechazo
     * no deja job ni evento.
     */
    async requestReconciliation(
      ctx: RequestContext,
      invoiceId: string,
      body: unknown,
    ): Promise<InvoiceDetails> {
      authorizer.requirePermission(ctx, "invoices.reconcile");
      const { reason } = parseInput(requestReconciliationSchema, body);
      const found = await find(ctx, invoiceId);
      const document = await deps.reconciliations.run(async (scope) => {
        const current = await scope.lockDocument(ctx.companyId, found.id);
        if (!current || !RECONCILABLE_STATES.has(current.state)) throw invoiceNotReconcilable();
        const enqueued = await enqueueReconciliationIn(scope.jobs, scope.db, current, {
          origin: "MANUAL",
          requestedBy: ctx.userId,
          reason,
          correlationId: ctx.requestId,
          runAt: now(),
          windowMs: deps.conclusionWindowMs,
        });
        if (!enqueued) throw sriInteractionInProgress();
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "invoice.reconciliation_requested",
          changes: {
            invoiceId: current.id,
            documentNumber: current.documentNumber,
            state: current.state,
            reason,
          },
          correlationId: ctx.requestId,
        });
        return current;
      });
      return details(document);
    },
  };
}

export type Invoices = ReturnType<typeof createInvoices>;
