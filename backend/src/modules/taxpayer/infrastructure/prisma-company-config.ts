// Repositorio de la configuración tributaria sobre PostgreSQL (design D2 y D4). Recibe el cliente o
// la transacción en curso, y toda consulta exige la empresa.
import type { DbClient } from "../../../platform/db/database.ts";
import type { CompanyConfigRepository, StoredConfig } from "../application/ports.ts";
import type { Environment, RimpeCategory, TaxpayerConfig } from "../domain/taxpayer-config.ts";

const versionInclude = {
  logoAsset: { select: { id: true, mimeType: true, sizeBytes: true, sha256: true } },
} as const;

type VersionRow = {
  id: string;
  version: number;
  ruc: string;
  legalName: string;
  tradeName: string | null;
  headOfficeAddress: string;
  phone: string | null;
  email: string | null;
  accountingRequired: boolean;
  specialTaxpayerNumber: string | null;
  withholdingAgentResolution: string | null;
  largeTaxpayer: boolean;
  rimpeCategory: string | null;
  providerRuc: string | null;
  environment: string;
  createdAt: Date;
  logoAsset: { id: string; mimeType: string; sizeBytes: number; sha256: string } | null;
};

function toStored(row: VersionRow, taxIdentityLocked: boolean): StoredConfig {
  return {
    versionId: row.id,
    version: row.version,
    taxIdentityLocked,
    createdAt: row.createdAt,
    config: {
      profile: {
        ruc: row.ruc,
        legalName: row.legalName,
        tradeName: row.tradeName,
        headOfficeAddress: row.headOfficeAddress,
        phone: row.phone,
        email: row.email,
        accountingRequired: row.accountingRequired,
        specialTaxpayerNumber: row.specialTaxpayerNumber,
        withholdingAgentResolution: row.withholdingAgentResolution,
        largeTaxpayer: row.largeTaxpayer,
        // Los CHECK de la migración garantizan estos valores.
        rimpeCategory: row.rimpeCategory as RimpeCategory | null,
        providerRuc: row.providerRuc,
      },
      environment: row.environment as Environment,
      logo: row.logoAsset
        ? {
            assetId: row.logoAsset.id,
            mimeType: row.logoAsset.mimeType,
            sizeBytes: row.logoAsset.sizeBytes,
            sha256: row.logoAsset.sha256,
          }
        : null,
    },
  };
}

function versionData(config: TaxpayerConfig) {
  return {
    ...config.profile,
    environment: config.environment,
    logoAssetId: config.logo?.assetId ?? null,
  };
}

export function createCompanyConfigRepository(db: DbClient): CompanyConfigRepository {
  return {
    async findCurrent(companyId) {
      const head = await db.companyConfig.findUnique({
        where: { companyId },
        include: { current: { include: versionInclude } },
      });
      return head ? toStored(head.current, head.taxIdentityLockedAt !== null) : null;
    },

    async appendVersion(companyId, { version, config, createdBy }) {
      const row = await db.companyConfigVersion.create({
        data: { companyId, version, createdById: createdBy, ...versionData(config) },
        include: versionInclude,
      });
      const head =
        version === 1
          ? await db.companyConfig.create({
              data: {
                companyId,
                currentVersionId: row.id,
                currentVersion: version,
                updatedAt: row.createdAt,
              },
            })
          : await db.companyConfig.update({
              where: { companyId },
              data: { currentVersionId: row.id, currentVersion: version, updatedAt: row.createdAt },
            });
      return toStored(row, head.taxIdentityLockedAt !== null);
    },

    async lockTaxIdentity(companyId, at) {
      const head = await db.companyConfig.findUnique({
        where: { companyId },
        include: { current: { select: { ruc: true } } },
      });
      if (!head) return false;
      const { count } = await db.companyConfig.updateMany({
        where: { companyId, taxIdentityLockedAt: null },
        data: { taxIdentityLockedAt: at, lockedRuc: head.current.ruc },
      });
      return count === 1;
    },
  };
}
