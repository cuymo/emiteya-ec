// Composición del módulo invoices para main.ts y las pruebas (add-invoice-emission, design D1).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createIdempotencyStore } from "../../../platform/idempotency/prisma-idempotency-store.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import { createDocumentRepository } from "../../fiscal/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { AccessKeys, XsdValidator } from "../../sri-engine/application/ports.ts";
import { createAccessKeys } from "../../sri-engine/infrastructure/access-keys.ts";
import { INVOICE_XML_BUILDER_VERSION } from "../../sri-engine/infrastructure/invoice-xml-builder.ts";
import { createDrafts } from "../application/drafts.ts";
import { createEmission } from "../application/emission.ts";
import { createEmissionUnitOfWork } from "./emission-unit-of-work.ts";
import { createEvaluationReads, type SigningReads } from "./evaluation-reads.ts";
import { invoicesRouter } from "./http/invoices-router.ts";
import { createDraftRepository } from "./prisma-drafts.ts";
import { createDraftsUnitOfWork } from "./unit-of-work.ts";

export type InvoicesModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Validador XSD con el paquete verificado al arrancar. */
  xsd: Pick<XsdValidator, "ensureAvailable" | "validate">;
  /** `INVOICE_MAX_LINES`. */
  maxLines: number;
  accessKeys?: AccessKeys;
  logger?: { warn(details: object, message: string): void };
  now?: () => Date;
};

export function invoicesModule(options: InvoicesModuleOptions) {
  const now = options.now ?? (() => new Date());
  const today = () => ecuadorDate(now());
  const reads = createEvaluationReads(options.prisma, options.signingReads);
  const drafts = createDrafts({
    drafts: createDraftRepository(options.prisma),
    uow: createDraftsUnitOfWork(options.prisma),
    reads,
    authorizer: options.authorizer,
    today,
    maxLines: options.maxLines,
  });
  const emission = createEmission({
    uow: createEmissionUnitOfWork(options.prisma, options.signingReads),
    reads,
    idempotency: createIdempotencyStore(options.prisma),
    documents: createDocumentRepository(options.prisma),
    accessKeys: options.accessKeys ?? createAccessKeys(),
    xsd: options.xsd,
    builderVersion: INVOICE_XML_BUILDER_VERSION,
    authorizer: options.authorizer,
    today,
    maxLines: options.maxLines,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const artifactOf = () => Promise.resolve(null);
  return { routers: [invoicesRouter({ drafts, emission, artifactOf })], drafts, emission };
}
