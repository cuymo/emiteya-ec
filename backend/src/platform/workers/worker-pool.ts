// Primitiva de pool de worker_threads para trabajo síncrono que no debe bloquear el event loop de la
// API (add-signing-certificate, design D18; extraída en add-document-archive, design D6). Workers
// fijos y reutilizados, una tarea por worker, cola limitada, timeout que termina y reemplaza el
// worker, y resultados tipados: el hilo principal nunca recibe el error original de una tarea, solo
// su código. Ni el pool ni el worker registran los mensajes. Cada instancia (criptográfica, del
// RIDE) aporta su entrada, su tamaño y sus errores; no comparten workers ni cola.
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Logger } from "pino";

export type TaskOutcome<T> = { ok: true; value: T } | { ok: false; code: string };

/** Errores de una instancia: cada pool decide su código, su clase y su estado HTTP. */
export type WorkerPoolErrors = Readonly<{
  /** La cola está llena. */
  busy: () => Error;
  /** La tarea superó su plazo: el worker se terminó y se reemplazó. */
  timeout: () => Error;
  /** El worker terminó de forma inesperada (no la tarea). */
  worker: () => Error;
  /** El pool está cerrado o se cerró con la tarea en cola. */
  closed: () => Error;
}>;

export type WorkerPoolOptions = {
  /** Módulo del worker que llama a serveWorkerTasks. */
  entry: URL;
  size: number;
  timeoutMs: number;
  /**
   * Tareas en espera admitidas. La comprobación precede al reparto, así que una cola de tamaño 0
   * rechaza toda tarea aunque haya un worker libre.
   */
  maxQueue?: number;
  logger?: Pick<Logger, "warn">;
  /** Datos de arranque de cada worker (`workerData`), por ejemplo un directorio de recursos. */
  workerData?: unknown;
  /** Mensaje del log de una tarea interrumpida, sin datos de la tarea. */
  interruptedMessage: string;
  errors: WorkerPoolErrors;
};

export interface WorkerPool {
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

export function createWorkerPool(options: WorkerPoolOptions): WorkerPool {
  const { errors } = options;
  const size = Math.max(1, Math.min(options.size, availableParallelism()));
  const maxQueue = options.maxQueue ?? 16;
  const queue: Job[] = [];
  const slots: Slot[] = [];
  let closed = false;
  let drained: (() => void) | null = null;

  const spawn = (): Slot => {
    const slot: Slot = {
      worker: new Worker(options.entry, {
        execArgv: workerExecArgv(options.entry),
        workerData: options.workerData,
      }),
      job: null,
      timer: null,
      started: 0,
    };
    slot.worker.on("message", (message: TaskOutcome<unknown>) => finish(slot, message));
    slot.worker.on("error", () => fail(slot, errors.worker(), "worker_error"));
    slot.worker.on("exit", () => {
      if (slots.includes(slot)) fail(slot, errors.worker(), "worker_exit");
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
        options.interruptedMessage,
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
      slot.timer = setTimeout(() => fail(slot, errors.timeout(), "timeout"), options.timeoutMs);
      slot.worker.postMessage({ task: job.task, payload: job.payload }, job.transfer);
    }
    if (closed && drained && slots.every((slot) => !slot.job)) drained();
  }

  for (let i = 0; i < size; i++) slots.push(spawn());

  return {
    run<T>(task: string, payload: unknown, transfer: ArrayBuffer[] = []) {
      if (closed) return Promise.reject(errors.closed());
      if (queue.length >= maxQueue) return Promise.reject(errors.busy());
      return new Promise<TaskOutcome<T>>((resolve, reject) => {
        queue.push({ task, payload, transfer, resolve: resolve as Job["resolve"], reject });
        pump();
      });
    },

    isRunning: () => !closed && slots.length > 0,

    async close() {
      if (closed) return;
      closed = true;
      for (const job of queue.splice(0)) job.reject(errors.closed());
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
