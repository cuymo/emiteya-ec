// Borrador de una nota de débito (add-debit-notes, design D20): la factura que modifica, el punto,
// la única forma de pago (una clave del catálogo) y sus conceptos. Puede guardarse incompleto; no
// reserva número ni calcula nada que se guarde. Un borrador emitido no cambia.
import type { DebitNoteCause } from "@facturador/contracts";

export type DebitNoteDraftStatus = "DRAFT" | "EMITTED";

/** Concepto del borrador: cada campo puede faltar mientras se prepara. */
export type DebitNoteDraftConcept = Readonly<{
  cause: DebitNoteCause | null;
  description: string | null;
  amount: string | null;
  taxTreatment: string | null;
}>;

/** Contenido que guarda una alta o una corrección, ya validado por el contrato. */
export type DebitNoteDraftContent = Readonly<{
  emissionPointId: string | null;
  paymentMethod: string | null;
  concepts: readonly DebitNoteDraftConcept[];
}>;

export type DebitNoteDraftRecord = DebitNoteDraftContent &
  Readonly<{
    id: string;
    companyId: string;
    invoiceId: string;
    status: DebitNoteDraftStatus;
    documentId: string | null;
    version: number;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
  }>;
