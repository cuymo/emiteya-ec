// Entrega por correo de los comprobantes autorizados (add-email-delivery, design D8 y D10): el
// servidor de correo de la empresa, el correo de prueba y los envíos de un comprobante. La
// contraseña SMTP solo entra en el cambio de la configuración y nunca sale: la consulta dice si hay
// una guardada.
import { z } from "zod";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_PATTERN } from "./invoices.ts";
import { environmentSchema, optionalText, strictBody } from "./taxpayer.ts";

export const EMAIL_SECURITIES = ["TLS", "STARTTLS", "NONE"] as const;
export const emailSecuritySchema = z.enum(EMAIL_SECURITIES, {
  error: "La seguridad no es válida.",
});
export type EmailSecurity = z.infer<typeof emailSecuritySchema>;

export const EMAIL_HOST_MAX_LENGTH = 253;
export const EMAIL_ADDRESS_MAX_LENGTH = 320;
export const EMAIL_FROM_NAME_MAX_LENGTH = 120;
export const EMAIL_PASSWORD_MAX_LENGTH = 256;
/** Direcciones de un reenvío: defensa de recursos del sistema (spec, «Reenvío manual»). */
export const EMAIL_RESEND_MAX_RECIPIENTS = 10;
const SINGLE_LINE = /^[^\r\n]*$/;

/** Una dirección de correo recortada, con su forma y su longitud. */
export const emailAddressSchema = z
  .string({ error: "El correo no tiene un formato válido." })
  .trim()
  .pipe(
    z
      .email({ error: "El correo no tiene un formato válido." })
      .max(EMAIL_ADDRESS_MAX_LENGTH, "El correo no tiene un formato válido."),
  );

const hostSchema = z
  .string({ error: "El servidor es obligatorio." })
  .trim()
  .min(1, "El servidor es obligatorio.")
  .max(EMAIL_HOST_MAX_LENGTH, `El servidor tiene como máximo ${EMAIL_HOST_MAX_LENGTH} caracteres.`)
  .regex(/^\S+$/, "El servidor no puede tener espacios.");

const portSchema = z
  .number({ error: "El puerto es obligatorio." })
  .int("El puerto va de 1 a 65535.")
  .min(1, "El puerto va de 1 a 65535.")
  .max(65535, "El puerto va de 1 a 65535.");

const usernameSchema = z
  .string()
  .max(
    EMAIL_ADDRESS_MAX_LENGTH,
    `El usuario tiene como máximo ${EMAIL_ADDRESS_MAX_LENGTH} caracteres.`,
  )
  .regex(SINGLE_LINE, "El usuario no puede tener saltos de línea.");

const fromNameSchema = z
  .string({ error: "El nombre del remitente es obligatorio." })
  .normalize("NFC")
  .trim()
  .min(1, "El nombre del remitente es obligatorio.")
  .max(
    EMAIL_FROM_NAME_MAX_LENGTH,
    `El nombre del remitente tiene como máximo ${EMAIL_FROM_NAME_MAX_LENGTH} caracteres.`,
  )
  .regex(SINGLE_LINE, "El nombre del remitente no puede tener saltos de línea.");

/** La contraseña no se recorta: un espacio al inicio o al final puede ser parte de ella. */
const passwordSchema = z
  .string({ error: "La contraseña no es válida." })
  .min(1, "La contraseña no puede estar vacía.")
  .max(
    EMAIL_PASSWORD_MAX_LENGTH,
    `La contraseña tiene como máximo ${EMAIL_PASSWORD_MAX_LENGTH} caracteres.`,
  )
  .regex(SINGLE_LINE, "La contraseña no puede tener saltos de línea.");

/**
 * PUT /email/settings. Sin `password`, se conserva la guardada; sin usuario, el servidor no pide
 * autenticación y la contraseña guardada se descarta. `expectedVersion` es null para la primera
 * configuración y la versión vigente para cambiarla.
 */
export const updateEmailSettingsSchema = strictBody({
  host: hostSchema,
  port: portSchema,
  security: emailSecuritySchema,
  username: optionalText(usernameSchema, "El usuario no es válido."),
  password: passwordSchema.optional(),
  fromName: fromNameSchema,
  fromAddress: emailAddressSchema,
  bccAddress: optionalText(emailAddressSchema, "El correo no tiene un formato válido."),
  autoSend: z.boolean({ error: "Indica si el envío automático está activo." }),
  testRecipient: optionalText(emailAddressSchema, "El correo no tiene un formato válido."),
  expectedVersion: z
    .number({ error: "La versión esperada es obligatoria." })
    .int("La versión esperada no es válida.")
    .min(1, "La versión esperada no es válida.")
    .nullable(),
});
export type UpdateEmailSettingsInput = z.input<typeof updateEmailSettingsSchema>;
export type EmailSettingsData = z.output<typeof updateEmailSettingsSchema>;

