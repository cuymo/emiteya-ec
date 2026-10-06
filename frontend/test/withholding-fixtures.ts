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
