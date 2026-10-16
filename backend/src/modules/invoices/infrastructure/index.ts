// Composición del módulo invoices para main.ts y las pruebas (add-invoice-emission, design D1).
import type { Registry } from "@prometheus-io/client";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createIdempotencyStore } from "../../../platform/idempotency/prisma-idempotency-store.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import {
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
import { INVOICE_XML_BUILDER_VERSION } from "../../sri-engine/infrastructure/invoice-xml-builder.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import { createArtifactStore } from "../../fiscal/infrastructure/index.ts";
import { createInvoiceXmlBuilder } from "../../sri-engine/infrastructure/invoice-xml-builder.ts";
import { createDrafts } from "../application/drafts.ts";
import { createEmission } from "../application/emission.ts";
import { createInvoices } from "../application/invoices.ts";
import { invoiceSigningProfile as createInvoiceSigningProfile } from "../application/signing-profile.ts";
import { createEmissionUnitOfWork } from "./emission-unit-of-work.ts";
import { createEvaluationReads, type SigningReads } from "./evaluation-reads.ts";
import type { StockReads } from "../application/ports.ts";
import { invoicesRouter } from "./http/invoices-router.ts";
export { invoiceStockLines, type InvoiceStockDocument } from "./stock-lines.ts";
export {
  invoiceCreditSource,
  type InvoiceCreditLine,
  type InvoiceCreditSource,
  type InvoiceIntegrityProblem,
} from "./credit-source.ts";
export type { StockReads } from "../application/ports.ts";
// Importes de la factura en los reportes (add-reports-export, design D5).
export { invoiceReportAmounts, invoiceReportTaxes } from "./report-amounts.ts";
// Tablero de Inicio: los borradores pendientes.
export { invoiceDraftCount } from "./dashboard-reads.ts";
import { registerEmissionMetrics } from "./metrics.ts";
import { createDraftRepository } from "./prisma-drafts.ts";
import { createDraftsUnitOfWork } from "./unit-of-work.ts";

export type InvoicesModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /**
   * Inventario de los productos sobre un cliente (add-minimal-inventory, design D1): lo implementa
   * `inventory` y lo compone `main.ts`. Obligatorio: olvidarlo es un error de tipos, no una emisión
   * que congela todas sus líneas sin inventario.
   */
  stockReads: StockReads;
  /** Validador XSD con el paquete verificado al arrancar: los archivos del esquema antes de reservar. */
  xsd: Pick<XsdValidator, "ensureAvailable">;
  /**
   * Firma compartida de `fiscal` con el perfil de la factura (add-credit-notes, design D2):
   * `signingPipelines(...).pipeline(invoiceSigningProfile())`, compuesta por `main.ts`.
   */
  signing: SigningPipeline;
  /** `INVOICE_MAX_LINES`. */
  maxLines: number;
  /**
   * false: la emisión se detiene en RESERVED, como si el proceso cayera después del commit. Solo
   * para las pruebas de recuperación.
   */
  signAfterReserve?: boolean;
  accessKeys?: AccessKeys;
  /** Registro de métricas: histograma de las etapas de la emisión (design D16). */
  metrics?: Registry;
  /** `EMISSION_STAGE_TIMINGS`: cabecera `Server-Timing` en la emisión; nunca en producción. */
  stageTimings?: boolean;
  logger?: {
    warn(details: object, message: string): void;
    error(details: object, message: string): void;
  };
  /** Cola durable: la reconciliación manual encola su job (add-sri-transmission, design D15). */
  jobs?: Pick<JobStore, "enqueueIn">;
  /** `SRI_CONCLUSION_WINDOW_HOURS` en milisegundos; 24 horas por defecto. */
  conclusionWindowMs?: number;
  now?: () => Date;
};

/** Perfil de la factura para la firma compartida, con el builder de la factura 1.1.0. */
export const invoiceSigningProfile = (): SigningProfile =>
  createInvoiceSigningProfile(createInvoiceXmlBuilder());

const DEFAULT_CONCLUSION_WINDOW_MS = 24 * 3_600_000;

export function invoicesModule(options: InvoicesModuleOptions) {
  const now = options.now ?? (() => new Date());
  const today = () => ecuadorDate(now());
  const reads = createEvaluationReads(options.prisma, options.signingReads, options.stockReads);
  const drafts = createDrafts({
    drafts: createDraftRepository(options.prisma),
    uow: createDraftsUnitOfWork(options.prisma),
    reads,
    authorizer: options.authorizer,
    today,
    maxLines: options.maxLines,
  });
  const documents = createDocumentRepository(options.prisma);
  const pipeline = options.signing;
  const invoices = createInvoices({
    documents,
    artifacts: createArtifactStore(options.prisma),
    pipeline,
    audit: createAuditLog(options.prisma),
    authorizer: options.authorizer,
    transmission: createTransmissionReader(options.prisma),
    reconciliations: createReconciliationRequestUnitOfWork(
      options.prisma,
      options.jobs ?? createPrismaJobStore(options.prisma),
    ),
    conclusionWindowMs: options.conclusionWindowMs ?? DEFAULT_CONCLUSION_WINDOW_MS,
    now,
  });
  const emission = createEmission({
    uow: createEmissionUnitOfWork(options.prisma, options.signingReads, options.stockReads),
    reads,
    idempotency: createIdempotencyStore(options.prisma),
    documents,
    accessKeys: options.accessKeys ?? createAccessKeys(),
    xsd: options.xsd,
    builderVersion: INVOICE_XML_BUILDER_VERSION,
    authorizer: options.authorizer,
    today,
    maxLines: options.maxLines,
    ...(options.signAfterReserve === false ? {} : { continueToSigned: pipeline.continueToSigned }),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  return {
    routers: [
      invoicesRouter({
        drafts,
        emission,
        invoices,
        serverTiming: options.stageTimings ?? false,
        ...(options.metrics ? { observeEmission: registerEmissionMetrics(options.metrics) } : {}),
      }),
    ],
    drafts,
    emission,
    invoices,
  };
}
