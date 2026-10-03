// Solo el módulo de catálogos lee sus tablas: la vigencia se resuelve en un único lugar
// (add-fiscal-catalogs, design D5).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const OWN = /^(modules\/catalogs\/|generated\/)/;
const TABLES =
  /\b(fiscalCatalogEntry|fiscalCatalogKey|fiscalCatalogDataset|consumerFinalPolicy|schemaRegistryEntry|specialCaseSupport|companyFiscalCatalogSetting|fiscal_catalog_entry|fiscal_catalog_key|fiscal_catalog_dataset|consumer_final_policy|schema_registry_entry|special_case_support|company_fiscal_catalog_setting)\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("frontera de las tablas de catálogos", () => {
  it("ningún módulo fuera de catalogs las lee ni las escribe", () => {
    const offenders = files(SRC)
      .map((path) => relative(SRC, path))
      .filter((path) => !OWN.test(path))
      .filter((path) => TABLES.test(readFileSync(join(SRC, path), "utf8")));
    expect(offenders).toEqual([]);
  });
});
