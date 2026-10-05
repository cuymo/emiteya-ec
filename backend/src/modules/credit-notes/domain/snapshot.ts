// Snapshot de la nota de crédito (add-credit-notes, design D24): un JSON versionado y autosuficiente
// que se congela al reservar. Desde ese momento es la verdad fiscal de la nota: el XML, el RIDE y la
// consulta salen solo de él, y la factura modificada se vuelve a leer únicamente para la integridad
// y las relaciones, nunca para reconstruir un importe.
import type { CreditNoteCause, CreditNoteDeclarationStatement } from "@facturador/contracts";

export const CREDIT_NOTE_SNAPSHOT_VERSION = 1;

/** Impuesto acreditado de una línea: la tarifa de la factura y los importes del cálculo. */
export type CreditNoteSnapshotTax = Readonly<{
  taxCode: string;
  rateCode: string;
  catalogType: string;
  entryKey: string;
  versionId: string;
  officialLabel: string;
  percentage: string;
  base: string;
  amount: string;
}>;

export type CreditNoteSnapshotLine = Readonly<{
  /** Posición de la línea en la nota, desde 1. */
  position: number;
  /** Posición de la línea original en la factura. */
  invoicePosition: number;
  /** Informativo: la nota no vuelve a leer el producto. */
  productId: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  /** Cantidad acreditada. */
  quantity: string;
  unitPrice: string;
  /** Subtotal exacto acreditado (`cantidad × precio` acumulado, sin redondear). */
  subtotal: string;
  discount: string;
  taxableBase: string;
  taxes: readonly CreditNoteSnapshotTax[];
  /** Retorno físico declarado, de 0 a la cantidad acreditada. No forma parte del XML. */
  physicalReturn: string;
  /** La decisión de inventario de la línea en el snapshot de la factura. */
  inventoryAffectsStock: boolean;
}>;

export type CreditNoteSnapshot = Readonly<{
  snapshotVersion: typeof CREDIT_NOTE_SNAPSHOT_VERSION;
  schema: Readonly<{
    documentType: "04";
    version: string;
    path: string;
    sha256: string;
    imports: readonly Readonly<{ path: string; sha256: string }>[];
  }>;
  builderVersion: string;
  /** Versión de `calculateCreditNoteAmounts` con que se calcularon los importes. */
  calculationVersion: number;
  /** Última versión aplicada de cada catálogo al reservar. */
  catalogDatasets: Readonly<Record<string, number>>;
  /** Configuración tributaria vigente al reservar: la nota es un comprobante nuevo, de hoy. */
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
  /** El comprador tal como figura en la factura modificada. */
  buyer: Readonly<{
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
  }>;
  cause: CreditNoteCause;
  /** `motivo`: una sola línea de 1 a 300 caracteres. */
  reason: string;
  /** La factura modificada: identidad, autorización y versión de su snapshot. */
  invoice: Readonly<{
    id: string;
    documentType: "01";
    documentNumber: string;
    issueDate: string;
    accessKey: string;
    authorizationNumber: string;
    authorizationDate: string;
    environment: "TEST" | "PRODUCTION";
    snapshotVersion: number;
  }>;
  lines: readonly CreditNoteSnapshotLine[];
  totals: Readonly<{
    withoutTaxes: string;
    discount: string;
    taxes: readonly Readonly<{
      taxCode: string;
      rateCode: string;
      percentage: string;
      base: string;
      amount: string;
    }>[];
    /** `valorModificacion`. */
    total: string;
  }>;
  /** Declaraciones del usuario (design D9): nunca una verificación del sistema. */
  declarations: Readonly<{
    version: number;
    statements: readonly CreditNoteDeclarationStatement[];
    declaredBy: string;
    declaredAt: string;
    basis: "USER_DECLARED";
  }>;
  key: Readonly<{
    documentNumber: string;
    sequential: string;
    numericCode: string;
    emissionType: "1";
    accessKey: string;
  }>;
}>;

/** Snapshot completo salvo los datos de la reserva, que se añaden con `withCreditNoteKey`. */
export type CreditNoteSnapshotDraft = Omit<CreditNoteSnapshot, "key">;

export const withCreditNoteKey = (
  draft: CreditNoteSnapshotDraft,
  key: CreditNoteSnapshot["key"],
): CreditNoteSnapshot => ({ ...draft, key });
