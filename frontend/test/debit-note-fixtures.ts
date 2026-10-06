// Datos de prueba de la nota de débito con la forma exacta de los contratos (add-debit-notes, design
// D20), para las pruebas de componente de la bandeja, el detalle y el borrador.
import { DEBIT_NOTE_ELIGIBILITY_DECLARATION } from "@facturador/contracts";

export const DEBIT_NOTE_KEY = "0910202605179001234500120010010000000031234567815";

export const DEBIT_NOTE_TRANSMISSION = {
  inProgress: false,
  stopped: null,
  reconcilable: false,
  authorization: null,
  lastResult: null,
};

const IVA15 = { key: "2:4", taxCode: "2", rateCode: "4", percentage: "15", label: "15%" };
const IVA0 = { key: "2:0", taxCode: "2", rateCode: "0", percentage: "0", label: "0%" };

export const debitNoteDetail = (
  state: string,
  transmission: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) => ({
  id: "nd-1",
  documentType: "05",
  environment: "TEST",
  documentNumber: "001-001-000000003",
  accessKey: DEBIT_NOTE_KEY,
  issueDate: "2026-10-09",
  state,
  invoice: {
    id: "inv-1",
    documentNumber: "001-001-000000001",
    issueDate: "2026-10-01",
    accessKey: "0110202601179001234500120010010000000011234567814",
    authorizationNumber: "0110202601179001234500120010010000000011234567814",
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
  concepts: [
    {
      position: 1,
      cause: "LATE_PAYMENT_INTEREST",
      description: "Intereses por 30 días de mora",
      amount: "20.00",
      taxTreatment: IVA15,
    },
    {
      position: 2,
      cause: "POST_INVOICE_COST_EXPENSE",
      description: "Flete posterior a la venta",
      amount: "5.00",
      taxTreatment: IVA0,
    },
  ],
  totals: {
    withoutTaxes: "25.00",
    taxes: [
      { ...IVA0, base: "5.00", amount: "0.00" },
      { ...IVA15, base: "20.00", amount: "3.00" },
    ],
    total: "28.00",
  },
  payment: {
    entryKey: "20",
    code: "20",
    label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
    amount: "28.00",
  },
  declarations: {
    version: DEBIT_NOTE_ELIGIBILITY_DECLARATION.version,
    statements: DEBIT_NOTE_ELIGIBILITY_DECLARATION.statements.map(({ id, text, source }) => ({
      id,
      text,
      source,
    })),
    basis: "USER_DECLARED",
    declaredBy: "usr-op",
    declaredByName: "Óscar Operador",
    declaredAt: "2026-10-09T15:00:00.000Z",
  },
  diagnostic: null,
  artifact: { sha256: "a".repeat(64), sizeBytes: 4096 },
  authorizedArtifact: null,
  transmission: { ...DEBIT_NOTE_TRANSMISSION, ...transmission },
  createdAt: "2026-10-09T15:00:00.000Z",
  signedAt: "2026-10-09T15:00:01.000Z",
  ...overrides,
});

export const debitNoteSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "nd-1",
  documentNumber: "001-001-000000003",
  environment: "TEST",
  issueDate: "2026-10-09",
  invoice: { id: "inv-1", documentNumber: "001-001-000000001" },
  causes: ["LATE_PAYMENT_INTEREST", "POST_INVOICE_COST_EXPENSE"],
  buyerIdentification: "0992877878001",
  buyerName: "EL PERNO CIA. LTDA.",
  total: "28.00",
  state: "AUTHORIZED",
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: "2026-10-09T15:00:00.000Z",
  ...overrides,
});

export const debitNoteDraftSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "ndd-1",
  version: 1,
  invoice: { id: "inv-1", documentNumber: "001-001-000000001", issueDate: "2026-10-01" },
  buyerName: "EL PERNO CIA. LTDA.",
  conceptCount: 2,
  previewTotal: "28.00",
  updatedAt: "2026-10-09T15:00:00.000Z",
  ...overrides,
});

const TREATMENTS = [IVA0, IVA15];

