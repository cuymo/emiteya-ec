// Transacción del reintento de una generación detenida del RIDE (add-document-archive, design D5):
// bloquea el comprobante, comprueba su RIDE y su último job, y encola el job manual. Dos
// solicitudes simultáneas se ordenan en el bloqueo y chocan en la clave activa del job.
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import type { JobStore } from "../../../../platform/jobs/jobs.ts";
import type {
  ArchiveRideJob,
  RideRetryUnitOfWork,
} from "../../application/archive/archive-ports.ts";
import { RIDE_JOB_TYPE } from "../../application/archive/ride-jobs.ts";
import { createDocumentRepository } from "../prisma-documents.ts";

export function createRideRetryUnitOfWork(
  prisma: PrismaClient,
  jobs: Pick<JobStore, "enqueueIn">,
): RideRetryUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({
          lockDocument: (companyId, documentId) =>
            createDocumentRepository(tx).lock(companyId, documentId),
          hasRide: async (companyId, documentId) =>
            (await tx.documentArtifact.count({
              where: { companyId, documentId, kind: "RIDE_PDF" },
            })) > 0,
          latestRideJob: async (companyId, documentId) =>
            ((await tx.job.findFirst({
              where: { companyId, documentId, type: RIDE_JOB_TYPE },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { status: true, lastErrorCode: true, completedAt: true },
            })) as ArchiveRideJob | null) ?? null,
          enqueue: (job) => jobs.enqueueIn(tx, job),
        }),
      ),
  };
}
