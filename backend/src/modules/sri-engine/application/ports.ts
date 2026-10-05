// Puertos propios del motor SRI (ADR 0018). Los tipos son de la aplicación: el adaptador de
// facturacion-electronica-ec traduce y ningún otro módulo ve los de la librería.
import type { DocumentType } from "@facturador/contracts";

export type SignXmlInput = Readonly<{
  xml: string;
  documentType: DocumentType;
  p12: Buffer;
  password: string;
}>;

/** Firma XAdES-BES con los parámetros de la ficha vigente del SRI (ADR 0013). */
export interface XmlSigner {
  sign(input: SignXmlInput): Promise<string>;
  /** XML fijo y sin datos reales para la firma de prueba al cargar un certificado (design D3). */
  testDocument(): string;
}

export const XML_SIGNER_ERRORS = [
  "PASSWORD_INVALID",
  "UNREADABLE",
  "INCOMPATIBLE",
  "SIGNER_FAILED",
] as const;
export type XmlSignerErrorCode = (typeof XML_SIGNER_ERRORS)[number];

/** Fallo del firmador traducido a un código; nunca lleva el mensaje original de la librería. */
export class XmlSignerError extends Error {
  readonly code: XmlSignerErrorCode;
  constructor(code: XmlSignerErrorCode) {
    super(code);
    this.name = "XmlSignerError";
    this.code = code;
  }
}

/** Archivo del paquete de XSD por su ruta lógica (`sri-xsd/…`, `w3c-xsd/…`) y su hash. */
export type SchemaFile = Readonly<{ path: string; sha256: string }>;

/** Esquema de un comprobante con los archivos que importa, tal como los registra el registro. */
export type RegisteredSchema = SchemaFile &
  Readonly<{
    documentType: DocumentType;
    version: string;
    imports: readonly SchemaFile[];
  }>;

/** Archivo del paquete que falta, sale de su directorio o no coincide con su hash. */
export type SchemaBundleFailure = Readonly<{
  path: string;
  reason: "MISSING" | "INVALID_PATH" | "HASH_MISMATCH";
}>;

/** Una violación del XSD: línea del XML y mensaje de libxml2, sin rutas ni detalles del motor. */
export type XsdViolation = Readonly<{ line: number | null; message: string }>;

export type XsdValidation =
  Readonly<{ valid: true }> | Readonly<{ valid: false; violations: readonly XsdViolation[] }>;

/** Validación XSD sin red contra los esquemas versionados del producto (CTX §19, ADR 0021). */
export interface XsdValidator {
  /**
   * Un XML que no cumple el esquema, o que no está bien formado, es `valid: false`. Si el esquema
   * o uno de sus imports falta o su hash no coincide, falla cerrada con `XsdValidatorError`. Con la
   * concurrencia y la cola llenas es `VALIDATOR_BUSY`, y si tarda demasiado, `VALIDATOR_TIMEOUT`.
   */
  validate(xml: string, schema: RegisteredSchema): Promise<XsdValidation>;
  /** Comprueba, antes de reservar, que el esquema y sus imports están disponibles con su hash. */
  ensureAvailable(schema: RegisteredSchema): Promise<void>;
  /** Verifica el paquete completo (al arrancar): devuelve los archivos que fallan, sin lanzar. */
  verifyBundle(files: readonly SchemaFile[]): Promise<readonly SchemaBundleFailure[]>;
}

export const XSD_VALIDATOR_ERRORS = [
  "SCHEMA_UNAVAILABLE",
  "SCHEMA_HASH_MISMATCH",
  "VALIDATOR_FAILED",
  "VALIDATOR_BUSY",
  "VALIDATOR_TIMEOUT",
] as const;
export type XsdValidatorErrorCode = (typeof XSD_VALIDATOR_ERRORS)[number];

/** Fallo del validador traducido a un código; nunca lleva rutas, la salida de xmllint ni el XML. */
export class XsdValidatorError extends Error {
  readonly code: XsdValidatorErrorCode;
  constructor(code: XsdValidatorErrorCode) {
    super(code);
    this.name = "XsdValidatorError";
    this.code = code;
  }
}

/** Datos de la clave de acceso (CTX §8.1); la fecha es la de emisión en Ecuador (Q-08). */
export type AccessKeyInput = Readonly<{
  /** `YYYY-MM-DD`, capturada una vez al comenzar la emisión. */
  issueDate: string;
  documentType: DocumentType;
  ruc: string;
  /** `1` Pruebas, `2` Producción (CTX §6). */
  environment: "1" | "2";
  establishment: string;
  emissionPoint: string;
  /** Nueve dígitos. */
  sequential: string;
  /** Ocho dígitos de `numericCode`. */
  numericCode: string;
}>;

/** Clave de acceso de 49 dígitos, tipo de emisión normal y dígito verificador módulo 11 (CTX §8). */
export interface AccessKeys {
  /** Ocho dígitos de un generador criptográfico, nunca `Math.random` (CTX §8.4). */
  numericCode(): string;
  /** Lanza `AccessKeyInputError` si un dato no tiene su longitud o no es numérico. */
  compose(input: AccessKeyInput): string;
}

