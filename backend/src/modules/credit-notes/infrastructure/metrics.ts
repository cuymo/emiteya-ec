// Métricas de las notas de crédito (add-credit-notes, design D20): reservas confirmadas por causa y
// rechazos por capacidad por motivo, sin empresa ni comprobante como etiqueta.
import { Counter, type Registry } from "@prometheus-io/client";
import type { CreditNoteEmissionObserver } from "../application/emission.ts";

export function registerCreditNoteMetrics(registry: Registry): CreditNoteEmissionObserver {
  const reservations = new Counter({
    name: "credit_note_reservations_total",
    help: "Notas de crédito reservadas, por causa.",
    labelNames: ["cause"] as const,
    registers: [registry],
  });
  const conflicts = new Counter({
    name: "credit_note_reservation_conflicts_total",
    help: "Notas de crédito rechazadas por capacidad, por motivo.",
    labelNames: ["reason"] as const,
    registers: [registry],
  });
  return {
    reserved: (cause) => reservations.inc({ cause }),
    conflict: (reason) => conflicts.inc({ reason }),
  };
}
