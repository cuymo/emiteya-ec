// Datos de prueba de la liquidación de compra con la forma exacta de los contratos
// (add-purchase-settlements, design D20 y D21), para las pruebas de componente de la bandeja, el
// detalle, la lista y el borrador.
import {
  PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY,
  PURCHASE_SETTLEMENT_STATEMENTS,
  PURCHASE_SETTLEMENT_STATEMENT_TEXTS,
  PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
} from "@facturador/contracts";

export const SETTLEMENT_KEY = "0710202603179001234500110010010000000031234567813";

export const SETTLEMENT_TRANSMISSION = {
  inProgress: false,
  stopped: null,
  reconcilable: false,
  authorization: null,
  lastResult: null,
};

const tax = (
  rateCode: string,
  percentage: string,
  label: string,
  base: string,
  amount: string,
) => ({
  taxCode: "2" as const,
  rateCode,
  rateKind: "PERCENTAGE" as const,
  percentage,
  label,
  base,
  amount,
});

export const settlementDetail = (
  state: string,
  transmission: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) => ({
  id: "lc-1",
  documentType: "03",
  environment: "TEST",
  documentNumber: "001-001-000000003",
  accessKey: SETTLEMENT_KEY,
  issueDate: "2026-10-07",
  state,
  issuer: {
    ruc: "1790012345001",
    legalName: "EMPRESA DE PRUEBA S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    establishmentAddress: "Av. 6 de Diciembre, Quito",
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: null,
    rimpeCategory: null,
  },
  supplier: {
    partyId: "prov-1",
    identificationType: "05",
    identification: "0102030405",
    legalName: "María Quishpe",
    address: "Comunidad San Pablo, Cayambe",
  },
  eligibility: {
    case: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.case,
    policy: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.id,
    rule: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.rule,
    policyVersion: 1,
    declarations: PURCHASE_SETTLEMENT_STATEMENTS.map((statementId) => ({
      statementId,
      text: PURCHASE_SETTLEMENT_STATEMENT_TEXTS[statementId],
      policyVersion: 1,
      basis: "USER_DECLARED",
      declaredBy: "usr-op",
      declaredByName: "Óscar Operador",
      declaredAt: "2026-10-07T15:00:00.000Z",
    })),
  },
  lines: [
    {
      position: 1,
      productId: "prod-1",
      mainCode: "CAC-01",
      auxiliaryCode: null,
      description: "Saco de cacao en grano, 45 kg",
      unit: "saco",
      quantity: "10",
      unitPrice: "4.5",
      discount: "5.00",
      taxableBase: "40.00",
      tax: tax("4", "15", "15%", "40.00", "6.00"),
    },
    {
      position: 2,
      productId: null,
      mainCode: null,
      auxiliaryCode: null,
      description: "Jornal de cosecha",
      unit: null,
      quantity: "2",
      unitPrice: "30",
      discount: "0.00",
      taxableBase: "60.00",
      tax: tax("0", "0", "0%", "60.00", "0.00"),
    },
  ],
  totals: {
    withoutTaxes: "100.00",
    discount: "5.00",
    taxes: [tax("0", "0", "0%", "60.00", "0.00"), tax("4", "15", "15%", "40.00", "6.00")],
    total: "106.00",
  },
  payments: [
    {
      position: 1,
      code: "01",
      label: "SIN UTILIZACION DEL SISTEMA FINANCIERO",
      total: "50.00",
      term: "0",
      timeUnit: "días",
    },
    {
      position: 2,
      code: "20",
      label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
      total: "56.00",
      term: "30",
      timeUnit: "días",
    },
  ],
  currency: "DOLAR",
  calculationVersion: "purchase-settlement-amounts-1",
  withholdingNotice: PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
  diagnostic: null,
  artifact: state === "RESERVED" ? null : { sha256: "a".repeat(64), sizeBytes: 9876 },
  authorizedArtifact: state === "AUTHORIZED" ? { sha256: "b".repeat(64), sizeBytes: 10234 } : null,
  transmission: { ...SETTLEMENT_TRANSMISSION, ...transmission },
  createdAt: "2026-10-07T15:00:00.000Z",
  signedAt: state === "RESERVED" ? null : "2026-10-07T15:00:01.000Z",
  ...overrides,
});

export const settlementSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "lc-1",
  documentNumber: "001-001-000000003",
  environment: "TEST",
  issueDate: "2026-10-07",
  supplierIdentification: "0102030405",
  supplierName: "María Quishpe",
  total: "106.00",
  state: "AUTHORIZED",
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: "2026-10-07T15:00:00.000Z",
  ...overrides,
});
