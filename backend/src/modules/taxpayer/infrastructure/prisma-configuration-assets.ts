// Assets de configuración en PostgreSQL (ADR 0017, design D5). Contenido inmutable deduplicado por
// empresa: el mismo SHA-256 reutiliza el asset existente. Toda lectura exige la empresa.
import { createHash } from "node:crypto";
import type { DbClient } from "../../../platform/db/database.ts";
import type { ConfigurationAssetStore } from "../application/ports.ts";

export function createConfigurationAssetStore(db: DbClient): ConfigurationAssetStore {
  return {
    async save(companyId, { kind, mimeType, content, createdBy }) {
      const sha256 = createHash("sha256").update(content).digest("hex");
      // INSERT ... ON CONFLICT DO NOTHING sobre (company_id, sha256), y lectura del vigente.
      await db.configurationAsset.createMany({
        data: [
          {
            companyId,
            kind,
            mimeType,
            sizeBytes: content.byteLength,
            sha256,
            content: Buffer.from(content),
            createdById: createdBy,
          },
        ],
        skipDuplicates: true,
      });
      const asset = await db.configurationAsset.findUniqueOrThrow({
        where: { companyId_sha256: { companyId, sha256 } },
        select: { id: true, mimeType: true, sizeBytes: true, sha256: true },
      });
      return { assetId: asset.id, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, sha256 };
    },

    async read(companyId, assetId) {
      const asset = await db.configurationAsset.findFirst({ where: { companyId, id: assetId } });
      return asset
        ? {
            assetId: asset.id,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            sha256: asset.sha256,
            content: asset.content,
          }
        : null;
    },
  };
}

/**
 * Logo de una versión inmutable de la configuración (add-document-archive, design D3): lo usa el
 * RIDE, que nunca lee la configuración vigente. Solo de lectura y siempre por empresa.
 */
export function createConfigurationLogoReader(db: DbClient) {
  return async (companyId: string, configVersionId: string) => {
    const version = await db.companyConfigVersion.findFirst({
      where: { companyId, id: configVersionId },
      select: {
        logoAsset: { select: { content: true, mimeType: true, sha256: true, sizeBytes: true } },
      },
    });
    return version?.logoAsset ?? null;
  };
}
