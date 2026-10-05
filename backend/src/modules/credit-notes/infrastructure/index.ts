// Composición del módulo credit-notes para main.ts y las pruebas (add-credit-notes, design D1). La
// factura de origen (`invoices`), la capacidad devolvible (`inventory`) y la firma de comprobantes
// (`signing`) llegan como puertos: ninguno de esos módulos importa `credit-notes`.
import type { Registry } from "@prometheus-io/client";
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
  CREDIT_NOTE_XML_BUILDER_VERSION,
  createCreditNoteXmlBuilder,
} from "../../sri-engine/infrastructure/credit-note-xml-builder.ts";
import { createCreditNotes } from "../application/credit-notes.ts";
import { createCreditNoteDrafts } from "../application/drafts.ts";
import { createCreditNoteEmission } from "../application/emission.ts";
import type { InvoiceCreditSourceReader, ReturnCapacity } from "../application/ports.ts";
import { creditNoteSigningProfile as createCreditNoteSigningProfile } from "../application/signing-profile.ts";
import { createEligibleInvoiceReader } from "./eligible-invoices.ts";
import { createCreditNoteListReader } from "./prisma-credit-note-list.ts";
import { creditNotesRouter } from "./http/credit-notes-router.ts";
import { registerCreditNoteMetrics } from "./metrics.ts";
import { createCreditCapacityRepository } from "./prisma-credit-capacity.ts";
import { createCreditNoteDraftRepository } from "./prisma-drafts.ts";
import { createCreditNotesReads, type SigningReads } from "./reads.ts";
import {
  createCreditNoteDraftsUnitOfWork,
  createCreditNoteEmissionUnitOfWork,
} from "./units-of-work.ts";

export { createCreditCapacityRepository } from "./prisma-credit-capacity.ts";
export { creditCapacityFollower } from "../application/followers.ts";
export { reconcileCreditCapacity, type CreditCapacityDifference } from "./reconciliation.ts";

/** Perfil de la nota de crédito para la firma compartida, con el builder `notaCredito` 1.1.0. */
export const creditNoteSigningProfile = (): SigningProfile =>
  createCreditNoteSigningProfile(createCreditNoteXmlBuilder());

export type CreditNotesModuleOptions = {
  prisma: PrismaClient;
  /** Esquema de la base de la conexión: la consulta de las facturas elegibles lo nombra. */
  schema: string;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Factura de origen (`invoiceCreditSource` de `invoices`), compuesta por `main.ts`. */
  invoices: InvoiceCreditSourceReader;
  /** Capacidad devolvible (`stockReturnCapacity` de `inventory`), compuesta por `main.ts`. */
  returns: ReturnCapacity;
  /** Validador XSD: los archivos del esquema antes de reservar. */
  xsd: Pick<XsdValidator, "ensureAvailable">;
  /** Firma compartida de `fiscal` con el perfil de la nota (design D2). */
  signing: SigningPipeline;
  /** false: la emisión se detiene en RESERVED. Solo para las pruebas de recuperación. */
  signAfterReserve?: boolean;
  accessKeys?: AccessKeys;
  metrics?: Registry;
  /** Cola durable: la reconciliación manual encola su job. */
  jobs?: Pick<JobStore, "enqueueIn">;
  /** `SRI_CONCLUSION_WINDOW_HOURS` en milisegundos; 24 horas por defecto. */
  conclusionWindowMs?: number;
  /** `EMISSION_STAGE_TIMINGS`: cabecera `Server-Timing` en la emisión; nunca en producción. */
  stageTimings?: boolean;
  now?: () => Date;
};

const DEFAULT_CONCLUSION_WINDOW_MS = 24 * 3_600_000;

export function creditNotesModule(options: CreditNotesModuleOptions) {
  const now = options.now ?? (() => new Date());
  const today = () => ecuadorDate(now());
  const { prisma } = options;
  const context = {
    reads: createCreditNotesReads(prisma, options.signingReads),
    invoices: options.invoices(prisma),
    capacity: createCreditCapacityRepository(prisma),
    returns: options.returns(prisma),
  };
  const drafts = createCreditNoteDrafts({
    drafts: createCreditNoteDraftRepository(prisma),
    uow: createCreditNoteDraftsUnitOfWork(prisma),
    context,
    authorizer: options.authorizer,
    today,
  });
  const documents = createDocumentRepository(prisma);
  const creditNotes = createCreditNotes({
    documents,
    artifacts: createArtifactStore(prisma),
    pipeline: options.signing,
    audit: createAuditLog(prisma),
    authorizer: options.authorizer,
    transmission: createTransmissionReader(prisma),
    eligible: createEligibleInvoiceReader(prisma, options.schema),
    list: createCreditNoteListReader(prisma),
    context,
    reconciliations: createReconciliationRequestUnitOfWork(
      prisma,
      options.jobs ?? createPrismaJobStore(prisma, options.schema),
    ),
    conclusionWindowMs: options.conclusionWindowMs ?? DEFAULT_CONCLUSION_WINDOW_MS,
    now,
    async userName(companyId, userId) {
      const member = await prisma.member.findFirst({
        where: { organizationId: companyId, userId },
        select: { user: { select: { name: true } } },
      });
      return member?.user.name ?? null;
    },
  });
  const emission = createCreditNoteEmission({
    uow: createCreditNoteEmissionUnitOfWork(prisma, {
      signingReads: options.signingReads,
      invoices: options.invoices,
      returns: options.returns,
    }),
    context,
    drafts: createCreditNoteDraftRepository(prisma),
    idempotency: createIdempotencyStore(prisma),
    documents,
    accessKeys: options.accessKeys ?? createAccessKeys(),
    xsd: options.xsd,
    builderVersion: CREDIT_NOTE_XML_BUILDER_VERSION,
    authorizer: options.authorizer,
    today,
    now,
    ...(options.signAfterReserve === false
      ? {}
      : { continueToSigned: options.signing.continueToSigned }),
    ...(options.metrics ? { observer: registerCreditNoteMetrics(options.metrics) } : {}),
  });
  return {
    routers: [
      creditNotesRouter({
        drafts,
        emission,
        creditNotes,
        serverTiming: options.stageTimings ?? false,
      }),
    ],
    drafts,
    emission,
    creditNotes,
  };
}
