// Datos deterministas del editor de facturas y de los catálogos que usan sus pantallas vecinas
// (productize-invoice-editor-and-composition-foundation, tarea 1.1). Con la forma exacta de los
// contratos, como los de las pruebas unitarias. Solo hay lecturas: la revisión visual nunca guarda
// ni emite, así que `POST` y `PUT` no tienen respuesta y harían fallar la prueba.
import { creditNoteDraft, invoiceCredit } from "../test/credit-note-fixtures";

export type Reply = { status: number; body?: unknown };

const ok = (data: unknown): Reply => ({ status: 200, body: { data } });
const page = (rows: unknown[], query: URLSearchParams): Reply => {
  const current = Number(query.get("page") ?? "1");
  const size = Number(query.get("pageSize") ?? "25");
  return {
    status: 200,
    body: {
      data: rows.slice((current - 1) * size, current * size),
      meta: { page: current, pageSize: size, total: rows.length },
    },
  };
};

const STAMP = { createdAt: "2026-10-10T15:00:00.000Z", updatedAt: "2026-10-10T15:00:00.000Z" };

// Catálogos: la misma estructura para formas de pago, IVA, ICE e IRBPNR.
type CatalogRow = {
  code: string;
  label: string;
  rate?: { taxKind: "IVA" | "ICE" | "IRBPNR"; rateKind: string; percentage: string | null };
};
const CATALOG_ROWS: Record<string, CatalogRow[]> = {
  "payment-method": [
    { code: "01", label: "SIN UTILIZACION DEL SISTEMA FINANCIERO" },
    { code: "16", label: "TARJETA DE DÉBITO" },
    { code: "19", label: "TARJETA DE CRÉDITO" },
    { code: "20", label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO" },
  ],
  "iva-rate": [
    { code: "0", label: "0%", rate: { taxKind: "IVA", rateKind: "PERCENTAGE", percentage: "0" } },
    { code: "4", label: "15%", rate: { taxKind: "IVA", rateKind: "PERCENTAGE", percentage: "15" } },
    {
      code: "6",
      label: "No objeto de impuesto",
      rate: { taxKind: "IVA", rateKind: "NOT_SUBJECT", percentage: null },
    },
    {
      code: "7",
      label: "Exento de IVA",
      rate: { taxKind: "IVA", rateKind: "EXEMPT", percentage: null },
    },
  ],
  "ice-rate": [],
  "irbpnr-rate": [],
};

function catalogEntries(catalogType: string): Reply | null {
  const rows = CATALOG_ROWS[catalogType];
  if (!rows) return null;
  return ok({
    catalog: {
      catalogType,
      datasetVersion: 1,
      source: {
        document: "Ficha técnica del SRI",
        version: "2.34",
        publishedOn: "2026-07-27",
        url: "https://www.sri.gob.ec",
        sha256: "a".repeat(64),
      },
      enablementPolicy: "DEFAULT_ENABLED",
    },
    at: "2026-10-14",
    entries: rows.map((row) => {
      const version = {
        id: `${catalogType}-${row.code}`,
        officialLabel: row.label,
        effectiveFrom: "2016-06-01",
        effectiveFromBasis: "SOURCE_STATED",
        effectiveTo: null,
        normativeStatus: "OFFICIAL",
        sourceRef: "Ficha técnica v2.34",
        datasetVersion: 1,
        rate: row.rate ? { ...row.rate, sriTaxCode: row.rate.taxKind === "IVA" ? "2" : "3" } : null,
        taxKind: null,
        identificationRule: null,
        withholding: null,
      };
      return {
        entryKey: row.code,
        code: row.code,
        versions: [version],
        applicable: version,
        enablement: { enabled: true, source: "DEFAULT" },
        usable: true,
      };
    }),
  });
}

const ESTABLISHMENTS = [
  {
    id: "est-1",
    code: "001",
    address: "Av. Amazonas N24-03, Quito",
    status: "ACTIVE",
    emissionPoints: [
      { id: "ep-1", code: "001", status: "ACTIVE", available: true },
      { id: "ep-2", code: "002", status: "ACTIVE", available: true },
    ],
  },
];

const party = (id: string, identification: string, legalName: string, extra = {}) => ({
  id,
  identificationType: identification.length === 13 ? "04" : "05",
  identificationTypeLabel: identification.length === 13 ? "RUC" : "Cédula",
  identification,
  legalName,
  address: "Quito",
  email: null,
  phone: null,
  roles: ["CUSTOMER"],
  status: "ACTIVE",
  systemRecord: null,
  version: 1,
  ...STAMP,
  ...extra,
});
const CUSTOMERS = [
  party("party-1", "0992877878001", "EL PERNO CIA. LTDA."),
  party("party-2", "1790012345001", "Comercial Andina S.A."),
  party("party-3", "0102030405", "María José Paredes"),
];
const CONSUMER_FINAL = party("party-cf", "9999999999999", "CONSUMIDOR FINAL", {
  identificationType: "07",
  identificationTypeLabel: "Consumidor final",
  systemRecord: "CONSUMER_FINAL",
});

const iva15 = {
  slot: "iva",
  catalogType: "iva-rate",
  entryKey: "4",
  code: "4",
  officialLabel: "15%",
  rate: { taxKind: "IVA", sriTaxCode: "2", rateKind: "PERCENTAGE", percentage: "15" },
  usable: true,
  reason: null,
};
const product = (id: string, code: string, name: string, price: string, kind = "GOOD") => ({
  id,
  kind,
  mainCode: code,
  auxiliaryCode: null,
  name,
  description: null,
  unitPrice: price,
  stockTracked: false,
  status: "ACTIVE",
  version: 1,
  taxes: [iva15],
  taxConfiguration: { status: "READY", reasons: [], evaluatedOn: "2026-10-14" },
  ...STAMP,
});
export const PRODUCTS = [
  product("prod-1", "CEM-50", "Cemento Holcim tipo GU 50 kg", "8.75"),
  product("prod-2", "VAR-12", "Varilla corrugada 12 mm x 12 m", "11.40"),
  product("prod-3", "PIN-LTX-G", "Pintura látex blanco hueso galón", "18.90"),
  product("prod-4", "SRV-TRN", "Transporte de materiales dentro de Quito", "25.00", "SERVICE"),
  product("prod-5", "PVC-12", "Tubo PVC presión 1/2 pulgada x 6 m", "6.35"),
];

// Borradores de factura del editor, con la vista previa del servidor.
const POINT = { id: "ep-1", establishmentCode: "001", code: "001", available: true };
const tax = (base: string, amount: string) => ({
  taxCode: "2",
  rateCode: "4",
  percentage: "15",
  base,
  amount,
});
const line = (position: number, productIndex: number, quantity: string, discount = "0.00") => {
  const source = PRODUCTS[productIndex]!;
  return {
    position,
    product: {
      id: source.id,
      mainCode: source.mainCode,
      name: source.name,
      unitPrice: source.unitPrice,
      status: "ACTIVE",
    },
    quantity,
    discount,
  };
};
const buyer = (source: ReturnType<typeof party>) => ({
  id: source.id,
  identificationType: source.identificationType,
  identification: source.identification,
  legalName: source.legalName,
  status: "ACTIVE",
  systemRecord: source.systemRecord,
});
const payment = (position: number, code: string, label: string, amount: string | null) => ({
  position,
  paymentMethod: code,
  code,
  officialLabel: label,
  amount,
});
const READY_TOTALS = {
  withoutTaxes: "53.75",
  discount: "1.25",
  taxes: [tax("53.75", "8.06")],
  total: "61.81",
};
const draft = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  version: 3,
  emissionPoint: POINT,
  buyer: buyer(CUSTOMERS[0]!),
  lines: [line(1, 0, "3", "1.25"), line(2, 4, "4.5")],
  payments: [payment(1, "01", "SIN UTILIZACION DEL SISTEMA FINANCIERO", null)],
  preview: {
    evaluatedOn: "2026-10-14",
    lines: [
      { position: 1, unitPrice: "8.75", taxableBase: "25.00", taxes: [tax("25.00", "3.75")] },
      { position: 2, unitPrice: "6.35", taxableBase: "28.75", taxes: [tax("28.75", "4.31")] },
    ],
    totals: READY_TOTALS,
    issues: [],
    stockWarnings: [],
  },
  createdAt: "2026-10-14T14:30:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-10-14T14:50:00.000Z",
  updatedBy: "user-1",
  ...overrides,
});

