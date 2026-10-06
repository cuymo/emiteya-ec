// Snapshot del comprobante de retención (add-withholding-receipts, design D14): un JSON versionado y
// autosuficiente que se congela al reservar. Desde ese momento es la verdad fiscal del comprobante:
// el XML, el RIDE y la consulta salen solo de él, sin releer el tercero, los catálogos ni la
// configuración.
export const WITHHOLDING_SNAPSHOT_VERSION = 1;

/** Referencia de la versión de una entrada de catálogo aplicada al reservar. */
export type WithholdingCatalogRef = Readonly<{
  catalogType: string;
  entryKey: string;
  versionId: string;
  datasetVersion: number;
}>;

export type WithholdingSnapshotSupportTax = Readonly<{
  position: number;
  /** El `codImpuestoDocSustento`: 2 IVA, 3 ICE o 5 IRBPNR. */
  taxCode: "2" | "3" | "5";
  taxLabel: string;
  taxRef: WithholdingCatalogRef;
  /** El `codigoPorcentaje`, vigente en la fecha del documento sustento. */
  rateCode: string;
  rateLabel: string;
  rateRef: WithholdingCatalogRef;
  /** La `tarifa` en su forma canónica: del catálogo (IVA) o declarada (ICE e IRBPNR). */
  tariff: string;
  tariffBasis: "CATALOG" | "USER_DECLARED";
  /** La base y el valor tal como los declaró el usuario, nunca recalculados. */
  base: string;
  amount: string;
}>;

export type WithholdingSnapshotPayment = Readonly<{
  position: number;
  /** El `formaPago` del XML. */
  code: string;
  label: string;
  ref: WithholdingCatalogRef;
  total: string;
}>;

export type WithholdingSnapshotItem = Readonly<{
  position: number;
  /** El `codigo` del XML: 1 renta o 2 IVA. */
  tax: "1" | "2";
  taxLabel: string;
  taxRef: WithholdingCatalogRef;
  /** El `codigoRetencion` del XML: el código literal de la entrada. */
  code: string;
  label: string;
  ref: WithholdingCatalogRef;
  /** `baseImponible` a 2 decimales. */
  base: string;
  /** `porcentajeRetener` en su forma canónica. */
  percentage: string;
  /** `valorRetenido`, de `calculateWithholdingAmounts`. */
  amount: string;
}>;

export type WithholdingSnapshotSupport = Readonly<{
  position: number;
  /** El `codDocSustento`: un código de dos caracteres. */
  documentType: Readonly<{ code: "01" | "02" | "03"; label: string; ref: WithholdingCatalogRef }>;
  /** El `codSustento`. */
  supportCode: Readonly<{ code: string; label: string; ref: WithholdingCatalogRef }>;
  number: string;
  issueDate: string;
  authorizationNumber: string | null;
  totalWithoutTaxes: string;
  importTotal: string;
  taxes: readonly WithholdingSnapshotSupportTax[];
  payments: readonly WithholdingSnapshotPayment[];
  withholdings: readonly WithholdingSnapshotItem[];
}>;

export type WithholdingSnapshot = Readonly<{
  snapshotVersion: typeof WITHHOLDING_SNAPSHOT_VERSION;
  schema: Readonly<{
    documentType: "07";
    version: string;
    path: string;
    sha256: string;
    imports: readonly Readonly<{ path: string; sha256: string }>[];
  }>;
  builderVersion: string;
  /** Versión de `calculateWithholdingAmounts` con que se calcularon los valores retenidos. */
  calculationVersion: number;
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
  /** El sujeto retenido tal como estaba al reservar; nunca se relee el tercero. */
  subject: Readonly<{
    partyId: string;
    identificationType: string;
    identification: string;
    legalName: string;
  }>;
  /** Declaración del usuario (design D4): nunca una verificación del sistema. */
  relatedParty: Readonly<{
    value: "SI" | "NO";
    basis: "USER_DECLARED";
    declaredBy: string;
    declaredByName: string | null;
    declaredAt: string;
  }>;
  /** `MM/AAAA`, el elegido por el usuario y nunca recalculado. */
  fiscalPeriod: string;
  supports: readonly WithholdingSnapshotSupport[];
  totals: Readonly<{ withheld: string }>;
  key: Readonly<{
    documentNumber: string;
    sequential: string;
    numericCode: string;
    emissionType: "1";
    accessKey: string;
  }>;
}>;

/** Snapshot completo salvo los datos de la reserva, que se añaden con `withWithholdingKey`. */
export type WithholdingSnapshotDraft = Omit<WithholdingSnapshot, "key">;

export const withWithholdingKey = (
  draft: WithholdingSnapshotDraft,
  key: WithholdingSnapshot["key"],
): WithholdingSnapshot => ({ ...draft, key });
