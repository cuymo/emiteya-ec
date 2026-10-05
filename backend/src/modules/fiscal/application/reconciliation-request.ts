// Solicitud de reconciliación manual compartida por tipo (add-sri-transmission, design D15 y D19;
// add-credit-notes, design D2): con el comprobante bloqueado, comprueba su estado, encola un
// `sri.reconcile` manual y audita la solicitud en la misma transacción. Cada módulo expone su ruta,
// su permiso, sus errores y su acción de auditoría; un rechazo no deja job ni evento.
import type { AuditAction, AuditChanges } from "../../audit/domain/audit-event.ts";
import { RECONCILABLE_STATES } from "../domain/transmission.ts";
import type { StoredDocument } from "./ports.ts";
import { enqueueReconciliationIn } from "./transmission-jobs.ts";
import type { ReconciliationRequestScope } from "./transmission-ports.ts";

export type ReconciliationRequestInput = Readonly<{
  companyId: string;
  documentId: string;
  userId: string;
  reason: string;
  correlationId: string;
  runAt: Date;
  windowMs: number;
  /** Auditoría de la solicitud del tipo, con el comprobante bloqueado. */
  audit(current: StoredDocument): Readonly<{ action: AuditAction; changes: AuditChanges }>;
}>;

export type ReconciliationRequestOutcome =
  | Readonly<{ outcome: "REQUESTED"; document: StoredDocument }>
  | Readonly<{ outcome: "NOT_RECONCILABLE" }>
  | Readonly<{ outcome: "IN_PROGRESS" }>;

export async function requestReconciliationIn(
  scope: ReconciliationRequestScope,
  input: ReconciliationRequestInput,
): Promise<ReconciliationRequestOutcome> {
  const current = await scope.lockDocument(input.companyId, input.documentId);
  if (!current || !RECONCILABLE_STATES.has(current.state)) return { outcome: "NOT_RECONCILABLE" };
  const enqueued = await enqueueReconciliationIn(scope.jobs, scope.db, current, {
    origin: "MANUAL",
    requestedBy: input.userId,
    reason: input.reason,
    correlationId: input.correlationId,
    runAt: input.runAt,
    windowMs: input.windowMs,
  });
  if (!enqueued) return { outcome: "IN_PROGRESS" };
  await scope.audit.append({
    companyId: input.companyId,
    actor: { type: "USER", userId: input.userId },
    ...input.audit(current),
    correlationId: input.correlationId,
  });
  return { outcome: "REQUESTED", document: current };
}
