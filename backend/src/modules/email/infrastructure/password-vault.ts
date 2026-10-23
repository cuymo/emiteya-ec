// Contraseña SMTP en un sobre AES-256-GCM (add-email-delivery, design D9), con la clave maestra de
// custodia que usa la firma. Sus AAD la ligan a su empresa y a su formato: un sobre copiado a otra
// empresa no se abre.
import {
  type EnvelopeContext,
  type MasterKeyring,
  openEnvelope,
  sealEnvelope,
} from "../../../platform/secrets/envelope.ts";
import { SmtpPasswordUnavailableError, type SmtpPasswordVault } from "../application/ports.ts";

export const SMTP_PASSWORD_FORMAT_VERSION = 1;

const fieldAad = (companyId: string) =>
  Buffer.from(`email-smtp-password|${SMTP_PASSWORD_FORMAT_VERSION}|${companyId}`);

const contextOf = (companyId: string): EnvelopeContext => ({
  wrapAad: (keyVersion) =>
    Buffer.from(`email-smtp-key|${SMTP_PASSWORD_FORMAT_VERSION}|${keyVersion}|${companyId}`),
  keyCheckLabel: (keyVersion) => `email-smtp-key-check|${keyVersion}`,
});

export function createSmtpPasswordVault(keyring: MasterKeyring): SmtpPasswordVault {
  return {
    seal(password, companyId) {
      const plaintext = Buffer.from(password, "utf8");
      try {
        const sealed = sealEnvelope(keyring, contextOf(companyId), {
          password: { plaintext, aad: fieldAad(companyId) },
        });
        return {
          formatVersion: SMTP_PASSWORD_FORMAT_VERSION,
          keyVersion: sealed.keyVersion,
          keyCheck: sealed.keyCheck,
          wrappedKey: sealed.wrappedKey,
          wrappedKeyNonce: sealed.wrappedKeyNonce,
          passwordCiphertext: sealed.fields.password.ciphertext,
          passwordNonce: sealed.fields.password.nonce,
        };
      } catch {
        throw new SmtpPasswordUnavailableError();
      } finally {
        plaintext.fill(0);
      }
    },

    open(sealed, companyId) {
      if (sealed.formatVersion !== SMTP_PASSWORD_FORMAT_VERSION) {
        throw new SmtpPasswordUnavailableError();
      }
      try {
        const opened = openEnvelope(keyring, contextOf(companyId), sealed, {
          password: {
            ciphertext: sealed.passwordCiphertext,
            nonce: sealed.passwordNonce,
            aad: fieldAad(companyId),
          },
        });
        const password = opened.password.toString("utf8");
        opened.password.fill(0);
        return password;
      } catch {
        throw new SmtpPasswordUnavailableError();
      }
    },
  };
}
