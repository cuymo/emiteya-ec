// Snapshot de la liquidación de compra (add-purchase-settlements, design D11 y D17): un JSON
// versionado y autosuficiente que se congela al reservar. Desde ese momento es la verdad fiscal de la
// liquidación: el XML, el RIDE y la consulta salen solo de él, sin releer el tercero, los productos,
// los catálogos ni la configuración. Las declaraciones de procedencia viven aquí y en el registro de
// la base, nunca en el XML.
import type {
  PURCHASE_SETTLEMENT_CURRENCY,
  PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY,
  PurchaseSettlementStatement,
} from "@facturador/contracts";
import type { PURCHASE_SETTLEMENT_CALCULATION_VERSION } from "./amounts.ts";

export const PURCHASE_SETTLEMENT_SNAPSHOT_VERSION = 1;

/** Referencia de la versión de una entrada de catálogo aplicada al reservar. */
export type PurchaseCatalogRef = Readonly<{
  catalogType: string;
  entryKey: string;
  versionId: string;
  datasetVersion: number;
}>;

/** Una declaración confirmada por quien emitió (design D3): nunca una verificación del sistema. */
export type PurchaseSettlementDeclaration = Readonly<{
  statementId: PurchaseSettlementStatement;
  policyVersion: number;
  basis: "USER_DECLARED";
  declaredBy: string;
  declaredByName: string | null;
  declaredAt: string;
}>;

export type PurchaseSettlementSnapshotLine = Readonly<{
  position: number;
  /** El producto de la línea, solo como referencia; nunca se relee. */
  productId: string | null;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  unit: string | null;
  quantity: string;
  unitPrice: string;
  /** `descuento`, siempre presente. */
  discount: string;
  /** `precioTotalSinImpuesto`. */
  taxableBase: string;
  tax: Readonly<{
    taxCode: "2";
    /** `codigoPorcentaje`. */
    rateCode: string;
    rateKind: string;
    /** `tarifa` de cálculo, en su forma canónica. */
    percentage: string;
    label: string;
    ref: PurchaseCatalogRef;
    base: string;
    amount: string;
  }>;
}>;

export type PurchaseSettlementSnapshotPayment = Readonly<{
  position: number;
  /** El `formaPago` del XML. */
  code: string;
  label: string;
  ref: PurchaseCatalogRef;
  total: string;
  /** `plazo`, en su forma canónica. */
  term: string;
  /** `unidadTiempo`, tal como lo escribió el usuario. */
  timeUnit: string;
}>;

export type PurchaseSettlementSnapshot = Readonly<{
  snapshotVersion: typeof PURCHASE_SETTLEMENT_SNAPSHOT_VERSION;
  schema: Readonly<{
    documentType: "03";
    version: string;
    path: string;
    sha256: string;
    imports: readonly Readonly<{ path: string; sha256: string }>[];
  }>;
  builderVersion: string;
  /** Versión de `calculatePurchaseSettlementAmounts` con que se calcularon los importes. */
  calculationVersion: typeof PURCHASE_SETTLEMENT_CALCULATION_VERSION;
  /** Última versión aplicada de cada catálogo usado al reservar. */
  catalogDatasets: Readonly<Record<string, number>>;
  /** Configuración tributaria vigente al reservar. */
  taxpayerConfig: Readonly<{ versionId: string; version: number }>;
  issueDate: string;
  environment: "TEST" | "PRODUCTION";
  environmentCode: "1" | "2";
  issuer: Readonly<{
    ruc: string;
    legalName: string;
    tradeName: string | null;
    headOfficeAddress: string;
    establishment: Readonly<{ id: string; code: string; address: string }>;
    emissionPoint: Readonly<{ id: string; code: string }>;
    accountingRequired: boolean;
    specialTaxpayerNumber: string | null;
    withholdingAgentResolution: string | null;
    rimpeCategory: "EMPRENDEDOR" | "NEGOCIO_POPULAR" | null;
  }>;
  /** El proveedor tal como estaba al reservar, con la dirección de la liquidación. */
  supplier: Readonly<{
    partyId: string;
    identificationType: string;
    identification: string;
    legalName: string;
    address: string;
  }>;
  /** Procedencia (design D3): el caso c) del art. 13 con las cuatro declaraciones del usuario. */
  eligibility: Readonly<{
    case: typeof PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.case;
    policy: typeof PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.id;
    rule: typeof PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.rule;
    policyVersion: number;
    declarations: readonly PurchaseSettlementDeclaration[];
  }>;
  lines: readonly PurchaseSettlementSnapshotLine[];
  totals: Readonly<{
    withoutTaxes: string;
    discount: string;
    taxes: readonly Readonly<{
      taxCode: "2";
      rateCode: string;
      percentage: string;
      base: string;
      amount: string;
    }>[];
    total: string;
  }>;
  payments: readonly PurchaseSettlementSnapshotPayment[];
  currency: typeof PURCHASE_SETTLEMENT_CURRENCY;
  counts: Readonly<{ lines: number; payments: number }>;
  key: Readonly<{
    documentNumber: string;
    sequential: string;
    numericCode: string;
    emissionType: "1";
    accessKey: string;
  }>;
}>;

/** Snapshot completo salvo los datos de la reserva, que se añaden con `withPurchaseSettlementKey`. */
export type PurchaseSettlementSnapshotDraft = Omit<PurchaseSettlementSnapshot, "key">;

export const withPurchaseSettlementKey = (
  draft: PurchaseSettlementSnapshotDraft,
  key: PurchaseSettlementSnapshot["key"],
): PurchaseSettlementSnapshot => ({ ...draft, key });
