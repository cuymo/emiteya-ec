// Puertos del módulo de correo (add-email-delivery, design D1, D8 y D9).
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { EmailSettingsFields, EmailSettingsRecord } from "../domain/settings.ts";

/** La contraseña SMTP en su sobre AES-256-GCM (design D9). */
export type SealedSmtpPassword = Readonly<{
  formatVersion: number;
  keyVersion: string;
  keyCheck: Buffer;
  wrappedKey: Buffer;
  wrappedKeyNonce: Buffer;
  passwordCiphertext: Buffer;
  passwordNonce: Buffer;
}>;

/** Cifra y abre la contraseña ligada a su empresa; un sobre de otra empresa no se abre. */
export interface SmtpPasswordVault {
  seal(password: string, companyId: string): SealedSmtpPassword;
  /** Lanza `SmtpPasswordUnavailableError` si no se puede abrir. */
  open(sealed: SealedSmtpPassword, companyId: string): string;
}

export class SmtpPasswordUnavailableError extends Error {
  constructor() {
    super("No se pudo abrir la contraseña del servidor de correo.");
    this.name = "SmtpPasswordUnavailableError";
  }
}

export interface EmailSettingsRepository {
  find(companyId: string): Promise<EmailSettingsRecord | null>;
  /** Serializa los cambios de la configuración de una empresa dentro de la transacción. */
  lock(companyId: string): Promise<void>;
  insert(companyId: string, fields: EmailSettingsFields, userId: string): Promise<void>;
  /** Cambia y sube la versión solo si sigue en `expectedVersion`. */
  updateIfVersion(
    companyId: string,
    expectedVersion: number,
    fields: EmailSettingsFields,
    userId: string,
  ): Promise<boolean>;
  findSecret(companyId: string): Promise<SealedSmtpPassword | null>;
  saveSecret(companyId: string, sealed: SealedSmtpPassword): Promise<void>;
  deleteSecret(companyId: string): Promise<void>;
}

export type EmailScope = Readonly<{ settings: EmailSettingsRepository; audit: AuditLog }>;

export interface EmailUnitOfWork {
  run<T>(work: (scope: EmailScope) => Promise<T>): Promise<T>;
}

/** Lo que decide el despliegue (design D5 y D7). */
export type EmailDeploymentPolicy = Readonly<{
  deliveryEnabled: boolean;
  plaintextAllowed: boolean;
}>;
