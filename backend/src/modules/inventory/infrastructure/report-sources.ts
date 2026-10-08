// Fuentes del inventario para los reportes (add-reports-export, design D1, D2 y D3). Movimientos lee
// el libro solo de agregado de toda la empresa; Existencias, el saldo registrado de cada producto
// inicializado, sin recalcularlo nunca desde el kárdex ni desde los comprobantes. El inventario no
// lee la tabla de productos: el código, el nombre y el orden por nombre los aporta `products`.
import type {
  InventoryMovementRow,
  InventoryMovementsFilters,
  StockMovementType,
} from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { FiscalDecimal } from "../../../platform/decimal/fiscal-decimal.ts";
import {
  qualifiedTable,
  sqlReportSource,
  type ReportSource,
} from "../../../platform/db/report-source.ts";
import { ecuadorRange } from "../domain/stock.ts";

/** Un movimiento sin los datos del producto, que completa `products`. */
export type InventoryMovementSourceRow = Omit<InventoryMovementRow, "code" | "name">;

type Raw = {
  id: string;
  occurred_at: Date;
  product_id: string;
  movement_type: string;
  delta: string;
  balance_after: string;
  document_number: string | null;
};

const quantity = (text: string) => FiscalDecimal.fromDatabase("existencia", text).toString();

/** Movimientos de la empresa por fechas de Ecuador inclusivas, del más reciente al más antiguo. */
export function createInventoryMovementsReportSource(
  schema: string,
): ReportSource<InventoryMovementsFilters, InventoryMovementSourceRow> {
  const movements = qualifiedTable(schema, "stock_movement");
  return sqlReportSource<InventoryMovementsFilters, Raw, InventoryMovementSourceRow>({
    query: (companyId, filters) => {
      const range = ecuadorRange(filters.from, filters.to);
      return {
        select: Prisma.sql`m.id, m.occurred_at, m.product_id, m.movement_type,
          m.delta::text AS delta, m.balance_after::text AS balance_after, m.document_number`,
        from: Prisma.sql`${movements} m WHERE ${Prisma.join(
          [
            Prisma.sql`m.company_id = ${companyId}`,
            ...(filters.productId ? [Prisma.sql`m.product_id = ${filters.productId}`] : []),
            ...(range.from ? [Prisma.sql`m.occurred_at >= ${range.from}`] : []),
            ...(range.before ? [Prisma.sql`m.occurred_at < ${range.before}`] : []),
            ...(filters.movementType
              ? [Prisma.sql`m.movement_type = ${filters.movementType}`]
              : []),
          ],
          " AND ",
        )}`,
        orderBy: Prisma.sql`m.occurred_at DESC, m.id DESC`,
      };
    },
    map: (raw) => ({
      id: raw.id,
      occurredAt: raw.occurred_at.toISOString(),
      productId: raw.product_id,
      movementType: raw.movement_type as StockMovementType,
      quantity: quantity(raw.delta),
      balanceAfter: quantity(raw.balance_after),
      documentNumber: raw.document_number,
    }),
  });
}

/** Lecturas de Existencias: los productos inicializados y sus saldos registrados. */
export const inventoryBalanceReads = {
  /** Productos con inventario inicializado, opcionalmente solo uno. */
  initializedProductIds: async (
    db: DbClient,
    companyId: string,
    productId?: string,
  ): Promise<string[]> => {
    const rows = await db.stockBalance.findMany({
      where: { companyId, ...(productId ? { productId } : {}) },
      select: { productId: true },
    });
    return rows.map((row) => row.productId);
  },

  /** Saldo registrado de cada producto pedido, en su forma canónica. */
  balances: async (
    db: DbClient,
    companyId: string,
    productIds: readonly string[],
  ): Promise<Map<string, string>> => {
    if (productIds.length === 0) return new Map();
    const rows = await db.stockBalance.findMany({
      where: { companyId, productId: { in: [...productIds] } },
      select: { productId: true, balance: true },
    });
    return new Map(rows.map((row) => [row.productId, quantity(row.balance.toFixed())]));
  },
};
