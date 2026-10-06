// Diagnóstico compartido del último intento de firma (add-invoice-emission, design D10): los
// mensajes de los códigos que no nombran el comprobante y el formato con la línea y el elemento, sin
// secretos, sin el XML y sin la salida de libxml2. Cada tipo aporta los mensajes que lo nombran; la
// retención no importa `invoices` (add-withholding-receipts, design D1).
import { SIGNING_ATTEMPT_CODES, type SigningAttemptCode } from "@facturador/contracts";

export const SHARED_DIAGNOSTIC_MESSAGES = {
  VALIDATOR_BUSY: "La validación del XML está saturada. Reintenta la firma en unos segundos.",
  VALIDATOR_TIMEOUT: "La validación del XML tardó demasiado. Reintenta la firma.",
  CRYPTO_BUSY: "El servicio de firma está saturado. Reintenta en unos segundos.",
  CRYPTO_TIMEOUT: "La firma tardó demasiado y se canceló. Reintenta la firma.",
  CRYPTO_UNAVAILABLE: "El servicio de firma no está disponible. Reintenta en unos minutos.",
  SIGNING_CERTIFICATE_NOT_USABLE:
    "La firma electrónica de la empresa no es utilizable: carga una vigente y reintenta.",
  CUSTODY_UNAVAILABLE:
    "La clave de custodia de la instalación no abre la firma electrónica: vuelve a cargar la firma o revisa la configuración.",
  CERTIFICATE_MISMATCH:
    "El certificado de la firma no coincide con la firma registrada: vuelve a cargar la firma.",
  SIGNER_FAILED:
    "No se pudo firmar con la firma electrónica cargada. Revísala, vuelve a cargarla y reintenta.",
  SIGNED_XML_INVALID:
    "El XML firmado no cumple el esquema XSD. Es un error del producto: contacta a soporte.",
} as const satisfies Partial<Record<SigningAttemptCode, string>>;

/** Mensajes que nombran el comprobante: los aporta cada tipo. */
export type DocumentDiagnosticMessages = Record<
  Exclude<SigningAttemptCode, keyof typeof SHARED_DIAGNOSTIC_MESSAGES>,
  string
>;

export const isAttemptCode = (code: string): code is SigningAttemptCode =>
  Object.hasOwn(SIGNING_ATTEMPT_CODES, code);

/** Mensaje del diagnóstico; para XSD_INVALID añade solo la línea y el elemento, nunca su valor. */
export function signingDiagnosticMessage(
  own: DocumentDiagnosticMessages,
  code: SigningAttemptCode,
  detail: { line: number | null; element: string | null } | null,
): string {
  const message: string =
    code in own
      ? own[code as keyof DocumentDiagnosticMessages]
      : SHARED_DIAGNOSTIC_MESSAGES[code as keyof typeof SHARED_DIAGNOSTIC_MESSAGES];
  const where = [
    detail?.line != null ? `línea ${detail.line}` : null,
    detail?.element ? `elemento ${detail.element}` : null,
  ].filter((part): part is string => part !== null);
  return where.length > 0 ? `${message} (${where.join(", ")})` : message;
}
