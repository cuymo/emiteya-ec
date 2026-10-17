// Composición del módulo purchase-settlements (add-purchase-settlements, design D1, D2 y D21):
// borradores con su vista previa, opciones y búsqueda de proveedores, la emisión, la consulta, la
// reconciliación manual y el reintento de la firma, sobre las lecturas de taxpayer, catalogs y
// signing, y las lecturas de terceros y de productos que compone `main.ts`. Ningún otro módulo
// importa este; este no importa `parties`, `products`, `invoices` ni `inventory`.
import type { Registry } from "@prometheus-io/client";
import type { PurchaseSettlementLimits } from "@facturador/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createIdempotencyStore } from "../../../platform/idempotency/prisma-idempotency-store.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import { createPrismaJobStore } from "../../../platform/jobs/prisma-job-store.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import {
  createArtifactStore,
  createDocumentRepository,
  createReconciliationRequestUnitOfWork,
  createTransmissionReader,
  type SigningPipeline,
  type SigningProfile,
} from "../../fiscal/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { AccessKeys, XsdValidator } from "../../sri-engine/application/ports.ts";
import { createAccessKeys } from "../../sri-engine/infrastructure/access-keys.ts";
import {
  PURCHASE_SETTLEMENT_XML_BUILDER_VERSION,
  createPurchaseSettlementXmlBuilder,
} from "../../sri-engine/infrastructure/purchase-settlement-xml-builder.ts";
import { createPurchaseSettlementDrafts } from "../application/drafts.ts";
import { createPurchaseSettlementEmission } from "../application/emission.ts";
import { createPurchaseSettlementOptions } from "../application/options.ts";
import type { PurchaseProductReader, PurchaseSupplierReader } from "../application/ports.ts";
import { createPurchaseSettlements } from "../application/purchase-settlements.ts";
import { purchaseSettlementSigningProfile as createPurchaseSettlementSigningProfile } from "../application/signing-profile.ts";
import { purchaseSettlementsRouter } from "./http/purchase-settlements-router.ts";
import { createPurchaseSettlementEntries } from "../application/entries.ts";
import { toPurchaseSettlementDraftSummaryView } from "./http/views.ts";
import { registerPurchaseSettlementMetrics } from "./metrics.ts";
import { createPurchaseSettlementDraftRepository } from "./prisma-drafts.ts";
import { createPurchaseSettlementListReader } from "./prisma-purchase-settlement-list.ts";
import { createPurchaseSettlementReads, type SigningReads } from "./reads.ts";
import {
  createPurchaseSettlementDraftsUnitOfWork,
  createPurchaseSettlementEmissionUnitOfWork,
} from "./units-of-work.ts";

export {
  isPurchaseSettlementDraftBody,
  PURCHASE_SETTLEMENT_DRAFT_BODY_LIMIT_BYTES,
} from "./http/purchase-settlements-router.ts";

// Importes de la liquidación de compra en los reportes (add-reports-export, design D5).
export { purchaseSettlementReportAmounts } from "./report-amounts.ts";

/** Perfil de la liquidación de compra para la firma compartida, con el builder 1.1.0. */
export const purchaseSettlementSigningProfile = (): SigningProfile =>
  createPurchaseSettlementSigningProfile(createPurchaseSettlementXmlBuilder());

export type PurchaseSettlementsModuleOptions = {
  prisma: PrismaClient;
  /** Esquema de la base de la conexión: la cola durable lo nombra. */
  schema: string;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Proveedores, de `parties`, compuestos por `main.ts` (design D4). */
  suppliers: PurchaseSupplierReader;
  /** Productos, de `products`, compuestos por `main.ts` (design D6). */
  products: PurchaseProductReader;
  /** Límites efectivos de recursos (`PURCHASE_SETTLEMENT_MAX_*`, design D22). */
  limits: PurchaseSettlementLimits;
  /** Validador XSD: los archivos del esquema antes de reservar. */
  xsd: Pick<XsdValidator, "ensureAvailable">;
  /** Firma compartida de `fiscal` con el perfil de la liquidación (design D2). */
  signing: SigningPipeline;
  /** false: la emisión se detiene en RESERVED. Solo para las pruebas de recuperación. */
  signAfterReserve?: boolean;
  accessKeys?: AccessKeys;
  metrics?: Registry;
  /** `EMISSION_STAGE_TIMINGS`: cabecera `Server-Timing` en la emisión; nunca en producción. */
  stageTimings?: boolean;
  /** Cola durable: la reconciliación manual encola su job. */
  jobs?: Pick<JobStore, "enqueueIn">;
  /** `SRI_CONCLUSION_WINDOW_HOURS` en milisegundos; 24 horas por defecto. */
  conclusionWindowMs?: number;
  now?: () => Date;
};

const DEFAULT_CONCLUSION_WINDOW_MS = 24 * 3_600_000;

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
  const documents = createDocumentRepository(prisma);
  const settlements = createPurchaseSettlements({
    documents,
    artifacts: createArtifactStore(prisma),
    pipeline: options.signing,
    audit: createAuditLog(prisma),
    authorizer: options.authorizer,
    transmission: createTransmissionReader(prisma),
    list: createPurchaseSettlementListReader(prisma),
    reconciliations: createReconciliationRequestUnitOfWork(
      prisma,
      options.jobs ?? createPrismaJobStore(prisma, options.schema),
    ),
    conclusionWindowMs: options.conclusionWindowMs ?? DEFAULT_CONCLUSION_WINDOW_MS,
    now,
  });
  const emission = createPurchaseSettlementEmission({
    uow: createPurchaseSettlementEmissionUnitOfWork(prisma, {
      signingReads: options.signingReads,
      suppliers: options.suppliers,
      products: options.products,
    }),
    context,
    drafts: createPurchaseSettlementDraftRepository(prisma),
    idempotency: createIdempotencyStore(prisma),
    documents,
    accessKeys: options.accessKeys ?? createAccessKeys(),
    xsd: options.xsd,
    builderVersion: PURCHASE_SETTLEMENT_XML_BUILDER_VERSION,
    authorizer: options.authorizer,
    limits: options.limits,
    today,
    now,
    ...(options.signAfterReserve === false
      ? {}
      : { continueToSigned: options.signing.continueToSigned }),
    ...(options.metrics ? { observer: registerPurchaseSettlementMetrics(options.metrics) } : {}),
  });
  const entries = createPurchaseSettlementEntries({
    authorizer: options.authorizer,
    drafts,
    settlements,
    draftView: (_ctx, draft) => toPurchaseSettlementDraftSummaryView(draft),
  });
  return {
    routers: [
      purchaseSettlementsRouter({
        drafts,
        entries,
        options: settlementOptions,
        emission,
        settlements,
        serverTiming: options.stageTimings ?? false,
      }),
    ],
    drafts,
    options: settlementOptions,
    emission,
    settlements,
  };
}
