// Unidad de trabajo del inventario (add-minimal-inventory, design D7): el movimiento, el saldo y la
// auditoría de la configuración en la misma transacción, con el lock transaccional del control de
// stock de cada producto.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { InventoryUnitOfWork } from "../application/ports.ts";
import { createStockRepository } from "./prisma-stock.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

/**
 * Lock transaccional del control de stock de un producto: lo toman la inicialización, el control,
 * las entradas, los ajustes y la corrección de la marca del producto, y se libera al confirmar.
 */
export async function lockStockTrackingIn(
  db: DbClient,
  companyId: string,
  productId: string,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock-tracking:${companyId}:${productId}`}))`;
}

export function createInventoryUnitOfWork(prisma: PrismaClient): InventoryUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) =>
          work({
            db: tx,
            stock: createStockRepository(tx),
            audit: createAuditLog(tx),
            lockTracking: (companyId, productId) => lockStockTrackingIn(tx, companyId, productId),
          }),
        { timeout: TRANSACTION_TIMEOUT_MS },
      ),
  };
}
