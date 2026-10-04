// Pool de worker_threads del RIDE (add-document-archive, design D6): una instancia de la primitiva
// `worker-pool.ts`, independiente del pool criptográfico. Maquetar un RIDE bloquea su hilo entre
// 100 y 220 ms (spike S-4): nunca ocurre en el hilo que atiende HTTP. Sus errores no son HTTP: los
// clasifica el job del RIDE, que reprograma o falla con backoff.
import type { Logger } from "pino";
import { createWorkerPool, type WorkerPool } from "./worker-pool.ts";

export type RidePoolFailure = "BUSY" | "TIMEOUT" | "WORKER" | "CLOSED";

/** Fallo operativo del pool del RIDE, nunca del comprobante. */
export class RidePoolError extends Error {
  readonly reason: RidePoolFailure;

  constructor(reason: RidePoolFailure) {
    super(`RIDE_POOL_${reason}`);
    this.name = "RidePoolError";
    this.reason = reason;
  }
}

export type RideWorkerPoolOptions = {
  /** Módulo del worker del RIDE (`serve-ride-tasks`). */
  entry: URL;
  size: number;
  maxQueue: number;
  timeoutMs: number;
  /** Directorio de las fuentes verificadas que carga cada worker. */
  fontsDirectory: string;
  logger?: Pick<Logger, "warn">;
};

export type RideWorkerPool = WorkerPool;

export function createRideWorkerPool(options: RideWorkerPoolOptions): RideWorkerPool {
  return createWorkerPool({
    entry: options.entry,
    size: options.size,
    maxQueue: options.maxQueue,
    timeoutMs: options.timeoutMs,
    ...(options.logger ? { logger: options.logger } : {}),
    workerData: { fontsDirectory: options.fontsDirectory },
    interruptedMessage: "render del RIDE interrumpido",
    errors: {
      busy: () => new RidePoolError("BUSY"),
      timeout: () => new RidePoolError("TIMEOUT"),
      worker: () => new RidePoolError("WORKER"),
      closed: () => new RidePoolError("CLOSED"),
    },
  });
}
