// Lado del worker del pool criptográfico (design D18), sobre la primitiva `serve-worker-tasks.ts`.
// Un error que no sea CryptoTaskError se responde como INTERNAL, sin su mensaje: podría citar datos
// de la tarea.
import {
  WorkerTaskError,
  serveWorkerTasks,
  type WorkerTaskHandlers,
} from "./serve-worker-tasks.ts";

export class CryptoTaskError extends WorkerTaskError {
  constructor(code: string) {
    super(code);
    this.name = "CryptoTaskError";
  }
}

export type CryptoTaskHandlers = WorkerTaskHandlers;

export function serveCryptoTasks(handlers: CryptoTaskHandlers): void {
  serveWorkerTasks(handlers);
}
