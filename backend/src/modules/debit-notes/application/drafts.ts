// Borradores de nota de débito (add-debit-notes, design D5, D8 y D20). Se guardan, corrigen con
// versión y eliminan sin reservar número, y sin auditoría (D22). La factura se resuelve en la
// empresa de la sesión: otra empresa, una nota de crédito o una nota de débito responden igual que
// una factura inexistente. Cada consulta devuelve la vista previa del servidor, recalculada con la
// fecha del día: la forma de pago se resuelve otra vez con el catálogo vigente.
import {
  createDebitNoteDraftSchema,
  listDebitNoteDraftsQuerySchema,
  updateDebitNoteDraftSchema,
  type DebitNoteDraftData,
  type DebitNotePreviewView,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { DebitNoteDraftContent, DebitNoteDraftRecord } from "../domain/draft.ts";
import { debitNotePreview } from "../domain/preview.ts";
import { loadDebitContext, type ContextReads, type DebitContext } from "./context.ts";
import {
  DebitNoteRejectedError,
  DraftAlreadyEmittedError,
  draftChanged,
  draftNotFound,
  invalidReference,
  invoiceNotFound,
} from "./errors.ts";
import type { DebitNoteDraftRepository, DebitNoteDraftsUnitOfWork, DebitSource } from "./ports.ts";

export type DebitNoteDraftsDependencies = {
  drafts: DebitNoteDraftRepository;
  uow: DebitNoteDraftsUnitOfWork;
  /** Lecturas sobre la conexión: factura, preparación de la empresa y catálogo. */
  context: ContextReads;
  authorizer: Authorizer;
  /** Fecha de hoy en Ecuador: la de la vista previa. */
  today: () => string;
};

/** Borrador con su factura, su contexto y su vista previa. */
export type DebitNoteDraftDetails = Readonly<{
  draft: DebitNoteDraftRecord;
  context: DebitContext;
  preview: DebitNotePreviewView;
}>;

export type Page<T> = Readonly<{
  items: readonly T[];
  meta: Readonly<{ page: number; pageSize: number; total: number }>;
}>;

const contentOf = (data: Omit<DebitNoteDraftData, "invoiceId">): DebitNoteDraftContent => ({
  emissionPointId: data.emissionPointId,
  paymentMethod: data.paymentMethod,
  concepts: data.concepts.map((concept) => ({
    cause: concept.cause,
    description: concept.description,
    amount: concept.amount,
    taxTreatment: concept.taxTreatment,
  })),
});

export function createDebitNoteDrafts(deps: DebitNoteDraftsDependencies) {
  const { drafts, uow, authorizer } = deps;

  /** La factura de la empresa que admite una nota; las demás se rechazan antes de guardar. */
  async function eligibleInvoice(companyId: string, invoiceId: string): Promise<DebitSource> {
    const invoice = await deps.context.invoices.find(companyId, invoiceId);
    if (!invoice) throw invoiceNotFound();
    if (invoice.state !== "AUTHORIZED") {
      throw new DebitNoteRejectedError({
        code: "DEBIT_NOTE_INVOICE_NOT_ELIGIBLE",
        message: "Solo una factura autorizada admite nota de débito.",
        concept: null,
      });
    }
    if (invoice.consumerFinal) {
      throw new DebitNoteRejectedError({
        code: "DEBIT_NOTE_CONSUMER_FINAL",
        message:
          "Por política del sistema, una nota de débito exige un comprador identificado: una factura emitida a consumidor final no la admite.",
        concept: null,
      });
    }
    return invoice;
  }

  /**
   * El punto del borrador existe en la empresa (`400`). La integridad, el ambiente, los tratamientos
   * y la forma de pago no se comprueban aquí: la vista previa los informa como problemas.
   */
  async function checkReferences(companyId: string, content: DebitNoteDraftContent) {
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

  async function details(draft: DebitNoteDraftRecord): Promise<DebitNoteDraftDetails> {
    const invoice = await deps.context.invoices.find(draft.companyId, draft.invoiceId);
    if (!invoice) throw invoiceNotFound();
    const today = deps.today();
    const context = await loadDebitContext(deps.context, draft.companyId, invoice, draft, today);
    return {
      draft,
      context,
      preview: debitNotePreview(context.treatments, context.evaluation, today),
    };
  }

  async function findDraft(companyId: string, draftId: string): Promise<DebitNoteDraftRecord> {
    const draft = await drafts.find(companyId, draftId);
    if (!draft) throw draftNotFound();
    if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
    return draft;
  }

  return {
    details,

    async create(ctx: RequestContext, body: unknown): Promise<DebitNoteDraftDetails> {
      authorizer.requirePermission(ctx, "debitNotes.draft");
      const { invoiceId, ...data } = parseInput(createDebitNoteDraftSchema, body);
      const invoice = await eligibleInvoice(ctx.companyId, invoiceId);
      const content = contentOf(data);
      await checkReferences(ctx.companyId, content);
      const draft = await uow.run(({ drafts: tx }) =>
        tx.create(ctx.companyId, invoice.id, content, ctx.userId),
      );
      return details(draft);
    },

    async get(ctx: RequestContext, draftId: string): Promise<DebitNoteDraftDetails> {
      authorizer.requirePermission(ctx, "debitNotes.draft");
      return details(await findDraft(ctx.companyId, draftId));
    },

    async list(ctx: RequestContext, query: unknown): Promise<Page<DebitNoteDraftDetails>> {
      authorizer.requirePermission(ctx, "debitNotes.draft");
      const { page, pageSize } = parseInput(listDebitNoteDraftsQuerySchema, query);
      const { items, total } = await drafts.list(ctx.companyId, { page, pageSize });
      const result: DebitNoteDraftDetails[] = [];
      for (const draft of items) result.push(await details(draft));
      return { items: result, meta: { page, pageSize, total } };
    },

    async update(
      ctx: RequestContext,
      draftId: string,
      body: unknown,
    ): Promise<DebitNoteDraftDetails> {
      authorizer.requirePermission(ctx, "debitNotes.draft");
      const { expectedVersion, ...data } = parseInput(updateDebitNoteDraftSchema, body);
      const current = await findDraft(ctx.companyId, draftId);
      if (current.version !== expectedVersion) throw draftChanged();
      await eligibleInvoice(ctx.companyId, current.invoiceId);
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
      authorizer.requirePermission(ctx, "debitNotes.draft");
      await findDraft(ctx.companyId, draftId);
      const deleted = await uow.run(({ drafts: tx }) => tx.deleteIfDraft(ctx.companyId, draftId));
      if (!deleted) await findDraft(ctx.companyId, draftId);
    },
  };
}

export type DebitNoteDrafts = ReturnType<typeof createDebitNoteDrafts>;
