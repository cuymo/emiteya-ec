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
