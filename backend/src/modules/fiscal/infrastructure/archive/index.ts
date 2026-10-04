// Ensamblado del archivo documental para main.ts y las pruebas (add-document-archive, design D1).
// Es el único punto que ve el archivo desde fuera de sus carpetas: la transmisión no lo importa.
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
