// Datos de prueba de la guía de remisión con la forma exacta de los contratos (add-shipping-guides,
// design D21, D22 y D25), para las pruebas de componente de la bandeja, el detalle, la lista y el
// borrador.

export const GUIDE_KEY = "0610202606179001234500110010010000000051234567817";

export const GUIDE_TRANSMISSION = {
  inProgress: false,
  stopped: null,
  reconcilable: false,
  authorization: null,
  lastResult: null,
};

export const guideDetail = (
  state: string,
  transmission: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) => ({
  id: "gr-1",
  documentType: "06",
  environment: "TEST",
  documentNumber: "001-001-000000005",
  accessKey: GUIDE_KEY,
  issueDate: "2026-10-06",
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
  departure: {
    source: "ESTABLISHMENT",
    establishment: { id: "est-1", code: "001", address: "Av. 6 de Diciembre, Quito" },
    address: "Av. 6 de Diciembre, Quito",
  },
  transporter: {
    source: "PARTY",
    partyId: "car-1",
    identificationType: "04",
    identification: "1791111111001",
    legalName: "TRANSPORTES ANDINOS S.A.",
  },
  plate: "PAA-1234",
  transportStart: "2026-10-06",
  transportEnd: "2026-10-07",
  recipients: [
    {
      position: 1,
      kind: "PARTY",
      partyId: "cli-1",
      destinationEstablishment: null,
      identificationType: "04",
      identification: "0992877878001",
      legalName: "EL PERNO CIA. LTDA.",
      address: "Av. Quito y Guayaquil",
      motive: "Venta",
      route: "Quito - Guayaquil",
      destinationEstablishmentCode: null,
      support: {
        kind: "INTERNAL_INVOICE",
        invoice: {
          id: "inv-1",
          documentType: "01",
          documentNumber: "001-001-000000123",
          issueDate: "2026-10-05",
          authorizationNumber: "0510202601179001234500110010010000001231234567815",
        },
      },
      details: [
        {
          position: 1,
          productId: "prod-1",
          mainCode: "CEM-50",
          auxiliaryCode: null,
          description: "Cemento 50 kg",
          quantity: "10",
        },
      ],
    },
    {
      position: 2,
      kind: "OWN_COMPANY",
      partyId: null,
      destinationEstablishment: { id: "est-2", code: "002", address: "Bodega sur, Quito" },
      identificationType: "04",
      identification: "1790012345001",
      legalName: "EMPRESA DE PRUEBA S.A.",
      address: "Bodega sur, Quito",
      motive: "Reposición de bodega",
      route: null,
      destinationEstablishmentCode: "002",
      support: {
        kind: "DECLARED_EXCEPTION",
        declaration: {
          case: "OWN_ESTABLISHMENT_TRANSFER",
          literal: "d",
          label: "Traslado entre establecimientos propios",
          policyVersion: 1,
          basis: "USER_DECLARED",
          declaredBy: "usr-op",
          declaredByName: "Óscar Operador",
          declaredAt: "2026-10-06T15:00:00.000Z",
        },
      },
      details: [
        {
          position: 1,
          productId: null,
          mainCode: "VAR-12",
          auxiliaryCode: null,
          description: "Varilla 12 mm",
          quantity: "2.5",
        },
      ],
    },
  ],
  counts: { recipients: 2, details: 2 },
  diagnostic: null,
  artifact: state === "RESERVED" ? null : { sha256: "a".repeat(64), sizeBytes: 9876 },
  authorizedArtifact: state === "AUTHORIZED" ? { sha256: "b".repeat(64), sizeBytes: 10234 } : null,
  transmission: { ...GUIDE_TRANSMISSION, ...transmission },
  createdAt: "2026-10-06T15:00:00.000Z",
  signedAt: state === "RESERVED" ? null : "2026-10-06T15:00:01.000Z",
  ...overrides,
});

export const guideSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "gr-1",
  documentNumber: "001-001-000000005",
  environment: "TEST",
  issueDate: "2026-10-06",
  carrierName: "TRANSPORTES ANDINOS S.A.",
  recipients: { count: 2, name: null },
  transportStart: "2026-10-06",
  transportEnd: "2026-10-07",
  state: "AUTHORIZED",
  diagnosticCode: null,
  transmissionStopped: false,
  createdAt: "2026-10-06T15:00:00.000Z",
  ...overrides,
});

export const guideDraftSummary = (overrides: Record<string, unknown> = {}) => ({
  id: "grd-1",
  version: 2,
  carrierName: "TRANSPORTES ANDINOS S.A.",
  recipientCount: 2,
  detailCount: 3,
  transportStart: "2026-10-06",
  updatedAt: "2026-10-06T15:00:00.000Z",
  ...overrides,
});

