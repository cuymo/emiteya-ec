// Servidor de correo de una empresa (add-email-delivery, design D8 y D11): sus datos sin la
// contraseña y los cambios que se auditan. La contraseña solo se registra como «cambió», nunca su
// valor ni un nombre de campo que la auditoría rechace por parecer un secreto.
import type { EmailSecurity } from "@facturador/contracts";
import type { AuditChanges } from "../../audit/domain/audit-event.ts";

export type EmailSettingsFields = Readonly<{
  host: string;
  port: number;
  security: EmailSecurity;
  username: string | null;
  fromName: string;
  fromAddress: string;
  bccAddress: string | null;
  autoSend: boolean;
  testRecipient: string | null;
}>;

export type EmailSettingsRecord = EmailSettingsFields &
  Readonly<{
    companyId: string;
    /** Si hay una contraseña guardada; la contraseña nunca sale del módulo. */
    passwordSet: boolean;
    version: number;
    updatedAt: Date;
  }>;

export const SETTINGS_FIELDS = [
  "host",
  "port",
  "security",
  "username",
  "fromName",
  "fromAddress",
  "bccAddress",
  "autoSend",
  "testRecipient",
] as const satisfies readonly (keyof EmailSettingsFields)[];

/**
 * Cambios auditables: el valor anterior y el nuevo de cada campo que cambió y, si cambió la
 * contraseña (otra, una nueva o quitada), `smtpLoginChanged`. null si no cambia nada. La primera
 * configuración lleva sus valores como `.to`.
 */
export function settingsChanges(
  before: EmailSettingsFields | null,
  after: EmailSettingsFields,
  passwordChanged: boolean,
): AuditChanges | null {
  const changes: Record<string, string | number | boolean | null> = {};
  for (const field of SETTINGS_FIELDS) {
    if (before !== null && before[field] === after[field]) continue;
    if (before !== null) changes[`${field}.from`] = before[field];
    changes[`${field}.to`] = after[field];
  }
  if (passwordChanged) changes.smtpLoginChanged = true;
  return Object.keys(changes).length > 0 ? changes : null;
}