/** Datos de la clave inválidos; nunca repite los valores. */
export class AccessKeyInputError extends Error {
  constructor() {
    super("ACCESS_KEY_INVALID_INPUT");
    this.name = "AccessKeyInputError";
  }
}

/** Impuesto de una línea, con sus importes ya materializados. */
export type InvoiceLineTax = Readonly<{
  /** Código del impuesto (`2` IVA) y código de la tarifa del catálogo. */
  taxCode: string;
  rateCode: string;
  /** Porcentaje de la tarifa, tal como lo publica el catálogo. */
  rate: string;
  base: string;
  amount: string;
}>;

export type InvoiceLineSnapshot = Readonly<{
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  /** `precioTotalSinImpuesto`. */
  taxableBase: string;
  taxes: readonly InvoiceLineTax[];
}>;

/**
 * Proyección directa del snapshot de la factura que recibe el builder (add-invoice-emission, D4):
 * todos los importes son `DecimalString` ya calculados y materializados por
 * `invoices/domain/amounts.ts`. El builder no lee base de datos, reloj, catálogos ni configuración.
 */
export type InvoiceSnapshot = Readonly<{
  /** Versión del XSD registrado con que se construye. */
  schemaVersion: string;
  /** `1` Pruebas, `2` Producción. */
  environment: "1" | "2";
  /** `YYYY-MM-DD`, capturada una vez al comenzar la emisión (Q-08). */
  issueDate: string;
  accessKey: string;
  /** Nueve dígitos. */
  sequential: string;
  issuer: Readonly<{
    ruc: string;
    legalName: string;
    tradeName: string | null;
    headOfficeAddress: string;
    establishment: string;
    emissionPoint: string;
    establishmentAddress: string | null;
    specialTaxpayerNumber: string | null;
    accountingRequired: boolean;
    /** Resolución de agente de retención (anexo 21), si corresponde. */
    withholdingAgentResolution: string | null;
    /** Contribuyente del régimen RIMPE (anexo 22): lleva la leyenda fija del XSD. */
    rimpe: boolean;
  }>;
  buyer: Readonly<{
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
  }>;
  lines: readonly InvoiceLineSnapshot[];
  totals: Readonly<{
    withoutTaxes: string;
    discount: string;
    taxes: readonly Readonly<{ taxCode: string; rateCode: string; base: string; amount: string }>[];
    total: string;
  }>;
  payments: readonly Readonly<{ method: string; total: string }>[];
}>;

/** XML sin firmar de una factura: función pura y determinista de su snapshot (Q-44). */
export interface InvoiceXmlBuilder {
  /** Versión del builder, que el snapshot y el artefacto registran. */
  readonly version: string;
  build(snapshot: InvoiceSnapshot): string;
}

/**
 * Proyección del snapshot de la nota de crédito que recibe su builder (add-credit-notes, design
 * D12 y D24): los importes son `DecimalString` ya calculados por `calculateCreditNoteAmounts` y
 * congelados al reservar. El builder solo transcribe; no lee la factura, el reloj ni catálogos.
 */
export type CreditNoteXmlSnapshot = Readonly<{
  /** Versión del XSD registrado con que se construye. */
  schemaVersion: string;
  environment: "1" | "2";
  issueDate: string;
  accessKey: string;
  sequential: string;
  issuer: InvoiceSnapshot["issuer"];
  /** El comprador de la factura modificada, tal como figura en ella. */
  buyer: Readonly<{ identificationType: string; identification: string; legalName: string }>;
  /** Comprobante modificado: tipo, número `EEE-PPP-SSSSSSSSS` y fecha `YYYY-MM-DD`. */
  modified: Readonly<{ documentType: "01"; documentNumber: string; issueDate: string }>;
  lines: readonly InvoiceLineSnapshot[];
  totals: Readonly<{
    withoutTaxes: string;
    taxes: readonly Readonly<{ taxCode: string; rateCode: string; base: string; amount: string }>[];
    /** `valorModificacion`. */
    total: string;
  }>;
  /** `motivo`: una sola línea de 1 a 300 caracteres. */
  reason: string;
}>;

/** XML sin firmar de una nota de crédito: función pura y determinista de su snapshot (D12). */
export interface CreditNoteXmlBuilder {
  readonly version: string;
  build(snapshot: CreditNoteXmlSnapshot): string;
}

export const INVOICE_XML_ERRORS = [
  "UNSUPPORTED_SCHEMA_VERSION",
  "INVALID_SNAPSHOT_AMOUNT",
  "INVALID_SNAPSHOT_TEXT",
] as const;
export type InvoiceXmlErrorCode = (typeof INVOICE_XML_ERRORS)[number];

/** Snapshot que no se puede escribir; el error nunca lleva datos del comprobante. */
export class InvoiceXmlError extends Error {
  readonly code: InvoiceXmlErrorCode;
  constructor(code: InvoiceXmlErrorCode) {
    super(code);
    this.name = "InvoiceXmlError";
    this.code = code;
  }
}

/** Snapshot de una nota de crédito que no se puede escribir, con los mismos códigos. */
export class CreditNoteXmlError extends Error {
  readonly code: InvoiceXmlErrorCode;
  constructor(code: InvoiceXmlErrorCode) {
    super(code);
    this.name = "CreditNoteXmlError";
    this.code = code;
  }
}
