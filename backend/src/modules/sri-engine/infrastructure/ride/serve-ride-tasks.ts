// Worker del RIDE (add-document-archive, design D6): carga una vez las fuentes verificadas y
// pdfmake, y dibuja cada RIDE fuera del hilo que atiende HTTP. Si las fuentes faltan o no
// coinciden, cada tarea responde `RIDE_FONTS_UNAVAILABLE` con los archivos afectados, nunca rutas.
import { workerData } from "node:worker_threads";
import { serveWorkerTasks } from "../../../../platform/workers/serve-worker-tasks.ts";
import type { RideRenderInput, RideRenderOutcome } from "../../application/ride.ts";
import { loadRideAssets } from "./ride-assets.ts";
import { RIDE_RENDER_TASK } from "./pooled-ride-renderer.ts";
import { createInProcessRideRenderer } from "./ride-renderer.ts";

const { fontsDirectory } = workerData as { fontsDirectory: string };
const assets = loadRideAssets(fontsDirectory);
const renderer = assets.ok ? createInProcessRideRenderer(assets.fonts) : null;

serveWorkerTasks({
  [RIDE_RENDER_TASK]: (input: RideRenderInput): Promise<RideRenderOutcome> | RideRenderOutcome =>
    renderer
      ? renderer.render(input)
      : {
          status: "REJECTED",
          code: "RIDE_FONTS_UNAVAILABLE",
          detail: assets.ok ? [] : assets.failures.map((failure) => failure.file),
        },
});
