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

const POLICY = {
  id: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.id,
  rule: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.rule,
  case: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.case,
  version: 1,
  source: "Reglamento de Comprobantes de Venta, art. 13, letra c)",
  statements: PURCHASE_SETTLEMENT_STATEMENTS.map((id) => ({
    id,
    text: PURCHASE_SETTLEMENT_STATEMENT_TEXTS[id],
  })),
};

export const SETTLEMENT_OPTIONS = {
  evaluatedOn: "2026-10-07",
  limits: { lines: 100, payments: 10 },
  policy: POLICY,
  withholdingNotice: PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
  currency: "DOLAR",
  ivaRates: [
    { entryKey: "0", code: "0", label: "0%", rateKind: "PERCENTAGE", percentage: "0" },
    { entryKey: "4", code: "4", label: "15%", rateKind: "PERCENTAGE", percentage: "15" },
    {
      entryKey: "6",
      code: "6",
      label: "No objeto de IVA",
      rateKind: "NOT_SUBJECT",
      percentage: "0",
    },
  ],
  paymentMethods: [
    { entryKey: "01", code: "01", label: "SIN UTILIZACION DEL SISTEMA FINANCIERO" },
    { entryKey: "20", code: "20", label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO" },
  ],
};

export const SUPPLIER_VIEW = {
  id: "prov-1",
  identificationType: "05",
  identification: "0102030405",
  legalName: "María Quishpe",
  address: "Comunidad San Pablo, Cayambe",
  selectable: true,
  reason: null,
};

/** Borrador completo y sin problemas: dos líneas y dos pagos que suman el importe total. */
export const settlementDraft = (overrides: Record<string, unknown> = {}) => ({
  id: "lcd-1",
  version: 3,
  emissionPoint: { id: "pto-1", establishmentCode: "001", code: "001", available: true },
  supplier: SUPPLIER_VIEW,
  supplierAddress: "Comunidad San Pablo, Cayambe",
  lines: [
    {
      productId: "prod-1",
      productName: "Cacao en grano",
      mainCode: "CAC-01",
      auxiliaryCode: null,
      description: "Saco de cacao en grano, 45 kg",
      unit: "saco",
      quantity: "10",
      unitPrice: "4.50",
      discount: "5.00",
      ivaRate: "4",
    },
    {
      productId: null,
      productName: null,
      mainCode: null,
      auxiliaryCode: null,
      description: "Jornal de cosecha",
      unit: null,
      quantity: "2",
      unitPrice: "30.00",
      discount: "0",
      ivaRate: "0",
    },
  ],
  payments: [
    { paymentMethod: "01", total: "50.00", term: "0", timeUnit: "días" },
    { paymentMethod: "20", total: "56.00", term: "30", timeUnit: "días" },
  ],
  preview: {
    evaluatedOn: "2026-10-07",
    calculationVersion: "purchase-settlement-amounts-1",
    supplier: {
      identificationType: "05",
      identification: "0102030405",
      legalName: "María Quishpe",
    },
    lines: [
      {
        position: 1,
        subtotal: "45.00",
        discount: "5.00",
        taxableBase: "40.00",
        tax: tax("4", "15", "15%", "40.00", "6.00"),
      },
      {
        position: 2,
        subtotal: "60.00",
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
    paymentsTotal: "106.00",
    policy: POLICY,
    withholdingNotice: PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
    issues: [],
  },
  createdAt: "2026-10-07T14:00:00.000Z",
  createdBy: "usr-op",
  updatedAt: "2026-10-07T14:30:00.000Z",
  updatedBy: "usr-op",
  ...overrides,
});

/** Un borrador recién creado: sin proveedor, con una línea y un pago vacíos que el usuario llena. */
export const emptySettlementDraft = () => {
  const base = settlementDraft();
  return settlementDraft({
    version: 1,
    supplier: null,
    supplierAddress: null,
    lines: [],
    payments: [],
    preview: {
      ...base.preview,
      supplier: null,
      lines: [],
      totals: null,
      paymentsTotal: null,
      issues: [
        {
          code: "PURCHASE_SETTLEMENT_SUPPLIER_REQUIRED",
          message: "Elige el proveedor.",
          field: "supplierPartyId",
          line: null,
          payment: null,
        },
        {
          code: "PURCHASE_SETTLEMENT_LINES_REQUIRED",
          message: "La liquidación necesita al menos una línea.",
          field: "lines",
          line: null,
          payment: null,
        },
      ],
    },
  });
};
