// Borradores de guía de remisión (add-shipping-guides, design D6, D12, D22 y D23). Se guardan,
// corrigen con versión y eliminan sin reservar número, y sin auditoría (D24). Las referencias se
// resuelven en la empresa de la sesión: otra empresa responde igual que un recurso inexistente. Un
// borrador nuevo sin partida propone como texto la dirección del establecimiento del punto (D6), y
// desde una factura propone su comprador, la factura como sustento y solo las mercancías sugeridas
// `PRODUCT` (D12). Los límites de recursos configurados se aplican al guardar, como defensa del
// sistema (D23). Cada consulta devuelve la vista previa del servidor, recalculada con la fecha del día.
import {
  createShippingGuideDraftSchema,
  listShippingGuideDraftsQuerySchema,
  updateShippingGuideDraftSchema,
  type ShippingGuideDraftData,
  type ShippingGuideLimits,
  type ShippingGuidePreviewView,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type {
  DraftRecipient,
  ShippingGuideDraftContent,
  ShippingGuideDraftRecord,
} from "../domain/draft.ts";
import { GUIDE_IDENTIFICATION_TYPES } from "../domain/evaluation.ts";
import { shippingGuidePreview } from "../domain/preview.ts";
import {
  loadShippingGuideContext,
  referencesOf,
  type ContextReads,
  type ShippingGuideContext,
} from "./context.ts";
import {
  DraftAlreadyEmittedError,
  ShippingGuideRejectedError,
  draftChanged,
  draftNotFound,
  invalidReference,
  invoiceNotFound,
  referenceNotFound,
} from "./errors.ts";
import { suggestedGoods } from "./goods.ts";
import type { ShippingGuideDraftRepository, ShippingGuideDraftsUnitOfWork } from "./ports.ts";

export type ShippingGuideDraftsDependencies = {
  drafts: ShippingGuideDraftRepository;
  uow: ShippingGuideDraftsUnitOfWork;
  /** Lecturas sobre la conexión: terceros, productos, facturas y preparación de la empresa. */
  context: ContextReads;
  authorizer: Authorizer;
  /** Límites efectivos de recursos (`SHIPPING_GUIDE_MAX_*`). */
  limits: ShippingGuideLimits;
  /** Fecha de hoy en Ecuador: la de la vista previa. */
  today: () => string;
};

/** Borrador con su contexto y su vista previa. */
export type ShippingGuideDraftDetails = Readonly<{
  draft: ShippingGuideDraftRecord;
  context: ShippingGuideContext;
  preview: ShippingGuidePreviewView;
}>;

export type Page<T> = Readonly<{
  items: readonly T[];
  meta: Readonly<{ page: number; pageSize: number; total: number }>;
}>;

const contentOf = (data: ShippingGuideDraftData): ShippingGuideDraftContent => ({
  emissionPointId: data.emissionPointId,
  originEstablishmentId: data.originEstablishmentId,
  departureAddress: data.departureAddress,
  transporter: data.transporter,
  plate: data.plate,
  transportStart: data.transportStart,
  transportEnd: data.transportEnd,
  recipients: data.recipients.map((recipient) => ({
    recipient: recipient.recipient,
    address: recipient.address,
    motive: recipient.motive,
    route: recipient.route,
    destinationEstablishmentCode: recipient.destinationEstablishmentCode,
    support: recipient.support,
    details: recipient.details.map((detail) => ({
      productId: detail.productId,
      mainCode: detail.mainCode,
      auxiliaryCode: detail.auxiliaryCode,
      description: detail.description,
      quantity: detail.quantity,
    })),
  })),
});

const DEFENSE = "Es una defensa de recursos del sistema, no un límite del SRI.";

export function createShippingGuideDrafts(deps: ShippingGuideDraftsDependencies) {
  const { drafts, uow, authorizer, limits } = deps;
  const { reads, parties, products, invoices } = deps.context;

  /** Los límites efectivos, compuestos (design D23, P9): defensas de recursos, no reglas del SRI. */
  function checkLimits(content: ShippingGuideDraftContent) {
    const reject = (message: string, recipient: number | null) => {
      throw new ShippingGuideRejectedError({
        code: "SHIPPING_GUIDE_RESOURCE_LIMIT",
        message: `${message} ${DEFENSE}`,
        field: recipient === null ? "recipients" : null,
        recipient,
        detail: null,
      });
    };
    if (content.recipients.length > limits.recipients) {
      reject(`El sistema admite como máximo ${limits.recipients} destinatarios por guía.`, null);
    }
    content.recipients.forEach((recipient, index) => {
      if (recipient.details.length > limits.detailsPerRecipient) {
        reject(
          `El sistema admite como máximo ${limits.detailsPerRecipient} detalles por destinatario.`,
          index + 1,
        );
      }
    });
    const details = content.recipients.reduce(
      (sum, recipient) => sum + recipient.details.length,
      0,
    );
    if (details > limits.details) {
      reject(`El sistema admite como máximo ${limits.details} detalles por guía.`, null);
    }
  }

  /** Cada referencia existe en la empresa (`404` igual que inexistente; el punto, `400`). */
  async function checkReferences(companyId: string, content: ShippingGuideDraftContent) {
    if (
      content.emissionPointId &&
      !(await reads.emissionPoint(companyId, content.emissionPointId))
    ) {
      throw invalidReference(
        "EMISSION_POINT_NOT_FOUND",
        "El punto de emisión no existe en tu empresa.",
      );
    }
    const refs = referencesOf(content);
    const carrierId = content.transporter?.source === "PARTY" ? content.transporter.partyId : null;
    for (const id of new Set(refs.parties)) {
      if (!(await parties.find(companyId, id))) {
        throw id === carrierId
          ? referenceNotFound(
              "SHIPPING_GUIDE_CARRIER_NOT_FOUND",
              "El transportista no existe en tu empresa.",
            )
          : referenceNotFound(
              "SHIPPING_GUIDE_RECIPIENT_NOT_FOUND",
              "El destinatario no existe en tu empresa.",
            );
      }
    }
    for (const id of new Set(refs.establishments)) {
      if (!(await reads.establishment(companyId, id))) {
        throw referenceNotFound(
          "SHIPPING_GUIDE_ESTABLISHMENT_NOT_FOUND",
          "El establecimiento no existe en tu empresa.",
        );
      }
    }
    for (const id of new Set(refs.products)) {
      if (!(await products.find(companyId, id))) {
        throw referenceNotFound(
          "SHIPPING_GUIDE_PRODUCT_NOT_FOUND",
          "El producto no existe en tu empresa.",
        );
      }
    }
    for (const id of new Set(refs.invoices)) {
      if (!(await invoices.find(companyId, id))) {
        throw referenceNotFound(
          "SHIPPING_GUIDE_INVOICE_NOT_FOUND",
          "La factura no existe en tu empresa.",
        );
      }
    }
  }

  /** Sin partida, el servidor propone como texto la dirección del establecimiento del punto (D6). */
  async function proposeDeparture(
    companyId: string,
    content: ShippingGuideDraftContent,
  ): Promise<ShippingGuideDraftContent> {
    if (content.departureAddress !== null || content.originEstablishmentId !== null) return content;
    if (!content.emissionPointId) return content;
    const point = await reads.emissionPoint(companyId, content.emissionPointId);
    return point ? { ...content, departureAddress: point.establishment.address } : content;
  }

  /**
   * Destinatario propuesto desde una factura (design D12): su comprador si es un tercero activo de tipo
   * 04, 05 o 06 (nunca el consumidor final), la factura como sustento y solo las sugerencias `PRODUCT`.
   */
  async function recipientFromInvoice(
    companyId: string,
    invoiceId: string,
  ): Promise<DraftRecipient> {
    const invoice = await invoices.find(companyId, invoiceId);
    if (!invoice) throw invoiceNotFound();
    const buyer =
      invoice.consumerFinal || !GUIDE_IDENTIFICATION_TYPES.has(invoice.buyer.identificationType)
        ? null
        : await parties.findByIdentity(
            companyId,
            invoice.buyer.identificationType,
            invoice.buyer.identification,
          );
    const party = buyer && buyer.status === "ACTIVE" && !buyer.consumerFinal ? buyer : null;
    const goods = await suggestedGoods(products, companyId, invoice);
    return {
      recipient: party ? { kind: "PARTY", partyId: party.id } : null,
      address: party?.address ?? null,
      motive: null,
      route: null,
      destinationEstablishmentCode: null,
      support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.id },
      details: goods.lines
        .filter((line) => line.suggestion === "PRODUCT")
        .map((line) => ({
          productId: line.productId,
          mainCode: null,
          auxiliaryCode: null,
          description: line.description,
          quantity: line.quantity,
        })),
    };
  }

  async function details(draft: ShippingGuideDraftRecord): Promise<ShippingGuideDraftDetails> {
    const today = deps.today();
    const context = await loadShippingGuideContext(
      deps.context,
      draft.companyId,
      draft,
      today,
      limits,
    );
    return { draft, context, preview: shippingGuidePreview(context.evaluation, today) };
  }

  async function findDraft(companyId: string, draftId: string): Promise<ShippingGuideDraftRecord> {
    const draft = await drafts.find(companyId, draftId);
    if (!draft) throw draftNotFound();
    if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
    return draft;
  }

  return {
    details,

    async create(ctx: RequestContext, body: unknown): Promise<ShippingGuideDraftDetails> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      const { fromInvoiceId, ...data } = parseInput(createShippingGuideDraftSchema, body);
      let content = contentOf(data);
      if (fromInvoiceId !== null) {
        content = {
          ...content,
          recipients: [await recipientFromInvoice(ctx.companyId, fromInvoiceId)],
        };
      }
      checkLimits(content);
      await checkReferences(ctx.companyId, content);
      content = await proposeDeparture(ctx.companyId, content);
      const draft = await uow.run(({ drafts: tx }) =>
        tx.create(ctx.companyId, content, ctx.userId),
      );
      return details(draft);
    },

    async get(ctx: RequestContext, draftId: string): Promise<ShippingGuideDraftDetails> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      return details(await findDraft(ctx.companyId, draftId));
    },

    async list(ctx: RequestContext, query: unknown): Promise<Page<ShippingGuideDraftRecord>> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      const { page, pageSize } = parseInput(listShippingGuideDraftsQuerySchema, query);
      const { items, total } = await drafts.list(ctx.companyId, { page, pageSize });
      return { items, meta: { page, pageSize, total } };
    },

    async update(
      ctx: RequestContext,
      draftId: string,
      body: unknown,
    ): Promise<ShippingGuideDraftDetails> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      const { expectedVersion, ...data } = parseInput(updateShippingGuideDraftSchema, body);
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
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      await findDraft(ctx.companyId, draftId);
      const deleted = await uow.run(({ drafts: tx }) => tx.deleteIfDraft(ctx.companyId, draftId));
      if (!deleted) await findDraft(ctx.companyId, draftId);
    },
  };
}

export type ShippingGuideDrafts = ReturnType<typeof createShippingGuideDrafts>;
