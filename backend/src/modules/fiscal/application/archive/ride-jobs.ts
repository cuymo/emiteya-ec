// Job del RIDE (add-document-archive, design D5): `document.render_ride`, deduplicado por
// comprobante. Nace con la autorización, por el seguidor de las transiciones que compone el
// arranque: la transmisión no lo conoce. El barrido es solo la defensa secundaria.
import type { BackoffPolicy, JobStore, NewJob } from "../../../../platform/jobs/jobs.ts";
import type { DocumentTransitionFollower } from "../document-transitions.ts";

export const RIDE_JOB_TYPE = "document.render_ride";
/** Prefijo de los jobs del archivo documental: los toma su propio runner. */
export const DOCUMENT_JOB_PREFIX = "document.";

export const rideDedupeKey = (documentId: string) => `${RIDE_JOB_TYPE}:${documentId}`;

/** Configuración operativa del job del RIDE (variables `RIDE_*`). */
export type RideJobSettings = Readonly<{
  maxAttempts: number;
  backoff: BackoffPolicy;
}>;

/** Reintentos con backoff exponencial y jitter: de 1 s a 10 min. */
export const RIDE_BACKOFF: BackoffPolicy = { baseMs: 10_000, capMs: 600_000, minMs: 1_000 };

type DocumentRef = Readonly<{ id: string; companyId: string }>;

export function rideJob(
  document: DocumentRef,
  settings: RideJobSettings,
  now: Date,
  manual?: Readonly<{ requestedBy: string }>,
): NewJob {
  return {
    companyId: document.companyId,
    type: RIDE_JOB_TYPE,
    dedupeKey: rideDedupeKey(document.id),
    documentId: document.id,
    runAt: now,
    maxAttempts: settings.maxAttempts,
    ...(manual ? { origin: "MANUAL" as const, requestedBy: manual.requestedBy } : {}),
  };
}

/**
 * Seguidor de las transiciones: al llegar a `AUTHORIZED`, encola el RIDE en la misma transacción.
 * Si ya hay un job activo con su clave, la garantía ya se cumple.
 */
export function rideFollower(
  deps: Readonly<{ jobs: Pick<JobStore, "enqueueIn">; settings: RideJobSettings }>,
): DocumentTransitionFollower {
  return async (db, event) => {
    if (event.to !== "AUTHORIZED") return;
    await deps.jobs.enqueueIn(
      db,
      rideJob({ id: event.documentId, companyId: event.companyId }, deps.settings, event.at),
    );
  };
}
