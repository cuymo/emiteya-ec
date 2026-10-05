// Ensamblado del módulo fiscal para main.ts y las pruebas (add-fiscal-numbering, design D1).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createEstablishmentRepository } from "../../taxpayer/infrastructure/prisma-establishments.ts";
import { createSequenceAdministration } from "../application/sequence-administration.ts";
import { sequencesRouter } from "./http/sequences-router.ts";
import { createSequenceRepository } from "./prisma-sequences.ts";
import { createFiscalUnitOfWork } from "./unit-of-work.ts";

// Reserva dentro de la transacción de la emisión (add-invoice-emission, design D1 y D7).
export { createFiscalScope } from "./unit-of-work.ts";
export { reserveSequentialIn } from "../application/reservation.ts";
// Comprobantes y su historial (add-invoice-emission, design D3).
export { createDocumentRepository, toStoredDocument } from "./prisma-documents.ts";
export { createArtifactStore } from "./prisma-artifacts.ts";
// Transmisión al SRI (add-sri-transmission, design D1, D6, D15 y D18).
export { createTransmissionReader } from "./prisma-transmission-reads.ts";
export { createReconciliationRequestUnitOfWork } from "./reconciliation-unit-of-work.ts";
export { createSriEvidenceRepository } from "./prisma-sri-evidence.ts";
export { createTransmissionUnitOfWork } from "./transmission-unit-of-work.ts";
export { createTransmissionSweeper, type TransmissionSweeper } from "./transmission-sweeper.ts";
export { enqueueTransmissionIn } from "../application/transmission-jobs.ts";
export {
  signingPipelines,
  type SigningPipelines,
  type SigningPipelinesOptions,
} from "./signing-pipelines.ts";
export type {
  DocumentSigner,
  SigningPipeline,
  SigningProfile,
} from "../application/signing-pipeline.ts";
export {
  DEFAULT_TRANSMISSION_SETTINGS,
  type TransmissionSettings,
} from "../application/transmission-settings.ts";
export type {
  ReconciliationRequestUnitOfWork,
  TransmissionReader,
  TransmissionSummary,
  TransmissionEvent,
} from "../application/transmission-ports.ts";
export type {
  ArtifactStore,
  ArtifactSummary,
  DocumentRepository,
  StoredArtifact,
  StoredDocument,
} from "../application/ports.ts";

export function fiscalRouters({
  prisma,
  authorizer,
}: {
  prisma: PrismaClient;
  authorizer: Authorizer;
}) {
  return [
    sequencesRouter(
      createSequenceAdministration({
        uow: createFiscalUnitOfWork(prisma),
        sequences: createSequenceRepository(prisma),
        establishments: createEstablishmentRepository(prisma),
        authorizer,
      }),
    ),
  ];
}

// Handlers de la transmisión (add-sri-transmission, design D8 a D17).
export { createTransmitHandler } from "../application/transmit-handler.ts";
export { SRI_JOB_TYPES } from "../domain/transmission.ts";
export { createAuthorizeHandler } from "../application/authorize-handler.ts";
export { createReconcileHandler } from "../application/reconcile-handler.ts";
export { registerTransmissionMetrics } from "./transmission-metrics.ts";
