// Diagnóstico del último intento de firma de una nota de débito (add-debit-notes, design D2): los
// mismos códigos y clases que la factura, con el comprobante nombrado como nota de débito.
import type { SigningAttemptCode } from "@facturador/contracts";
import { diagnosticMessage } from "../../invoices/application/diagnostics.ts";

export { isAttemptCode } from "../../invoices/application/diagnostics.ts";

const DEBIT_NOTE_MESSAGES: Partial<Record<SigningAttemptCode, string>> = {
  PERSIST_FAILED: "No se pudo guardar la nota de débito firmada. Reintenta la firma.",
  SCHEMA_UNAVAILABLE:
    "El esquema XSD de la nota de débito no está disponible en la instalación. Contacta a soporte.",
  SCHEMA_HASH_MISMATCH:
    "El esquema XSD de la nota de débito no coincide con su registro. Contacta a soporte.",
  XSD_INVALID:
    "El XML de la nota de débito no cumple el esquema XSD. Es un error del producto: contacta a soporte.",
  INVALID_SNAPSHOT_TEXT:
    "Un texto de la nota de débito tiene caracteres que XML no admite. Contacta a soporte.",
  INVALID_SNAPSHOT_AMOUNT: "Un importe de la nota de débito no es válido. Contacta a soporte.",
};

/** Mensaje del diagnóstico de una nota; para XSD_INVALID añade solo la línea y el elemento. */
export function debitNoteDiagnosticMessage(
  code: SigningAttemptCode,
  detail: { line: number | null; element: string | null } | null,
): string {
  const own = DEBIT_NOTE_MESSAGES[code];
  if (!own) return diagnosticMessage(code, detail);
  const where = [
    detail?.line != null ? `línea ${detail.line}` : null,
    detail?.element ? `elemento ${detail.element}` : null,
  ].filter((part): part is string => part !== null);
  return where.length > 0 ? `${own} (${where.join(", ")})` : own;
}
