// Consulta de facturas y reintento de su firma (add-invoice-emission, design D10, D13 y D14). Las
// facturas se leen desde su snapshot; el reintento continúa la misma emisión con su snapshot, su
// número y su clave, y se audita con su resultado. Sobre una factura firmada no tiene efecto.
import { listInvoicesQuerySchema } from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type {
  ArtifactStore,
  ArtifactSummary,
  DocumentRepository,
  StoredDocument,
} from "../../fiscal/application/ports.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { invoiceNotFound } from "./errors.ts";
import type { Page } from "./ports.ts";
import type { SigningPipeline } from "./signing-pipeline.ts";

export type InvoiceDetails = Readonly<{
  document: StoredDocument;
  artifact: ArtifactSummary | null;
}>;

export function createInvoices(deps: {
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  pipeline: SigningPipeline;
  audit: AuditLog;
  authorizer: Authorizer;
}) {
  const { documents, artifacts, authorizer } = deps;

  async function details(document: StoredDocument): Promise<InvoiceDetails> {
    const artifact =
      document.state === "SIGNED"
        ? await artifacts.summary(document.companyId, document.id, "SIGNED_XML")
        : null;
    return { document, artifact };
  }

  async function find(ctx: RequestContext, invoiceId: string): Promise<StoredDocument> {
    const document = await documents.find(ctx.companyId, invoiceId);
    if (!document || document.documentType !== "01") throw invoiceNotFound();
    return document;
  }

  return {
    details,

    async list(ctx: RequestContext, query: unknown): Promise<Page<StoredDocument>> {
      authorizer.requirePermission(ctx, "invoices.read");
      const { search, state, page, pageSize } = parseInput(listInvoicesQuerySchema, query);
      const { items, total } = await documents.list(ctx.companyId, {
        documentType: "01",
        search,
        state,
        page,
        pageSize,
      });
      return { items, meta: { page, pageSize, total } };
    },

    async get(ctx: RequestContext, invoiceId: string): Promise<InvoiceDetails> {
      authorizer.requirePermission(ctx, "invoices.read");
      return details(await find(ctx, invoiceId));
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
  };
}

export type Invoices = ReturnType<typeof createInvoices>;
