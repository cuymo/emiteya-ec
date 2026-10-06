// Diagnóstico del último intento de firma de un comprobante de retención (add-withholding-receipts,
// design D1 y D2): los mismos códigos, clases y mensajes compartidos de `fiscal` que la factura, con
// el comprobante nombrado como retención.
import type { SigningAttemptCode } from "@facturador/contracts";
import {
  signingDiagnosticMessage,
  type DocumentDiagnosticMessages,
} from "../../fiscal/application/signing-diagnostics.ts";

export { isAttemptCode } from "../../fiscal/application/signing-diagnostics.ts";

const WITHHOLDING_MESSAGES: DocumentDiagnosticMessages = {
  PERSIST_FAILED: "No se pudo guardar el comprobante de retención firmado. Reintenta la firma.",
  SCHEMA_UNAVAILABLE:
    "El esquema XSD del comprobante de retención no está disponible en la instalación. Contacta a soporte.",
  SCHEMA_HASH_MISMATCH:
    "El esquema XSD del comprobante de retención no coincide con su registro. Contacta a soporte.",
  XSD_INVALID:
    "El XML del comprobante de retención no cumple el esquema XSD. Es un error del producto: contacta a soporte.",
  INVALID_SNAPSHOT_TEXT:
    "Un texto del comprobante de retención tiene caracteres que XML no admite. Contacta a soporte.",
  INVALID_SNAPSHOT_AMOUNT:
    "Un importe del comprobante de retención no es válido. Contacta a soporte.",
};

/** Mensaje del diagnóstico de una retención; para XSD_INVALID añade solo la línea y el elemento. */
export function withholdingDiagnosticMessage(
  code: SigningAttemptCode,
  detail: { line: number | null; element: string | null } | null,
): string {
  return signingDiagnosticMessage(WITHHOLDING_MESSAGES, code, detail);
}
