// Diagnóstico del último intento de firma (add-invoice-emission, design D10): cada código con su
// clase y un mensaje para el usuario, sin secretos, sin el XML y sin la salida de libxml2.
import {
  SIGNING_ATTEMPT_CODES,
  type SigningAttemptClass,
  type SigningAttemptCode,
} from "@facturador/contracts";

export const DIAGNOSTIC_MESSAGES: Record<SigningAttemptCode, string> = {
  VALIDATOR_BUSY: "La validación del XML está saturada. Reintenta la firma en unos segundos.",
  VALIDATOR_TIMEOUT: "La validación del XML tardó demasiado. Reintenta la firma.",
  CRYPTO_BUSY: "El servicio de firma está saturado. Reintenta en unos segundos.",
  CRYPTO_TIMEOUT: "La firma tardó demasiado y se canceló. Reintenta la firma.",
  CRYPTO_UNAVAILABLE: "El servicio de firma no está disponible. Reintenta en unos minutos.",
  PERSIST_FAILED: "No se pudo guardar la factura firmada. Reintenta la firma.",
  SIGNING_CERTIFICATE_NOT_USABLE:
    "La firma electrónica de la empresa no es utilizable: carga una vigente y reintenta.",
  CUSTODY_UNAVAILABLE:
    "La clave de custodia de la instalación no abre la firma electrónica: vuelve a cargar la firma o revisa la configuración.",
  CERTIFICATE_MISMATCH:
    "El certificado de la firma no coincide con la firma registrada: vuelve a cargar la firma.",
  SIGNER_FAILED:
    "No se pudo firmar con la firma electrónica cargada. Revísala, vuelve a cargarla y reintenta.",
  SCHEMA_UNAVAILABLE:
    "El esquema XSD de la factura no está disponible en la instalación. Contacta a soporte.",
  SCHEMA_HASH_MISMATCH:
    "El esquema XSD de la factura no coincide con su registro. Contacta a soporte.",
  XSD_INVALID:
    "El XML de la factura no cumple el esquema XSD. Es un error del producto: contacta a soporte.",
  SIGNED_XML_INVALID:
    "El XML firmado no cumple el esquema XSD. Es un error del producto: contacta a soporte.",
  INVALID_SNAPSHOT_TEXT:
    "Un texto de la factura tiene caracteres que XML no admite. Contacta a soporte.",
  INVALID_SNAPSHOT_AMOUNT: "Un importe de la factura no es válido. Contacta a soporte.",
};

export const isAttemptCode = (code: string): code is SigningAttemptCode =>
  Object.hasOwn(SIGNING_ATTEMPT_CODES, code);

export const classOf = (code: SigningAttemptCode): SigningAttemptClass =>
  SIGNING_ATTEMPT_CODES[code];

/** Mensaje del diagnóstico; para XSD_INVALID añade solo la línea y el elemento, nunca su valor. */
export function diagnosticMessage(
  code: SigningAttemptCode,
  detail: { line: number | null; element: string | null } | null,
): string {
  const where = [
    detail?.line != null ? `línea ${detail.line}` : null,
    detail?.element ? `elemento ${detail.element}` : null,
  ].filter((part): part is string => part !== null);
  return where.length > 0
    ? `${DIAGNOSTIC_MESSAGES[code]} (${where.join(", ")})`
    : DIAGNOSTIC_MESSAGES[code];
}
