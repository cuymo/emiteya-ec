// Errores de la firma electrónica con código estable para la API (design D3, D7 y D9). Ningún
// mensaje incluye la contraseña ni contenido del archivo.
import { formatCertificateBytes } from "@facturador/contracts";
import { AppError, ConflictError } from "../../../platform/http/errors.ts";
import type { CertificateRejection, IncompatibleReason } from "./ports.ts";

/** Mensaje exacto para la limitación de S-6: PBES2 con una contraseña con caracteres no ASCII. */
export const PASSWORD_ENCODING_MESSAGE =
  "Este archivo PKCS#12 utiliza una combinación de formato y contraseña que no podemos procesar. Intenta exportarlo nuevamente usando una contraseña con caracteres ASCII.";

const INCOMPATIBLE_MESSAGES: Record<IncompatibleReason, string> = {
  PASSWORD_ENCODING: PASSWORD_ENCODING_MESSAGE,
  CHAIN_ORDER:
    "En este archivo PKCS#12 el certificado del titular no es el primero, así que no podemos firmar con él. Exporta la firma de nuevo o pide a tu entidad certificadora un archivo nuevo.",
  ITERATIONS:
    "Este archivo PKCS#12 usa un cifrado con un costo de procesamiento superior al admitido. Exporta la firma de nuevo con la configuración habitual de tu entidad certificadora.",
  TEST_SIGNATURE:
    "No pudimos firmar una prueba con este archivo PKCS#12. Pide a tu entidad certificadora un archivo nuevo.",
};

const REJECTION_MESSAGES: Record<
  Exclude<CertificateRejection, "CERTIFICATE_INCOMPATIBLE">,
  string
> = {
  CERTIFICATE_UNREADABLE: "El archivo no es una firma electrónica válida (PKCS#12).",
  CERTIFICATE_PASSWORD_INVALID: "La contraseña no corresponde al archivo de la firma.",
  CERTIFICATE_KEY_UNSUPPORTED:
    "La firma no sirve para firmar comprobantes: necesita una clave privada RSA de al menos 2048 bits que corresponda a su certificado.",
};

export function certificateRejected(
  code: CertificateRejection,
  reason?: IncompatibleReason,
): AppError {
  if (code === "CERTIFICATE_INCOMPATIBLE") {
    return new AppError(code, 400, INCOMPATIBLE_MESSAGES[reason ?? "TEST_SIGNATURE"]);
  }
  return new AppError(code, 400, REJECTION_MESSAGES[code]);
}

export const certificateTooLarge = (maxBytes: number) =>
  new AppError(
    "CERTIFICATE_TOO_LARGE",
    400,
    `El archivo de la firma supera el tamaño admitido (${formatCertificateBytes(maxBytes)}).`,
  );

/** Fechas en la hora de Ecuador (ERS RNF-010), con el año completo. */
const DATE = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Guayaquil",
});

export const certificateNotValidNow = (notBefore: Date, notAfter: Date) =>
  new AppError(
    "CERTIFICATE_NOT_VALID_NOW",
    400,
    `La firma no está vigente: su vigencia va del ${DATE.format(notBefore)} al ${DATE.format(notAfter)}.`,
  );

export const certificateRucNotFound = (holder: string, issuer: string) =>
  new AppError(
    "CERTIFICATE_RUC_NOT_FOUND",
    400,
    `No encontramos un RUC en este certificado (titular: ${holder}; emisor: ${issuer}). El SRI rechaza las firmas cuyo certificado no contiene RUC: pide a tu entidad certificadora un certificado con RUC.`,
  );

export const certificateChanged = () =>
  new ConflictError(
    "CERTIFICATE_CHANGED",
    "La firma vigente cambió mientras la reemplazabas. Recarga para ver la firma vigente.",
  );

export const custodyDisabled = () =>
  new ConflictError(
    "CERTIFICATE_CUSTODY_DISABLED",
    "Esta instalación no tiene custodia de firmas configurada: no se pueden cargar firmas.",
  );
