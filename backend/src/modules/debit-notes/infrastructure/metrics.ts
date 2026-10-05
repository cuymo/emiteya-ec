// Métricas de las notas de débito (add-debit-notes, design D24): las reservas confirmadas y sus
// conceptos por causa, con las dos causas como únicos valores. Sin empresa ni comprobante como
// etiqueta. La transmisión, la autorización y el RIDE usan sus métricas vigentes.
import { Counter, type Registry } from "@prometheus-io/client";
import { DEBIT_NOTE_CAUSES } from "@facturador/contracts";
import type { DebitNoteEmissionObserver } from "../application/emission.ts";

export function registerDebitNoteMetrics(registry: Registry): DebitNoteEmissionObserver {
  const reservations = new Counter({
    name: "debit_note_reservations_total",
    help: "Notas de débito reservadas.",
    registers: [registry],
  });
  const concepts = new Counter({
    name: "debit_note_concepts_total",
    help: "Conceptos de las notas de débito reservadas, por causa.",
    labelNames: ["cause"] as const,
    registers: [registry],
  });
  const known = new Set<string>(DEBIT_NOTE_CAUSES);
  return {
    reserved(causes) {
      reservations.inc();
      for (const cause of causes) if (known.has(cause)) concepts.inc({ cause });
    },
  };
}
