// Diagnóstico del último intento de firma (add-invoice-emission, design D10): cada código con su
// clase y un mensaje para el usuario, sin secretos, sin el XML y sin la salida de libxml2. Los
// mensajes que no nombran el comprobante y el formato son los compartidos de `fiscal`.
import type { SigningAttemptCode } from "@facturador/contracts";
import {
  SHARED_DIAGNOSTIC_MESSAGES,
  signingDiagnosticMessage,
  type DocumentDiagnosticMessages,
} from "../../fiscal/application/signing-diagnostics.ts";

export { isAttemptCode } from "../../fiscal/application/signing-diagnostics.ts";

const INVOICE_MESSAGES: DocumentDiagnosticMessages = {
  PERSIST_FAILED: "No se pudo guardar la factura firmada. Reintenta la firma.",
  SCHEMA_UNAVAILABLE:
    "El esquema XSD de la factura no está disponible en la instalación. Contacta a soporte.",
  SCHEMA_HASH_MISMATCH:
    "El esquema XSD de la factura no coincide con su registro. Contacta a soporte.",
  XSD_INVALID:
    "El XML de la factura no cumple el esquema XSD. Es un error del producto: contacta a soporte.",
  INVALID_SNAPSHOT_TEXT:
    "Un texto de la factura tiene caracteres que XML no admite. Contacta a soporte.",
  INVALID_SNAPSHOT_AMOUNT: "Un importe de la factura no es válido. Contacta a soporte.",
};

export const DIAGNOSTIC_MESSAGES: Record<SigningAttemptCode, string> = {
  ...SHARED_DIAGNOSTIC_MESSAGES,
  ...INVOICE_MESSAGES,
};

/** Mensaje del diagnóstico; para XSD_INVALID añade solo la línea y el elemento, nunca su valor. */
export function diagnosticMessage(
  code: SigningAttemptCode,
  detail: { line: number | null; element: string | null } | null,
): string {
  return signingDiagnosticMessage(INVOICE_MESSAGES, code, detail);
}
