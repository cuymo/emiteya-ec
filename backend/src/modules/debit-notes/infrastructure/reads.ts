// Lecturas de la preparación de la empresa para emitir una nota de débito (add-debit-notes, design
// D1, D4 y D8), compuestas con las fábricas internas de taxpayer, catalogs y signing sobre un mismo
// cliente: la conexión para la vista previa o la transacción de reserva para la emisión. La forma de
// pago se resuelve con el resolver centralizado de `catalogs` (vigencia y habilitación).
import type { DbClient } from "../../../platform/db/database.ts";
import { fiscalCatalogQueries } from "../../catalogs/infrastructure/index.ts";
import { taxpayerEmissionReads } from "../../taxpayer/infrastructure/index.ts";
import type { DebitNotesReads, PaymentMethodAvailability } from "../application/ports.ts";

/** Firma vigente sobre un cliente: `signingModule(...).reads`. */
export type SigningReads = (db: DbClient) => {
  activeCertificate(companyId: string): Promise<Readonly<{ usable: boolean }> | null>;
};

export function createDebitNotesReads(db: DbClient, signingReads: SigningReads): DebitNotesReads {
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
    async paymentMethods(companyId, date) {
      const available = await catalogs.availability(companyId, "payment-method", date);
      const result = new Map<string, PaymentMethodAvailability>();
      for (const [entryKey, entry] of available) {
        result.set(entryKey, {
          entryKey,
          usable: entry.usable,
          applicable: entry.applicable
            ? {
                id: entry.applicable.id,
                code: entry.applicable.code,
                officialLabel: entry.applicable.officialLabel,
                datasetVersion: entry.applicable.datasetVersion,
              }
            : null,
        });
      }
      return result;
    },
  };
}
