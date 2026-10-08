// Composición del módulo withholding-receipts para main.ts y las pruebas (add-withholding-receipts,
// design D1). La lectura de terceros (`parties`) y la firma de comprobantes (`signing`) llegan como
// puertos: ninguno de esos módulos importa `withholding-receipts`. La retención no compone
// inventario, capacidades ni facturas.
import type { Registry } from "@prometheus-io/client";
import type { WithholdingLimits } from "@facturador/contracts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createIdempotencyStore } from "../../../platform/idempotency/prisma-idempotency-store.ts";
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
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import { createPrismaJobStore } from "../../../platform/jobs/prisma-job-store.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { AccessKeys, XsdValidator } from "../../sri-engine/application/ports.ts";
import { createAccessKeys } from "../../sri-engine/infrastructure/access-keys.ts";
import {
  WITHHOLDING_RECEIPT_XML_BUILDER_VERSION,
  createWithholdingReceiptXmlBuilder,
} from "../../sri-engine/infrastructure/withholding-receipt-xml-builder.ts";
import { createWithholdingDrafts } from "../application/drafts.ts";
import { createWithholdingEmission } from "../application/emission.ts";
import { createWithholdingOptions } from "../application/options.ts";
import type { WithheldPartyReader } from "../application/ports.ts";
import { withholdingReceiptSigningProfile as createWithholdingSigningProfile } from "../application/signing-profile.ts";
import { createWithholdingReceipts } from "../application/withholding-receipts.ts";
import { withholdingReceiptsRouter } from "./http/withholding-receipts-router.ts";
import { registerWithholdingMetrics } from "./metrics.ts";
import { createWithholdingReceiptListReader } from "./prisma-withholding-list.ts";
import { createWithholdingDraftRepository } from "./prisma-drafts.ts";
import { createWithholdingReads, type SigningReads } from "./reads.ts";
import {
  createWithholdingDraftsUnitOfWork,
  createWithholdingEmissionUnitOfWork,
} from "./units-of-work.ts";

// Importes de la retención y fuente del reporte de Retenciones (add-reports-export, design D1 y D5).
export { withholdingReportAmounts } from "./report-amounts.ts";
export { createWithholdingsReportSource, type WithholdingsSourceFilters } from "./report-source.ts";

/** Perfil del comprobante de retención para la firma compartida, con el builder 2.0.0. */
export const withholdingReceiptSigningProfile = (): SigningProfile =>
  createWithholdingSigningProfile(createWithholdingReceiptXmlBuilder());

export type WithholdingReceiptsModuleOptions = {
  prisma: PrismaClient;
  /** Esquema de la base de la conexión: la cola durable lo nombra. */
  schema: string;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Terceros que pueden ser sujeto retenido, de `parties`, compuestos por `main.ts` (design D3). */
  parties: WithheldPartyReader;
  /** Límites efectivos de recursos (`WITHHOLDING_MAX_*`, design D25). */
  limits: WithholdingLimits;
  /** Validador XSD: los archivos del esquema antes de reservar. */
  xsd: Pick<XsdValidator, "ensureAvailable">;
  /** Firma compartida de `fiscal` con el perfil de la retención (design D2). */
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
  const documents = createDocumentRepository(prisma);
  const withholdings = createWithholdingReceipts({
    documents,
    artifacts: createArtifactStore(prisma),
    pipeline: options.signing,
    audit: createAuditLog(prisma),
    authorizer: options.authorizer,
    transmission: createTransmissionReader(prisma),
    list: createWithholdingReceiptListReader(prisma),
    reconciliations: createReconciliationRequestUnitOfWork(
      prisma,
      options.jobs ?? createPrismaJobStore(prisma, options.schema),
    ),
    conclusionWindowMs: options.conclusionWindowMs ?? DEFAULT_CONCLUSION_WINDOW_MS,
    now,
  });
  const emission = createWithholdingEmission({
    uow: createWithholdingEmissionUnitOfWork(prisma, {
      signingReads: options.signingReads,
      parties: options.parties,
    }),
    context,
    drafts: createWithholdingDraftRepository(prisma),
    idempotency: createIdempotencyStore(prisma),
    documents,
    accessKeys: options.accessKeys ?? createAccessKeys(),
    xsd: options.xsd,
    builderVersion: WITHHOLDING_RECEIPT_XML_BUILDER_VERSION,
    authorizer: options.authorizer,
    limits: options.limits,
    today,
    now,
    ...(options.signAfterReserve === false
      ? {}
      : { continueToSigned: options.signing.continueToSigned }),
    ...(options.metrics ? { observer: registerWithholdingMetrics(options.metrics) } : {}),
  });
  return {
    routers: [
      withholdingReceiptsRouter({
        drafts,
        options: withholdingOptions,
        emission,
        withholdings,
        serverTiming: options.stageTimings ?? false,
      }),
    ],
    drafts,
    options: withholdingOptions,
    emission,
    withholdings,
  };
}
// Fuente de portabilidad (add-data-portability, design D1).
export { createWithholdingPortabilitySources } from "./portability-sources.ts";
