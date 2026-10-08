// Composición del módulo debit-notes para main.ts y las pruebas (add-debit-notes, design D1). La
// factura de origen (`invoices`) y la firma de comprobantes (`signing`) llegan como puertos: ninguno
// de esos módulos importa `debit-notes`. La nota de débito no compone capacidades ni inventario.
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
  DEBIT_NOTE_XML_BUILDER_VERSION,
  createDebitNoteXmlBuilder,
} from "../../sri-engine/infrastructure/debit-note-xml-builder.ts";
import { createDebitNotes } from "../application/debit-notes.ts";
import { createDebitNoteDrafts } from "../application/drafts.ts";
import { createDebitNoteEmission } from "../application/emission.ts";
import type { InvoiceSourceReader } from "../application/ports.ts";
import { debitNoteSigningProfile as createDebitNoteSigningProfile } from "../application/signing-profile.ts";
import { createDebitEligibleInvoiceReader } from "./eligible-invoices.ts";
import { createDebitNoteListReader } from "./prisma-debit-note-list.ts";
import { debitNotesRouter } from "./http/debit-notes-router.ts";
import { registerDebitNoteMetrics } from "./metrics.ts";
import { createDebitNoteDraftRepository } from "./prisma-drafts.ts";
import { createDebitNotesReads, type SigningReads } from "./reads.ts";
import {
  createDebitNoteDraftsUnitOfWork,
  createDebitNoteEmissionUnitOfWork,
} from "./units-of-work.ts";

// Importes de la nota de débito en los reportes (add-reports-export, design D5).
export { debitNoteReportAmounts } from "./report-amounts.ts";

/** Perfil de la nota de débito para la firma compartida, con el builder `notaDebito` 1.0.0. */
export const debitNoteSigningProfile = (): SigningProfile =>
  createDebitNoteSigningProfile(createDebitNoteXmlBuilder());

export type DebitNotesModuleOptions = {
  prisma: PrismaClient;
  /** Esquema de la base de la conexión: la consulta de las facturas elegibles lo nombra. */
  schema: string;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Factura de origen (`invoiceCreditSource` de `invoices`), compuesta por `main.ts`. */
  invoices: InvoiceSourceReader;
  /** Validador XSD: los archivos del esquema antes de reservar. */
  xsd: Pick<XsdValidator, "ensureAvailable">;
  /** Firma compartida de `fiscal` con el perfil de la nota de débito (design D2). */
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

export function debitNotesModule(options: DebitNotesModuleOptions) {
  const now = options.now ?? (() => new Date());
  const today = () => ecuadorDate(now());
  const { prisma } = options;
  const reads = createDebitNotesReads(prisma, options.signingReads);
  const context = { reads, invoices: options.invoices(prisma) };
  const drafts = createDebitNoteDrafts({
    drafts: createDebitNoteDraftRepository(prisma),
    uow: createDebitNoteDraftsUnitOfWork(prisma),
    context,
    authorizer: options.authorizer,
    today,
  });
  const documents = createDocumentRepository(prisma);
  const debitNotes = createDebitNotes({
    documents,
    artifacts: createArtifactStore(prisma),
    pipeline: options.signing,
    audit: createAuditLog(prisma),
    authorizer: options.authorizer,
    transmission: createTransmissionReader(prisma),
    eligible: createDebitEligibleInvoiceReader(prisma, options.schema),
    list: createDebitNoteListReader(prisma),
    reads,
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
  const emission = createDebitNoteEmission({
    uow: createDebitNoteEmissionUnitOfWork(prisma, {
      signingReads: options.signingReads,
      invoices: options.invoices,
    }),
    context,
    drafts: createDebitNoteDraftRepository(prisma),
    idempotency: createIdempotencyStore(prisma),
    documents,
    accessKeys: options.accessKeys ?? createAccessKeys(),
    xsd: options.xsd,
    builderVersion: DEBIT_NOTE_XML_BUILDER_VERSION,
    authorizer: options.authorizer,
    today,
    now,
    ...(options.signAfterReserve === false
      ? {}
      : { continueToSigned: options.signing.continueToSigned }),
    ...(options.metrics ? { observer: registerDebitNoteMetrics(options.metrics) } : {}),
  });
  return {
    routers: [
      debitNotesRouter({
        drafts,
        emission,
        debitNotes,
        serverTiming: options.stageTimings ?? false,
      }),
    ],
    drafts,
    emission,
    debitNotes,
  };
}