export const emailSettingsViewSchema = z.strictObject({
  host: z.string(),
  port: z.number().int(),
  security: emailSecuritySchema,
  username: z.string().nullable(),
  /** Si hay una contraseña guardada; la contraseña nunca sale del servidor. */
  passwordSet: z.boolean(),
  fromName: z.string(),
  fromAddress: z.string(),
  bccAddress: z.string().nullable(),
  autoSend: z.boolean(),
  testRecipient: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type EmailSettingsView = z.infer<typeof emailSettingsViewSchema>;

/** GET /email/settings: la configuración, o null sin configurar, y lo que decide el despliegue. */
export const emailSettingsResponseSchema = z.strictObject({
  settings: emailSettingsViewSchema.nullable(),
  /** `EMAIL_DELIVERY_ENABLED`: apagado, el sistema no conecta con ningún servidor de correo. */
  deliveryEnabled: z.boolean(),
  /** `EMAIL_ALLOW_PLAINTEXT_SMTP`: si el despliegue admite un servidor sin cifrado. */
  plaintextAllowed: z.boolean(),
});
export type EmailSettingsResponse = z.infer<typeof emailSettingsResponseSchema>;

/**
 * GET /email/availability: lo que la confirmación de la emisión necesita saber del correo, también
 * para el operador. Nunca el servidor, el usuario ni la contraseña.
 */
export const emailAvailabilitySchema = z.strictObject({
  /** Si la empresa registró su servidor de correo. */
  configured: z.boolean(),
  /** `EMAIL_DELIVERY_ENABLED` del despliegue. */
  deliveryEnabled: z.boolean(),
  /** El envío automático de la empresa; false sin servidor. */
  autoSend: z.boolean(),
  /** El único destino de los comprobantes del ambiente de Pruebas. */
  testRecipient: z.string().nullable(),
});
export type EmailAvailability = z.infer<typeof emailAvailabilitySchema>;

/** POST /email/test. */
export const sendTestEmailSchema = strictBody({ to: emailAddressSchema });
export type SendTestEmailInput = z.input<typeof sendTestEmailSchema>;

export const testEmailResultSchema = z.strictObject({
  /** true si el servidor aceptó el correo; no prueba que llegó al buzón. */
  accepted: z.boolean(),
  message: z.string(),
  to: z.string(),
  at: z.iso.datetime(),
});
export type TestEmailResult = z.infer<typeof testEmailResultSchema>;

export const EMAIL_DELIVERY_STATUSES = [
  "PENDING",
  "RETRYING",
  "SENT",
  "FAILED",
  "NO_RECIPIENT",
  "DISABLED",
] as const;
export const emailDeliveryStatusSchema = z.enum(EMAIL_DELIVERY_STATUSES, {
  error: "El estado del correo no es válido.",
});
export type EmailDeliveryStatus = z.infer<typeof emailDeliveryStatusSchema>;

export const EMAIL_DELIVERY_ORIGINS = ["AUTOMATIC", "MANUAL"] as const;
export const EMAIL_RECIPIENT_OUTCOMES = ["ACCEPTED", "REJECTED"] as const;
export const EMAIL_ATTEMPT_OUTCOMES = ["SENT", "RETRYABLE", "DETERMINISTIC"] as const;

/** Un envío de un comprobante, sin el contenido del correo ni datos de la configuración. */
export const emailDeliveryViewSchema = z.strictObject({
  id: z.string(),
  origin: z.enum(EMAIL_DELIVERY_ORIGINS),
  /** Quien pidió el reenvío; null en el envío automático. */
  requestedBy: z.strictObject({ name: z.string() }).nullable(),
  environment: environmentSchema,
  /** true si fue al correo de prueba por ser un comprobante del ambiente de Pruebas. */
  testRedirect: z.boolean(),
  status: emailDeliveryStatusSchema,
  recipients: z.array(
    z.strictObject({
      address: z.string(),
      /** null mientras el envío no termina. */
      outcome: z.enum(EMAIL_RECIPIENT_OUTCOMES).nullable(),
      reason: z.string().nullable(),
    }),
  ),
  /** El motivo, en lenguaje claro, de un envío fallido, sin destinatario o desactivado. */
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  attempts: z.array(
    z.strictObject({
      number: z.number().int(),
      at: z.iso.datetime(),
      outcome: z.enum(EMAIL_ATTEMPT_OUTCOMES),
      smtpCode: z.number().int().nullable(),
    }),
  ),
});
export type EmailDeliveryView = z.infer<typeof emailDeliveryViewSchema>;

/** GET /documents/:id/email-recipients: las direcciones propuestas para enviar o reenviar. */
export const emailRecipientsViewSchema = z.strictObject({
  recipients: z.array(z.string()),
  environment: environmentSchema,
  /** En Pruebas, el envío va al correo de prueba y no a estas direcciones. */
  testRedirect: z.boolean(),
  testRecipient: z.string().nullable(),
});
export type EmailRecipientsView = z.infer<typeof emailRecipientsViewSchema>;

/** POST /documents/:id/email-deliveries: de 1 a 10 direcciones distintas. */
export const resendEmailSchema = strictBody({
  recipients: z
    .array(emailAddressSchema, { error: "Las direcciones no son válidas." })
    .min(1, "Escribe al menos un correo.")
    .max(
      EMAIL_RESEND_MAX_RECIPIENTS,
      `Un envío admite como máximo ${EMAIL_RESEND_MAX_RECIPIENTS} correos.`,
    )
    .superRefine((recipients, ctx) => {
      const seen = new Set<string>();
      recipients.forEach((address, index) => {
        const key = address.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({ code: "custom", path: [index], message: "El correo está repetido." });
        }
        seen.add(key);
      });
    }),
});
export type ResendEmailInput = z.input<typeof resendEmailSchema>;

/** Cabecera del reenvío: la misma clave con la misma solicitud devuelve el mismo envío. */
export const resendEmailHeadersSchema = z.object({
  [IDEMPOTENCY_KEY_HEADER]: z
    .string({ error: "La cabecera Idempotency-Key es obligatoria." })
    .regex(IDEMPOTENCY_KEY_PATTERN, "La cabecera Idempotency-Key no es válida."),
});
