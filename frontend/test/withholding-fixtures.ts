// Datos de prueba del comprobante de retención con la forma exacta de los contratos
// (add-withholding-receipts, design D20 y D24), para las pruebas de componente de la bandeja, el
// detalle, la lista y el borrador.

export const WITHHOLDING_KEY = "0610202607179001234500120010010000000041234567811";

export const WITHHOLDING_TRANSMISSION = {
  inProgress: false,
  stopped: null,
  reconcilable: false,
  authorization: null,
  lastResult: null,
};

export const withholdingDetail = (
  state: string,
  transmission: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) => ({
  id: "ret-1",
  documentType: "07",
  environment: "TEST",
  documentNumber: "001-001-000000004",
  accessKey: WITHHOLDING_KEY,
  issueDate: "2026-10-06",
  state,
  issuer: {
    ruc: "1790012345001",
    legalName: "EMPRESA DE PRUEBA S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    establishmentAddress: "Quito",
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: "1",
    rimpeCategory: null,
  },
  subject: {
    partyId: "prov-1",
    identificationType: "04",
    identification: "1791234567001",
    legalName: "PROVEEDORA DEL SUR S.A.",
  },
  relatedParty: {
    value: "NO",
    basis: "USER_DECLARED",
    declaredBy: "usr-op",
    declaredByName: "Óscar Operador",
    declaredAt: "2026-10-06T15:00:00.000Z",
  },
  fiscalPeriod: "10/2026",
  supports: [
    {
      position: 1,
      documentType: "01",
      documentTypeLabel: "Factura",
      supportCode: "01",
      supportCodeLabel:
        "Crédito Tributario para declaración de IVA (servicios y bienes distintos de inventarios y activos fijos)",
      number: "001001000000123",
      issueDate: "2026-10-01",
      authorizationNumber: "0110202601179123456700110010010000001231234567815",
      totalWithoutTaxes: "100.00",
      importTotal: "115.00",
      taxes: [
        {
          position: 1,
          tax: "2",
          taxLabel: "IVA",
          rateCode: "4",
          rateLabel: "15%",
          rate: "15",
          rateBasis: "CATALOG",
          base: "100.00",
          amount: "15.00",
        },
      ],
      payments: [
        {
          position: 1,
          code: "20",
          label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
          total: "115.00",
        },
      ],
      withholdings: [
        {
          position: 1,
          tax: "1",
          taxLabel: "RENTA",
          entryKey: "312",
          code: "312",
          label: "Transferencia de bienes muebles de naturaleza corporal",
          base: "100.00",
          percentage: "1.75",
          amount: "1.75",
        },
        {
          position: 2,
          tax: "2",
          taxLabel: "IVA",
          entryKey: "9",
          code: "9",
          label: "Retención del 10% del IVA",
          base: "15.00",
          percentage: "10",
          amount: "1.50",
        },
      ],
    },
  ],
  totals: { withheld: "3.25" },
  diagnostic: null,
  artifact: { sha256: "a".repeat(64), sizeBytes: 4096 },
  authorizedArtifact: null,
  transmission: { ...WITHHOLDING_TRANSMISSION, ...transmission },
  createdAt: "2026-10-06T15:00:00.000Z",
  signedAt: "2026-10-06T15:00:01.000Z",
  ...overrides,
});

export const withholdingSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "ret-1",
  documentNumber: "001-001-000000004",
  environment: "TEST",
  issueDate: "2026-10-06",
  fiscalPeriod: "10/2026",
  subjectIdentification: "1791234567001",
  subjectName: "PROVEEDORA DEL SUR S.A.",
  supportCount: 1,
  total: "3.25",
  state: "AUTHORIZED",
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: "2026-10-06T15:00:00.000Z",
  ...overrides,
});

export const withholdingDraftSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "retd-1",
  version: 2,
  partyName: "PROVEEDORA DEL SUR S.A.",
  fiscalPeriod: "10/2026",
  supportCount: 1,
  withholdingCount: 2,
  previewTotal: "3.25",
  updatedAt: "2026-10-06T15:00:00.000Z",
  ...overrides,
});

