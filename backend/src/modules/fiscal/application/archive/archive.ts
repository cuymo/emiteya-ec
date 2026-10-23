// Bandeja de comprobantes (add-document-archive, design D2, D5 y D11): lista y resumen de los
// documentos de cada comprobante, siempre de la empresa de la sesión, y el reintento de una
// generación detenida del RIDE. El detalle de la factura y su transmisión siguen en `invoices`.
import { listDocumentsQuerySchema, type EmailDeliveryStatus } from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../../identity/application/authorization.ts";
import type { RequestContext } from "../../../identity/application/request-context.ts";
import type {
  ArchiveDocument,
  ArchiveEmailStatuses,
  ArchiveReads,
  RideRetryUnitOfWork,
} from "./archive-ports.ts";
import {
  documentNotAuthorized,
  documentNotFound,
  rideAlreadyAvailable,
  rideGenerationInProgress,
} from "./errors.ts";
import { rideJob, type RideJobSettings } from "./ride-jobs.ts";

export type ArchivePage = Readonly<{
  items: ArchiveDocument[];
  meta: Readonly<{ page: number; pageSize: number; total: number }>;
}>;

export function createArchive(deps: {
  reads: ArchiveReads;
  authorizer: Authorizer;
  retries: RideRetryUnitOfWork;
  rideSettings: RideJobSettings;
  /** El estado del correo de cada comprobante (add-email-delivery); sin él, ningún envío. */
  emailStatuses?: ArchiveEmailStatuses;
  now?: () => Date;
}) {
  const { reads, authorizer } = deps;
  const now = deps.now ?? (() => new Date());

  async function withEmail(companyId: string, documents: ArchiveDocument[]) {
    const statuses = deps.emailStatuses
      ? await deps.emailStatuses.lastStatuses(
          companyId,
          documents.map((document) => document.id),
        )
      : new Map<string, EmailDeliveryStatus>();
    return documents.map((document) => ({
      ...document,
      emailStatus: statuses.get(document.id) ?? null,
    }));
  }

  return {
    async list(ctx: RequestContext, query: unknown): Promise<ArchivePage> {
      authorizer.requirePermission(ctx, "archive.read");
      const filters = parseInput(listDocumentsQuerySchema, query);
      // El filtro del correo se resuelve con su fuente: los comprobantes con el último envío fallido.
      const failed =
        filters.emailStatus === "FAILED"
          ? ((await deps.emailStatuses?.failedDocumentIds(ctx.companyId)) ?? [])
          : undefined;
      const { items, total } = await reads.list(
        ctx.companyId,
        failed ? { ...filters, documentIds: failed } : filters,
      );
      return {
        items: await withEmail(ctx.companyId, items),
        meta: { page: filters.page, pageSize: filters.pageSize, total },
      };
    },

    async summary(ctx: RequestContext, documentId: string): Promise<ArchiveDocument> {
      authorizer.requirePermission(ctx, "archive.read");
      const document = await reads.find(ctx.companyId, documentId);
      if (!document) throw documentNotFound();
      const [withStatus] = await withEmail(ctx.companyId, [document]);
      return withStatus!;
    },

    /**
     * Reintenta una generación detenida: autorizado, sin RIDE y con su último job `STOPPED`. Nunca
     * reemplaza un RIDE, nunca deja dos jobs activos y nunca cambia el estado fiscal. El job manual
     * guarda quién lo pidió; no hay evento de auditoría (design D12).
     */
    async retryRide(ctx: RequestContext, documentId: string): Promise<ArchiveDocument> {
      authorizer.requirePermission(ctx, "archive.retryRide");
      await deps.retries.run(async (scope) => {
        const document = await scope.lockDocument(ctx.companyId, documentId);
        if (!document) throw documentNotFound();
        if (document.state !== "AUTHORIZED") throw documentNotAuthorized();
        if (await scope.hasRide(ctx.companyId, document.id)) throw rideAlreadyAvailable();
        const latest = await scope.latestRideJob(ctx.companyId, document.id);
        // Sin job todavía, el barrido lo programa: la generación sigue pendiente.
        if (latest?.status !== "STOPPED") throw rideGenerationInProgress();
        const job = rideJob(document, deps.rideSettings, now(), { requestedBy: ctx.userId });
        if (!(await scope.enqueue(job))) throw rideGenerationInProgress();
      });
      const document = await reads.find(ctx.companyId, documentId);
      if (!document) throw documentNotFound();
      return document;
    },
  };
}

export type Archive = ReturnType<typeof createArchive>;
