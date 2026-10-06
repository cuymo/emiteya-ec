// Borradores de comprobante de retención (add-withholding-receipts, design D5, D6, D21 y D25). Se
// guardan, corrigen con versión y eliminan sin reservar número, y sin auditoría (D23). El proveedor y
// el punto se resuelven en la empresa de la sesión: otra empresa responde igual que un recurso
// inexistente. Un borrador nuevo sin período toma el mes de hoy (D5). Los límites de recursos
// configurados se aplican al guardar, como defensa del sistema (D25). Cada consulta devuelve la vista
// previa del servidor, recalculada con la fecha del día y el catálogo vigente.
import {
  createWithholdingDraftSchema,
  listWithholdingDraftsQuerySchema,
  updateWithholdingDraftSchema,
  type WithholdingDraftData,
  type WithholdingLimits,
  type WithholdingPreviewView,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { WithholdingDraftContent, WithholdingDraftRecord } from "../domain/draft.ts";
import { monthOf } from "../domain/evaluation.ts";
import { withholdingPreview } from "../domain/preview.ts";
import { loadWithholdingContext, type ContextReads, type WithholdingContext } from "./context.ts";
import {
  DraftAlreadyEmittedError,
  WithholdingRejectedError,
  draftChanged,
  draftNotFound,
  invalidReference,
  subjectNotFound,
} from "./errors.ts";
import type { WithholdingDraftRepository, WithholdingDraftsUnitOfWork } from "./ports.ts";

export type WithholdingDraftsDependencies = {
  drafts: WithholdingDraftRepository;
  uow: WithholdingDraftsUnitOfWork;
  /** Lecturas sobre la conexión: tercero, preparación de la empresa y catálogos. */
  context: ContextReads;
  authorizer: Authorizer;
  /** Límites efectivos de recursos (`WITHHOLDING_MAX_*`). */
  limits: WithholdingLimits;
  /** Fecha de hoy en Ecuador: la de la vista previa y la del período propuesto. */
  today: () => string;
};

/** Borrador con su contexto y su vista previa. */
export type WithholdingDraftDetails = Readonly<{
  draft: WithholdingDraftRecord;
  context: WithholdingContext;
  preview: WithholdingPreviewView;
}>;

export type Page<T> = Readonly<{
  items: readonly T[];
  meta: Readonly<{ page: number; pageSize: number; total: number }>;
}>;

const contentOf = (data: WithholdingDraftData): WithholdingDraftContent => ({
  partyId: data.partyId,
  relatedParty: data.relatedParty,
  fiscalPeriod: data.fiscalPeriod,
  emissionPointId: data.emissionPointId,
  supports: data.supports.map((support) => ({
    documentType: support.documentType,
    supportCode: support.supportCode,
    number: support.number,
    issueDate: support.issueDate,
    authorizationNumber: support.authorizationNumber,
    totalWithoutTaxes: support.totalWithoutTaxes,
    importTotal: support.importTotal,
    taxes: support.taxes.map((tax) => ({
      tax: tax.tax,
      rateEntryKey: tax.rateEntryKey,
      rate: tax.rate,
      base: tax.base,
      amount: tax.amount,
    })),
    payments: support.payments.map((payment) => ({
      paymentMethod: payment.paymentMethod,
      total: payment.total,
    })),
    withholdings: support.withholdings.map((item) => ({
      tax: item.tax,
      entryKey: item.entryKey,
      base: item.base,
    })),
  })),
});

export function createWithholdingDrafts(deps: WithholdingDraftsDependencies) {
  const { drafts, uow, authorizer, limits } = deps;

  /** Los límites efectivos (design D25): defensas de recursos, no reglas del SRI. */
  function checkLimits(content: WithholdingDraftContent) {
    const reject = (message: string, support: number | null) => {
      throw new WithholdingRejectedError({
        code: "WITHHOLDING_RESOURCE_LIMIT",
        message: `${message} Es una defensa de recursos del sistema, no un límite del SRI.`,
        support,
        tax: null,
        payment: null,
        withholding: null,
      });
    };
    if (content.supports.length > limits.supports) {
      reject(
        `El sistema admite como máximo ${limits.supports} documentos sustento por comprobante.`,
        null,
      );
    }
    content.supports.forEach((support, index) => {
      if (support.withholdings.length > limits.itemsPerSupport) {
        reject(
          `El sistema admite como máximo ${limits.itemsPerSupport} retenciones por documento sustento.`,
          index + 1,
        );
      }
      if (support.taxes.length > limits.taxesPerSupport) {
        reject(
          `El sistema admite como máximo ${limits.taxesPerSupport} impuestos declarados por documento sustento.`,
          index + 1,
        );
      }
      if (support.payments.length > limits.paymentsPerSupport) {
        reject(
          `El sistema admite como máximo ${limits.paymentsPerSupport} formas de pago por documento sustento.`,
          index + 1,
        );
      }
    });
  }

  /** El proveedor (`404`) y el punto (`400`) existen en la empresa; el resto lo informa la vista previa. */
  async function checkReferences(companyId: string, content: WithholdingDraftContent) {
    if (content.partyId && !(await deps.context.parties.find(companyId, content.partyId))) {
      throw subjectNotFound();
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
  }

  async function details(draft: WithholdingDraftRecord): Promise<WithholdingDraftDetails> {
    const today = deps.today();
    const context = await loadWithholdingContext(
      deps.context,
      draft.companyId,
      draft,
      today,
      limits,
    );
    return {
      draft,
      context,
      preview: withholdingPreview(context.evaluation, today, draft.supports.length),
    };
  }

  async function findDraft(companyId: string, draftId: string): Promise<WithholdingDraftRecord> {
    const draft = await drafts.find(companyId, draftId);
    if (!draft) throw draftNotFound();
    if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
    return draft;
  }

  return {
    details,

    async create(ctx: RequestContext, body: unknown): Promise<WithholdingDraftDetails> {
      authorizer.requirePermission(ctx, "withholdings.draft");
      const data = parseInput(createWithholdingDraftSchema, body);
      const content = contentOf({
        ...data,
        // El servidor propone el mes de la fecha de emisión; el usuario lo cambia mientras prepara.
        fiscalPeriod: data.fiscalPeriod ?? monthOf(deps.today()),
      });
      checkLimits(content);
      await checkReferences(ctx.companyId, content);
      const draft = await uow.run(({ drafts: tx }) =>
        tx.create(ctx.companyId, content, ctx.userId),
      );
      return details(draft);
    },

    async get(ctx: RequestContext, draftId: string): Promise<WithholdingDraftDetails> {
      authorizer.requirePermission(ctx, "withholdings.draft");
      return details(await findDraft(ctx.companyId, draftId));
    },

    async list(ctx: RequestContext, query: unknown): Promise<Page<WithholdingDraftDetails>> {
      authorizer.requirePermission(ctx, "withholdings.draft");
      const { page, pageSize } = parseInput(listWithholdingDraftsQuerySchema, query);
      const { items, total } = await drafts.list(ctx.companyId, { page, pageSize });
      const result: WithholdingDraftDetails[] = [];
      for (const draft of items) result.push(await details(draft));
      return { items: result, meta: { page, pageSize, total } };
    },

    async update(
      ctx: RequestContext,
      draftId: string,
      body: unknown,
    ): Promise<WithholdingDraftDetails> {
      authorizer.requirePermission(ctx, "withholdings.draft");
      const { expectedVersion, ...data } = parseInput(updateWithholdingDraftSchema, body);
      const current = await findDraft(ctx.companyId, draftId);
      if (current.version !== expectedVersion) throw draftChanged();
      const content = contentOf(data);
      checkLimits(content);
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
      authorizer.requirePermission(ctx, "withholdings.draft");
      await findDraft(ctx.companyId, draftId);
      const deleted = await uow.run(({ drafts: tx }) => tx.deleteIfDraft(ctx.companyId, draftId));
      if (!deleted) await findDraft(ctx.companyId, draftId);
    },
  };
}

export type WithholdingDrafts = ReturnType<typeof createWithholdingDrafts>;
