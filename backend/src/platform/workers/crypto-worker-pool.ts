// Pool de worker_threads para trabajo criptográfico síncrono (add-signing-certificate, design D18):
// abrir un PKCS#12, derivar sus claves o firmar consumen CPU que no debe bloquear el event loop de
// la API. Es una instancia de la primitiva `worker-pool.ts` (add-document-archive, design D6), con
// sus propios errores HTTP; no comparte workers ni cola con el pool del RIDE.
import type { Logger } from "pino";
import { AppError } from "../http/errors.ts";
import { createWorkerPool, type WorkerPool } from "./worker-pool.ts";

export { workerEntry, type TaskOutcome } from "./worker-pool.ts";

export class CryptoBusyError extends AppError {
  constructor() {
    super(
      "CRYPTO_BUSY",
      503,
      "El procesamiento criptográfico está saturado. Intenta de nuevo en unos segundos.",
    );
  }
}

export class CryptoTimeoutError extends AppError {
  constructor() {
    super("CRYPTO_TIMEOUT", 503, "La operación criptográfica tardó demasiado y se canceló.");
  }
}

/** Fallo del worker (no de la tarea): se trata como error interno, sin detalles. */
export class CryptoWorkerError extends Error {
  constructor() {
    super("El worker criptográfico terminó de forma inesperada.");
    this.name = "CryptoWorkerError";
  }
}

export class CryptoPoolClosedError extends AppError {
  constructor() {
    super("CRYPTO_UNAVAILABLE", 503, "El procesamiento criptográfico no está disponible.");
  }
}

export type CryptoWorkerPoolOptions = {
  /** Módulo del worker que llama a serveCryptoTasks. */
  entry: URL;
  size: number;
  timeoutMs: number;
  maxQueue?: number;
  logger?: Pick<Logger, "warn">;
};

export type CryptoWorkerPool = WorkerPool;

export function createCryptoWorkerPool(options: CryptoWorkerPoolOptions): CryptoWorkerPool {
  return createWorkerPool({
    ...options,
    interruptedMessage: "tarea criptográfica interrumpida",
    errors: {
      busy: () => new CryptoBusyError(),
      timeout: () => new CryptoTimeoutError(),
      worker: () => new CryptoWorkerError(),
      closed: () => new CryptoPoolClosedError(),
    },
  });
}
