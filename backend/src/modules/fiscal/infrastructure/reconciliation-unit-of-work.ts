// Transacción de una solicitud de reconciliación manual (add-sri-transmission, design D15 y D19):
// bloquea el comprobante, encola el job y registra la auditoría juntos.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { ReconciliationRequestUnitOfWork } from "../application/transmission-ports.ts";
import { createDocumentRepository } from "./prisma-documents.ts";

export function createReconciliationRequestUnitOfWork(
  prisma: PrismaClient,
  jobs: Pick<JobStore, "enqueueIn">,
): ReconciliationRequestUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({
          db: tx,
          jobs,
          lockDocument: (companyId, documentId) =>
            createDocumentRepository(tx).lock(companyId, documentId),
          audit: createAuditLog(tx),
        }),
      ),
  };
}
