// Datos de las pruebas del dominio de la liquidación de compra (add-purchase-settlements): un proveedor
// con cédula y el rol de proveedor, productos, las tarifas de IVA del catálogo vigente (15 %, 0 %, no
// objeto, exento y diferenciado, sin porcentaje de cálculo) y dos formas de pago. Son datos ya
// resueltos, como los entrega la lectura de `catalogs`.
import type {
  CatalogOption,
  CatalogVersion,
  PurchaseProduct,
  PurchaseSettlementEvaluationInput,
  PurchaseSupplier,
} from "../../src/modules/purchase-settlements/domain/evaluation.ts";
import type {
  DraftLine,
  DraftPayment,
} from "../../src/modules/purchase-settlements/domain/draft.ts";

export const ISSUE_DATE = "2026-10-07";

export const SUPPLIER: PurchaseSupplier = {
  id: "party-1",
  status: "ACTIVE",
  identificationType: "05",
  identification: "0102030405",
  legalName: "María Quishpe",
  address: "Comunidad San Pablo, Cayambe",
  roles: ["SUPPLIER"],
  consumerFinal: false,
};

export const PRODUCT: PurchaseProduct = {
  id: "prod-1",
  status: "ACTIVE",
  name: "Cacao en grano",
  mainCode: "CAC-01",
  auxiliaryCode: null,
};

const version = (
  catalogType: string,
  entryKey: string,
  officialLabel: string,
  rateKind: string | null,
  percentage: string | null,
): CatalogVersion => ({
  catalogType,
  entryKey,
  code: entryKey,
  officialLabel,
  versionId: `${catalogType}:${entryKey}:v1`,
  datasetVersion: 1,
  percentage,
  rateKind,
});

const option = (entry: CatalogVersion, usable = true): CatalogOption => ({
  entryKey: entry.entryKey,
  applicable: entry,
  usable,
});

export const IVA = {
  "15": version("iva-rate", "4", "15%", "PERCENTAGE", "15"),
  "0": version("iva-rate", "0", "0%", "PERCENTAGE", "0"),
  notSubject: version("iva-rate", "6", "No Objeto de Impuesto", "NOT_SUBJECT", null),
  exempt: version("iva-rate", "7", "Exento de IVA", "EXEMPT", null),
  differentiated: version("iva-rate", "8", "IVA diferenciado", "DIFFERENTIATED", null),
};

export const PAYMENT_METHODS = {
  cash: version("payment-method", "01", "SIN UTILIZACION DEL SISTEMA FINANCIERO", null, null),
  transfer: version(
    "payment-method",
    "20",
    "OTROS CON UTILIZACION DEL SISTEMA FINANCIERO",
    null,
    null,
  ),
};

export const CATALOGS: PurchaseSettlementEvaluationInput["catalogs"] = {
  ivaRates: new Map(Object.values(IVA).map((entry) => [entry.entryKey, option(entry)])),
  paymentMethods: new Map(
    Object.values(PAYMENT_METHODS).map((entry) => [entry.entryKey, option(entry)]),
  ),
};

export const line = (values: Partial<DraftLine> = {}): DraftLine => ({
  productId: null,
  mainCode: null,
  auxiliaryCode: null,
  description: "Saco de cacao en grano, 45 kg",
  unit: "saco",
  quantity: "10",
  unitPrice: "4.5",
  discount: "5",
  ivaRate: "4",
  ...values,
});

export const payment = (values: Partial<DraftPayment> = {}): DraftPayment => ({
  paymentMethod: "01",
  total: "106.00",
  term: "0",
  timeUnit: "días",
  ...values,
});

/** Liquidación del spec: 10 × 4.50 − 5.00 al 15 % y 2 × 30.00 al 0 %, pagos de 50 y 56. */
export const SPEC_LINES: DraftLine[] = [
  line(),
  line({
    description: "Jornal de cosecha",
    unit: null,
    mainCode: "JOR-01",
    quantity: "2",
    unitPrice: "30",
    discount: "0",
    ivaRate: "0",
  }),
];
export const SPEC_PAYMENTS: DraftPayment[] = [
  payment({ total: "50.00", term: "0" }),
  payment({ paymentMethod: "20", total: "56.00", term: "30" }),
];

export const evaluationInput = (
  overrides: Omit<Partial<PurchaseSettlementEvaluationInput>, "draft"> & {
    draft?: Partial<PurchaseSettlementEvaluationInput["draft"]>;
  } = {},
): PurchaseSettlementEvaluationInput => ({
  issueDate: ISSUE_DATE,
  supplier: SUPPLIER,
  products: new Map([[PRODUCT.id, PRODUCT]]),
  catalogs: CATALOGS,
  limits: { lines: 100, payments: 10 },
  ...overrides,
  draft: {
    supplierPartyId: SUPPLIER.id,
    supplierAddress: "Comunidad San Pablo, Cayambe",
    lines: SPEC_LINES,
    payments: SPEC_PAYMENTS,
    ...overrides.draft,
  },
});
