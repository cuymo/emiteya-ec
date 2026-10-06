// Borrador de un comprobante de retención (add-withholding-receipts, design D4 a D6 y D21): el
// proveedor, la parte relacionada, el período, el punto y los documentos sustento con sus impuestos,
// sus pagos y sus retenciones. Puede guardarse incompleto; no reserva número ni calcula nada que se
// guarde. Un borrador emitido no cambia.

export type WithholdingDraftStatus = "DRAFT" | "EMITTED";

/** Impuesto declarado del documento sustento: cada campo puede faltar mientras se prepara. */
export type DraftSupportTax = Readonly<{
  tax: string | null;
  rateEntryKey: string | null;
  /** Solo para ICE e IRBPNR: la tarifa del IVA sale del catálogo. */
  rate: string | null;
  base: string | null;
  amount: string | null;
}>;

export type DraftSupportPayment = Readonly<{
  paymentMethod: string | null;
  total: string | null;
}>;

/** Retención del documento: el impuesto, la entrada de su catálogo y la base, nada más. */
export type DraftWithholdingItem = Readonly<{
  tax: string | null;
  entryKey: string | null;
  base: string | null;
}>;

export type DraftSupport = Readonly<{
  documentType: string | null;
  supportCode: string | null;
  number: string | null;
  issueDate: string | null;
  authorizationNumber: string | null;
  totalWithoutTaxes: string | null;
  importTotal: string | null;
  taxes: readonly DraftSupportTax[];
  payments: readonly DraftSupportPayment[];
  withholdings: readonly DraftWithholdingItem[];
}>;

/** Contenido que guarda una alta o una corrección, ya validado por el contrato. */
export type WithholdingDraftContent = Readonly<{
  partyId: string | null;
  relatedParty: "SI" | "NO" | null;
  fiscalPeriod: string | null;
  emissionPointId: string | null;
  supports: readonly DraftSupport[];
}>;

export type WithholdingDraftRecord = WithholdingDraftContent &
  Readonly<{
    id: string;
    companyId: string;
    status: WithholdingDraftStatus;
    documentId: string | null;
    version: number;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
  }>;
