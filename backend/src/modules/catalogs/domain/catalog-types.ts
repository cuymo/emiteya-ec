// Catálogos fiscales y datasets normativos (add-fiscal-catalogs, design D2 y D9).
import { FISCAL_CATALOG_TYPES, type FiscalCatalogType } from "@facturador/contracts";

export { FISCAL_CATALOG_TYPES, type FiscalCatalogType };

/**
 * Datasets que el cargador aplica: los catálogos de entradas, la política de consumidor final, el
 * registro, la matriz y la política de tamaño del envío al SRI.
 */
export const DATASET_TYPES = [
  ...FISCAL_CATALOG_TYPES,
  "consumer-final-policy",
  "schema-registry",
  "special-case-matrix",
  "sri-transmission-policy",
] as const;
export type DatasetType = (typeof DATASET_TYPES)[number];

/**
 * Catálogos cuya disponibilidad por empresa tiene sentido (design D9), y los de retención que el
 * agente elige (add-withholding-receipts, design D11).
 */
export const ENABLEABLE_CATALOGS: ReadonlySet<FiscalCatalogType> = new Set([
  "iva-rate",
  "ice-rate",
  "irbpnr-rate",
  "payment-method",
  "withholding-iva-code",
  "withholding-income-concept",
]);

export const isEnableable = (catalogType: string): boolean =>
  ENABLEABLE_CATALOGS.has(catalogType as FiscalCatalogType);

export const isFiscalCatalogType = (value: string): value is FiscalCatalogType =>
  (FISCAL_CATALOG_TYPES as readonly string[]).includes(value);
