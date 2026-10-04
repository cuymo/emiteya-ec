// Transacción corta del paso a SIGNED (add-invoice-emission, design D9, paso 6): el artefacto exacto,
// la transición guardada, su historial, la auditoría y el `sri.transmit` inicial (add-sri-transmission,
// design D6) se confirman juntos. El trigger diferido impide un SIGNED sin artefacto.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import {
  createArtifactStore,
  createDocumentRepository,
  enqueueTransmissionIn,
  type TransmissionSettings,
} from "../../fiscal/infrastructure/index.ts";
import type { SignedUnitOfWork } from "../application/ports.ts";

export function createSignedUnitOfWork(
  prisma: PrismaClient,
  transmission: Readonly<{
    jobs: Pick<JobStore, "enqueueIn">;
    settings: TransmissionSettings;
    now: () => Date;
  }>,
): SignedUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({
          artifacts: createArtifactStore(tx),
          documents: createDocumentRepository(tx),
          audit: createAuditLog(tx),
          enqueueTransmission: (document) =>
            enqueueTransmissionIn(
              { db: tx, jobs: transmission.jobs },
              document,
              transmission.settings,
              transmission.now(),
            ),
        }),
      ),
  };
}
