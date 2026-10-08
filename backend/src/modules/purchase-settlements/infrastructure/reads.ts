// Lecturas de la preparación de la empresa y de los catálogos para una liquidación de compra
// (add-purchase-settlements, design D1, D7, D9 y D13), compuestas con las fábricas internas de
// taxpayer, catalogs y signing sobre un mismo cliente: la conexión para la vista previa o la
// transacción de reserva para la emisión. Las entradas se resuelven con el resolver centralizado de
// `catalogs` (vigencia, habilitación y clasificación).
import type { DbClient } from "../../../platform/db/database.ts";
import {
  fiscalCatalogQueries,
  type StoredEntryVersion,
} from "../../catalogs/infrastructure/index.ts";
import { taxpayerEmissionReads } from "../../taxpayer/infrastructure/index.ts";
import type { PurchaseSettlementReads } from "../application/ports.ts";
import type { CatalogOption, CatalogVersion } from "../domain/evaluation.ts";

/** Firma vigente sobre un cliente: `signingModule(...).reads`. */
export type SigningReads = (db: DbClient) => {
  activeCertificate(companyId: string): Promise<Readonly<{ usable: boolean }> | null>;
};

const toVersion = (version: StoredEntryVersion): CatalogVersion => ({
  catalogType: version.catalogType,
  entryKey: version.entryKey,
  code: version.code,
  officialLabel: version.officialLabel,
  versionId: version.id,
  datasetVersion: version.datasetVersion,
  percentage: version.percentage,
  rateKind: version.rateKind,
});

export function createPurchaseSettlementReads(
  db: DbClient,
  signingReads: SigningReads,
): PurchaseSettlementReads {
  const taxpayer = taxpayerEmissionReads(db);
  const catalogs = fiscalCatalogQueries(db);
  const signing = signingReads(db);
  return {
    async currentConfig(companyId) {
      const current = await taxpayer.currentConfig(companyId);
      if (!current) return null;
      return {
        versionId: current.versionId,
        version: current.version,
        environment: current.config.environment,
        profile: current.config.profile,
      };
    },
    async emissionPoint(companyId, emissionPointId) {
      const found = await taxpayer.emissionPoint(companyId, emissionPointId);
      if (!found) return null;
      return {
        point: { id: found.point.id, code: found.point.code },
        establishment: {
          id: found.establishment.id,
          code: found.establishment.code,
          address: found.establishment.address,
        },
        available: found.point.status === "ACTIVE" && found.establishment.status === "ACTIVE",
      };
    },
    activeCertificate: (companyId) => signing.activeCertificate(companyId),
    schemaRegistry: () => catalogs.schemaRegistry(),
    datasetVersions: () => catalogs.datasetVersions(),
    async availability(companyId, catalogType, date) {
      const available = await catalogs.availability(companyId, catalogType, date);
      const result = new Map<string, CatalogOption>();
      for (const [entryKey, entry] of available) {
        result.set(entryKey, {
          entryKey,
          applicable: entry.applicable ? toVersion(entry.applicable) : null,
          usable: entry.usable,
        });
      }
      return result;
    },
  };
}
