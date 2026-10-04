// Transacción de la decisión de un paso de la transmisión (add-sri-transmission, design D8, TX B):
// el resultado, la transición guardada, la autorización y su artefacto, el job y la auditoría.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { TransmissionUnitOfWork } from "../application/transmission-step.ts";
import { createArtifactStore } from "./prisma-artifacts.ts";
import { createDocumentRepository } from "./prisma-documents.ts";
import { createSriEvidenceRepository } from "./prisma-sri-evidence.ts";

export function createTransmissionUnitOfWork(prisma: PrismaClient): TransmissionUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({
          db: tx,
          evidence: createSriEvidenceRepository(tx),
          documents: createDocumentRepository(tx),
          artifacts: createArtifactStore(tx),
          audit: createAuditLog(tx),
        }),
      ),
  };
}
