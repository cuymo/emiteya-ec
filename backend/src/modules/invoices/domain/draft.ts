// Borrador de factura (add-invoice-emission, design D2): un recurso editable, sin número ni clave,
// que guarda referencias e importes de entrada. No guarda precio: la línea toma el del producto al
// emitir (Q-45). Un borrador emitido no cambia.

export type DraftStatus = "DRAFT" | "EMITTED";

export type DraftLine = Readonly<{
  position: number;
  productId: string;
  quantity: string;
  discount: string;
}>;

export type DraftPayment = Readonly<{
  position: number;
  /** Entrada del catálogo `payment-method`. */
  paymentMethod: string;
  /** Sin importe, una única forma de pago cubre el importe total. */
  amount: string | null;
}>;

export type DraftRecord = Readonly<{
  id: string;
  companyId: string;
  status: DraftStatus;
  documentId: string | null;
  version: number;
  emissionPointId: string | null;
  buyerPartyId: string | null;
  lines: readonly DraftLine[];
  payments: readonly DraftPayment[];
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}>;

/** Contenido que guarda una alta o una corrección, ya validado por el contrato. */
export type DraftContent = Readonly<{
  emissionPointId: string | null;
  buyerPartyId: string | null;
  lines: readonly Readonly<{ productId: string; quantity: string; discount: string }>[];
  payments: readonly Readonly<{ paymentMethod: string; amount: string | null }>[];
}>;
