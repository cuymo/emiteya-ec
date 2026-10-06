// Opciones del borrador y búsquedas de la guía de remisión (add-shipping-guides, design D3, D7 a D9 y
// D22): la política de excepciones con su texto oficial y su versión, los establecimientos propios
// activos, la identidad tributaria del transporte propio y los límites efectivos; los transportistas
// (con el rol, elegibles o no con su motivo), los destinatarios (con cualquier rol), las facturas
// autorizadas del ambiente vigente y las mercancías sugeridas de una de ellas.
import {
  CARRIER_IDENTIFICATION_MAX,
  CARRIER_IDENTIFICATION_SOURCE,
  SHIPPING_EXCEPTION_CASES,
  SHIPPING_EXCEPTION_POLICY,
  SHIPPING_EXCEPTION_SOURCE,
  SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION,
  listShippingLookupQuerySchema,
  type ShippingCarrierView,
  type ShippingGuideLimits,
  type ShippingGuideOptionsView,
  type ShippingInvoiceGoodsView,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { GuideParty } from "../domain/evaluation.ts";
import type { ContextReads } from "./context.ts";
import type { Page } from "./drafts.ts";
import { invoiceNotFound } from "./errors.ts";
import { suggestedGoods } from "./goods.ts";
import type { EligibleInvoice, ShippingEligibleInvoiceReader } from "./ports.ts";

export type ShippingGuideOptionsDependencies = {
  context: ContextReads;
  eligibleInvoices: ShippingEligibleInvoiceReader;
  authorizer: Authorizer;
  limits: ShippingGuideLimits;
  today: () => string;
};

/** Un transportista es elegible si su identificación cabe en el XML (ficha v2.34, anexo 3). */
export const carrierView = (party: GuideParty): ShippingCarrierView => {
  const tooLong = party.identification.length > CARRIER_IDENTIFICATION_MAX;
  return {
    id: party.id,
    identificationType: party.identificationType,
    identification: party.identification,
    legalName: party.legalName,
    selectable: !tooLong,
    reason: tooLong
      ? `Su identificación tiene ${party.identification.length} caracteres y la guía admite como máximo ${CARRIER_IDENTIFICATION_MAX} (${CARRIER_IDENTIFICATION_SOURCE}).`
      : null,
  };
};

export function createShippingGuideOptions(deps: ShippingGuideOptionsDependencies) {
  const { authorizer } = deps;
  const { reads, parties, products, invoices } = deps.context;

  return {
    async options(ctx: RequestContext): Promise<ShippingGuideOptionsView> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      const [config, establishments] = await Promise.all([
        reads.currentConfig(ctx.companyId),
        reads.establishments(ctx.companyId),
      ]);
      return {
        evaluatedOn: deps.today(),
        limits: { ...deps.limits },
        exceptionPolicy: {
          version: SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION,
          source: SHIPPING_EXCEPTION_SOURCE,
          cases: SHIPPING_EXCEPTION_CASES.map((value) => ({
            case: value,
            literal: SHIPPING_EXCEPTION_POLICY[value].literal,
            label: SHIPPING_EXCEPTION_POLICY[value].label,
            statement: SHIPPING_EXCEPTION_POLICY[value].statement,
            recipientKind: SHIPPING_EXCEPTION_POLICY[value].recipientKind,
          })),
        },
        establishments: establishments
          .filter((establishment) => establishment.active)
          .map(({ id, code, address }) => ({ id, code, address })),
        issuerIdentity: config
          ? { ruc: config.profile.ruc, legalName: config.profile.legalName }
          : null,
      };
    },

    async carriers(ctx: RequestContext, query: unknown): Promise<Page<ShippingCarrierView>> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      const { search, page, pageSize } = parseInput(listShippingLookupQuerySchema, query);
      const { items, total } = await parties.searchCarriers(ctx.companyId, {
        search,
        page,
        pageSize,
      });
      return { items: items.map(carrierView), meta: { page, pageSize, total } };
    },

    async recipients(ctx: RequestContext, query: unknown): Promise<Page<GuideParty>> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      const { search, page, pageSize } = parseInput(listShippingLookupQuerySchema, query);
      const { items, total } = await parties.searchRecipients(ctx.companyId, {
        search,
        page,
        pageSize,
      });
      return { items, meta: { page, pageSize, total } };
    },

    async eligibleInvoices(ctx: RequestContext, query: unknown): Promise<Page<EligibleInvoice>> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      const { search, page, pageSize } = parseInput(listShippingLookupQuerySchema, query);
      const config = await reads.currentConfig(ctx.companyId);
      if (!config) return { items: [], meta: { page, pageSize, total: 0 } };
      const { items, total } = await deps.eligibleInvoices.list(ctx.companyId, {
        search,
        page,
        pageSize,
        environment: config.environment,
      });
      return { items, meta: { page, pageSize, total } };
    },

    async invoiceGoods(ctx: RequestContext, invoiceId: string): Promise<ShippingInvoiceGoodsView> {
      authorizer.requirePermission(ctx, "shippingGuides.draft");
      const invoice = await invoices.find(ctx.companyId, invoiceId);
      if (!invoice) throw invoiceNotFound();
      return suggestedGoods(products, ctx.companyId, invoice);
    },
  };
}

export type ShippingGuideOptions = ReturnType<typeof createShippingGuideOptions>;
