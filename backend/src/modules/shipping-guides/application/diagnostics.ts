// Diagnóstico del último intento de firma de una guía de remisión (add-shipping-guides, design D2):
// los mismos códigos, clases y mensajes compartidos de `fiscal` que la factura, con el comprobante
// nombrado como guía de remisión.
import type { SigningAttemptCode } from "@facturador/contracts";
import {
  signingDiagnosticMessage,
  type DocumentDiagnosticMessages,
} from "../../fiscal/application/signing-diagnostics.ts";

export { isAttemptCode } from "../../fiscal/application/signing-diagnostics.ts";

const SHIPPING_GUIDE_MESSAGES: DocumentDiagnosticMessages = {
  PERSIST_FAILED: "No se pudo guardar la guía de remisión firmada. Reintenta la firma.",
  SCHEMA_UNAVAILABLE:
    "El esquema XSD de la guía de remisión no está disponible en la instalación. Contacta a soporte.",
  SCHEMA_HASH_MISMATCH:
    "El esquema XSD de la guía de remisión no coincide con su registro. Contacta a soporte.",
  XSD_INVALID:
    "El XML de la guía de remisión no cumple el esquema XSD. Es un error del producto: contacta a soporte.",
  INVALID_SNAPSHOT_TEXT:
    "Un texto de la guía de remisión tiene caracteres que XML no admite. Contacta a soporte.",
  INVALID_SNAPSHOT_AMOUNT: "Una cantidad de la guía de remisión no es válida. Contacta a soporte.",
};

/** Mensaje del diagnóstico de una guía; para XSD_INVALID añade solo la línea y el elemento. */
export function shippingGuideDiagnosticMessage(
  code: SigningAttemptCode,
  detail: { line: number | null; element: string | null } | null,
): string {
  return signingDiagnosticMessage(SHIPPING_GUIDE_MESSAGES, code, detail);
}
