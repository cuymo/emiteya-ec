// Datos de prueba de la nota de crédito con la forma exacta de los contratos (add-credit-notes, design
// D16), para las pruebas de componente de la bandeja, el detalle y el borrador.
import { CREDIT_NOTE_ELIGIBILITY_DECLARATION } from "@facturador/contracts";

export const CREDIT_NOTE_KEY = "0410202604179001234500120010010000000071234567819";

export const CREDIT_NOTE_TRANSMISSION = {
  inProgress: false,
  stopped: null,
  reconcilable: false,
  authorization: null,
  lastResult: null,
};

const IVA15 = { taxCode: "2", rateCode: "4", percentage: "15", base: "10.00", amount: "1.50" };

export const creditNoteDetail = (
  state: string,
  transmission: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) => ({
  id: "nc-1",
  documentType: "04",
  environment: "TEST",
  documentNumber: "001-001-000000007",
  accessKey: CREDIT_NOTE_KEY,
  issueDate: "2026-10-04",
  state,
  cause: "RETURN",
  reason: "Devolución de mercadería",
  invoice: {
    id: "inv-1",
    documentNumber: "001-001-000000001",
    issueDate: "2026-10-01",
    accessKey: "0110202601179001234500120010010000000011234567814",
  },
  issuer: {
    ruc: "1790012345001",
    legalName: "EMPRESA DE PRUEBA S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    establishmentAddress: "Quito",
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: null,
    rimpeCategory: null,
  },
  buyer: {
    identificationType: "04",
    identification: "0992877878001",
    legalName: "EL PERNO CIA. LTDA.",
    address: null,
  },
  lines: [
    {
      position: 1,
      mainCode: "P-001",
      auxiliaryCode: null,
      description: "Perno de acero",
      quantity: "1",
      unitPrice: "10.00",
      discount: "0.00",
      taxableBase: "10.00",
      taxes: [IVA15],
      physicalReturn: "1",
    },
  ],
  totals: { withoutTaxes: "10.00", taxes: [IVA15], total: "11.50" },
  declarations: {
    version: CREDIT_NOTE_ELIGIBILITY_DECLARATION.version,
    statements: CREDIT_NOTE_ELIGIBILITY_DECLARATION.statements.map(({ id, text, source }) => ({
      id,
      text,
      source,
    })),
    basis: "USER_DECLARED",
    declaredBy: "usr-op",
    declaredByName: "Óscar Operador",
    declaredAt: "2026-10-04T15:00:00.000Z",
  },
  diagnostic: null,
  artifact: { sha256: "a".repeat(64), sizeBytes: 4096 },
  authorizedArtifact: null,
  transmission: { ...CREDIT_NOTE_TRANSMISSION, ...transmission },
  createdAt: "2026-10-04T15:00:00.000Z",
  signedAt: "2026-10-04T15:00:01.000Z",
  ...overrides,
});

const IVA0 = { taxCode: "2", rateCode: "0", percentage: "0", base: "20.00", amount: "0.00" };

/** Crédito de una factura con un bien que salió del inventario y un servicio. */
export const invoiceCredit = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: "inv-1",
  documentNumber: "001-001-000000001",
  issueDate: "2026-10-01",
  buyerIdentification: "0992877878001",
  buyerName: "EL PERNO CIA. LTDA.",
  consumerFinal: false,
  total: "66.00",
  applied: "0.00",
  reserved: "0.00",
  available: "66.00",
  totalAnnulmentAvailable: true,
  lines: [
    {
      position: 1,
      productId: "prod-1",
      mainCode: "P-001",
      description: "Perno de acero",
      quantity: "4",
      unitPrice: "10.00",
      discount: "0.00",
      taxableBase: "40.00",
      taxes: [{ ...IVA15, base: "40.00", amount: "6.00" }],
      inventoryAffectsStock: true,
      credited: { applied: "0", reserved: "0", available: "4" },
      returnable: { original: "4", applied: "0", reserved: "0", available: "4" },
    },
    {
      position: 2,
      productId: "prod-2",
      mainCode: "S-001",
      description: "Instalación",
      quantity: "1",
      unitPrice: "20.00",
      discount: "0.00",
      taxableBase: "20.00",
      taxes: [IVA0],
      inventoryAffectsStock: false,
      credited: { applied: "0", reserved: "0", available: "1" },
      returnable: null,
    },
  ],
  ...overrides,
});

export const CREDIT_NOTE_POINT = {
  id: "ep-1",
  establishmentCode: "001",
  code: "001",
  available: true,
};

/** Borrador guardado de una devolución de la línea 1, con su vista previa del servidor. */
export const creditNoteDraft = (overrides: Record<string, unknown> = {}) => ({
  id: "cnd-1",
  version: 1,
  invoice: {
    id: "inv-1",
    documentNumber: "001-001-000000001",
    issueDate: "2026-10-01",
    buyerIdentification: "0992877878001",
    buyerName: "EL PERNO CIA. LTDA.",
    total: "66.00",
  },
  emissionPoint: CREDIT_NOTE_POINT,
  cause: "RETURN",
  reason: "Devolución de mercadería",
  lines: [{ position: 1, quantity: "1", physicalReturn: "1" }],
  preview: {
    evaluatedOn: "2026-10-04",
    lines: [
      {
        position: 1,
        mainCode: "P-001",
        description: "Perno de acero",
        quantity: "1",
        unitPrice: "10.00",
        discount: "0.00",
        taxableBase: "10.00",
        taxes: [IVA15],
        physicalReturn: "1",
        physicalReturnAllowed: true,
        remainingQuantity: "3",
      },
    ],
    totals: { withoutTaxes: "10.00", taxes: [IVA15], total: "11.50" },
    issues: [],
  },
  createdAt: "2026-10-04T15:00:00.000Z",
  createdBy: "usr-op",
  updatedAt: "2026-10-04T15:00:00.000Z",
  updatedBy: "usr-op",
  ...overrides,
});

export const creditNoteSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "nc-1",
  documentNumber: "001-001-000000007",
  environment: "TEST",
  issueDate: "2026-10-04",
  invoice: { id: "inv-1", documentNumber: "001-001-000000001" },
  cause: "RETURN",
  buyerIdentification: "0992877878001",
  buyerName: "EL PERNO CIA. LTDA.",
  total: "11.50",
  state: "AUTHORIZED",
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: "2026-10-04T15:00:00.000Z",
  ...overrides,
});

export const creditNoteDraftSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "cnd-1",
  version: 1,
  invoice: { id: "inv-1", documentNumber: "001-001-000000001", issueDate: "2026-10-01" },
  cause: "RETURN",
  buyerName: "EL PERNO CIA. LTDA.",
  lineCount: 1,
  previewTotal: "11.50",
  updatedAt: "2026-10-04T15:00:00.000Z",
  ...overrides,
});
