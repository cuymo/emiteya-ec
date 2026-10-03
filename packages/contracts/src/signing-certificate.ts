// Contratos de la firma electrónica (add-signing-certificate, design D3, D8 y D9). Ninguna vista
// admite el archivo, la contraseña ni la clave privada: la API solo publica metadatos.
import { z } from "zod";

/** Límite por defecto del P12 decodificado; es configuración (CERTIFICATE_MAX_BYTES), no del SRI. */
export const CERTIFICATE_MAX_BYTES_DEFAULT = 64 * 1024;
/**
 * Tope absoluto del contrato y de la configuración, solo como defensa del payload: el límite
 * efectivo lo aplica el backend y es el único que se muestra al usuario.
 */
export const CERTIFICATE_MAX_BYTES_LIMIT = 1024 * 1024;

/**
 * Formato único de tamaños para el usuario, el mismo en el error del backend y en el selector de
 * archivo: 65536 -> "64 KiB". Redondea hacia abajo para no prometer de más un límite.
 */
export const formatCertificateBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${Math.floor(bytes / 1024)} KiB`;
export const CERTIFICATE_PASSWORD_MAX_LENGTH = 256;
export const EXPIRY_ALERT_DAYS = { min: 1, max: 90, default: 30 } as const;

const strict = <T extends z.core.$ZodLooseShape>(shape: T) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "La solicitud contiene campos no permitidos."
        : "La solicitud no es válida.",
  });

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_BASE64_LENGTH = Math.ceil(CERTIFICATE_MAX_BYTES_LIMIT / 3) * 4;

/**
 * PUT de la firma: el PKCS#12 en base64, su contraseña exacta (sin recortar ni normalizar) y la
 * firma vigente que el administrador ve, o null si no hay ninguna.
 */
export const uploadSigningCertificateSchema = strict({
  file: z
    .string({ error: "Selecciona el archivo de la firma electrónica." })
    .min(4, "Selecciona el archivo de la firma electrónica.")
    .max(MAX_BASE64_LENGTH, "El archivo de la firma supera el tamaño admitido.")
    .regex(BASE64, "El archivo de la firma no es válido."),
  password: z
    .string({ error: "Escribe la contraseña de la firma." })
    .min(1, "Escribe la contraseña de la firma.")
    .max(
      CERTIFICATE_PASSWORD_MAX_LENGTH,
      `La contraseña debe tener como máximo ${CERTIFICATE_PASSWORD_MAX_LENGTH} caracteres.`,
    ),
  expectedCurrentId: z.string().min(1).nullable(),
});
export type UploadSigningCertificateInput = z.infer<typeof uploadSigningCertificateSchema>;

const alertDaysMessage = `La anticipación debe ser un número entero de días entre ${EXPIRY_ALERT_DAYS.min} y ${EXPIRY_ALERT_DAYS.max}.`;
export const expiryAlertSchema = strict({
  days: z
    .number({ error: alertDaysMessage })
    .int(alertDaysMessage)
    .min(EXPIRY_ALERT_DAYS.min, alertDaysMessage)
    .max(EXPIRY_ALERT_DAYS.max, alertDaysMessage),
});
export type ExpiryAlertInput = z.infer<typeof expiryAlertSchema>;

/** Vigencia derivada al leer (design D8); NONE solo cuando la empresa no tiene firma. */
export const CERTIFICATE_STATES = [
  "NONE",
  "VALID",
  "EXPIRING",
  "EXPIRED",
  "KEY_UNAVAILABLE",
] as const;
export const certificateStateSchema = z.enum(CERTIFICATE_STATES);
export type CertificateState = z.infer<typeof certificateStateSchema>;

export const RUC_MATCHES = ["MATCH", "MISMATCH", "PENDING"] as const;
export const rucMatchSchema = z.enum(RUC_MATCHES);
export type RucMatch = z.infer<typeof rucMatchSchema>;

export const signingCertificateViewSchema = z.strictObject({
  id: z.string(),
  subject: z.string(),
  issuer: z.string(),
  serialNumber: z.string(),
  fingerprint: z.string(),
  notBefore: z.iso.datetime(),
  notAfter: z.iso.datetime(),
  detectedRuc: z.string(),
  /** RUC vigente de la empresa, para mostrar ambos en la advertencia; null sin datos. */
  companyRuc: z.string().nullable(),
  rucMatch: rucMatchSchema,
  state: certificateStateSchema.exclude(["NONE"]),
  usable: z.boolean(),
  daysToExpiry: z.number().int(),
  uploadedAt: z.iso.datetime(),
});
export type SigningCertificateView = z.infer<typeof signingCertificateViewSchema>;

export const signingCertificateResponseSchema = z.strictObject({
  certificate: signingCertificateViewSchema.nullable(),
  expiryAlertDays: z.number().int(),
  /** Límite efectivo del P12 decodificado (CERTIFICATE_MAX_BYTES), para el selector de archivo. */
  maxBytes: z.number().int().positive(),
});
export type SigningCertificateResponse = z.infer<typeof signingCertificateResponseSchema>;

export const signingCertificateUploadResultSchema = z.strictObject({
  certificate: signingCertificateViewSchema,
  /** true si el certificado ya era la firma vigente: nada cambió. */
  unchanged: z.boolean(),
});
export type SigningCertificateUploadResult = z.infer<typeof signingCertificateUploadResultSchema>;

/** Lo que ve un operador: solo la vigencia (access-control.md). */
export const certificateValidityViewSchema = z.strictObject({
  state: certificateStateSchema,
  usable: z.boolean(),
  notAfter: z.iso.datetime().nullable(),
  daysToExpiry: z.number().int().nullable(),
});
export type CertificateValidityView = z.infer<typeof certificateValidityViewSchema>;

export const expiryAlertResultSchema = z.strictObject({
  expiryAlertDays: z.number().int(),
});
