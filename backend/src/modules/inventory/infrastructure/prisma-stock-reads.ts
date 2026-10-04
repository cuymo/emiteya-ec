// Lecturas del inventario para la API (add-minimal-inventory, design D8). Toda consulta filtra por
// la empresa; el saldo se lee materializado, nunca sumando el kárdex. El nombre de la persona sale
// de su relación, como en el historial de entregas.
import type { DbClient } from "../../../platform/db/database.ts";
import type { StockReads } from "../application/ports.ts";
import { createStockRepository } from "./prisma-stock.ts";

export function createStockReads(db: DbClient): StockReads {
  const stock = createStockRepository(db);
  return {
    async detail(companyId, productId) {
      const found = await stock.find(companyId, productId);
      if (!found) return null;
      const initializer = await db.user.findUnique({
        where: { id: found.initializedBy },
        select: { name: true },
      });
      const last = await db.stockMovement.findUnique({
        where: {
          companyId_productId_position: { companyId, productId, position: found.lastPosition },
        },
        select: { occurredAt: true },
      });
      return {
        stock: found,
        initializedByName: initializer?.name ?? "",
        lastMovementAt: last?.occurredAt ?? null,
      };
    },
  };
}
