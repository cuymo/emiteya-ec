// Composición del módulo de inventario para main.ts y las pruebas (add-minimal-inventory, design
// D1). Lo que otros módulos reciben del inventario se inyecta al componer: `fiscal`, `invoices` y
// `products` no importan este módulo.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { productStockTracking } from "../../products/infrastructure/index.ts";
import { createInventory } from "../application/inventory.ts";
import type {
  InventoryObserver,
  InventoryProduct,
  InventoryProducts,
} from "../application/ports.ts";
import { inventoryRouter } from "./http/inventory-router.ts";
import { createStockRepository } from "./prisma-stock.ts";
import { createStockReads } from "./prisma-stock-reads.ts";
import { createInventoryUnitOfWork, lockStockTrackingIn } from "./unit-of-work.ts";

export { createStockRepository } from "./prisma-stock.ts";
export {
  inventoryOutflowFollower,
  type InvoiceStockLinesReader,
} from "../application/invoice-outflow.ts";
export { createInventoryUnitOfWork, lockStockTrackingIn } from "./unit-of-work.ts";
export { createStockReads } from "./prisma-stock-reads.ts";
export { registerInventoryMetrics } from "./metrics.ts";
export {
  reconcileStock,
  reconcileStockReturnCapacity,
  type StockDifference,
  type StockReturnDifference,
} from "./reconciliation.ts";
export { stockReturnCapacity, stockReturnReservations } from "./prisma-return-capacity.ts";
export { creditNoteReturnFollower } from "../application/credit-note-return.ts";

// Fuentes de Existencias y Movimientos para los reportes (add-reports-export, design D1).
export {
  createInventoryMovementsReportSource,
  inventoryBalanceReads,
  type InventoryMovementSourceRow,
} from "./report-sources.ts";

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

/**
 * Inventario inicializado de un producto, sobre un cliente: `products` lo recibe para rechazar el
 * cambio de la marca de un producto con inventario desde su corrección (design D7). Toma el lock del
 * control de stock del producto, el mismo que la inicialización.
 */
export function inventoryInitialization(db: DbClient) {
  const stock = createStockRepository(db);
  return {
    async isInitialized(companyId: string, productId: string) {
      await lockStockTrackingIn(db, companyId, productId);
      return (await stock.find(companyId, productId)) !== null;
    },
  };
}

/** Productos vistos por el inventario: la lectura y la marca que pertenecen a `products`. */
const toInventoryProduct = (found: InventoryProduct): InventoryProduct => ({
  id: found.id,
  mainCode: found.mainCode,
  auxiliaryCode: found.auxiliaryCode,
  name: found.name,
  kind: found.kind,
  status: found.status,
  stockTracked: found.stockTracked,
});

const inventoryProducts: InventoryProducts = (db) => {
  const products = productStockTracking(db);
  return {
    async find(companyId, productId) {
      const found = await products.find(companyId, productId);
      return found ? toInventoryProduct(found) : null;
    },
    async search(companyId, query) {
      const { items, total } = await products.search(companyId, query);
      return { items: items.map(toInventoryProduct), total };
    },
    setStockTracked: (companyId, productId, stockTracked, userId) =>
      products.setStockTracked(companyId, productId, stockTracked, userId),
  };
};

export type InventoryModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Métricas del inventario, registradas una vez en el arranque (design D14). */
  observer?: InventoryObserver;
  now?: () => Date;
};

export function inventoryModule({
  prisma,
  authorizer,
  observer,
  now = () => new Date(),
}: InventoryModuleOptions) {
  const service = createInventory({
    uow: createInventoryUnitOfWork(prisma),
    products: inventoryProducts,
    stock: createStockRepository,
    reads: createStockReads,
    db: prisma,
    authorizer,
    now,
    ...(observer ? { observer } : {}),
  });
  return { routers: [inventoryRouter(service)], service };
}
// Fuente de portabilidad (add-data-portability, design D1).
export { createInventoryPortabilitySources } from "./portability-sources.ts";
// Tablero de Inicio: los productos agotados.
export { outOfStockCount } from "./dashboard-reads.ts";
