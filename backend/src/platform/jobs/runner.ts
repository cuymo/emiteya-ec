// Runner de la cola durable (design D5): workers que sondean con jitter, un interruptor por prefijo
// de tipo y el apagado ordenado. Sin trabajo o con la base caída duerme; nunca da vueltas en caliente.
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { LeaseLostError, type BackoffPolicy, type Job, type JobStore } from "./jobs.ts";
import type { DbClient } from "../db/database.ts";

export type JobContext = Readonly<{
  /** Se aborta al pedir el apagado: el handler no empieza una llamada externa nueva. */
  signal: AbortSignal;
  now: () => Date;
}>;

/**
 * Ejecuta un job arrendado y confirma su decisión con el `JobStore` (completar, reprogramar,
 * fallar o detener), en la transacción que también guarda su efecto. Si lanza, el runner registra
 * un fallo reintentable con el backoff del handler.
 */
export type JobHandler = Readonly<{
  run: (job: Job, context: JobContext) => Promise<void>;
  backoff: BackoffPolicy;
}>;

export type JobRunnerOptions = Readonly<{
  store: JobStore;
  /** Cliente con el que el runner registra el fallo de un handler que lanzó. */
  db: DbClient;
  handlers: Readonly<Record<string, JobHandler>>;
  workers: number;
  pollIntervalMs: number;
  leaseMs: number;
  /** Prefijos de tipo pausados en este momento: sus jobs no se toman ni gastan intentos. */
  pausedPrefixes: () => readonly string[];
  logger: Pick<Logger, "info" | "warn" | "error">;
  /** Plazo de gracia del apagado para los jobs en curso. */
  graceMs?: number;
  now?: () => Date;
  random?: () => number;
}>;

export type JobRunner = {
  start: () => void;
  /** Deja de tomar trabajo, espera hasta el plazo de gracia y libera los arriendos pendientes. */
  close: () => Promise<void>;
  isRunning: () => boolean;
  /** Tipos que se tomarían ahora: los registrados menos los pausados. */
  activeTypes: () => string[];
};

export const DEFAULT_SHUTDOWN_GRACE_MS = 8_000;

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const { store, handlers, logger } = options;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const graceMs = options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const instance = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const stopping = new AbortController();
  const wakers = new Set<() => void>();
  let loops: Promise<void>[] = [];
  let started = false;

  const activeTypes = () => {
    const paused = options.pausedPrefixes();
    return Object.keys(handlers).filter((type) => !paused.some((p) => type.startsWith(p)));
  };

  /** Espera interrumpible por el apagado, con jitter de ±50 % para no sincronizar workers. */
  const sleep = () =>
    new Promise<void>((resolve) => {
      if (stopping.signal.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        wakers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.round(options.pollIntervalMs * (0.5 + random())));
      wakers.add(done);
    });

  async function execute(job: Job) {
    const handler = handlers[job.type]!;
    try {
      await handler.run(job, { signal: stopping.signal, now });
    } catch (error) {
      if (error instanceof LeaseLostError) {
        logger.warn(
          { jobId: job.id, type: job.type },
          "arriendo perdido; la decisión no se confirmó",
        );
        return;
      }
      logger.error({ jobId: job.id, type: job.type, err: error }, "el job falló");
      await store
        .fail(
          options.db,
          job,
          { code: "HANDLER_ERROR", errorClass: "RETRYABLE" },
          { backoff: handler.backoff, now: now(), random },
        )
        .catch((failure: unknown) => {
          if (!(failure instanceof LeaseLostError))
            logger.error({ jobId: job.id, err: failure }, "no se pudo registrar el fallo del job");
        });
    }
  }

  async function loop(owner: string) {
    while (!stopping.signal.aborted) {
      const types = activeTypes();
      if (types.length === 0) {
        await sleep();
        continue;
      }
      let jobs: Job[];
      try {
        jobs = await store.claim({ owner, types, limit: 1, leaseMs: options.leaseMs, now: now() });
      } catch (error) {
        logger.error({ err: error }, "no se pudo consultar la cola de jobs");
        await sleep();
        continue;
      }
      const job = jobs[0];
      if (!job) {
        await sleep();
        continue;
      }
      await execute(job);
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      loops = Array.from({ length: options.workers }, (_, index) => loop(`${instance}:w${index}`));
      logger.info({ workers: options.workers }, "runner de jobs iniciado");
    },

    async close() {
      if (stopping.signal.aborted) return;
      stopping.abort();
      for (const wake of [...wakers]) wake();
      let timer: NodeJS.Timeout | undefined;
      const grace = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), graceMs);
      });
      const result = await Promise.race([Promise.all(loops).then(() => "done" as const), grace]);
      clearTimeout(timer);
      if (result === "timeout") {
        const released = await Promise.all(
          Array.from({ length: options.workers }, (_, index) =>
            store.release(`${instance}:w${index}`, now()),
          ),
        );
        logger.warn(
          { released: released.reduce((sum, count) => sum + count, 0) },
          "plazo de gracia agotado; arriendos liberados",
        );
      }
    },

    isRunning: () => started && !stopping.signal.aborted,
    activeTypes,
  };
}
