// Composición del módulo de productos para main.ts y las pruebas (add-parties-and-products).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { CatalogAvailability } from "../application/ports.ts";
import { createProducts } from "../application/products.ts";
import { productsRouter } from "./http/products-router.ts";
import { createProductRepository } from "./prisma-products.ts";
import { createProductsUnitOfWork } from "./unit-of-work.ts";

/**
 * Lectura de un producto de la empresa, con sus referencias fiscales, sobre un cliente: la emisión
 * de facturas la usa dentro de su transacción (add-invoice-emission, design D1).
 */
export function productReader(db: DbClient) {
  const products = createProductRepository(db);
  return { find: (companyId: string, productId: string) => products.find(companyId, productId) };
}

export type ProductsModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  /** Disponibilidad de las entradas fiscales de `catalogs` (design D2). */
  catalogs: CatalogAvailability;
  now?: () => Date;
};

export function productsModule({
  prisma,
  authorizer,
  catalogs,
  now = () => new Date(),
}: ProductsModuleOptions) {
  const service = createProducts({
    products: createProductRepository(prisma),
    uow: createProductsUnitOfWork(prisma),
    catalogs,
    authorizer,
    today: () => ecuadorDate(now()),
  });
  return { routers: [productsRouter(service)], service };
}
