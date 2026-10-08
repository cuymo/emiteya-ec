// Composición del módulo de productos para main.ts y las pruebas (add-parties-and-products).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type {
  CatalogAvailability,
  InventoryInitialization,
  StockProductQuery,
} from "../application/ports.ts";
import { createProducts } from "../application/products.ts";
import { productsRouter } from "./http/products-router.ts";
import { createProductRepository } from "./prisma-products.ts";
import { createProductsUnitOfWork } from "./unit-of-work.ts";

// Código, nombre y orden de los productos en los reportes del inventario (add-reports-export, D1).
export {
  createReportProductsSource,
  reportProductLabels,
  type ReportProduct,
} from "./report-products.ts";

/**
 * Lectura de un producto de la empresa, con sus referencias fiscales, sobre un cliente: la emisión
 * de facturas la usa dentro de su transacción (add-invoice-emission, design D1).
 */
export function productReader(db: DbClient) {
  const products = createProductRepository(db);
  return { find: (companyId: string, productId: string) => products.find(companyId, productId) };
}

/**
 * Marca de control de stock de un producto con inventario inicializado, sobre el cliente de la
 * transacción del inventario (add-minimal-inventory, design D7 y D8): la lectura del producto, la
 * página de la lista del inventario y el cambio de su marca, que incrementa su versión. La auditoría
 * la registra el inventario.
 */
export function productStockTracking(db: DbClient) {
  const products = createProductRepository(db);
  return {
    find: (companyId: string, productId: string) => products.find(companyId, productId),
    search: (companyId: string, query: StockProductQuery) =>
      products.searchForStock(companyId, query),
    setStockTracked: (
      companyId: string,
      productId: string,
      stockTracked: boolean,
      userId: string,
    ) => products.setStockTrackedIfDifferent(companyId, productId, stockTracked, userId),
  };
}

export type { InventoryInitialization, StockProductQuery } from "../application/ports.ts";

export type ProductsModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Disponibilidad de las entradas fiscales de `catalogs` (design D2). */
  catalogs: CatalogAvailability;
  /**
   * Inventario inicializado de un producto (add-minimal-inventory, design D7): lo implementa
   * `inventory` y lo compone `main.ts`. Obligatorio: sin él, la marca de un producto con inventario
   * se podría cambiar desde la corrección del producto.
   */
  inventoryInitialization: InventoryInitialization;
  now?: () => Date;
};

export function productsModule({
  prisma,
  authorizer,
  catalogs,
  inventoryInitialization,
  now = () => new Date(),
}: ProductsModuleOptions) {
  const service = createProducts({
    products: createProductRepository(prisma),
    uow: createProductsUnitOfWork(prisma, inventoryInitialization),
    catalogs,
    authorizer,
    today: () => ecuadorDate(now()),
  });
  return { routers: [productsRouter(service)], service };
}
