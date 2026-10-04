// Encolado de los jobs de la transmisión (add-sri-transmission, design D6 y D15). Cada job se
// encola dentro de la transacción que decide la fase siguiente; la deduplicación y la unicidad de
// una interacción activa por comprobante impiden dos jobs equivalentes a la vez.
import type { DbClient } from "../../../platform/db/database.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import { SRI_JOB_TYPES, sriDedupeKey } from "../domain/transmission.ts";
import type { StoredDocument } from "./ports.ts";

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

/** `sri.reconcile` del comprobante; false si ya hay una interacción activa con el SRI. */
export function enqueueReconciliationIn(
  jobs: Pick<JobStore, "enqueueIn">,
  db: DbClient,
  document: Pick<StoredDocument, "id" | "companyId">,
  input: ReconciliationJobInput,
): Promise<boolean> {
  return jobs.enqueueIn(db, {
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
  });
}
