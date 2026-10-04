// Lecturas del inventario para la API (add-minimal-inventory, design D8). Toda consulta filtra por
// la empresa; el saldo se lee materializado, nunca sumando el kárdex. El nombre de la persona sale
// de su relación, como en el historial de entregas.
import type { DbClient } from "../../../platform/db/database.ts";
import type { StockReads } from "../application/ports.ts";
import { createStockRepository, toMovement } from "./prisma-stock.ts";

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

    async summaries(companyId, productIds) {
      const found = await stock.findMany(companyId, productIds);
      if (found.size === 0) return new Map();
      const last = await db.stockMovement.findMany({
        where: {
          OR: [...found.values()].map((item) => ({
            companyId,
            productId: item.productId,
            position: item.lastPosition,
          })),
        },
        select: { productId: true, occurredAt: true },
      });
      const lastAt = new Map(last.map((row) => [row.productId, row.occurredAt]));
      return new Map(
        [...found].map(([productId, item]) => [
          productId,
          { stock: item, lastMovementAt: lastAt.get(productId) ?? null },
        ]),
      );
    },

    async movements(companyId, productId, { range, page, pageSize }) {
      const where = {
        companyId,
        productId,
        ...(range.from || range.before
          ? {
              occurredAt: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.before ? { lt: range.before } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.stockMovement.findMany({
          where,
          orderBy: { position: "desc" },
          include: { actor: { select: { name: true } } },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.stockMovement.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({ ...toMovement(row), actorName: row.actor?.name ?? null })),
        total,
      };
    },

    async movement(companyId, movementId) {
      const row = await db.stockMovement.findFirst({
        where: { id: movementId, companyId },
        include: { actor: { select: { name: true } } },
      });
      return row ? { ...toMovement(row), actorName: row.actor?.name ?? null } : null;
    },
  };
}
