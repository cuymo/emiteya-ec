// Composición del módulo purchase-settlements (add-purchase-settlements, design D1, D2 y D21):
// borradores con su vista previa, opciones y búsqueda de proveedores, sobre las lecturas de taxpayer,
// catalogs y signing, y las lecturas de terceros y de productos que compone `main.ts`. Ningún otro
// módulo importa este; este no importa `parties`, `products`, `invoices` ni `inventory`.
import type { PurchaseSettlementLimits } from "@facturador/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createPurchaseSettlementDrafts } from "../application/drafts.ts";
import { createPurchaseSettlementOptions } from "../application/options.ts";
import type { PurchaseProductReader, PurchaseSupplierReader } from "../application/ports.ts";
import { purchaseSettlementsRouter } from "./http/purchase-settlements-router.ts";
import { createPurchaseSettlementDraftRepository } from "./prisma-drafts.ts";
import { createPurchaseSettlementReads, type SigningReads } from "./reads.ts";
import { createPurchaseSettlementDraftsUnitOfWork } from "./units-of-work.ts";

export {
  isPurchaseSettlementDraftBody,
  PURCHASE_SETTLEMENT_DRAFT_BODY_LIMIT_BYTES,
} from "./http/purchase-settlements-router.ts";

export type PurchaseSettlementsModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Proveedores, de `parties`, compuestos por `main.ts` (design D4). */
  suppliers: PurchaseSupplierReader;
  /** Productos, de `products`, compuestos por `main.ts` (design D6). */
  products: PurchaseProductReader;
  /** Límites efectivos de recursos (`PURCHASE_SETTLEMENT_MAX_*`, design D22). */
  limits: PurchaseSettlementLimits;
  now?: () => Date;
};

export function purchaseSettlementsModule(options: PurchaseSettlementsModuleOptions) {
  const now = options.now ?? (() => new Date());
  const today = () => ecuadorDate(now());
  const { prisma } = options;
  const context = {
    reads: createPurchaseSettlementReads(prisma, options.signingReads),
    suppliers: options.suppliers(prisma),
    products: options.products(prisma),
  };
  const drafts = createPurchaseSettlementDrafts({
    drafts: createPurchaseSettlementDraftRepository(prisma),
    uow: createPurchaseSettlementDraftsUnitOfWork(prisma),
    context,
    authorizer: options.authorizer,
    limits: options.limits,
    today,
  });
  const settlementOptions = createPurchaseSettlementOptions({
    context,
    authorizer: options.authorizer,
    limits: options.limits,
    today,
  });
  return {
    routers: [purchaseSettlementsRouter({ drafts, options: settlementOptions })],
    drafts,
    options: settlementOptions,
  };
}
