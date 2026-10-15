// Datos de prueba del editor de facturas y de Borradores (add-invoice-emission, tarea 10.2), con la
// forma exacta de los contratos, compartidos por sus pruebas de pantalla.
import { SessionGate } from "@/components/session";
import { ADMIN_ME, OPERATOR_ME, mockApi, renderApp, type Route } from "./harness";

export const CUSTOMER = {
  id: "party-1",
  identificationType: "04",
  identificationTypeLabel: "RUC",
  identification: "0992877878001",
  legalName: "EL PERNO CIA. LTDA.",
  address: null,
  email: null,
  phone: null,
  roles: ["CUSTOMER"],
  status: "ACTIVE",
  systemRecord: null,
  version: 1,
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
};
export const CONSUMER_FINAL = {
  ...CUSTOMER,
  id: "party-cf",
  identificationType: "07",
  identification: "9999999999999",
  legalName: "CONSUMIDOR FINAL",
  systemRecord: "CONSUMER_FINAL",
};
export const PRODUCT = {
  id: "prod-1",
  kind: "GOOD",
  mainCode: "CEM-50",
  auxiliaryCode: null,
  name: "Cemento 50 kg",
  description: null,
  unitPrice: "8.75",
  stockTracked: false,
  status: "ACTIVE",
  version: 1,
  taxes: [],
  taxConfiguration: { status: "READY", reasons: [], evaluatedOn: "2026-10-03" },
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-03T10:00:00.000Z",
};
export const POINT = { id: "ep-1", establishmentCode: "001", code: "001", available: true };
export const TOTALS = {
  withoutTaxes: "25.00",
  discount: "1.25",
  taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: "25.00", amount: "3.75" }],
  total: "28.75",
};

export const draft = (overrides: Record<string, unknown> = {}) => ({
  id: "draft-1",
  version: 1,
  emissionPoint: POINT,
  buyer: {
    id: CUSTOMER.id,
    identificationType: "04",
    identification: CUSTOMER.identification,
    legalName: CUSTOMER.legalName,
    status: "ACTIVE",
    systemRecord: null,
  },
  lines: [
    {
      position: 1,
      product: {
        id: "prod-1",
        mainCode: "CEM-50",
        name: "Cemento 50 kg",
        unitPrice: "8.75",
        status: "ACTIVE",
      },
      quantity: "3",
      discount: "1.25",
    },
  ],
  payments: [
    {
      position: 1,
      paymentMethod: "01",
      code: "01",
      officialLabel: "Sin utilización del sistema financiero",
      amount: null,
    },
  ],
  preview: {
    evaluatedOn: "2026-10-03",
    lines: [
      {
        position: 1,
        unitPrice: "8.75",
        taxableBase: "25.00",
        taxes: TOTALS.taxes,
      },
    ],
    totals: TOTALS,
    issues: [],
    stockWarnings: [],
  },
  createdAt: "2026-10-03T15:00:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-10-03T15:00:00.000Z",
  updatedBy: "user-1",
  ...overrides,
});
export const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  documentType: "01",
  environment: "TEST",
  documentNumber: "001-001-000000001",
  accessKey: "0310202601179001234500110010010000000011234567816",
  issueDate: "2026-10-03",
  state: "SIGNED",
  issuer: {
    ruc: "1790012345001",
    legalName: "COMERCIAL ANDINA S.A.",
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
    identification: CUSTOMER.identification,
    legalName: CUSTOMER.legalName,
    address: null,
    consumerFinal: false,
  },
  lines: [],
  payments: [{ code: "01", amount: "28.75" }],
  totals: TOTALS,
  diagnostic: null,
  artifact: { sha256: "a".repeat(64), sizeBytes: 4096 },
  authorizedArtifact: null,
  transmission: {
    inProgress: true,
    stopped: null,
    reconcilable: false,
    authorization: null,
    lastResult: null,
  },
  createdAt: "2026-10-03T15:00:00.000Z",
  signedAt: "2026-10-03T15:00:01.000Z",
  ...overrides,
});

export const ok =
  (data: unknown): Route =>
  () => ({ status: 200, body: { data } });
export const paged =
  (data: unknown[]): Route =>
  () => ({ status: 200, body: { data, meta: { page: 1, pageSize: 25, total: data.length } } });
export const ESTABLISHMENTS = ok([
  {
    id: "est-1",
    code: "001",
    address: "Av. Amazonas, Quito",
    status: "ACTIVE",
    emissionPoints: [{ id: "ep-1", code: "001", status: "ACTIVE", available: true }],
  },
]);
export const PAYMENT_METHODS = ok({
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
  at: "2026-10-03",
  entries: ["01", "19"].map((code) => {
    const version = {
      id: `pm-${code}`,
      officialLabel:
        code === "01" ? "Sin utilización del sistema financiero" : "Tarjeta de crédito",
      effectiveFrom: "2016-06-01",
      effectiveFromBasis: "OFFICIAL",
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
      enablement: { enabled: true, source: "DEFAULT" },
      usable: true,
    };
  }),
});

export function render(
  ui: React.ReactNode,
  routes: Record<string, Route>,
  me: typeof ADMIN_ME | typeof OPERATOR_ME = ADMIN_ME,
) {
  const calls = mockApi({
    "GET /api/v1/me": () => ({ status: 200, body: { data: me } }),
    "GET /api/v1/company/status": ok({
      environment: "TEST",
      displayName: "COMERCIAL ANDINA S.A.",
      readiness: { ready: true, checks: [] },
    }),
    "GET /api/v1/establishments": ESTABLISHMENTS,
    "GET /api/v1/fiscal-catalogs/payment-method/entries": PAYMENT_METHODS,
    "GET /api/v1/me/default-emission-point": ok({
      establishment: { id: "est-1", code: "001", address: "Av. Amazonas, Quito", status: "ACTIVE" },
      emissionPoint: { id: "ep-1", code: "001", status: "ACTIVE" },
      available: true,
    }),
    ...routes,
  });
  renderApp(<SessionGate fallback={<p>cargando</p>}>{ui}</SessionGate>);
  return calls;
}
