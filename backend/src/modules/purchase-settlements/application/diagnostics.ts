// Diagnóstico del último intento de firma de una liquidación de compra (add-purchase-settlements,
// design D2): los mismos códigos, clases y mensajes compartidos de `fiscal` que la factura, con el
// comprobante nombrado como liquidación de compra.
import type { SigningAttemptCode } from "@facturador/contracts";
import {
  signingDiagnosticMessage,
  type DocumentDiagnosticMessages,
} from "../../fiscal/application/signing-diagnostics.ts";

export { isAttemptCode } from "../../fiscal/application/signing-diagnostics.ts";

const PURCHASE_SETTLEMENT_MESSAGES: DocumentDiagnosticMessages = {
  PERSIST_FAILED: "No se pudo guardar la liquidación de compra firmada. Reintenta la firma.",
  SCHEMA_UNAVAILABLE:
    "El esquema XSD de la liquidación de compra no está disponible en la instalación. Contacta a soporte.",
  SCHEMA_HASH_MISMATCH:
    "El esquema XSD de la liquidación de compra no coincide con su registro. Contacta a soporte.",
  XSD_INVALID:
    "El XML de la liquidación de compra no cumple el esquema XSD. Es un error del producto: contacta a soporte.",
  INVALID_SNAPSHOT_TEXT:
    "Un texto de la liquidación de compra tiene caracteres que XML no admite. Contacta a soporte.",
  INVALID_SNAPSHOT_AMOUNT:
    "Un importe de la liquidación de compra no es válido. Contacta a soporte.",
};

/** Mensaje del diagnóstico de una liquidación; para XSD_INVALID añade solo la línea y el elemento. */
export function purchaseSettlementDiagnosticMessage(
  code: SigningAttemptCode,
  detail: { line: number | null; element: string | null } | null,
): string {
  return signingDiagnosticMessage(PURCHASE_SETTLEMENT_MESSAGES, code, detail);
}
