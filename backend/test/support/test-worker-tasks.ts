// Worker de prueba de la primitiva de pool: éxito, CPU, error tipado, fallo inesperado, cuelgue y
// salida del proceso del worker.
import {
  WorkerTaskError,
  serveWorkerTasks,
} from "../../src/platform/workers/serve-worker-tasks.ts";

const busy = (ms: number) => {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  return x;
};

serveWorkerTasks({
  echo: (payload: { value: string }) => ({ echoed: payload.value }),
  busy: (payload: { ms: number }) => ({ spent: busy(payload.ms) > 0 }),
  typed: () => {
    throw new WorkerTaskError("TYPED_FAILURE");
  },
  unexpected: (payload: { secret: string }) => {
    throw new Error(`fallo con ${payload.secret}`);
  },
  hang: () => {
    for (;;) busy(1000);
  },
  crash: () => process.exit(3),
});
