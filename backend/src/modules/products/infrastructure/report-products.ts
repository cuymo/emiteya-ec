// Productos para los reportes del inventario (add-reports-export, design D1 y D2): el código y el
// nombre vigentes de un lote de productos, y el orden de Existencias por nombre normalizado e
// identificador sobre los productos que aporta el inventario. Solo lectura.
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import {
  qualifiedTable,
  sqlReportSource,
  type ReportSource,
} from "../../../platform/db/report-source.ts";

export type ReportProduct = Readonly<{ productId: string; code: string; name: string }>;

type Raw = { id: string; main_code: string | null; auxiliary_code: string | null; name: string };

/** El código principal, o el auxiliar si no tiene; vacío si no tiene ninguno. */
const codeOf = (main: string | null, auxiliary: string | null) => main ?? auxiliary ?? "";

/** Los productos pedidos, por nombre normalizado e identificador. */
export function createReportProductsSource(
  schema: string,
): ReportSource<{ productIds: readonly string[] }, ReportProduct> {
  const products = qualifiedTable(schema, "product");
  return sqlReportSource<{ productIds: readonly string[] }, Raw, ReportProduct>({
    query: (companyId, { productIds }) => ({
      select: Prisma.sql`p.id, p.main_code, p.auxiliary_code, p.name`,
      from: Prisma.sql`${products} p
        WHERE p.company_id = ${companyId} AND p.id = ANY(${[...productIds]}::text[])`,
      orderBy: Prisma.sql`p.search_name ASC, p.id ASC`,
    }),
    map: (raw) => ({
      productId: raw.id,
      code: codeOf(raw.main_code, raw.auxiliary_code),
      name: raw.name,
    }),
  });
}

/** El código y el nombre vigentes de cada producto pedido de la empresa. */
export async function reportProductLabels(
  db: DbClient,
  companyId: string,
  productIds: readonly string[],
): Promise<Map<string, ReportProduct>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.product.findMany({
    where: { companyId, id: { in: [...new Set(productIds)] } },
    select: { id: true, mainCode: true, auxiliaryCode: true, name: true },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      { productId: row.id, code: codeOf(row.mainCode, row.auxiliaryCode), name: row.name },
    ]),
  );
}
