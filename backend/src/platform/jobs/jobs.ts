// Cola durable propia en PostgreSQL (ADR 0012, design D5 de add-sri-transmission): tipos del job,
// del error tipado y el backoff exponencial con jitter completo. No conoce el SRI ni ningún módulo.

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
