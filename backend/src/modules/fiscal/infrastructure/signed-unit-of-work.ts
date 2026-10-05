// Transacción corta del paso a SIGNED (add-invoice-emission, design D9, paso 6): el artefacto exacto,
// la transición guardada, su historial, la auditoría y el `sri.transmit` inicial (add-sri-transmission,
// design D6) se confirman juntos. El trigger diferido impide un SIGNED sin artefacto. La comparten
// todos los tipos (add-credit-notes, design D2).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import type { SignedUnitOfWork } from "../application/ports.ts";
import { enqueueTransmissionIn } from "../application/transmission-jobs.ts";
import type { TransmissionSettings } from "../application/transmission-settings.ts";
import { createArtifactStore } from "./prisma-artifacts.ts";
import { createDocumentRepository } from "./prisma-documents.ts";

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
