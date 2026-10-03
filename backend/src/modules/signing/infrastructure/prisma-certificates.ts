// Repositorio de la firma electrónica sobre Prisma (design D2 y D7). Los metadatos y el secreto
// viven en tablas separadas; la lectura solo trae la cabecera del secreto (versión y key_check),
// nunca el material cifrado.
import type { DbClient } from "../../../platform/db/database.ts";
import type { CertificateRepository, StoredCertificate } from "../application/ports.ts";

const SELECT = {
  id: true,
  companyId: true,
  subject: true,
  issuer: true,
  serialNumber: true,
  fingerprintSha256: true,
  notBefore: true,
  notAfter: true,
  detectedRuc: true,
  keyAlgorithm: true,
  keyBits: true,
  createdAt: true,
  secret: { select: { keyVersion: true, keyCheck: true } },
} as const;

type Row = {
  id: string;
  companyId: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  fingerprintSha256: string;
  notBefore: Date;
  notAfter: Date;
  detectedRuc: string;
  keyAlgorithm: string;
  keyBits: number;
  createdAt: Date;
  secret: { keyVersion: string; keyCheck: Uint8Array } | null;
};

const toStored = (row: Row): StoredCertificate => ({
  id: row.id,
  companyId: row.companyId,
  subject: row.subject,
  issuer: row.issuer,
  serialNumber: row.serialNumber,
  fingerprint: row.fingerprintSha256,
  notBefore: row.notBefore,
  notAfter: row.notAfter,
  detectedRuc: row.detectedRuc,
  keyAlgorithm: row.keyAlgorithm,
  keyBits: row.keyBits,
  uploadedAt: row.createdAt,
  secret: row.secret
    ? { keyVersion: row.secret.keyVersion, keyCheck: Buffer.from(row.secret.keyCheck) }
    : null,
});

/** Copia en un Uint8Array propio, el tipo de los Bytes de Prisma. */
const bytes = (buffer: Buffer) => new Uint8Array(buffer);

export function createCertificateRepository(db: DbClient): CertificateRepository {
  return {
    async lock(companyId) {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`signing-certificate:${companyId}`}))`;
    },

    async findActive(companyId) {
      const row = await db.signingCertificate.findUnique({
        where: { activeCompanyId: companyId },
        select: SELECT,
      });
      return row ? toStored(row) : null;
    },

    async listActive() {
      const rows = await db.signingCertificate.findMany({
        where: { status: "ACTIVE" },
        select: SELECT,
      });
      return rows.map(toStored);
    },

    async insert(certificate) {
      await db.signingCertificate.create({
        data: {
          id: certificate.id,
          companyId: certificate.companyId,
          status: "ACTIVE",
          activeCompanyId: certificate.companyId,
          subject: certificate.subject,
          issuer: certificate.issuer,
          serialNumber: certificate.serialNumber,
          fingerprintSha256: certificate.fingerprint,
          notBefore: certificate.notBefore,
          notAfter: certificate.notAfter,
          detectedRuc: certificate.detectedRuc,
          keyAlgorithm: certificate.keyAlgorithm,
          keyBits: certificate.keyBits,
          uploadedBy: certificate.uploadedBy,
          createdAt: certificate.uploadedAt,
        },
      });
    },

    async insertSecret(sealed, binding) {
      await db.signingCertificateSecret.create({
        data: {
          certificateId: binding.certificateId,
          companyId: binding.companyId,
          formatVersion: sealed.formatVersion,
          keyVersion: sealed.keyVersion,
          keyCheck: bytes(sealed.keyCheck),
          wrappedKey: bytes(sealed.wrappedKey),
          wrappedKeyNonce: bytes(sealed.wrappedKeyNonce),
          p12Ciphertext: bytes(sealed.p12Ciphertext),
          p12Nonce: bytes(sealed.p12Nonce),
          passwordCiphertext: bytes(sealed.passwordCiphertext),
          passwordNonce: bytes(sealed.passwordNonce),
        },
      });
    },

    async deleteSecret(certificateId) {
      await db.signingCertificateSecret.deleteMany({ where: { certificateId } });
    },

    async markReplaced(certificateId, at) {
      await db.signingCertificate.update({
        where: { id: certificateId },
        data: { status: "REPLACED", activeCompanyId: null, replacedAt: at },
      });
    },

    async linkReplacement(certificateId, replacedById) {
      await db.signingCertificate.update({ where: { id: certificateId }, data: { replacedById } });
    },

    async expiryAlertDays(companyId) {
      const row = await db.signingCertificateSettings.findUnique({ where: { companyId } });
      return row?.expiryAlertDays ?? null;
    },

    async setExpiryAlertDays(companyId, days) {
      await db.signingCertificateSettings.upsert({
        where: { companyId },
        create: { companyId, expiryAlertDays: days },
        update: { expiryAlertDays: days },
      });
    },
  };
}
