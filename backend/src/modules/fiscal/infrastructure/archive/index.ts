// Ensamblado del archivo documental para main.ts y las pruebas (add-document-archive, design D1).
// Es el único punto que ve el archivo desde fuera de sus carpetas: la transmisión no lo importa.
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import type { Authorizer } from "../../../identity/application/authorization.ts";
import { createArchive } from "../../application/archive/archive.ts";
import { documentsRouter } from "./http/documents-router.ts";
import { createArchiveReads } from "./prisma-archive-reads.ts";

export {
  DOCUMENT_JOB_PREFIX,
  RIDE_BACKOFF,
  RIDE_JOB_TYPE,
  rideFollower,
  rideJob,
  type RideJobSettings,
} from "../../application/archive/ride-jobs.ts";
export { createRideHandler } from "../../application/archive/ride-handler.ts";
export type { RideLogoSource } from "../../application/archive/ride-ports.ts";
export { createRideSweeper, type RideSweeper } from "./ride-sweeper.ts";
export { createRideUnitOfWork } from "./ride-unit-of-work.ts";
export { registerRideMetrics } from "./ride-metrics.ts";

/** Rutas de la bandeja de comprobantes y sus documentos. */
export function archiveRouters(deps: { prisma: PrismaClient; authorizer: Authorizer }) {
  const archive = createArchive({
    reads: createArchiveReads(deps.prisma),
    authorizer: deps.authorizer,
  });
  return [documentsRouter({ archive })];
}
