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

/** Esquema del registro de esquemas (CTX §19.3, design D11 de add-fiscal-catalogs). */
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
