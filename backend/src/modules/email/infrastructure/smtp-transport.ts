// Transporte SMTP con nodemailer (ADR 0029; add-email-delivery, design D5 y D6). Un transporte por
// envío, sin pool: TLS directo o STARTTLS con el certificado verificado y TLS 1.2 o superior; sin
// cifrado solo si el despliegue lo admite. Nunca lanza por un fallo del servidor: lo devuelve
// clasificado, con un detalle técnico recortado y sin la contraseña. nodemailer no lee archivos ni
// URL: los adjuntos son bytes en memoria.
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import type {
  MailTransport,
  OutgoingMail,
  SendOutcome,
  SmtpConnection,
} from "../application/ports.ts";
import { DETAIL_MAX_LENGTH, type EmailFailure, type EmailFailureCode } from "../domain/failures.ts";

export type SmtpTransportOptions = Readonly<{
  connectionTimeoutMs: number;
  socketTimeoutMs: number;
  /** El despliegue admite un servidor sin cifrado (el buzón de pruebas). */
  plaintextAllowed: boolean;
  /** Solo para las pruebas: la autoridad que firma el certificado del servidor falso. */
  trustedCa?: string;
}>;

type SmtpError = Error & {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
  permanent?: boolean;
  originalCode?: string;
  rejected?: string[];
};

// Errores de red sin respuesta SMTP: el servidor no está disponible por ahora.
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
]);

// Errores de verificación del certificado del servidor (`tls`, OpenSSL).
const CERTIFICATE_CODE =
  /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ALTNAME|HOSTNAME|DEPTH_ZERO|ERR_SSL|ERR_TLS/i;

/** El primer número de tres cifras de una respuesta como «250 2.0.0 Ok». */
const smtpCodeOf = (response: string | undefined): number | null => {
  const match = /^(\d{3})/.exec(response ?? "");
  return match ? Number(match[1]) : null;
};

/** Recorta y limpia el detalle técnico: nunca la contraseña, ni en claro ni en base64. */
function scrubbed(text: string, password: string | null): string {
  let clean = text.replace(/[\r\n]+/g, " ").trim();
  if (password) {
    for (const secret of [password, Buffer.from(password, "utf8").toString("base64")]) {
      clean = clean.split(secret).join("***");
    }
  }
  return clean.length > DETAIL_MAX_LENGTH ? `${clean.slice(0, DETAIL_MAX_LENGTH - 1)}…` : clean;
}

/** Clasifica un error de nodemailer en un código de la tabla cerrada (design D6). */
export function classifySmtpError(error: SmtpError): EmailFailureCode {
  const code = error.code ?? "";
  const original = error.originalCode ?? "";
  const status = error.responseCode;
  if (
    CERTIFICATE_CODE.test(original) ||
    (code === "ETLS" && CERTIFICATE_CODE.test(error.message))
  ) {
    return "TLS_FAILED";
  }
  if (code === "ETLS") return "TLS_REQUIRED";
  if (code === "ETIMEDOUT") return "TIMEOUT";
  if (status !== undefined && status >= 400 && status < 500) {
    // Una autenticación rechazada por ahora (454) también se reintenta.
    return "TEMPORARY_REJECTION";
  }
  if (code === "EAUTH" || code === "ENOAUTH") return "AUTH_REJECTED";
  if (code === "EENVELOPE") {
    if (error.command === "MAIL FROM" || /MAIL FROM/i.test(error.message)) return "SENDER_REJECTED";
    return "ALL_RECIPIENTS_REJECTED";
  }
  if (code === "EMESSAGE" && status !== undefined && status >= 500) return "MESSAGE_REJECTED";
  if (NETWORK_CODES.has(original) || code === "ECONNECTION" || code === "ESOCKET") {
    return "SERVER_UNAVAILABLE";
  }
  return "UNKNOWN";
}

function failureOf(error: unknown, password: string | null): EmailFailure {
  const smtpError = (error instanceof Error ? error : new Error(String(error))) as SmtpError;
  const parts = [smtpError.code, smtpError.originalCode, smtpError.response ?? smtpError.message];
  return {
    code: classifySmtpError(smtpError),
    smtpCode: smtpError.responseCode ?? null,
    detail: scrubbed(parts.filter(Boolean).join(" "), password),
  };
}

/** El dominio del remitente, para el saludo EHLO y el `Message-ID`. */
export const domainOf = (address: string): string => address.split("@").pop() ?? "localhost";

export function createSmtpMailTransport(options: SmtpTransportOptions): MailTransport {
  return {
    async send(connection: SmtpConnection, mail: OutgoingMail): Promise<SendOutcome> {
      if (connection.security === "NONE" && !options.plaintextAllowed) {
        return {
          kind: "FAILED",
          failure: { code: "PLAINTEXT_NOT_ALLOWED", smtpCode: null, detail: "" },
        };
      }
      const transport = nodemailer.createTransport({
        host: connection.host,
        port: connection.port,
        secure: connection.security === "TLS",
        requireTLS: connection.security === "STARTTLS",
        ignoreTLS: connection.security === "NONE",
        ...(connection.username
          ? { auth: { user: connection.username, pass: connection.password ?? "" } }
          : {}),
        name: domainOf(mail.from.address),
        connectionTimeout: options.connectionTimeoutMs,
        greetingTimeout: options.connectionTimeoutMs,
        socketTimeout: options.socketTimeoutMs,
        tls: {
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
          // SNI solo con un nombre: una IP no es un nombre de servidor (RFC 6066).
          ...(isIP(connection.host) === 0 ? { servername: connection.host } : {}),
          ...(options.trustedCa ? { ca: options.trustedCa } : {}),
        },
        disableFileAccess: true,
        disableUrlAccess: true,
        logger: false,
        debug: false,
      });
      try {
        const info = await transport.sendMail({
          from: { name: mail.from.name, address: mail.from.address },
          to: [...mail.to],
          ...(mail.bcc ? { bcc: mail.bcc } : {}),
          subject: mail.subject,
          text: mail.text,
          ...(mail.html ? { html: mail.html } : {}),
          attachments: mail.attachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            content: attachment.content,
          })),
          ...(mail.messageId ? { messageId: mail.messageId } : {}),
        });
        const rejectedErrors = (info as { rejectedErrors?: SmtpError[] }).rejectedErrors ?? [];
        return {
          kind: "SENT",
          accepted: info.accepted.map(String),
          rejected: info.rejected.map((address) => {
            const cause = rejectedErrors.find(
              (error) => (error as { recipient?: string }).recipient === String(address),
            );
            return { address: String(address), smtpCode: cause?.responseCode ?? null };
          }),
          smtpCode: smtpCodeOf(info.response),
        };
      } catch (error) {
        return { kind: "FAILED", failure: failureOf(error, connection.password) };
      } finally {
        transport.close();
      }
    },
  };
}