export const debitNoteDraft = (overrides: Record<string, unknown> = {}) => ({
  id: "ndd-1",
  version: 1,
  invoice: {
    id: "inv-1",
    documentNumber: "001-001-000000001",
    issueDate: "2026-10-01",
    buyerIdentification: "0992877878001",
    buyerName: "EL PERNO CIA. LTDA.",
    total: "66.00",
  },
  emissionPoint: { id: "ep-1", establishmentCode: "001", code: "001", available: true },
  paymentMethod: "20",
  concepts: [
    {
      position: 1,
      cause: "LATE_PAYMENT_INTEREST",
      description: "Intereses por 30 días de mora",
      amount: "20.00",
      taxTreatment: "2:4",
    },
    {
      position: 2,
      cause: "POST_INVOICE_COST_EXPENSE",
      description: "Flete posterior a la venta",
      amount: "5.00",
      taxTreatment: "2:0",
    },
  ],
  preview: {
    evaluatedOn: "2026-10-09",
    taxTreatments: TREATMENTS,
    totals: {
      withoutTaxes: "25.00",
      taxes: [
        { ...IVA0, base: "5.00", amount: "0.00" },
        { ...IVA15, base: "20.00", amount: "3.00" },
      ],
      total: "28.00",
    },
    payment: {
      entryKey: "20",
      code: "20",
      label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
      amount: "28.00",
    },
    issues: [],
  },
  createdAt: "2026-10-09T15:00:00.000Z",
  createdBy: "usr-op",
  updatedAt: "2026-10-09T15:00:00.000Z",
  updatedBy: "usr-op",
  ...overrides,
});

/** Una factura autorizada con dos tarifas, como la devuelve `GET /invoices/{id}`. */
export const authorizedInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  documentType: "01",
  environment: "TEST",
  documentNumber: "001-001-000000001",
  accessKey: "0110202601179001234500120010010000000011234567814",
  issueDate: "2026-10-01",
  state: "AUTHORIZED",
  issuer: debitNoteDetail("AUTHORIZED").issuer,
  buyer: {
    identificationType: "04",
    identification: "0992877878001",
    legalName: "EL PERNO CIA. LTDA.",
    address: "Guayaquil",
    consumerFinal: false,
  },
  lines: [],
  payments: [{ code: "20", amount: "66.00" }],
  totals: {
    withoutTaxes: "60.00",
    discount: "0.00",
    taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: "40.00", amount: "6.00" }],
    total: "66.00",
  },
  diagnostic: null,
  artifact: { sha256: "a".repeat(64), sizeBytes: 4096 },
  authorizedArtifact: { sha256: "b".repeat(64), sizeBytes: 5120 },
  transmission: {
    ...DEBIT_NOTE_TRANSMISSION,
    authorization: {
      number: "0110202601179001234500120010010000000011234567814",
      authorizedAt: "2026-10-01T15:00:05.000Z",
      environment: "TEST",
    },
  },
  createdAt: "2026-10-01T15:00:00.000Z",
  signedAt: "2026-10-01T15:00:01.000Z",
  ...overrides,
});

const paymentMethod = (code: string, officialLabel: string, usable: boolean) => {
  const version = {
    id: `pm-${code}`,
    officialLabel,
    effectiveFrom: "2016-06-01",
    effectiveFromBasis: "SOURCE_STATED",
    effectiveTo: null,
    normativeStatus: "OFFICIAL",
    sourceRef: "Ficha",
    datasetVersion: 1,
    rate: null,
    taxKind: null,
    identificationRule: null,
    withholding: null,
  };
  return {
    entryKey: code,
    code,
    versions: [version],
    applicable: version,
    enablement: { enabled: usable, source: usable ? "DEFAULT" : "COMPANY" },
    usable,
  };
};

/** Formas de pago del catálogo: dos utilizables y una deshabilitada para la empresa. */
export const PAYMENT_METHOD_ENTRIES = {
  catalog: {
    catalogType: "payment-method",
    datasetVersion: 1,
    source: {
      document: "Ficha",
      version: "2.34",
      publishedOn: "2026-07-27",
      url: "https://www.sri.gob.ec",
      sha256: "a".repeat(64),
    },
    enablementPolicy: "DEFAULT_ENABLED",
  },
  at: "2026-10-09",
  entries: [
    paymentMethod("01", "SIN UTILIZACIÓN DEL SISTEMA FINANCIERO", true),
    paymentMethod("19", "TARJETA DE CRÉDITO", false),
    paymentMethod("20", "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO", true),
  ],
};
