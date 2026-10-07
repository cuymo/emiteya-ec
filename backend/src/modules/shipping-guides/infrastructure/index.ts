// Composición del módulo shipping-guides (add-shipping-guides, design D1, D2 y D22): borradores con
// su vista previa, opciones y búsquedas, la emisión, la consulta, la reconciliación manual y el
// reintento de la firma, sobre las lecturas de taxpayer, catalogs y signing, y las lecturas de
// terceros, productos y facturas que compone `main.ts`. Ningún otro módulo importa este; este no
// importa `parties`, `products`, `invoices` ni `inventory`.
import type { Registry } from "@prometheus-io/client";
import type { ShippingGuideLimits } from "@facturador/contracts";
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
  SHIPPING_GUIDE_XML_BUILDER_VERSION,
  createShippingGuideXmlBuilder,
} from "../../sri-engine/infrastructure/shipping-guide-xml-builder.ts";
import { createShippingGuideDrafts } from "../application/drafts.ts";
import { createShippingGuideEmission } from "../application/emission.ts";
import { createShippingGuideOptions } from "../application/options.ts";
import type {
  ShippingInvoiceReader,
  ShippingPartyReader,
  ShippingProductReader,
} from "../application/ports.ts";
import { createShippingGuides } from "../application/shipping-guides.ts";
import { shippingGuideSigningProfile as createShippingGuideSigningProfile } from "../application/signing-profile.ts";
import { createShippingEligibleInvoiceReader } from "./eligible-invoices.ts";
import { shippingGuidesRouter } from "./http/shipping-guides-router.ts";

export {
  isShippingGuideDraftBody,
  SHIPPING_GUIDE_DRAFT_BODY_LIMIT_BYTES,
} from "./http/shipping-guides-router.ts";
import { registerShippingGuideMetrics } from "./metrics.ts";
import { createShippingGuideDraftRepository } from "./prisma-drafts.ts";
import { createShippingGuideListReader } from "./prisma-shipping-guide-list.ts";
import { createShippingGuideReads, type SigningReads } from "./reads.ts";
import {
  createShippingGuideDraftsUnitOfWork,
  createShippingGuideEmissionUnitOfWork,
} from "./units-of-work.ts";

/** Perfil de la guía de remisión para la firma compartida, con el builder 1.1.0. */
export const shippingGuideSigningProfile = (): SigningProfile =>
  createShippingGuideSigningProfile(createShippingGuideXmlBuilder());

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
  /** Validador XSD: los archivos del esquema antes de reservar. */
  xsd: Pick<XsdValidator, "ensureAvailable">;
  /** Firma compartida de `fiscal` con el perfil de la guía (design D2). */
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
  const documents = createDocumentRepository(prisma);
  const guides = createShippingGuides({
    documents,
    artifacts: createArtifactStore(prisma),
    pipeline: options.signing,
    audit: createAuditLog(prisma),
    authorizer: options.authorizer,
    transmission: createTransmissionReader(prisma),
    list: createShippingGuideListReader(prisma),
    reconciliations: createReconciliationRequestUnitOfWork(
      prisma,
      options.jobs ?? createPrismaJobStore(prisma, options.schema),
    ),
    conclusionWindowMs: options.conclusionWindowMs ?? DEFAULT_CONCLUSION_WINDOW_MS,
    now,
  });
  const emission = createShippingGuideEmission({
    uow: createShippingGuideEmissionUnitOfWork(prisma, {
      signingReads: options.signingReads,
      parties: options.parties,
      products: options.products,
      invoices: options.invoices,
    }),
    context,
    drafts: createShippingGuideDraftRepository(prisma),
    idempotency: createIdempotencyStore(prisma),
    documents,
    accessKeys: options.accessKeys ?? createAccessKeys(),
    xsd: options.xsd,
    builderVersion: SHIPPING_GUIDE_XML_BUILDER_VERSION,
    authorizer: options.authorizer,
    limits: options.limits,
    today,
    now,
    ...(options.signAfterReserve === false
      ? {}
      : { continueToSigned: options.signing.continueToSigned }),
    ...(options.metrics ? { observer: registerShippingGuideMetrics(options.metrics) } : {}),
  });
  const carrierName = async (companyId: string, partyId: string | null) => {
    if (partyId === null) {
      const config = await context.reads.currentConfig(companyId);
      return config?.profile.legalName ?? null;
    }
    return (await context.parties.find(companyId, partyId))?.legalName ?? null;
  };
  return {
    routers: [
      shippingGuidesRouter({
        drafts,
        options: shippingOptions,
        emission,
        guides,
        serverTiming: options.stageTimings ?? false,
        carrierName,
      }),
    ],
    drafts,
    options: shippingOptions,
    emission,
    guides,
  };
}
