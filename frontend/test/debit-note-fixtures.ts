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

const IVA15 = { key: "2:4", taxCode: "2", rateCode: "4", percentage: "15", label: "IVA 15 %" };
const IVA0 = { key: "2:0", taxCode: "2", rateCode: "0", percentage: "0", label: "IVA 0 %" };

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
