// Composición del módulo shipping-guides (add-shipping-guides, design D1, D2 y D22): borradores con
// su vista previa, opciones y búsquedas, sobre las lecturas de taxpayer, catalogs y signing, y las
// lecturas de terceros, productos y facturas que compone `main.ts`. Ningún otro módulo importa este;
// este no importa `parties`, `products`, `invoices` ni `inventory`.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { ShippingGuideLimits } from "@facturador/contracts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createShippingGuideDrafts } from "../application/drafts.ts";
import { createShippingGuideOptions } from "../application/options.ts";
import type {
  ShippingInvoiceReader,
  ShippingPartyReader,
  ShippingProductReader,
} from "../application/ports.ts";
import { createShippingEligibleInvoiceReader } from "./eligible-invoices.ts";
import { shippingGuidesRouter } from "./http/shipping-guides-router.ts";
import { createShippingGuideDraftRepository } from "./prisma-drafts.ts";
import { createShippingGuideReads, type SigningReads } from "./reads.ts";
import { createShippingGuideDraftsUnitOfWork } from "./units-of-work.ts";

export type ShippingGuidesModuleOptions = {
  prisma: PrismaClient;
  /** Esquema de la base de la conexión: las consultas crudas lo nombran. */
  schema: string;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Terceros de la guía, de `parties`, compuestos por `main.ts` (design D3 y D7). */
  parties: ShippingPartyReader;
  /** Productos, de `products`, compuestos por `main.ts` (design D9). */
  products: ShippingProductReader;
  /** Facturas sustento: `invoiceCreditSource` de `invoices`, compuesta por `main.ts`. */
  invoices: ShippingInvoiceReader;
  /** Límites efectivos de recursos (`SHIPPING_GUIDE_MAX_*`, design D23). */
  limits: ShippingGuideLimits;
  now?: () => Date;
};

export function shippingGuidesModule(options: ShippingGuidesModuleOptions) {
  const now = options.now ?? (() => new Date());
  const today = () => ecuadorDate(now());
  const { prisma } = options;
  const context = {
    reads: createShippingGuideReads(prisma, options.signingReads),
    parties: options.parties(prisma),
    products: options.products(prisma),
    invoices: options.invoices(prisma),
  };
  const drafts = createShippingGuideDrafts({
    drafts: createShippingGuideDraftRepository(prisma),
    uow: createShippingGuideDraftsUnitOfWork(prisma),
    context,
    authorizer: options.authorizer,
    limits: options.limits,
    today,
  });
  const shippingOptions = createShippingGuideOptions({
    context,
    eligibleInvoices: createShippingEligibleInvoiceReader(prisma, options.schema),
    authorizer: options.authorizer,
    limits: options.limits,
    today,
  });
  const carrierName = async (companyId: string, partyId: string | null) => {
    if (partyId === null) {
      const config = await context.reads.currentConfig(companyId);
      return config?.profile.legalName ?? null;
    }
    return (await context.parties.find(companyId, partyId))?.legalName ?? null;
  };
  return {
    routers: [shippingGuidesRouter({ drafts, options: shippingOptions, carrierName })],
    drafts,
    options: shippingOptions,
  };
}
