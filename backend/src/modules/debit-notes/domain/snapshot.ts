// Snapshot de la nota de débito (add-debit-notes, design D13): un JSON versionado y autosuficiente
// que se congela al reservar. Desde ese momento es la verdad fiscal de la nota: el XML, el RIDE y la
// consulta salen solo de él, y la factura modificada se vuelve a leer únicamente para las
// relaciones, nunca para reconstruir un dato.
import type { DebitNoteCause, DebitNoteDeclarationStatement } from "@facturador/contracts";

export const DEBIT_NOTE_SNAPSHOT_VERSION = 1;

/** Tratamiento de IVA de la factura con sus referencias fiscales (design D6). */
export type DebitNoteSnapshotTreatment = Readonly<{
  key: string;
  taxCode: string;
  rateCode: string;
  percentage: string;
  catalogType: string;
  entryKey: string;
  versionId: string;
  officialLabel: string;
}>;

export type DebitNoteSnapshotConcept = Readonly<{
  /** Posición del concepto en la nota, desde 1: el orden de los motivos. */
  position: number;
  cause: DebitNoteCause;
  /** La `razon` del motivo, tal como la escribió el usuario. */
  description: string;
  /** La base del concepto, a 2 decimales: el `valor` del motivo. */
  amount: string;
  /** Clave del tratamiento de la factura (`invoice.taxTreatments`). */
  taxTreatment: string;
}>;

/** La única forma de pago (design D8), con la forma de los pagos de la factura. */
export type DebitNoteSnapshotPayment = Readonly<{
  position: 1;
  entryKey: string;
  /** El `formaPago` del XML. */
  code: string;
  catalogType: "payment-method";
  versionId: string;
  datasetVersion: number;
  officialLabel: string;
  /** El valor total de la nota. */
  amount: string;
}>;

export type DebitNoteSnapshot = Readonly<{
  snapshotVersion: typeof DEBIT_NOTE_SNAPSHOT_VERSION;
  schema: Readonly<{
    documentType: "05";
    version: string;
    path: string;
    sha256: string;
    imports: readonly Readonly<{ path: string; sha256: string }>[];
  }>;
  builderVersion: string;
  /** Versión de `calculateDebitNoteAmounts` con que se calcularon los importes. */
  calculationVersion: number;
  /** Última versión aplicada de cada catálogo usado al reservar. */
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
  /** La factura modificada: identidad, autorización, versión de su snapshot y sus tratamientos. */
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
    taxTreatments: readonly DebitNoteSnapshotTreatment[];
  }>;
  concepts: readonly DebitNoteSnapshotConcept[];
  /** Un impuesto por tratamiento usado: la base total de sus conceptos y su impuesto. */
  taxes: readonly Readonly<{
    taxCode: string;
    rateCode: string;
    percentage: string;
    base: string;
    amount: string;
  }>[];
  totals: Readonly<{
    /** `totalSinImpuestos`. */
    withoutTaxes: string;
    /** `valorTotal`. */
    total: string;
  }>;
  /** Exactamente un elemento en el MVP; una lista para que varios pagos sean una ampliación. */
  payments: readonly [DebitNoteSnapshotPayment];
  /** Declaración del usuario (design D9): nunca una verificación del sistema. */
  declarations: Readonly<{
    version: number;
    statements: readonly DebitNoteDeclarationStatement[];
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

/** Snapshot completo salvo los datos de la reserva, que se añaden con `withDebitNoteKey`. */
export type DebitNoteSnapshotDraft = Omit<DebitNoteSnapshot, "key">;

export const withDebitNoteKey = (
  draft: DebitNoteSnapshotDraft,
  key: DebitNoteSnapshot["key"],
): DebitNoteSnapshot => ({ ...draft, key });
