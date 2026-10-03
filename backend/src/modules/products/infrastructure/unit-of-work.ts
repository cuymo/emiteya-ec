// Unidad de trabajo de productos (add-parties-and-products, design D13): el cambio, sus referencias
// fiscales y su evento de auditoría en la misma transacción.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { ProductsUnitOfWork } from "../application/ports.ts";
import { createProductRepository } from "./prisma-products.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

export function createProductsUnitOfWork(prisma: PrismaClient): ProductsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) => work({ products: createProductRepository(tx), audit: createAuditLog(tx) }),
        { timeout: TRANSACTION_TIMEOUT_MS },
      ),
  };
}
