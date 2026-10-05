// Borradores de nota de crédito (add-credit-notes, design D5 y D16). Se guardan, corrigen con versión
// y eliminan sin reservar capacidad ni número, y sin auditoría (D18). La factura se resuelve en la
// empresa de la sesión: otra empresa responde igual que una factura inexistente. Cada consulta
// devuelve la vista previa del servidor, recalculada con la capacidad vigente.
import {
  compareDecimalStrings,
  createCreditNoteDraftSchema,
  listCreditNoteDraftsQuerySchema,
  updateCreditNoteDraftSchema,
  type CreditNoteDraftData,
  type CreditNotePreviewView,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { CreditNoteDraftContent, CreditNoteDraftRecord } from "../domain/draft.ts";
import { creditNotePreview } from "../domain/preview.ts";
import {
  creditInvoiceOf,
  loadCreditContext,
  type ContextReads,
  type CreditContext,
} from "./context.ts";
import {
  CreditNoteRejectedError,
  DraftAlreadyEmittedError,
  draftChanged,
  draftNotFound,
  invalidReference,
  invoiceNotFound,
} from "./errors.ts";
import type {
  CreditNoteDraftRepository,
  CreditNoteDraftsUnitOfWork,
  CreditSource,
  StoredDraftContent,
} from "./ports.ts";

export type CreditNoteDraftsDependencies = {
  drafts: CreditNoteDraftRepository;
  uow: CreditNoteDraftsUnitOfWork;
  /** Lecturas sobre la conexión: factura, capacidades y preparación de la empresa. */
  context: ContextReads;
  authorizer: Authorizer;
  /** Fecha de hoy en Ecuador: la de la vista previa. */
  today: () => string;
};

/** Borrador con su factura, su contexto y su vista previa. */
export type CreditNoteDraftDetails = Readonly<{
  draft: CreditNoteDraftRecord;
  context: CreditContext;
  preview: CreditNotePreviewView;
}>;

export type Page<T> = Readonly<{
  items: readonly T[];
  meta: Readonly<{ page: number; pageSize: number; total: number }>;
}>;

const contentOf = (data: Omit<CreditNoteDraftData, "invoiceId">): CreditNoteDraftContent => ({
  emissionPointId: data.emissionPointId,
  cause: data.cause,
  reason: data.reason,
  lines: data.lines.map((line) => ({
    position: line.position,
    ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
    physicalReturn: line.physicalReturn,
  })),
});

export function createCreditNoteDrafts(deps: CreditNoteDraftsDependencies) {
  const { drafts, uow, authorizer } = deps;

  /** La factura de la empresa que admite una nota; las demás se rechazan antes de guardar. */
  async function eligibleInvoice(companyId: string, invoiceId: string): Promise<CreditSource> {
    const invoice = await deps.context.invoices.find(companyId, invoiceId);
    if (!invoice) throw invoiceNotFound();
    if (invoice.state !== "AUTHORIZED") {
      throw new CreditNoteRejectedError({
        code: "CREDIT_NOTE_INVOICE_NOT_ELIGIBLE",
        message: "Solo una factura autorizada admite nota de crédito.",
        line: null,
      });
    }
    if (invoice.consumerFinal) {
      throw new CreditNoteRejectedError({
        code: "CREDIT_NOTE_CONSUMER_FINAL",
        message:
          "Una factura emitida a consumidor final no admite nota de crédito (Res. NAC-DGERCGC25-00000014, art. 3).",
        line: null,
      });
    }
    return invoice;
  }

  /**
   * Referencias del borrador en la factura y en la empresa (`400`), y la cantidad guardada de cada
   * línea: en una anulación total, la original. La integridad de la factura no se comprueba aquí:
   * la vista previa la informa como un problema que bloquea.
   */
  async function stored(
    companyId: string,
    invoice: CreditSource,
    content: CreditNoteDraftContent,
  ): Promise<StoredDraftContent> {
    if (
      content.emissionPointId &&
      !(await deps.context.reads.emissionPoint(companyId, content.emissionPointId))
    ) {
      throw invalidReference(
        "EMISSION_POINT_NOT_FOUND",
        "El punto de emisión no existe en tu empresa.",
      );
    }
    const lines = new Map(invoice.lines.map((line) => [line.position, line]));
    return {
      ...content,
      lines: content.lines.map((line) => {
        const original = lines.get(line.position);
        if (!original) {
          throw invalidReference(
            "CREDIT_NOTE_LINE_INVALID",
            `La factura no tiene una línea ${line.position}.`,
          );
        }
        const quantity = line.quantity ?? original.quantity;
        if (compareDecimalStrings(line.physicalReturn, quantity) > 0) {
          throw invalidReference(
            "CREDIT_NOTE_PHYSICAL_RETURN_INVALID",
            `Línea ${line.position}: el retorno físico no puede superar la cantidad acreditada.`,
          );
        }
        return { position: line.position, quantity, physicalReturn: line.physicalReturn };
      }),
    };
  }

  async function details(draft: CreditNoteDraftRecord): Promise<CreditNoteDraftDetails> {
    const invoice = await deps.context.invoices.find(draft.companyId, draft.invoiceId);
    if (!invoice) throw invoiceNotFound();
    const context = await loadCreditContext(deps.context, draft.companyId, invoice, draft);
    return {
      draft,
      context,
      preview: creditNotePreview(creditInvoiceOf(invoice), context.evaluation, deps.today()),
    };
  }

  async function findDraft(companyId: string, draftId: string): Promise<CreditNoteDraftRecord> {
    const draft = await drafts.find(companyId, draftId);
    if (!draft) throw draftNotFound();
    if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
    return draft;
  }

  return {
    details,

    async create(ctx: RequestContext, body: unknown): Promise<CreditNoteDraftDetails> {
      authorizer.requirePermission(ctx, "creditNotes.draft");
      const { invoiceId, ...data } = parseInput(createCreditNoteDraftSchema, body);
      const invoice = await eligibleInvoice(ctx.companyId, invoiceId);
      const content = await stored(ctx.companyId, invoice, contentOf(data));
      const draft = await uow.run(({ drafts: tx }) =>
        tx.create(ctx.companyId, invoice.id, content, ctx.userId),
      );
      return details(draft);
    },

    async get(ctx: RequestContext, draftId: string): Promise<CreditNoteDraftDetails> {
      authorizer.requirePermission(ctx, "creditNotes.draft");
      return details(await findDraft(ctx.companyId, draftId));
    },

    async list(ctx: RequestContext, query: unknown): Promise<Page<CreditNoteDraftDetails>> {
      authorizer.requirePermission(ctx, "creditNotes.draft");
      const { page, pageSize } = parseInput(listCreditNoteDraftsQuerySchema, query);
      const { items, total } = await drafts.list(ctx.companyId, { page, pageSize });
      const result: CreditNoteDraftDetails[] = [];
      for (const draft of items) result.push(await details(draft));
      return { items: result, meta: { page, pageSize, total } };
    },

    async update(
      ctx: RequestContext,
      draftId: string,
      body: unknown,
    ): Promise<CreditNoteDraftDetails> {
      authorizer.requirePermission(ctx, "creditNotes.draft");
      const { expectedVersion, ...data } = parseInput(updateCreditNoteDraftSchema, body);
      const current = await findDraft(ctx.companyId, draftId);
      if (current.version !== expectedVersion) throw draftChanged();
      const invoice = await eligibleInvoice(ctx.companyId, current.invoiceId);
      const content = await stored(ctx.companyId, invoice, contentOf(data));
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
      authorizer.requirePermission(ctx, "creditNotes.draft");
      await findDraft(ctx.companyId, draftId);
      const deleted = await uow.run(({ drafts: tx }) => tx.deleteIfDraft(ctx.companyId, draftId));
      if (!deleted) await findDraft(ctx.companyId, draftId);
    },
  };
}

export type CreditNoteDrafts = ReturnType<typeof createCreditNoteDrafts>;
