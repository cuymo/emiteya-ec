// Fuentes de portabilidad de los productos (add-data-portability, design D4): todos los productos y
// servicios de la empresa, en todos sus estados y con sus datos vigentes, y sus impuestos por la
// clave de la entrada del catálogo. El precio es texto decimal: nunca pasa por `number`.
import { canonicalDecimal } from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

export function createProductsPortabilitySources(schema: string) {
  const products = qualifiedTable(schema, "product");
  const taxes = qualifiedTable(schema, "product_tax");
  return {
    products: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`p.id, p.kind, p.main_code, p.auxiliary_code, p.name, p.description,
          p.unit_price::text AS unit_price, p.stock_tracked, p.status, p.created_at, p.updated_at`,
        from: Prisma.sql`${products} p WHERE p.company_id = ${companyId}`,
        orderBy: Prisma.sql`p.search_name, p.id`,
      }),
      map: (raw: {
        id: string;
        kind: string;
        main_code: string | null;
        auxiliary_code: string | null;
        name: string;
        description: string | null;
        unit_price: string;
        stock_tracked: boolean;
        status: string;
        created_at: Date;
        updated_at: Date;
      }) => ({
        id: raw.id,
        kind: raw.kind,
        mainCode: raw.main_code,
        auxiliaryCode: raw.auxiliary_code,
        name: raw.name,
        description: raw.description,
        unitPrice: canonicalDecimal(raw.unit_price),
        stockTracked: raw.stock_tracked,
        status: raw.status,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      }),
    }),
    productTaxes: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`t.product_id, t.catalog_type, t.entry_key`,
        from: Prisma.sql`${taxes} t
          JOIN ${products} p ON p.company_id = t.company_id AND p.id = t.product_id
          WHERE t.company_id = ${companyId}`,
        orderBy: Prisma.sql`p.search_name, p.id, t.catalog_type, t.entry_key`,
      }),
      map: (raw: { product_id: string; catalog_type: string; entry_key: string }) => ({
        productId: raw.product_id,
        catalogType: raw.catalog_type,
        entryKey: raw.entry_key,
      }),
    }),
  };
}
