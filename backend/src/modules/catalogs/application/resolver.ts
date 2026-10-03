// Resolución de vigencia como puerto de aplicación (add-fiscal-catalogs, design D5). Es el único
// camino para saber qué versión de una entrada aplica en una fecha: la API, terceros y productos y
// la emisión lo usan; ninguno reimplementa la regla. La fecha es siempre explícita.
import type { FiscalCatalogType } from "@facturador/contracts";
import { resolveCatalogEntry as resolveVersion, type IsoDate } from "../domain/validity.ts";
import type { CatalogReader, StoredEntryVersion } from "./ports.ts";

export type CatalogResolver = {
  resolveCatalogEntry(
    catalogType: FiscalCatalogType,
    entryKey: string,
    effectiveDate: IsoDate,
  ): Promise<StoredEntryVersion | null>;
};

export function createCatalogResolver(
  reader: Pick<CatalogReader, "entryVersions">,
): CatalogResolver {
  return {
    async resolveCatalogEntry(catalogType, entryKey, effectiveDate) {
      return resolveVersion(await reader.entryVersions(catalogType, entryKey), effectiveDate);
    },
  };
}