/** Opciones del borrador, con la forma de `shippingGuideOptionsViewSchema`. */
export const SHIPPING_OPTIONS = {
  evaluatedOn: "2026-10-06",
  limits: { recipients: 10, detailsPerRecipient: 50, details: 100 },
  exceptionPolicy: {
    version: 1,
    source:
      "Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios, art. 30, numeral 8",
    cases: [
      {
        case: "QUANTITY_OR_PRICE_AFTER_TRANSFER",
        literal: "b",
        label: "Cantidad o precio determinado después del traslado",
        statement:
          "Cuando la cantidad o el precio de los bienes se determinan con posterioridad al traslado.",
        recipientKind: "PARTY",
      },
      {
        case: "CONSIGNMENT",
        literal: "c",
        label: "Consignación",
        statement: "Traslado de bienes en consignación.",
        recipientKind: "PARTY",
      },
      {
        case: "OWN_ESTABLISHMENT_TRANSFER",
        literal: "d",
        label: "Traslado entre establecimientos propios",
        statement: "Traslado entre establecimientos de un mismo contribuyente.",
        recipientKind: "OWN_COMPANY",
      },
      {
        case: "EXHIBITION_OR_DEMONSTRATION",
        literal: "e",
        label: "Exhibición o demostración",
        statement: "Traslado de bienes para exhibición o demostración.",
        recipientKind: "PARTY",
      },
    ],
  },
  establishments: [
    { id: "est-1", code: "001", address: "Av. 6 de Diciembre, Quito" },
    { id: "est-2", code: "002", address: "Bodega sur, Quito" },
  ],
  issuerIdentity: { ruc: "1790012345001", legalName: "EMPRESA DE PRUEBA S.A." },
};

export const EMPTY_PREVIEW = {
  evaluatedOn: "2026-10-06",
  departureAddress: null,
  carrier: null,
  recipients: [],
  counts: { recipients: 0, details: 0 },
  exceptionDeclarationRequired: false,
  issues: [],
};

/** Borrador completo: transporte propio y un destinatario con factura, sin problemas. */
export const guideDraft = (overrides: Record<string, unknown> = {}) => ({
  id: "grd-1",
  version: 2,
  emissionPoint: { id: "pto-1", establishmentCode: "001", code: "001", available: true },
  originEstablishment: null,
  departureAddress: "Av. 6 de Diciembre, Quito",
  transporter: { source: "SELF" },
  plate: "PAA-1234",
  transportStart: "2026-10-06",
  transportEnd: "2026-10-07",
  recipients: [
    {
      recipient: {
        kind: "PARTY",
        partyId: "cli-1",
        party: {
          id: "cli-1",
          identificationType: "04",
          identification: "0992877878001",
          legalName: "EL PERNO CIA. LTDA.",
          address: "Av. Quito y Guayaquil",
        },
      },
      address: "Av. Quito y Guayaquil",
      motive: "Venta",
      route: null,
      destinationEstablishmentCode: null,
      support: {
        kind: "INTERNAL_INVOICE",
        invoiceId: "inv-1",
        documentNumber: "001-001-000000123",
      },
      details: [
        {
          productId: "prod-1",
          productName: "Cemento 50 kg",
          mainCode: null,
          auxiliaryCode: null,
          description: "Cemento 50 kg en sacos",
          quantity: "10",
        },
      ],
    },
  ],
  preview: {
    evaluatedOn: "2026-10-06",
    departureAddress: "Av. 6 de Diciembre, Quito",
    carrier: {
      source: "SELF",
      identificationType: "04",
      identification: "1790012345001",
      legalName: "EMPRESA DE PRUEBA S.A.",
    },
    recipients: [
      {
        position: 1,
        identification: "0992877878001",
        legalName: "EL PERNO CIA. LTDA.",
        address: "Av. Quito y Guayaquil",
        destinationEstablishmentCode: null,
        support: {
          kind: "INTERNAL_INVOICE",
          invoice: {
            id: "inv-1",
            documentNumber: "001-001-000000123",
            issueDate: "2026-10-05",
            authorizationNumber: "0510202601179001234500110010010000001231234567815",
          },
        },
        details: [
          {
            position: 1,
            mainCode: "CEM-50",
            auxiliaryCode: null,
            description: "Cemento 50 kg en sacos",
            quantity: "10",
          },
        ],
      },
    ],
    counts: { recipients: 1, details: 1 },
    exceptionDeclarationRequired: false,
    issues: [],
  },
  createdAt: "2026-10-06T15:00:00.000Z",
  createdBy: "usr-op",
  updatedAt: "2026-10-06T15:00:00.000Z",
  updatedBy: "usr-op",
  ...overrides,
});
