// Composición del módulo de productos para main.ts y las pruebas (add-parties-and-products).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { CatalogAvailability } from "../application/ports.ts";
import { createProducts } from "../application/products.ts";
import { productsRouter } from "./http/products-router.ts";
import { createProductRepository } from "./prisma-products.ts";
import { createProductsUnitOfWork } from "./unit-of-work.ts";

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
