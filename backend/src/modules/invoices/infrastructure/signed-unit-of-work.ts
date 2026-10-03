// Transacción corta del paso a SIGNED (add-invoice-emission, design D9, paso 6): el artefacto exacto,
// la transición guardada, su historial y la auditoría se confirman juntos. El trigger diferido impide
// un SIGNED sin artefacto.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import {
  createArtifactStore,
  createDocumentRepository,
} from "../../fiscal/infrastructure/index.ts";
import type { SignedUnitOfWork } from "../application/ports.ts";

export function createSignedUnitOfWork(prisma: PrismaClient): SignedUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({
          artifacts: createArtifactStore(tx),
          documents: createDocumentRepository(tx),
          audit: createAuditLog(tx),
        }),
      ),
  };
}
