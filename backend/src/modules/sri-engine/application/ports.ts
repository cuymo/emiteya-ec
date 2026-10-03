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
export type RegisteredSchema = Readonly<{
  documentType: DocumentType;
  version: string;
  file: string;
  sha256: string;
}>;

/** Una violación del XSD: línea del XML y mensaje de libxml2, sin rutas ni detalles del motor. */
export type XsdViolation = Readonly<{ line: number | null; message: string }>;

export type XsdValidation =
  Readonly<{ valid: true }> | Readonly<{ valid: false; violations: readonly XsdViolation[] }>;

/** Validación XSD sin red contra los esquemas versionados del producto (CTX §19, ADR 0021). */
export interface XsdValidator {
  /**
   * Un XML que no cumple el esquema, o que no está bien formado, es `valid: false`. Si el esquema
   * o uno de sus imports falta o su hash no coincide, falla cerrada con `XsdValidatorError`.
   */
  validate(xml: string, schema: RegisteredSchema): Promise<XsdValidation>;
}

export const XSD_VALIDATOR_ERRORS = [
  "SCHEMA_UNAVAILABLE",
  "SCHEMA_HASH_MISMATCH",
  "VALIDATOR_FAILED",
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
