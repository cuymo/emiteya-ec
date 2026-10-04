// Ensamblado del archivo documental para main.ts y las pruebas (add-document-archive, design D1).
// Es el único punto que ve el archivo desde fuera de sus carpetas: la transmisión no lo importa.
import type { Registry } from "@prometheus-io/client";
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import type { Authorizer } from "../../../identity/application/authorization.ts";
import { createArchive } from "../../application/archive/archive.ts";
import { createDownloads } from "../../application/archive/downloads.ts";
import { createArtifactStore } from "../prisma-artifacts.ts";
import { registerDeliveryMetrics } from "./delivery-metrics.ts";
import { documentsRouter } from "./http/documents-router.ts";
import { createArchiveReads } from "./prisma-archive-reads.ts";
import { createDeliveryRepository } from "./prisma-deliveries.ts";

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

/** Rutas de la bandeja de comprobantes, sus documentos, sus descargas y sus entregas. */
export function archiveRouters(deps: {
  prisma: PrismaClient;
  authorizer: Authorizer;
  metrics?: Registry;
  logger?: Readonly<{ error(details: object, message: string): void }>;
}) {
  const reads = createArchiveReads(deps.prisma);
  const archive = createArchive({ reads, authorizer: deps.authorizer });
  const downloads = createDownloads({
    reads,
    artifacts: createArtifactStore(deps.prisma),
    deliveries: createDeliveryRepository(deps.prisma),
    authorizer: deps.authorizer,
    ...(deps.metrics ? { observer: registerDeliveryMetrics(deps.metrics) } : {}),
    ...(deps.logger ? { logger: deps.logger } : {}),
  });
  return [documentsRouter({ archive, downloads })];
}
