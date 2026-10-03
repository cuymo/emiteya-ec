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
