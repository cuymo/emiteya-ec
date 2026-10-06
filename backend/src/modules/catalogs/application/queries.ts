// Lecturas internas de los catálogos fiscales para otros módulos (add-parties-and-products, design
// D2; los puertos que prometía design D1 de add-fiscal-catalogs). No pasan por HTTP ni exigen una
// sesión: quien llama autoriza su propia operación y aporta la empresa de su contexto. La vigencia
// se resuelve solo con resolveCatalogEntry y la habilitación solo con effectiveEnablement.
import type { FiscalCatalogType } from "@facturador/contracts";
import { calculationDataStatus, type CalculationData } from "../domain/calculation-data.ts";
import { isEnableable } from "../domain/catalog-types.ts";
import { effectiveEnablement, isUsable, type Enablement } from "../domain/enablement.ts";
import { resolveCatalogEntry, type IsoDate } from "../domain/validity.ts";
import { latestByType } from "./fiscal-catalogs.ts";
import type {
  CatalogReader,
  EnablementRepository,
  StoredEntryVersion,
  StoredPolicyVersion,
  StoredSchemaEntry,
  StoredSizePolicyVersion,
  StoredSpecialCase,
} from "./ports.ts";
import { createCatalogResolver, type CatalogResolver } from "./resolver.ts";

/** Disponibilidad de una entrada para una empresa en una fecha. */
export type EntryAvailability = {
  entryKey: string;
  code: string;
  /** Versión aplicable en la fecha, o null. */
  applicable: StoredEntryVersion | null;
  /** Última versión publicada: da la denominación cuando no hay aplicable. */
  latest: StoredEntryVersion;
  withdrawn: boolean;
  enablement: Enablement;
  usable: boolean;
  /** De la versión aplicable o, si no hay, de la última. */
  calculationData: CalculationData;
};

export type IdentificationRule = {
  code: string;
  officialLabel: string;
  pattern: string | null;
  description: string;
  reservedFor: "CONSUMER_FINAL" | null;
};

export type FiscalCatalogQueries = CatalogResolver & {
  consumerFinalPolicy(date: IsoDate): Promise<StoredPolicyVersion | null>;
  /**
   * Límite de tamaño del envío al SRI aplicable en la fecha del envío (add-sri-transmission,
   * design D17). Sin una versión vigente, null: ningún envío sale.
   */
  sriTransmissionSizePolicy(date: IsoDate): Promise<StoredSizePolicyVersion | null>;
  identificationRule(code: string, date: IsoDate): Promise<IdentificationRule | null>;
  availability(
    companyId: string,
    catalogType: FiscalCatalogType,
    date: IsoDate,
  ): Promise<Map<string, EntryAvailability>>;
  /** Archivos del registro de esquemas vigente: documentos e imports (add-invoice-emission, D11). */
  schemaRegistry(): Promise<StoredSchemaEntry[]>;
  /** Matriz de casos especiales vigente (ADR 0014). */
  specialCases(): Promise<StoredSpecialCase[]>;
  /** Última versión aplicada de cada catálogo, para el snapshot de la emisión (add-invoice-emission, D4). */
  datasetVersions(): Promise<Record<string, number>>;
  /**
   * Todas las versiones de un catálogo, sin habilitación: los códigos de porcentaje de un documento
   * sustento se ofrecen con sus vigencias y se resuelven con su fecha (add-withholding-receipts, D6).
   */
  versions(catalogType: FiscalCatalogType): Promise<StoredEntryVersion[]>;
};

export function createFiscalCatalogQueries({
  reader,
  enablement,
}: {
  reader: CatalogReader;
  enablement: Pick<EnablementRepository, "decisions">;
}): FiscalCatalogQueries {
  const resolver = createCatalogResolver(reader);
  return {
    ...resolver,

    async consumerFinalPolicy(date) {
      return resolveCatalogEntry(await reader.policyVersions(), date);
    },

    async sriTransmissionSizePolicy(date) {
      return resolveCatalogEntry(await reader.sizePolicyVersions(), date);
    },

    schemaRegistry: () => reader.schemaEntries(),

    versions: (catalogType) => reader.entryVersions(catalogType),

    specialCases: () => reader.specialCases(),

    async datasetVersions() {
      return Object.fromEntries(
        [...latestByType(await reader.catalogs())].map(([type, dataset]) => [
          type,
          dataset.version,
        ]),
      );
    },

    async identificationRule(code, date) {
      const version = await resolver.resolveCatalogEntry("identification-type", code, date);
      if (!version) return null;
      return {
        code: version.code,
        officialLabel: version.officialLabel,
        pattern: version.identificationPattern,
        description: version.identificationRule ?? "",
        reservedFor: version.reservedFor,
      };
    },

    async availability(companyId, catalogType, date) {
      const dataset = latestByType(await reader.catalogs()).get(catalogType);
      const result = new Map<string, EntryAvailability>();
      if (!dataset) return result;
      const decisions = isEnableable(catalogType)
        ? await enablement.decisions(companyId, catalogType)
        : new Map<string, boolean>();
      const groups = new Map<string, StoredEntryVersion[]>();
      for (const version of await reader.entryVersions(catalogType)) {
        groups.set(version.entryKey, [...(groups.get(version.entryKey) ?? []), version]);
      }
      for (const [entryKey, versions] of groups) {
        const ordered = [...versions].sort((a, b) =>
          a.effectiveFrom.localeCompare(b.effectiveFrom),
        );
        const latest = ordered.at(-1)!;
        const applicable = resolveCatalogEntry(ordered, date);
        const entryEnablement = effectiveEnablement({
          decision: decisions.get(entryKey),
          policy: dataset.enablementPolicy,
        });
        result.set(entryKey, {
          entryKey,
          code: latest.code,
          applicable,
          latest,
          withdrawn: latest.normativeStatus === "WITHDRAWN",
          enablement: entryEnablement,
          usable: isUsable(applicable, entryEnablement),
          calculationData: calculationDataStatus(applicable ?? latest),
        });
      }
      return result;
    },
  };
}
