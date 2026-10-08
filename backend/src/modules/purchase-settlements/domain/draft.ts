// Borrador de una liquidación de compra (add-purchase-settlements, design D5, D6, D9 y D12): el punto,
// el proveedor con su dirección, las líneas (producto opcional o libre) y los pagos con su plazo y su
// unidad de tiempo. Puede guardarse incompleto; no reserva número ni guarda importes calculados. Un
// borrador emitido no cambia.

export type PurchaseSettlementDraftStatus = "DRAFT" | "EMITTED";

/** Línea del borrador: cada campo puede faltar mientras se prepara, salvo el descuento (0). */
export type DraftLine = Readonly<{
  productId: string | null;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  discount: string;
  /** Clave de la entrada del catálogo `iva-rate`. */
  ivaRate: string | null;
}>;

export type DraftPayment = Readonly<{
  paymentMethod: string | null;
  total: string | null;
  term: string | null;
  timeUnit: string | null;
}>;

/** Contenido que guarda una alta o una corrección, ya validado por el contrato. */
export type PurchaseSettlementDraftContent = Readonly<{
  emissionPointId: string | null;
  supplierPartyId: string | null;
  supplierAddress: string | null;
  lines: readonly DraftLine[];
  payments: readonly DraftPayment[];
}>;

export type PurchaseSettlementDraftRecord = PurchaseSettlementDraftContent &
  Readonly<{
    id: string;
    companyId: string;
    status: PurchaseSettlementDraftStatus;
    documentId: string | null;
    version: number;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
  }>;
