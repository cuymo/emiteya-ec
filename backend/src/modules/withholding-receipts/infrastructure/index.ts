// Composición del módulo withholding-receipts para main.ts y las pruebas (add-withholding-receipts,
// design D1). La lectura de terceros (`parties`) y la firma de comprobantes (`signing`) llegan como
// puertos: ninguno de esos módulos importa `withholding-receipts`. La retención no compone
// inventario, capacidades ni facturas.
import type { WithholdingLimits } from "@facturador/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createWithholdingDrafts } from "../application/drafts.ts";
import { createWithholdingOptions } from "../application/options.ts";
import type { WithheldPartyReader } from "../application/ports.ts";
import { withholdingReceiptsRouter } from "./http/withholding-receipts-router.ts";
import { createWithholdingDraftRepository } from "./prisma-drafts.ts";
import { createWithholdingReads, type SigningReads } from "./reads.ts";
import { createWithholdingDraftsUnitOfWork } from "./units-of-work.ts";

export type WithholdingReceiptsModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Terceros que pueden ser sujeto retenido, de `parties`, compuestos por `main.ts` (design D3). */
  parties: WithheldPartyReader;
  /** Límites efectivos de recursos (`WITHHOLDING_MAX_*`, design D25). */
  limits: WithholdingLimits;
  now?: () => Date;
};

export function withholdingReceiptsModule(options: WithholdingReceiptsModuleOptions) {
  const now = options.now ?? (() => new Date());
  const today = () => ecuadorDate(now());
  const { prisma } = options;
  const context = {
    reads: createWithholdingReads(prisma, options.signingReads),
    parties: options.parties(prisma),
  };
  const drafts = createWithholdingDrafts({
    drafts: createWithholdingDraftRepository(prisma),
    uow: createWithholdingDraftsUnitOfWork(prisma),
    context,
    authorizer: options.authorizer,
    limits: options.limits,
    today,
  });
  const withholdingOptions = createWithholdingOptions({
    context,
    authorizer: options.authorizer,
    limits: options.limits,
    today,
  });
  return {
    routers: [withholdingReceiptsRouter({ drafts, options: withholdingOptions })],
    drafts,
    options: withholdingOptions,
  };
}
