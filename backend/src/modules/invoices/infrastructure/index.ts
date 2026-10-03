// Composición del módulo invoices para main.ts y las pruebas (add-invoice-emission, design D1).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createDrafts } from "../application/drafts.ts";
import { createEvaluationReads, type SigningReads } from "./evaluation-reads.ts";
import { invoicesRouter } from "./http/invoices-router.ts";
import { createDraftRepository } from "./prisma-drafts.ts";
import { createDraftsUnitOfWork } from "./unit-of-work.ts";

export type InvoicesModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** `INVOICE_MAX_LINES`. */
  maxLines: number;
  now?: () => Date;
};

export function invoicesModule(options: InvoicesModuleOptions) {
  const now = options.now ?? (() => new Date());
  const drafts = createDrafts({
    drafts: createDraftRepository(options.prisma),
    uow: createDraftsUnitOfWork(options.prisma),
    reads: createEvaluationReads(options.prisma, options.signingReads),
    authorizer: options.authorizer,
    today: () => ecuadorDate(now()),
    maxLines: options.maxLines,
  });
  return { routers: [invoicesRouter({ drafts })], drafts };
}
