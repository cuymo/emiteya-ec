// Configuración del correo sobre PostgreSQL (add-email-delivery, design D8): una fila por empresa,
// con versión, y la contraseña cifrada en su propia tabla. Toda consulta filtra por la empresa.
import type { EmailSecurity } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { EmailSettingsRepository, SealedSmtpPassword } from "../application/ports.ts";
import type { EmailSettingsFields } from "../domain/settings.ts";

const SECRET_SELECT = {
  formatVersion: true,
  keyVersion: true,
  keyCheck: true,
  wrappedKey: true,
  wrappedKeyNonce: true,
  passwordCiphertext: true,
  passwordNonce: true,
} as const;

const bytes = (value: Uint8Array) => Buffer.from(value);

export function createEmailSettingsRepository(db: DbClient): EmailSettingsRepository {
  return {
    async find(companyId) {
      const row = await db.emailSettings.findUnique({
        where: { companyId },
        include: { secret: { select: { companyId: true } } },
      });
      if (!row) return null;
      return {
        companyId: row.companyId,
        host: row.host,
        port: row.port,
        security: row.security as EmailSecurity,
        username: row.username,
        fromName: row.fromName,
        fromAddress: row.fromAddress,
        bccAddress: row.bccAddress,
        autoSend: row.autoSend,
        testRecipient: row.testRecipient,
        passwordSet: row.secret !== null,
        version: row.version,
        updatedAt: row.updatedAt,
      };
    },

    async lock(companyId) {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email-settings:${companyId}`}))`;
    },

    async insert(companyId, fields: EmailSettingsFields, userId) {
      await db.emailSettings.create({ data: { companyId, ...fields, updatedBy: userId } });
    },

    async updateIfVersion(companyId, expectedVersion, fields, userId) {
      const { count } = await db.emailSettings.updateMany({
        where: { companyId, version: expectedVersion },
        data: { ...fields, version: { increment: 1 }, updatedBy: userId },
      });
      return count === 1;
    },

    async findSecret(companyId): Promise<SealedSmtpPassword | null> {
      const row = await db.emailSettingsSecret.findUnique({
        where: { companyId },
        select: SECRET_SELECT,
      });
      if (!row) return null;
      return {
        formatVersion: row.formatVersion,
        keyVersion: row.keyVersion,
        keyCheck: bytes(row.keyCheck),
        wrappedKey: bytes(row.wrappedKey),
        wrappedKeyNonce: bytes(row.wrappedKeyNonce),
        passwordCiphertext: bytes(row.passwordCiphertext),
        passwordNonce: bytes(row.passwordNonce),
      };
    },

    async saveSecret(companyId, sealed) {
      const data = {
        formatVersion: sealed.formatVersion,
        keyVersion: sealed.keyVersion,
        keyCheck: new Uint8Array(sealed.keyCheck),
        wrappedKey: new Uint8Array(sealed.wrappedKey),
        wrappedKeyNonce: new Uint8Array(sealed.wrappedKeyNonce),
        passwordCiphertext: new Uint8Array(sealed.passwordCiphertext),
        passwordNonce: new Uint8Array(sealed.passwordNonce),
      };
      await db.emailSettingsSecret.upsert({
        where: { companyId },
        create: { companyId, ...data },
        update: data,
      });
    },

    async deleteSecret(companyId) {
      await db.emailSettingsSecret.deleteMany({ where: { companyId } });
    },
  };
}
