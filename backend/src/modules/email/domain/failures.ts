// Fallos de un envío por correo (add-email-delivery, design D6; spec email-delivery, «Reintentos de
// los fallos temporales»): una tabla cerrada de códigos, si se reintentan y su motivo en lenguaje
// claro. La respuesta técnica del servidor nunca llega al usuario: solo se guarda recortada en el
// intento.

export const EMAIL_FAILURE_CODES = [
  "SERVER_UNAVAILABLE",
  "TIMEOUT",
  "TEMPORARY_REJECTION",
  "AUTH_REJECTED",
  "SENDER_REJECTED",
  "ALL_RECIPIENTS_REJECTED",
  "MESSAGE_REJECTED",
  "TLS_FAILED",
  "TLS_REQUIRED",
  "PLAINTEXT_NOT_ALLOWED",
  "NOT_CONFIGURED",
  "PASSWORD_UNAVAILABLE",
  "ARTIFACT_MISSING",
  "UNKNOWN",
  // Motivos de un envío sin destinatario o desactivado (design D2 y D3): no son fallos del servidor.
  "NO_ADDRESS",
  "CONSUMER_FINAL",
  "NO_TEST_RECIPIENT",
  "DELIVERY_DISABLED",
  "AUTO_SEND_OFF",
] as const;
export type EmailFailureCode = (typeof EMAIL_FAILURE_CODES)[number];

/** RETRYABLE: vuelve a intentarse con espera creciente. DETERMINISTIC: se detiene y se avisa. */
export type EmailFailureClass = "RETRYABLE" | "DETERMINISTIC";

const FAILURES: Record<EmailFailureCode, { kind: EmailFailureClass; message: string }> = {
  SERVER_UNAVAILABLE: {
    kind: "RETRYABLE",
    message: "No se pudo conectar con el servidor de correo.",
  },
  TIMEOUT: { kind: "RETRYABLE", message: "El servidor de correo no respondió a tiempo." },
  TEMPORARY_REJECTION: {
    kind: "RETRYABLE",
    message: "El servidor de correo no aceptó el envío por ahora.",
  },
  AUTH_REJECTED: {
    kind: "DETERMINISTIC",
    message: "El servidor rechazó el usuario o la contraseña.",
  },
  SENDER_REJECTED: {
    kind: "DETERMINISTIC",
    message: "El servidor de correo rechazó el remitente.",
  },
  ALL_RECIPIENTS_REJECTED: {
    kind: "DETERMINISTIC",
    message: "El servidor de correo rechazó todas las direcciones.",
  },
  MESSAGE_REJECTED: {
    kind: "DETERMINISTIC",
    message: "El servidor de correo rechazó el mensaje.",
  },
  TLS_FAILED: {
    kind: "DETERMINISTIC",
    message:
      "No se pudo establecer una conexión segura con el servidor de correo: su certificado no es válido o no corresponde al servidor.",
  },
  TLS_REQUIRED: {
    kind: "DETERMINISTIC",
    message:
      "El servidor de correo no ofrece una conexión cifrada con STARTTLS: elige TLS directo u otro puerto.",
  },
  PLAINTEXT_NOT_ALLOWED: {
    kind: "DETERMINISTIC",
    message: "Este despliegue exige una conexión cifrada con el servidor de correo.",
  },
  NOT_CONFIGURED: {
    kind: "DETERMINISTIC",
    message: "La empresa no tiene un servidor de correo configurado.",
  },
  PASSWORD_UNAVAILABLE: {
    kind: "DETERMINISTIC",
    message:
      "No se pudo usar la contraseña guardada del servidor de correo: vuelve a escribirla en Configuración → Correos.",
  },
  ARTIFACT_MISSING: {
    kind: "DETERMINISTIC",
    message:
      "Falta el XML autorizado o el RIDE del comprobante, o no pasó su verificación: el correo lleva siempre los dos.",
  },
  UNKNOWN: {
    kind: "RETRYABLE",
    message: "El envío falló por un error inesperado del servidor de correo.",
  },
  NO_ADDRESS: {
    kind: "DETERMINISTIC",
    message: "El receptor no tiene correo: entrega el RIDE impreso si el receptor lo pide.",
  },
  CONSUMER_FINAL: {
    kind: "DETERMINISTIC",
    message:
      "Comprobante a consumidor final, sin correo: entrega el RIDE impreso si el receptor lo pide.",
  },
  NO_TEST_RECIPIENT: {
    kind: "DETERMINISTIC",
    message: "Configura el correo de prueba para recibir los comprobantes del ambiente de Pruebas.",
  },
  DELIVERY_DISABLED: {
    kind: "DETERMINISTIC",
    message: "El envío de correos está desactivado en este despliegue.",
  },
  AUTO_SEND_OFF: {
    kind: "DETERMINISTIC",
    message: "El envío automático está desactivado: puedes enviar el correo a mano.",
  },
};

export const failureClass = (code: EmailFailureCode): EmailFailureClass => FAILURES[code].kind;
export const failureMessage = (code: EmailFailureCode): string => FAILURES[code].message;

/** Un fallo de un intento: su código, su código SMTP si lo hubo y un detalle técnico recortado. */
export type EmailFailure = Readonly<{
  code: EmailFailureCode;
  smtpCode: number | null;
  detail: string;
}>;

export const DETAIL_MAX_LENGTH = 200;
