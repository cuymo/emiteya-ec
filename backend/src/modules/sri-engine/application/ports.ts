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

/**
 * Proyección del snapshot de la nota de débito que recibe su builder (add-debit-notes, design D16):
 * los importes son `DecimalString` ya calculados por `calculateDebitNoteAmounts` y congelados al
 * reservar, y la forma de pago es la única del snapshot. El builder solo transcribe; no lee la
 * factura, el reloj ni catálogos.
 */
export type DebitNoteXmlSnapshot = Readonly<{
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
  /** `totalSinImpuestos`. */
  withoutTaxes: string;
  /** Un impuesto por tratamiento usado: código, código de porcentaje, tarifa, base e impuesto. */
  taxes: readonly Readonly<{
    taxCode: string;
    rateCode: string;
    rate: string;
    base: string;
    amount: string;
  }>[];
  /** `valorTotal`. */
  total: string;
  /** El único `pago`: `formaPago` y `total` (el valor total). */
  payment: Readonly<{ method: string; total: string }>;
  /** Un `motivo` por concepto, en su orden: `razon` (la descripción) y `valor` (la base). */
  reasons: readonly Readonly<{ reason: string; value: string }>[];
}>;

/** XML sin firmar de una nota de débito: función pura y determinista de su snapshot (D16). */
export interface DebitNoteXmlBuilder {
  readonly version: string;
  build(snapshot: DebitNoteXmlSnapshot): string;
}

/**
 * Proyección del snapshot del comprobante de retención que recibe su builder (add-withholding-receipts,
 * design D17): los valores retenidos los calculó `calculateWithholdingAmounts` y los congeló la
 * reserva; los impuestos y los pagos de cada documento sustento son los que declaró el usuario. El
 * builder solo transcribe; no lee el tercero, el reloj ni catálogos.
 */
export type WithholdingReceiptXmlSnapshot = Readonly<{
  /** Versión del XSD registrado con que se construye. */
  schemaVersion: string;
  environment: "1" | "2";
  issueDate: string;
  accessKey: string;
  sequential: string;
  issuer: InvoiceSnapshot["issuer"];
  /** El sujeto retenido tal como se congeló al reservar. */
  subject: Readonly<{ identificationType: string; identification: string; legalName: string }>;
  /** `parteRel`: la declaración del usuario. */
  relatedParty: "SI" | "NO";
  /** `periodoFiscal`, `MM/AAAA`. */
  fiscalPeriod: string;
  supports: readonly Readonly<{
    /** `codSustento`: dos dígitos. */
    supportCode: string;
    /** `codDocSustento`: el código de dos caracteres (`01`, `02`, `03`). */
    documentType: string;
    /** `numDocSustento`: 15 dígitos. */
    number: string;
    /** `YYYY-MM-DD`. */
    issueDate: string;
    authorizationNumber: string | null;
    totalWithoutTaxes: string;
    importTotal: string;
    /** `impuestoDocSustento`: código, código de porcentaje, base, tarifa y valor declarados. */
    taxes: readonly Readonly<{
      taxCode: string;
      rateCode: string;
      base: string;
      tariff: string;
      amount: string;
    }>[];
    /** `retencion`: código, código de retención, base, porcentaje y valor retenido. */
    withholdings: readonly Readonly<{
      taxCode: string;
      code: string;
      base: string;
      percentage: string;
      amount: string;
    }>[];
    payments: readonly Readonly<{ method: string; total: string }>[];
  }>[];
}>;

/** XML sin firmar de un comprobante de retención: función pura y determinista de su snapshot. */
export interface WithholdingReceiptXmlBuilder {
  readonly version: string;
  build(snapshot: WithholdingReceiptXmlSnapshot): string;
}

/**
 * Snapshot de una guía de remisión 1.1.0 para su builder (add-shipping-guides, design D16): la
 * partida, el transportista, la placa, las fechas y los destinatarios con su sustento y su detalle,
 * tal como los congeló la reserva. No tiene importes.
 */
export type ShippingGuideXmlSnapshot = Readonly<{
  /** Versión del XSD registrado con que se construye. */
  schemaVersion: string;
  environment: "1" | "2";
  accessKey: string;
  sequential: string;
  issuer: InvoiceSnapshot["issuer"];
  /** `dirPartida`. */
  departureAddress: string;
  carrier: Readonly<{ identificationType: string; identification: string; legalName: string }>;
  /** `YYYY-MM-DD`. */
  transportStart: string;
  transportEnd: string;
  plate: string;
  recipients: readonly Readonly<{
    identification: string;
    legalName: string;
    address: string;
    motive: string;
    destinationEstablishmentCode: string | null;
    route: string | null;
    /** Solo con una factura sustento: sus cuatro datos. */
    support: Readonly<{
      documentType: string;
      /** `NNN-NNN-NNNNNNNNN`. */
      documentNumber: string;
      authorizationNumber: string;
      /** `YYYY-MM-DD`. */
      issueDate: string;
    }> | null;
    details: readonly Readonly<{
      mainCode: string | null;
      auxiliaryCode: string | null;
      description: string;
      quantity: string;
    }>[];
  }>[];
}>;

/** XML sin firmar de una guía de remisión: función pura y determinista de su snapshot. */
export interface ShippingGuideXmlBuilder {
  readonly version: string;
  build(snapshot: ShippingGuideXmlSnapshot): string;
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

/** Snapshot de una nota de débito que no se puede escribir, con los mismos códigos. */
export class DebitNoteXmlError extends Error {
  readonly code: InvoiceXmlErrorCode;
  constructor(code: InvoiceXmlErrorCode) {
    super(code);
    this.name = "DebitNoteXmlError";
    this.code = code;
  }
}

/** Snapshot de un comprobante de retención que no se puede escribir, con los mismos códigos. */
export class WithholdingReceiptXmlError extends Error {
  readonly code: InvoiceXmlErrorCode;
  constructor(code: InvoiceXmlErrorCode) {
    super(code);
    this.name = "WithholdingReceiptXmlError";
    this.code = code;
  }
}

/** Snapshot de una guía de remisión que no se puede escribir, con los mismos códigos. */
export class ShippingGuideXmlError extends Error {
  readonly code: InvoiceXmlErrorCode;
  constructor(code: InvoiceXmlErrorCode) {
    super(code);
    this.name = "ShippingGuideXmlError";
    this.code = code;
  }
}
