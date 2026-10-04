// Configuración del RIDE desde el entorno (add-document-archive, design D6): pool propio, intentos
// y backoff de su job, arriendo del runner y barrido. Configuración operativa, no normativa.
import {
  RIDE_BACKOFF,
  type RideJobSettings,
} from "../modules/fiscal/infrastructure/archive/index.ts";
import type { Env } from "./env.ts";

/** Margen del arriendo sobre lo que puede tardar un render, para que nunca venza en curso. */
const LEASE_MARGIN_MS = 30_000;
/** Sondeo del runner del RIDE sin trabajo, con el jitter de ±50 % del runner. */
const RIDE_POLL_INTERVAL_MS = 2_000;

export type RideSettings = Readonly<{
  job: RideJobSettings;
  workers: number;
  queue: number;
  taskTimeoutMs: number;
  /** Cubre la espera de la cola del pool y el render: `(cola + 1) × plazo + margen`. */
  leaseMs: number;
  pollIntervalMs: number;
  sweepIntervalMs: number;
}>;

export function rideSettingsFromEnv(env: Env): RideSettings {
  return {
    job: { maxAttempts: env.RIDE_JOB_MAX_ATTEMPTS, backoff: RIDE_BACKOFF },
    workers: env.RIDE_WORKERS,
    queue: env.RIDE_QUEUE,
    taskTimeoutMs: env.RIDE_TASK_TIMEOUT_MS,
    leaseMs: (env.RIDE_QUEUE + 1) * env.RIDE_TASK_TIMEOUT_MS + LEASE_MARGIN_MS,
    pollIntervalMs: RIDE_POLL_INTERVAL_MS,
    sweepIntervalMs: env.RIDE_SWEEP_INTERVAL_SECONDS * 1_000,
  };
}