/** Opciones utilizables del borrador, con la forma de `withholdingOptionsViewSchema`. */
export const WITHHOLDING_OPTIONS = {
  evaluatedOn: "2026-10-06",
  limits: { supports: 10, itemsPerSupport: 5, taxesPerSupport: 5, paymentsPerSupport: 5 },
  withholdingTaxes: [
    { code: "1", label: "RENTA" },
    { code: "2", label: "IVA" },
  ],
  incomeConcepts: [
    {
      entryKey: "303",
      code: "303",
      label:
        "Honorarios profesionales y demás pagos por servicios relacionados con el título profesional",
      percentage: "10",
    },
    {
      entryKey: "312",
      code: "312",
      label: "Transferencia de bienes muebles de naturaleza corporal",
      percentage: "1.75",
    },
  ],
  ivaCodes: [
    {
      entryKey: "9",
      code: "9",
      label: "RETENCIÓN DEL IVA 10%",
      percentage: "10",
      sourceRef: "Tabla 20, página 33, retención del IVA",
    },
    {
      entryKey: "1",
      code: "1",
      label: "RETENCIÓN DEL IVA 30%",
      percentage: "30",
      sourceRef: "Tabla 20, página 33, retención del IVA",
    },
    {
      entryKey: "7",
      code: "7",
      label: "Retención en cero 0.00%",
      percentage: "0",
      sourceRef:
        "Tabla 20, página 33, retención en cero: *Aplica de conformidad con la Disposición Transitoria Única de la Resolución NAC-DGERCGC15-00000284.",
    },
  ],
  documentTypes: [
    {
      code: "01",
      label: "Factura",
      supportCodes: [
        { code: "01", label: "Crédito Tributario para declaración de IVA" },
        { code: "02", label: "Costo o Gasto para declaración de IR" },
      ],
    },
    {
      code: "02",
      label: "Nota o boleta de venta",
      supportCodes: [{ code: "02", label: "Costo o Gasto para declaración de IR" }],
    },
    {
      code: "03",
      label: "Liquidación de compra de Bienes o Prestación de servicios",
      supportCodes: [{ code: "01", label: "Crédito Tributario para declaración de IVA" }],
    },
  ],
  supportTaxes: [
    {
      tax: "2",
      label: "IVA",
      rates: [
        {
          entryKey: "0",
          code: "0",
          label: "0%",
          rateKind: "PERCENTAGE",
          percentage: "0",
          effectiveFrom: "2026-07-27",
          effectiveTo: null,
        },
        {
          entryKey: "4",
          code: "4",
          label: "15%",
          rateKind: "PERCENTAGE",
          percentage: "15",
          effectiveFrom: "2026-07-27",
          effectiveTo: null,
        },
      ],
    },
    {
      tax: "3",
      label: "ICE",
      rates: [
        {
          entryKey: "3011",
          code: "3011",
          label: "ICE Cigarrillos Rubios",
          rateKind: "PER_NORMATIVE",
          percentage: null,
          effectiveFrom: "2026-07-27",
          effectiveTo: null,
        },
      ],
    },
    {
      tax: "5",
      label: "IRBPNR",
      rates: [
        {
          entryKey: "5001",
          code: "5001",
          label: "IRBPNR",
          rateKind: "PER_UNIT",
          percentage: null,
          effectiveFrom: "2026-07-27",
          effectiveTo: null,
        },
      ],
    },
  ],
  paymentMethods: [
    { entryKey: "01", code: "01", label: "SIN UTILIZACIÓN DEL SISTEMA FINANCIERO" },
    { entryKey: "20", code: "20", label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO" },
  ],
};

const calculatedItem = (
  position: number,
  tax: string,
  code: string,
  label: string,
  base: string,
  percentage: string,
  amount: string,
) => ({ position, tax, entryKey: code, code, label, base, percentage, amount });

export const WITHHOLDING_PREVIEW = {
  evaluatedOn: "2026-10-06",
  issueMonth: "10/2026",
  periodDiffersFromIssueMonth: false,
  supports: [
    {
      position: 1,
      withholdings: [
        calculatedItem(
          1,
          "1",
          "312",
          "Transferencia de bienes muebles de naturaleza corporal",
          "100.00",
          "1.75",
          "1.75",
        ),
        calculatedItem(2, "2", "9", "RETENCIÓN DEL IVA 10%", "15.00", "10", "1.50"),
      ],
    },
  ],
  totals: { withheld: "3.25" },
  issues: [] as unknown[],
};

export const withholdingDraft = (overrides: Record<string, unknown> = {}) => ({
  id: "retd-1",
  version: 1,
  party: {
    id: "prov-1",
    identificationType: "04",
    identification: "1791234567001",
    legalName: "PROVEEDORA DEL SUR S.A.",
  },
  relatedParty: "NO",
  fiscalPeriod: "10/2026",
  emissionPoint: { id: "ep-1", establishmentCode: "001", code: "001", available: true },
  supports: [
    {
      documentType: "01",
      supportCode: "01",
      number: "001001000000123",
      issueDate: "2026-10-01",
      authorizationNumber: null,
      totalWithoutTaxes: "100.00",
      importTotal: "115.00",
      taxes: [{ tax: "2", rateEntryKey: "4", rate: null, base: "100.00", amount: "15.00" }],
      payments: [{ paymentMethod: "20", total: "115.00" }],
      withholdings: [
        { tax: "1", entryKey: "312", base: "100.00" },
        { tax: "2", entryKey: "9", base: "15.00" },
      ],
    },
  ],
  preview: WITHHOLDING_PREVIEW,
  createdAt: "2026-10-06T15:00:00.000Z",
  createdBy: "usr-op",
  updatedAt: "2026-10-06T15:00:00.000Z",
  updatedBy: "usr-op",
  ...overrides,
});
