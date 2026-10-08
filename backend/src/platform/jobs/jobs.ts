// Cola durable propia en PostgreSQL (ADR 0012, design D5 de add-sri-transmission): tipos del job,
// del error tipado, el puerto del repositorio y el backoff exponencial con jitter completo. No
// conoce el SRI ni ningún módulo.
import type { DbClient } from "../db/database.ts";

export type JobStatus = "PENDING" | "LEASED" | "DONE" | "STOPPED";
export type JobErrorClass = "RETRYABLE" | "DETERMINISTIC" | "INTEGRITY";
export type JobOrigin = "AUTOMATIC" | "MANUAL";

export type Job = Readonly<{
  id: string;
  companyId: string;
  type: string;
  dedupeKey: string;
  documentId: string | null;
  payload: Readonly<Record<string, unknown>>;
  status: JobStatus;
  scheduledAt: Date;
  nextAttemptAt: Date;
  /** Veces que un worker lo tomó; incluye el arriendo en curso. */
  attemptCount: number;
  maxAttempts: number;
  deadlineAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorClass: JobErrorClass | null;
  origin: JobOrigin;
  requestedBy: string | null;
  reason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}>;

export type NewJob = Readonly<{
  companyId: string;
  type: string;
  dedupeKey: string;
  documentId?: string | null;
  payload?: Readonly<Record<string, unknown>>;
  runAt: Date;
  maxAttempts: number;
  deadlineAt?: Date | null;
  origin?: JobOrigin;
  requestedBy?: string | null;
  reason?: string | null;
}>;

/** Error guardado en el job: código estable, clase y un detalle seguro y acotado, sin secretos. */
export type JobError = Readonly<{
  code: string;
  errorClass: JobErrorClass;
  detail?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type BackoffPolicy = Readonly<{ baseMs: number; capMs: number; minMs: number }>;

/**
 * Espera antes del siguiente intento: jitter completo sobre un techo exponencial,
 * `random(0, min(cap, base·2^(n-1)))`, nunca por debajo del mínimo ni por encima del tope.
 */
export function backoffDelayMs(
  attempt: number,
  policy: BackoffPolicy,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.min(policy.capMs, Math.max(policy.minMs, Math.floor(random() * ceiling)));
}

export type ClaimRequest = Readonly<{
  owner: string;
  /** Tipos que este worker sabe ejecutar y no están pausados. */
  types: readonly string[];
  limit: number;
  leaseMs: number;
  now: Date;
}>;

export type JobStore = {
  /**
   * Inserta el job salvo que ya haya uno activo con su clave o, en los tipos exclusivos por
   * comprobante, otro activo del mismo comprobante. Devuelve si lo insertó.
   */
  enqueueIn(db: DbClient, job: NewJob): Promise<boolean>;
  /** Toma los `PENDING` vencidos y los `LEASED` con el arriendo vencido; incrementa los intentos. */
  claim(request: ClaimRequest): Promise<Job[]>;
  /** `DONE`. Sin el arriendo, lanza `LeaseLostError` y la transacción se revierte. */
  complete(db: DbClient, job: Job, now: Date): Promise<void>;
  /**
   * Vuelve a `PENDING` para `at`. Sin `consumeAttempt`, devuelve el intento tomado: una pausa
   * del circuit breaker o un apagado antes de llamar no gastan intentos. El plazo sigue corriendo.
   */
  reschedule(
    db: DbClient,
    job: Job,
    options: Readonly<{ at: Date; now: Date; consumeAttempt: boolean; error?: JobError }>,
  ): Promise<JobStatus>;
  /**
   * Fallo tipado: reintenta con backoff, o se detiene si el error no es reintentable o se agotan
   * los intentos o el plazo. Devuelve el estado resultante.
   */
  fail(
    db: DbClient,
    job: Job,
    error: JobError,
    options: Readonly<{ backoff: BackoffPolicy; now: Date; random?: () => number }>,
  ): Promise<JobStatus>;
  /** `STOPPED` con su motivo: queda visible hasta una decisión humana. */
  stop(db: DbClient, job: Job, error: JobError, now: Date): Promise<void>;
  /**
   * Extiende el arriendo vigente de este intento (add-data-portability, design D11). La identidad
   * del arriendo es el job, su dueño y su `attemptCount`, que `claim` incrementa en cada toma: un
   * intento obsoleto con el mismo dueño tampoco renueva. Sin arriendo vigente, `LeaseLostError`.
   */
  renew(db: DbClient, job: Job, options: Readonly<{ leaseMs: number; now: Date }>): Promise<Date>;
  /**
   * Comprueba, dentro de la transacción en curso, que este intento conserva el arriendo vigente y
   * bloquea la fila del job hasta el commit: `claim` (`SKIP LOCKED`) no puede tomarlo antes de
   * que la decisión final se confirme. Sin arriendo vigente, `LeaseLostError`.
   */
  fence(db: DbClient, job: Job, now: Date): Promise<void>;
  /** Vence los arriendos de un worker para que otro los retome (apagado ordenado). */
  release(owner: string, now: Date): Promise<number>;
};

/** El arriendo ya no es de este worker: su decisión no se confirma. */
export class LeaseLostError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super("el arriendo del job se perdió");
    this.name = "LeaseLostError";
    this.jobId = jobId;
  }
}

/**
 * Unicidad de una interacción activa por comprobante: la migración la ata a los tipos `sri.*`
 * (`active_sri_document_id`, design D5). Es el único conocimiento del tipo que tiene la cola.
 */
export const DOCUMENT_EXCLUSIVE_PREFIX = "sri.";
