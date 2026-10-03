// Pool de worker_threads para trabajo criptográfico síncrono (add-signing-certificate, design D18):
// abrir un PKCS#12, derivar sus claves o firmar consumen CPU que no debe bloquear el event loop de
// la API. Workers fijos y reutilizados, una tarea por worker, cola limitada, timeout que termina y
// reemplaza el worker, y resultados tipados: el hilo principal nunca recibe el error original de
// una tarea, solo su código. Ni el pool ni el worker registran los mensajes. La emisión añadirá
// la firma de XML como otra tarea del mismo pool.
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Logger } from "pino";
import { AppError } from "../http/errors.ts";

export type TaskOutcome<T> = { ok: true; value: T } | { ok: false; code: string };

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

export interface CryptoWorkerPool {
  run<T>(task: string, payload: unknown, transfer?: ArrayBuffer[]): Promise<TaskOutcome<T>>;
  /** true mientras el pool acepta tareas y tiene sus workers. */
  isRunning(): boolean;
  close(): Promise<void>;
}

type Job = {
  task: string;
  payload: unknown;
  transfer: ArrayBuffer[];
  resolve: (outcome: TaskOutcome<unknown>) => void;
  reject: (error: Error) => void;
};

type Slot = { worker: Worker; job: Job | null; timer: NodeJS.Timeout | null; started: number };

/** Argumentos del worker: en desarrollo y pruebas carga TypeScript con las condiciones de desarrollo. */
function workerExecArgv(entry: URL): string[] {
  const args = [...process.execArgv];
  if (
    entry.pathname.endsWith(".ts") &&
    !args.some((arg) => arg.includes("conditions=development"))
  ) {
    args.push("--conditions=development");
  }
  return args;
}

export function createCryptoWorkerPool(options: CryptoWorkerPoolOptions): CryptoWorkerPool {
  const size = Math.max(1, Math.min(options.size, availableParallelism()));
  const maxQueue = options.maxQueue ?? 16;
  const queue: Job[] = [];
  const slots: Slot[] = [];
  let closed = false;
  let drained: (() => void) | null = null;

  const spawn = (): Slot => {
    const slot: Slot = {
      worker: new Worker(options.entry, { execArgv: workerExecArgv(options.entry) }),
      job: null,
      timer: null,
      started: 0,
    };
    slot.worker.on("message", (message: TaskOutcome<unknown>) => finish(slot, message));
    slot.worker.on("error", () => fail(slot, new CryptoWorkerError(), "worker_error"));
    slot.worker.on("exit", () => {
      if (slots.includes(slot)) fail(slot, new CryptoWorkerError(), "worker_exit");
    });
    return slot;
  };

  const replace = (slot: Slot) => {
    const index = slots.indexOf(slot);
    if (index === -1) return;
    slots.splice(index, 1);
    void slot.worker.terminate();
    if (!closed) slots.push(spawn());
    pump();
  };

  const settle = (slot: Slot) => {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    const job = slot.job;
    slot.job = null;
    return job;
  };

  function finish(slot: Slot, message: TaskOutcome<unknown>) {
    const job = settle(slot);
    if (!job) return;
    job.resolve(
      message.ok ? { ok: true, value: message.value } : { ok: false, code: message.code },
    );
    pump();
  }

  function fail(slot: Slot, error: Error, reason: string) {
    const job = settle(slot);
    if (job) {
      options.logger?.warn(
        { task: job.task, durationMs: Math.round(performance.now() - slot.started), reason },
        "tarea criptográfica interrumpida",
      );
      job.reject(error);
    }
    replace(slot);
  }

  function pump() {
    for (const slot of slots) {
      if (slot.job || queue.length === 0) continue;
      const job = queue.shift()!;
      slot.job = job;
      slot.started = performance.now();
      slot.timer = setTimeout(
        () => fail(slot, new CryptoTimeoutError(), "timeout"),
        options.timeoutMs,
      );
      slot.worker.postMessage({ task: job.task, payload: job.payload }, job.transfer);
    }
    if (closed && drained && slots.every((slot) => !slot.job)) drained();
  }

  for (let i = 0; i < size; i++) slots.push(spawn());

  return {
    run<T>(task: string, payload: unknown, transfer: ArrayBuffer[] = []) {
      if (closed) return Promise.reject(new CryptoPoolClosedError());
      if (queue.length >= maxQueue) return Promise.reject(new CryptoBusyError());
      return new Promise<TaskOutcome<T>>((resolve, reject) => {
        queue.push({ task, payload, transfer, resolve: resolve as Job["resolve"], reject });
        pump();
      });
    },

    isRunning: () => !closed && slots.length > 0,

    async close() {
      if (closed) return;
      closed = true;
      for (const job of queue.splice(0)) job.reject(new CryptoPoolClosedError());
      if (slots.some((slot) => slot.job)) await new Promise<void>((resolve) => (drained = resolve));
      const workers = slots.splice(0).map((slot) => slot.worker);
      await Promise.all(workers.map((worker) => worker.terminate()));
    },
  };
}

/** Ruta del módulo de un worker junto al llamador, `.ts` en desarrollo y `.js` compilado. */
export function workerEntry(callerUrl: string, relativeWithoutExtension: string): URL {
  const extension = callerUrl.endsWith(".ts") ? ".ts" : ".js";
  return new URL(`${relativeWithoutExtension}${extension}`, callerUrl);
}
