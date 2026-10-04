// Encolado de los jobs de la transmisión (add-sri-transmission, design D6 y D15). Cada job se
// encola dentro de la transacción que decide la fase siguiente; la deduplicación y la unicidad de
// una interacción activa por comprobante impiden dos jobs equivalentes a la vez.
import type { DbClient } from "../../../platform/db/database.ts";
import type { JobStore, NewJob } from "../../../platform/jobs/jobs.ts";
import { SRI_JOB_TYPES, sriDedupeKey } from "../domain/transmission.ts";
import type { StoredDocument } from "./ports.ts";
import type { TransmissionSettings } from "./transmission-settings.ts";

/**
 * Intentos máximos de un job de consulta: su límite real es la ventana de conclusión (`deadline`),
 * y este tope solo impide un bucle sin fin si el reloj fallara.
 */
export const POLL_JOB_MAX_ATTEMPTS = 1_000;

export type ReconciliationJobInput = Readonly<{
  origin: "AUTOMATIC" | "MANUAL";
  /** Administrador que la pidió, en una reconciliación manual. */
  requestedBy?: string | null;
  reason?: string | null;
  /** `requestId` de la solicitud manual: la auditoría de la finalización lo usa (design D19). */
  correlationId?: string | null;
  runAt: Date;
  /** Ventana de conclusión: el job se detiene si no concluye antes. */
  windowMs: number;
}>;

type DocumentRef = Pick<StoredDocument, "id" | "companyId">;

/** `sri.transmit`: el envío, o un reenvío de los mismos bytes (design D6 y D15). */
export function transmitJob(
  document: DocumentRef,
  settings: TransmissionSettings,
  now: Date,
): NewJob {
  return {
    companyId: document.companyId,
    type: SRI_JOB_TYPES.transmit,
    dedupeKey: sriDedupeKey(SRI_JOB_TYPES.transmit, document.id),
    documentId: document.id,
    runAt: now,
    maxAttempts: settings.transmit.maxAttempts,
    deadlineAt: new Date(now.getTime() + settings.transmit.deadlineMs),
  };
}

/** `sri.authorize`: consultas tras la espera inicial, dentro de la ventana de conclusión. */
export function authorizeJob(
  document: DocumentRef,
  input: Readonly<{
    runAt: Date;
    deadlineAt: Date;
    origin?: "AUTOMATIC" | "MANUAL";
    requestedBy?: string | null;
    reason?: string | null;
    correlationId?: string | null;
  }>,
): NewJob {
  return {
    companyId: document.companyId,
    type: SRI_JOB_TYPES.authorize,
    dedupeKey: sriDedupeKey(SRI_JOB_TYPES.authorize, document.id),
    documentId: document.id,
    payload: input.correlationId ? { correlationId: input.correlationId } : {},
    runAt: input.runAt,
    maxAttempts: POLL_JOB_MAX_ATTEMPTS,
    deadlineAt: input.deadlineAt,
    origin: input.origin ?? "AUTOMATIC",
    requestedBy: input.requestedBy ?? null,
    reason: input.reason ?? null,
  };
}

/**
 * El `sri.transmit` inicial, en la transacción que firma (design D6): nunca hay un comprobante
 * firmado sin su job. False si ya tenía una interacción activa.
 */
export function enqueueTransmissionIn(
  scope: Readonly<{ db: DbClient; jobs: Pick<JobStore, "enqueueIn"> }>,
  document: DocumentRef,
  settings: TransmissionSettings,
  now: Date,
): Promise<boolean> {
  return scope.jobs.enqueueIn(scope.db, transmitJob(document, settings, now));
}

/** `sri.reconcile`: la reconciliación por clave, automática o pedida por el administrador. */
export function reconcileJob(document: DocumentRef, input: ReconciliationJobInput): NewJob {
  return {
    companyId: document.companyId,
    type: SRI_JOB_TYPES.reconcile,
    dedupeKey: sriDedupeKey(SRI_JOB_TYPES.reconcile, document.id),
    documentId: document.id,
    payload: input.correlationId ? { correlationId: input.correlationId } : {},
    runAt: input.runAt,
    maxAttempts: POLL_JOB_MAX_ATTEMPTS,
    deadlineAt: new Date(input.runAt.getTime() + input.windowMs),
    origin: input.origin,
    requestedBy: input.requestedBy ?? null,
    reason: input.reason ?? null,
  };
}

/** `sri.reconcile` del comprobante; false si ya hay una interacción activa con el SRI. */
export function enqueueReconciliationIn(
  jobs: Pick<JobStore, "enqueueIn">,
  db: DbClient,
  document: DocumentRef,
  input: ReconciliationJobInput,
): Promise<boolean> {
  return jobs.enqueueIn(db, reconcileJob(document, input));
}
