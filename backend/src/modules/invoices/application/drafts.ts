// Borradores de factura (add-invoice-emission, design D2 y D13). Se guardan, corrigen con versión y
// eliminan sin consumir el secuencial ni crear datos fiscales, y sin auditoría (D14). Las referencias
// se resuelven en la empresa del contexto. Cada consulta devuelve una vista previa no fiscal,
// calculada con la fecha de hoy en Ecuador y la misma evaluación de la emisión (D6).
import {
  createDraftSchema,
  listDraftsQuerySchema,
  updateDraftSchema,
  type DraftData,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { DraftContent, DraftRecord } from "../domain/draft.ts";
import { evaluateInvoice, type Evaluation, type EvaluationInput } from "../domain/evaluation.ts";
import {
  DraftAlreadyEmittedError,
  draftChanged,
  draftNotFound,
  referenceNotFound,
  tooManyLines,
} from "./errors.ts";
import { cachedCatalogReads, readEvaluation } from "./evaluation.ts";
import type { DraftRepository, DraftsUnitOfWork, EvaluationReads, Page } from "./ports.ts";

export type DraftsDependencies = {
  drafts: DraftRepository;
  uow: DraftsUnitOfWork;
  reads: EvaluationReads;
  authorizer: Authorizer;
  /** Fecha de hoy en Ecuador: la de la vista previa. */
  today: () => string;
  /** `INVOICE_MAX_LINES`: defensa de recursos de la aplicación, no una regla del SRI. */
  maxLines: number;
};

/** Borrador con sus referencias resueltas y su vista previa. */
export type DraftDetails = Readonly<{
  draft: DraftRecord;
  input: EvaluationInput;
  evaluation: Evaluation;
}>;

const contentOf = (data: DraftData): DraftContent => ({
  emissionPointId: data.emissionPointId,
  buyerPartyId: data.buyerPartyId,
  lines: data.lines,
  payments: data.payments,
});

export function createDrafts(deps: DraftsDependencies) {
  const { drafts, uow, authorizer } = deps;

  /** Referencias que no existen en la empresa: `400` con la línea o el pago (design D2). */
  async function checkReferences(companyId: string, content: DraftContent): Promise<void> {
    if (content.lines.length > deps.maxLines) throw tooManyLines(deps.maxLines);
    if (
      content.emissionPointId &&
      !(await deps.reads.emissionPoint(companyId, content.emissionPointId))
    ) {
      throw referenceNotFound(
        "EMISSION_POINT_NOT_FOUND",
        "El punto de emisión no existe en tu empresa.",
      );
    }
    if (content.buyerPartyId && !(await deps.reads.party(companyId, content.buyerPartyId))) {
      throw referenceNotFound("BUYER_NOT_FOUND", "El comprador no existe en tu empresa.");
    }
    const seen = new Set<string>();
    for (const [index, line] of content.lines.entries()) {
      if (seen.has(line.productId)) continue;
      if (!(await deps.reads.product(companyId, line.productId))) {
        throw referenceNotFound(
          "PRODUCT_NOT_FOUND",
          `Línea ${index + 1}: el producto no existe en tu empresa.`,
        );
      }
      seen.add(line.productId);
    }
    if (content.payments.length > 0) {
      const methods = await deps.reads.catalogs.availability(
        companyId,
        "payment-method",
        deps.today(),
      );
      for (const [index, payment] of content.payments.entries()) {
        if (!methods.has(payment.paymentMethod)) {
          throw referenceNotFound(
            "PAYMENT_METHOD_NOT_FOUND",
            `Forma de pago ${index + 1}: ${payment.paymentMethod} no existe en el catálogo de formas de pago.`,
          );
        }
      }
    }
  }

  async function details(draft: DraftRecord, reads: EvaluationReads = deps.reads) {
    const { input } = await readEvaluation(
      reads,
      draft.companyId,
      draft,
      deps.today(),
      deps.maxLines,
    );
    return { draft, input, evaluation: evaluateInvoice(input) } satisfies DraftDetails;
  }

  async function findDraft(companyId: string, draftId: string): Promise<DraftRecord> {
    const draft = await drafts.find(companyId, draftId);
    if (!draft) throw draftNotFound();
    if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
    return draft;
  }

  return {
    async create(ctx: RequestContext, body: unknown): Promise<DraftDetails> {
      authorizer.requirePermission(ctx, "invoices.draft");
      const content = contentOf(parseInput(createDraftSchema, body));
      await checkReferences(ctx.companyId, content);
      const draft = await uow.run(({ drafts: tx }) =>
        tx.create(ctx.companyId, content, ctx.userId),
      );
      return details(draft);
    },

    async get(ctx: RequestContext, draftId: string): Promise<DraftDetails> {
      authorizer.requirePermission(ctx, "invoices.draft");
      return details(await findDraft(ctx.companyId, draftId));
    },

    async list(ctx: RequestContext, query: unknown): Promise<Page<DraftDetails>> {
      authorizer.requirePermission(ctx, "invoices.draft");
      const { page, pageSize } = parseInput(listDraftsQuerySchema, query);
      const { items, total } = await drafts.list(ctx.companyId, { page, pageSize });
      const reads = { ...deps.reads, catalogs: cachedCatalogReads(deps.reads.catalogs) };
      const result: DraftDetails[] = [];
      for (const draft of items) result.push(await details(draft, reads));
      return { items: result, meta: { page, pageSize, total } };
    },

    async update(ctx: RequestContext, draftId: string, body: unknown): Promise<DraftDetails> {
      authorizer.requirePermission(ctx, "invoices.draft");
      const { expectedVersion, ...data } = parseInput(updateDraftSchema, body);
      const current = await findDraft(ctx.companyId, draftId);
      if (current.version !== expectedVersion) throw draftChanged();
      const content = contentOf(data);
      await checkReferences(ctx.companyId, content);
      const updated = await uow.run(({ drafts: tx }) =>
        tx.updateIfVersion(ctx.companyId, draftId, expectedVersion, content, ctx.userId),
      );
      if (!updated) {
        await findDraft(ctx.companyId, draftId);
        throw draftChanged();
      }
      return details(await findDraft(ctx.companyId, draftId));
    },

    async remove(ctx: RequestContext, draftId: string): Promise<void> {
      authorizer.requirePermission(ctx, "invoices.draft");
      await findDraft(ctx.companyId, draftId);
      const deleted = await uow.run(({ drafts: tx }) => tx.deleteIfDraft(ctx.companyId, draftId));
      if (!deleted) await findDraft(ctx.companyId, draftId);
    },
  };
}

export type Drafts = ReturnType<typeof createDrafts>;
