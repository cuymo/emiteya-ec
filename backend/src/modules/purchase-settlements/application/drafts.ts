// Borradores de liquidación de compra (add-purchase-settlements, design D5, D6, D9, D12 y D22). Se
// guardan, corrigen con versión y eliminan sin reservar número, y sin auditoría (D23). El proveedor,
// los productos y el punto se resuelven en la empresa de la sesión: otra empresa responde igual que un
// recurso inexistente. Al elegir un proveedor con la dirección vacía, el borrador propone la del
// tercero (D5). Los límites de recursos configurados se aplican al guardar, como defensa del sistema
// (D22). Cada consulta devuelve la vista previa del servidor, recalculada con la fecha del día y el
// catálogo vigente.
import {
  createPurchaseSettlementDraftSchema,
  listPurchaseSettlementDraftsQuerySchema,
  updatePurchaseSettlementDraftSchema,
  type PurchaseSettlementDraftData,
  type PurchaseSettlementLimits,
  type PurchaseSettlementPreviewView,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type {
  PurchaseSettlementDraftContent,
  PurchaseSettlementDraftRecord,
} from "../domain/draft.ts";
import { purchaseSettlementPreview } from "../domain/preview.ts";
import {
  loadPurchaseSettlementContext,
  type ContextReads,
  type PurchaseSettlementContext,
} from "./context.ts";
import {
  DraftAlreadyEmittedError,
  PurchaseSettlementRejectedError,
  draftChanged,
  draftNotFound,
  invalidReference,
  productNotFound,
  supplierNotFound,
} from "./errors.ts";
import type {
  PurchaseSettlementDraftRepository,
  PurchaseSettlementDraftsUnitOfWork,
} from "./ports.ts";

export type PurchaseSettlementDraftsDependencies = {
  drafts: PurchaseSettlementDraftRepository;
  uow: PurchaseSettlementDraftsUnitOfWork;
  /** Lecturas sobre la conexión: proveedor, productos, preparación de la empresa y catálogos. */
  context: ContextReads;
  authorizer: Authorizer;
  /** Límites efectivos de recursos (`PURCHASE_SETTLEMENT_MAX_*`). */
  limits: PurchaseSettlementLimits;
  /** Fecha de hoy en Ecuador: la de la vista previa. */
  today: () => string;
};

/** Borrador con su contexto y su vista previa. */
export type PurchaseSettlementDraftDetails = Readonly<{
  draft: PurchaseSettlementDraftRecord;
  context: PurchaseSettlementContext;
  preview: PurchaseSettlementPreviewView;
}>;

export type Page<T> = Readonly<{
  items: readonly T[];
  meta: Readonly<{ page: number; pageSize: number; total: number }>;
}>;

const contentOf = (data: PurchaseSettlementDraftData): PurchaseSettlementDraftContent => ({
  emissionPointId: data.emissionPointId,
  supplierPartyId: data.supplierPartyId,
  supplierAddress: data.supplierAddress,
  lines: data.lines.map((line) => ({
    productId: line.productId,
    mainCode: line.mainCode,
    auxiliaryCode: line.auxiliaryCode,
    description: line.description,
    unit: line.unit,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    ivaRate: line.ivaRate,
  })),
  payments: data.payments.map((payment) => ({
    paymentMethod: payment.paymentMethod,
    total: payment.total,
    term: payment.term,
    timeUnit: payment.timeUnit,
  })),
});

export function createPurchaseSettlementDrafts(deps: PurchaseSettlementDraftsDependencies) {
  const { drafts, uow, authorizer, limits } = deps;

  /** Los límites efectivos (design D22): defensas de recursos, no reglas del SRI. */
  function checkLimits(content: PurchaseSettlementDraftContent) {
    const reject = (message: string, field: string) => {
      throw new PurchaseSettlementRejectedError({
        code: "PURCHASE_SETTLEMENT_RESOURCE_LIMIT",
        message: `${message} Es una defensa de recursos del sistema, no un límite del SRI.`,
        field,
        line: null,
        payment: null,
      });
    };
    if (content.lines.length > limits.lines) {
      reject(`La liquidación admite como máximo ${limits.lines} líneas.`, "lines");
    }
    if (content.payments.length > limits.payments) {
      reject(`La liquidación admite como máximo ${limits.payments} pagos.`, "payments");
    }
  }

  /**
   * El proveedor y los productos (`404`) y el punto (`400`) existen en la empresa; el resto lo
   * informa la vista previa. Con un proveedor nuevo y la dirección vacía, propone la del tercero.
   */
  async function resolveReferences(
    companyId: string,
    content: PurchaseSettlementDraftContent,
    previousSupplier: string | null,
  ): Promise<PurchaseSettlementDraftContent> {
    let supplierAddress = content.supplierAddress;
    if (content.supplierPartyId) {
      const supplier = await deps.context.suppliers.find(companyId, content.supplierPartyId);
      if (!supplier) throw supplierNotFound();
      if (supplierAddress === null && content.supplierPartyId !== previousSupplier) {
        supplierAddress = supplier.address?.trim() ? supplier.address.trim().slice(0, 300) : null;
      }
    }
    for (const id of new Set(content.lines.map((line) => line.productId))) {
      if (id !== null && !(await deps.context.products.find(companyId, id))) {
        throw productNotFound();
      }
    }
    if (
      content.emissionPointId &&
      !(await deps.context.reads.emissionPoint(companyId, content.emissionPointId))
    ) {
      throw invalidReference(
        "EMISSION_POINT_NOT_FOUND",
        "El punto de emisión no existe en tu empresa.",
      );
    }
    return { ...content, supplierAddress };
  }

  async function details(
    draft: PurchaseSettlementDraftRecord,
  ): Promise<PurchaseSettlementDraftDetails> {
    const today = deps.today();
    const context = await loadPurchaseSettlementContext(
      deps.context,
      draft.companyId,
      draft,
      today,
      limits,
    );
    return { draft, context, preview: purchaseSettlementPreview(context.evaluation, today) };
  }

  async function findDraft(
    companyId: string,
    draftId: string,
  ): Promise<PurchaseSettlementDraftRecord> {
    const draft = await drafts.find(companyId, draftId);
    if (!draft) throw draftNotFound();
    if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
    return draft;
  }

  return {
    details,

    async create(ctx: RequestContext, body: unknown): Promise<PurchaseSettlementDraftDetails> {
      authorizer.requirePermission(ctx, "purchaseSettlements.draft");
      const parsed = contentOf(parseInput(createPurchaseSettlementDraftSchema, body));
      checkLimits(parsed);
      const content = await resolveReferences(ctx.companyId, parsed, null);
      const draft = await uow.run(({ drafts: tx }) =>
        tx.create(ctx.companyId, content, ctx.userId),
      );
      return details(draft);
    },

    async get(ctx: RequestContext, draftId: string): Promise<PurchaseSettlementDraftDetails> {
      authorizer.requirePermission(ctx, "purchaseSettlements.draft");
      return details(await findDraft(ctx.companyId, draftId));
    },

    async list(ctx: RequestContext, query: unknown): Promise<Page<PurchaseSettlementDraftDetails>> {
      authorizer.requirePermission(ctx, "purchaseSettlements.draft");
      const { page, pageSize } = parseInput(listPurchaseSettlementDraftsQuerySchema, query);
      const { items, total } = await drafts.list(ctx.companyId, { page, pageSize });
      const result: PurchaseSettlementDraftDetails[] = [];
      for (const draft of items) result.push(await details(draft));
      return { items: result, meta: { page, pageSize, total } };
    },

    async update(
      ctx: RequestContext,
      draftId: string,
      body: unknown,
    ): Promise<PurchaseSettlementDraftDetails> {
      authorizer.requirePermission(ctx, "purchaseSettlements.draft");
      const { expectedVersion, ...data } = parseInput(updatePurchaseSettlementDraftSchema, body);
      const current = await findDraft(ctx.companyId, draftId);
      if (current.version !== expectedVersion) throw draftChanged();
      const parsed = contentOf(data);
      checkLimits(parsed);
      const content = await resolveReferences(ctx.companyId, parsed, current.supplierPartyId);
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
      authorizer.requirePermission(ctx, "purchaseSettlements.draft");
      await findDraft(ctx.companyId, draftId);
      const deleted = await uow.run(({ drafts: tx }) => tx.deleteIfDraft(ctx.companyId, draftId));
      if (!deleted) await findDraft(ctx.companyId, draftId);
    },
  };
}

export type PurchaseSettlementDrafts = ReturnType<typeof createPurchaseSettlementDrafts>;
