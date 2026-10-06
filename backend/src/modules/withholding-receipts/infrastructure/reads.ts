// Lecturas de la preparación de la empresa y de los catálogos para un comprobante de retención
// (add-withholding-receipts, design D1, D11, D12 y D15), compuestas con las fábricas internas de
// taxpayer, catalogs y signing sobre un mismo cliente: la conexión para la vista previa o la
// transacción de reserva para la emisión. Las entradas se resuelven con el resolver centralizado de
// `catalogs` (vigencia, habilitación y clasificación).
import type { DbClient } from "../../../platform/db/database.ts";
import {
  fiscalCatalogQueries,
  type StoredEntryVersion,
} from "../../catalogs/infrastructure/index.ts";
import { taxpayerEmissionReads } from "../../taxpayer/infrastructure/index.ts";
import type { WithholdingReads } from "../application/ports.ts";
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
  scopeClassification: version.scopeClassification,
  allowedSupportCodes: version.allowedSupportCodes,
  sourceRef: version.sourceRef,
});

export function createWithholdingReads(db: DbClient, signingReads: SigningReads): WithholdingReads {
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
          scopeClassification: (entry.applicable ?? entry.latest).scopeClassification,
          enabled: entry.enablement.enabled,
          usable: entry.usable,
        });
      }
      return result;
    },
    async resolve(catalogType, entryKey, date) {
      const version = await catalogs.resolveCatalogEntry(catalogType, entryKey, date);
      return version ? toVersion(version) : null;
    },
    async rateVersions(catalogType) {
      return (await catalogs.versions(catalogType))
        .filter((version) => version.normativeStatus !== "WITHDRAWN")
        .map((version) => ({
          entryKey: version.entryKey,
          code: version.code,
          officialLabel: version.officialLabel,
          rateKind: version.rateKind,
          percentage: version.percentage,
          effectiveFrom: version.effectiveFrom,
          effectiveTo: version.effectiveTo,
          usable: true,
        }))
        .sort(
          (a, b) =>
            a.code.localeCompare(b.code, "en", { numeric: true }) ||
            a.entryKey.localeCompare(b.entryKey) ||
            a.effectiveFrom.localeCompare(b.effectiveFrom),
        );
    },
  };
}
