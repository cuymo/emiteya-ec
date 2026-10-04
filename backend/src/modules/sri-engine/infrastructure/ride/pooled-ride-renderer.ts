// Renderer del RIDE para la API (add-document-archive, design D6): envía cada render al pool del
// RIDE y traduce sus fallos operativos. No carga pdfmake: solo lo carga el worker
// (`serve-ride-tasks.ts`).
import {
  RidePoolError,
  type RideWorkerPool,
} from "../../../../platform/workers/ride-worker-pool.ts";
import { workerEntry } from "../../../../platform/workers/worker-pool.ts";
import {
  RideRenderUnavailableError,
  type RideRenderOutcome,
  type RideRenderer,
} from "../../application/ride.ts";

export const RIDE_RENDER_TASK = "ride.render";

/** Módulo del worker del RIDE, junto a este archivo (`.ts` en desarrollo, `.js` en el build). */
export const rideTasksEntry = (): URL => workerEntry(import.meta.url, "./serve-ride-tasks");

export function createPooledRideRenderer(pool: RideWorkerPool): RideRenderer {
  return {
    async render(input) {
      let outcome;
      try {
        outcome = await pool.run<RideRenderOutcome>(RIDE_RENDER_TASK, input);
      } catch (error) {
        if (error instanceof RidePoolError) throw new RideRenderUnavailableError(error.reason);
        throw error;
      }
      // Un error inesperado del worker solo trae su código: es un fallo operativo, reintentable.
      if (!outcome.ok) throw new RideRenderUnavailableError("INTERNAL");
      return outcome.value;
    },
  };
}
