// Composición del módulo de inventario para main.ts y las pruebas (add-minimal-inventory, design
// D1). Lo que otros módulos reciben del inventario se inyecta al componer: `fiscal`, `invoices` y
// `products` no importan este módulo.
import type { DbClient } from "../../../platform/db/database.ts";
import { createStockRepository } from "./prisma-stock.ts";

export { createStockRepository } from "./prisma-stock.ts";
export { createInventoryUnitOfWork, lockStockTrackingIn } from "./unit-of-work.ts";
export { reconcileStock, type StockDifference } from "./reconciliation.ts";

/**
 * Saldo de los productos con inventario inicializado, sobre un cliente: `invoices` lo recibe como
 * `StockReads` para congelar la decisión de inventario de cada línea al reservar (design D4).
 */
export function inventoryStockReads(db: DbClient) {
  const stock = createStockRepository(db);
  return {
    async balances(companyId: string, productIds: readonly string[]) {
      const found = await stock.findMany(companyId, productIds);
      return new Map([...found].map(([productId, item]) => [productId, item.balance]));
    },
  };
}