/** Borradores por identificador, para `/borradores/<id>`. */
export const INVOICE_DRAFTS: Record<string, unknown> = {
  "borrador-listo": draft("borrador-listo"),
  "borrador-problemas": draft("borrador-problemas", {
    buyer: buyer({ ...CUSTOMERS[1]!, roles: ["SUPPLIER"] }),
    payments: [
      payment(1, "01", "SIN UTILIZACION DEL SISTEMA FINANCIERO", "40.00"),
      payment(2, "19", "TARJETA DE CRÉDITO", "10.00"),
    ],
    preview: {
      ...(draft("x").preview as Record<string, unknown>),
      issues: [
        {
          code: "BUYER_NOT_CUSTOMER",
          message: "El comprador Comercial Andina S.A. no tiene el rol de cliente.",
          line: null,
          payment: null,
        },
        {
          code: "PAYMENTS_DO_NOT_MATCH_TOTAL",
          message: "Las formas de pago suman USD 50,00 y el total es USD 61,81: faltan USD 11,81.",
          line: null,
          payment: 2,
        },
      ],
    },
  }),
  "borrador-incompleto": draft("borrador-incompleto", {
    version: 1,
    buyer: null,
    lines: [],
    payments: [payment(1, "01", "SIN UTILIZACION DEL SISTEMA FINANCIERO", null)],
    preview: {
      evaluatedOn: "2026-10-14",
      lines: [],
      totals: null,
      issues: [
        {
          code: "INVOICE_DRAFT_INCOMPLETE",
          message: "Al borrador le falta el comprador y al menos una línea.",
          line: null,
          payment: null,
        },
      ],
      stockWarnings: [],
    },
  }),
  "borrador-sin-totales": draft("borrador-sin-totales", {
    preview: {
      evaluatedOn: "2026-10-14",
      lines: [
        { position: 1, unitPrice: "8.75", taxableBase: "25.00", taxes: [tax("25.00", "3.75")] },
      ],
      totals: null,
      issues: [
        {
          code: "TAX_REFERENCE_NOT_USABLE",
          message: "Línea 2: la tarifa de IVA del producto ya no está habilitada.",
          line: 2,
          payment: null,
        },
      ],
      stockWarnings: [],
    },
  }),
  "borrador-consumidor-final": draft("borrador-consumidor-final", {
    buyer: buyer(CONSUMER_FINAL),
  }),
};

