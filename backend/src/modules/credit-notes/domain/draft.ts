// Borrador de una nota de crédito (add-credit-notes, design D5): la factura que modifica, la causa,
// el motivo, el punto y, por línea de la factura, la cantidad acreditada y el retorno físico. No
// reserva capacidad ni número; un borrador emitido no cambia.
import type { CreditNoteCause } from "@facturador/contracts";

export type CreditNoteDraftStatus = "DRAFT" | "EMITTED";

/** Línea del borrador: en una anulación total la cantidad es la original y no se elige. */
export type CreditNoteDraftLine = Readonly<{
  position: number;
  quantity?: string;
  physicalReturn: string;
}>;

/** Contenido que guarda una alta o una corrección, ya validado por el contrato. */
export type CreditNoteDraftContent = Readonly<{
  emissionPointId: string | null;
  cause: CreditNoteCause;
  reason: string | null;
  lines: readonly CreditNoteDraftLine[];
}>;

export type CreditNoteDraftRecord = CreditNoteDraftContent &
  Readonly<{
    id: string;
    companyId: string;
    invoiceId: string;
    status: CreditNoteDraftStatus;
    documentId: string | null;
    version: number;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
  }>;
