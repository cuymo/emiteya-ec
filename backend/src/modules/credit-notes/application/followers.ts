// Ciclo de vida de la capacidad acreditable (add-credit-notes, design D7 y D25): un seguidor de las
// transiciones del comprobante, en la misma transacción que la transición de la nota. Al entrar en
// `AUTHORIZED`, la reserva pasa a aplicada; en `RETURNED` o `NOT_AUTHORIZED`, se libera; en cualquier
// otro estado, nada. Un resultado incierto, un job detenido, un error de transporte o del parser, los
// reintentos agotados o una caída no son transiciones terminales: la capacidad sigue reservada y no
// existe un proceso que la libere por antigüedad. La actualización guardada por estado hace que una
// repetición no aplique ni libere dos veces. Para una factura, no hay reserva y no cambia nada.
import type { DbClient } from "../../../platform/db/database.ts";
import type { DocumentTransitionFollower } from "../../fiscal/application/document-transitions.ts";
import type { CreditCapacityRepository, CreditOutcome } from "./ports.ts";

const OUTCOMES: Partial<Record<string, CreditOutcome>> = {
  AUTHORIZED: "APPLIED",
  RETURNED: "RELEASED",
  NOT_AUTHORIZED: "RELEASED",
};

export function creditCapacityFollower(
  deps: Readonly<{ capacity: (db: DbClient) => CreditCapacityRepository }>,
): DocumentTransitionFollower {
  return async (db, event) => {
    const outcome = OUTCOMES[event.to];
    if (!outcome) return;
    await deps.capacity(db).conclude(event.companyId, event.documentId, outcome, event.at);
  };
}