/**
 * Respuestas del editor y de los catálogos para las rutas que el harness común no declara. Devuelve
 * `null` si la ruta no es de estas pantallas.
 */
export function editorReply(
  method: string,
  path: string,
  query: URLSearchParams,
  environment: "TEST" | "PRODUCTION" = "TEST",
): Reply | null {
  if (method !== "GET") return null;
  const draftMatch = /^\/api\/v1\/invoices\/drafts\/([^/]+)$/.exec(path);
  if (draftMatch) {
    const found = INVOICE_DRAFTS[draftMatch[1]!];
    return found
      ? ok(found)
      : {
          status: 404,
          body: {
            error: {
              code: "INVOICE_DRAFT_NOT_FOUND",
              message: "El borrador no existe.",
              requestId: "visual",
            },
          },
        };
  }
  const catalogMatch = /^\/api\/v1\/fiscal-catalogs\/([a-z-]+)\/entries$/.exec(path);
  if (catalogMatch) return catalogEntries(catalogMatch[1]!);
  switch (path) {
    case "/api/v1/establishments":
      return ok(ESTABLISHMENTS);
    case "/api/v1/me/default-emission-point":
      return ok({
        establishment: {
          id: "est-1",
          code: "001",
          address: ESTABLISHMENTS[0]!.address,
          status: "ACTIVE",
        },
        emissionPoint: { id: "ep-1", code: "001", status: "ACTIVE" },
        available: true,
      });
    case "/api/v1/parties": {
      const search = query.get("search") ?? "";
      if (search === "9999999999999") return page([CONSUMER_FINAL], query);
      return page(
        CUSTOMERS.filter(
          (row) =>
            !search ||
            row.identification.includes(search) ||
            row.legalName.toLowerCase().includes(search.toLowerCase()),
        ),
        query,
      );
    }
    case "/api/v1/products":
      return page(PRODUCTS, query);
    case "/api/v1/products/tax-summary":
      return ok({
        evaluatedOn: "2026-10-14",
        byStatus: { READY: PRODUCTS.length, REVIEW_REQUIRED: 0, INCOMPLETE: 0 },
        byEntry: [],
      });
    case "/api/v1/taxpayer":
      return ok({
        configured: true,
        version: 4,
        environment,
        taxIdentityLocked: true,
        profile: {
          ruc: "1792345678001",
          legalName: "FERRETERÍA ANDINA CÍA. LTDA.",
          tradeName: "Ferretería Andina",
          headOfficeAddress: "Av. Amazonas N24-03 y Colón, Quito",
          phone: "022345678",
          email: "facturacion@ferreteria-andina.ec",
          accountingRequired: true,
          specialTaxpayerNumber: null,
          withholdingAgentResolution: null,
          largeTaxpayer: false,
          rimpeCategory: null,
          providerRuc: null,
        },
        logo: null,
        logoMaxBytes: 1048576,
        updatedAt: "2026-10-01T15:00:00.000Z",
      });
    case "/api/v1/credit-notes/drafts/cnd-1":
      return ok(creditNoteDraft());
    case "/api/v1/credit-notes/invoices/inv-1/credit":
      return ok(invoiceCredit());
    default:
      return null;
  }
}
