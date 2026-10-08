// Fuente de portabilidad de los catálogos fiscales (add-data-portability, design D1 y D4): solo las
// decisiones de habilitación de la empresa, con el código de cada entrada. Los catálogos globales
// del SRI no se exportan: son públicos, y cada snapshot congela lo que usó.
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

export function createCatalogPortabilitySources(schema: string) {
  const settings = qualifiedTable(schema, "company_fiscal_catalog_setting");
  const keys = qualifiedTable(schema, "fiscal_catalog_key");
  return {
    catalogSettings: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`s.catalog_type, s.entry_key, k.code, s.enabled, s.updated_at, s.updated_by`,
        from: Prisma.sql`${settings} s
          LEFT JOIN ${keys} k ON k.catalog_type = s.catalog_type AND k.entry_key = s.entry_key
          WHERE s.company_id = ${companyId}`,
        orderBy: Prisma.sql`s.catalog_type, s.entry_key`,
      }),
      map: (raw: {
        catalog_type: string;
        entry_key: string;
        code: string | null;
        enabled: boolean;
        updated_at: Date;
        updated_by: string;
      }) => ({
        catalogType: raw.catalog_type,
        entryKey: raw.entry_key,
        code: raw.code,
        enabled: raw.enabled,
        updatedAt: raw.updated_at,
        updatedBy: raw.updated_by,
      }),
    }),
  };
}
