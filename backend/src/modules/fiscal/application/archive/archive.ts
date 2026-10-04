// Bandeja de comprobantes (add-document-archive, design D2 y D11): lista y resumen de los
// documentos de cada comprobante, siempre de la empresa de la sesión. El detalle de la factura y su
// transmisión siguen en `invoices`.
import { listDocumentsQuerySchema } from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../../identity/application/authorization.ts";
import type { RequestContext } from "../../../identity/application/request-context.ts";
import type { ArchiveDocument, ArchiveReads } from "./archive-ports.ts";
import { documentNotFound } from "./errors.ts";

export type ArchivePage = Readonly<{
  items: ArchiveDocument[];
  meta: Readonly<{ page: number; pageSize: number; total: number }>;
}>;

export function createArchive(deps: { reads: ArchiveReads; authorizer: Authorizer }) {
  const { reads, authorizer } = deps;

  return {
    async list(ctx: RequestContext, query: unknown): Promise<ArchivePage> {
      authorizer.requirePermission(ctx, "archive.read");
      const filters = parseInput(listDocumentsQuerySchema, query);
      const { items, total } = await reads.list(ctx.companyId, filters);
      return { items, meta: { page: filters.page, pageSize: filters.pageSize, total } };
    },

    async summary(ctx: RequestContext, documentId: string): Promise<ArchiveDocument> {
      authorizer.requirePermission(ctx, "archive.read");
      const document = await reads.find(ctx.companyId, documentId);
      if (!document) throw documentNotFound();
      return document;
    },
  };
}

export type Archive = ReturnType<typeof createArchive>;
