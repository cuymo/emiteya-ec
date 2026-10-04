// Repositorio del inventario sobre PostgreSQL (add-minimal-inventory, design D2 y D5). Toda consulta
// filtra por la empresa. El saldo cambia solo con una actualización atómica (`increment`), que
// bloquea su fila hasta el fin de la transacción, y el movimiento toma de ella su posición y su saldo
// resultante: nunca se lee el saldo, se calcula en memoria y se escribe. Las cantidades se
// convierten por texto con el dominio `existencia`.
import type { StockMovementOrigin, StockMovementType } from "@facturador/contracts";
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { StockQuantity } from "../../../platform/decimal/fiscal-decimal.ts";
import {
  StockAlreadyInitializedError,
  StockIdempotencyCollisionError,
  StockNotInitializedError,
  type StockIdempotentOperation,
  type StockRepository,
  type StoredMovement,
  type StoredStock,
} from "../application/ports.ts";

type BalanceRow = Prisma.StockBalanceGetPayload<object>;
type MovementRow = Prisma.StockMovementGetPayload<object>;

const quantity = (stored: { toFixed(): string }) => StockQuantity.fromDatabase(stored).toString();

function toStock(row: BalanceRow): StoredStock {
  return {
    companyId: row.companyId,
    productId: row.productId,
    balance: quantity(row.balance),
    lastPosition: row.lastPosition,
    initializedAt: row.initializedAt,
    initializedBy: row.initializedBy,
    updatedAt: row.updatedAt,
  };
}

export function toMovement(row: MovementRow): StoredMovement {
  return {
    id: row.id,
    companyId: row.companyId,
    productId: row.productId,
    position: row.position,
    type: row.movementType as StockMovementType,
    delta: quantity(row.delta),
    balanceAfter: quantity(row.balanceAfter),
    documentId: row.documentId,
    documentNumber: row.documentNumber,
    origin: row.origin as StockMovementOrigin,
    actorUserId: row.actorUserId,
    reason: row.reason,
    idempotencyOperation: row.idempotencyOperation as StockIdempotentOperation | null,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    occurredAt: row.occurredAt,
  };
}

/** Código de Prisma o de PostgreSQL de un error, si lo tiene. */
const codeOf = (error: unknown) => (error as { code?: unknown } | null)?.code;

/** Violación de unicidad sobre la restricción `name` (P2002 de Prisma o 23505 de PostgreSQL). */
function violates(error: unknown, name: string): boolean {
  if (codeOf(error) !== "P2002" && codeOf(error) !== "23505") return false;
  return JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(name);
}

export function createStockRepository(db: DbClient): StockRepository {
  const key = (companyId: string, productId: string) => ({
    companyId_productId: { companyId, productId },
  });

  return {
    async find(companyId, productId) {
      const row = await db.stockBalance.findUnique({ where: key(companyId, productId) });
      return row ? toStock(row) : null;
    },

    async findMany(companyId, productIds) {
      if (productIds.length === 0) return new Map();
      const rows = await db.stockBalance.findMany({
        where: { companyId, productId: { in: [...productIds] } },
      });
      return new Map(rows.map((row) => [row.productId, toStock(row)]));
    },

    async initialize({ companyId, productId, quantity: initial, note, actorUserId, at }) {
      try {
        await db.stockBalance.create({
          data: {
            companyId,
            productId,
            balance: initial,
            lastPosition: 1,
            initializedAt: at,
            initializedBy: actorUserId,
            updatedAt: at,
          },
        });
      } catch (error) {
        // La única unicidad del saldo es su clave: otra inicialización ganó.
        if (codeOf(error) === "P2002" || codeOf(error) === "23505") {
          throw new StockAlreadyInitializedError(productId);
        }
        throw error;
      }
      const row = await db.stockMovement.create({
        data: {
          companyId,
          productId,
          position: 1,
          movementType: "INICIAL",
          delta: initial,
          balanceAfter: initial,
          origin: "USER",
          actorUserId,
          reason: note,
          occurredAt: at,
        },
      });
      return toMovement(row);
    },

    async append(movement) {
      let updated: BalanceRow;
      try {
        updated = await db.stockBalance.update({
          where: key(movement.companyId, movement.productId),
          data: {
            balance: { increment: movement.delta },
            lastPosition: { increment: 1 },
            updatedAt: movement.occurredAt,
          },
        });
      } catch (error) {
        if (codeOf(error) === "P2025") throw new StockNotInitializedError(movement.productId);
        throw error;
      }
      try {
        const row = await db.stockMovement.create({
          data: {
            companyId: movement.companyId,
            productId: movement.productId,
            position: updated.lastPosition,
            movementType: movement.type,
            delta: movement.delta,
            balanceAfter: quantity(updated.balance),
            documentId: movement.documentId ?? null,
            documentNumber: movement.documentNumber ?? null,
            origin: movement.origin,
            actorUserId: movement.actorUserId,
            reason: movement.reason ?? null,
            idempotencyOperation: movement.idempotency?.operation ?? null,
            idempotencyKey: movement.idempotency?.key ?? null,
            requestHash: movement.idempotency?.requestHash ?? null,
            occurredAt: movement.occurredAt,
          },
        });
        return toMovement(row);
      } catch (error) {
        if (violates(error, "stock_movement_idempotency_key")) {
          throw new StockIdempotencyCollisionError();
        }
        throw error;
      }
    },

    async lock(companyId, productId, at) {
      try {
        const row = await db.stockBalance.update({
          where: key(companyId, productId),
          data: { updatedAt: at },
        });
        return toStock(row);
      } catch (error) {
        if (codeOf(error) === "P2025") return null;
        throw error;
      }
    },

    async findOutflow(companyId, documentId, productId) {
      const row = await db.stockMovement.findFirst({
        where: { companyId, documentId, productId, movementType: "SALIDA_FACTURA" },
      });
      return row ? toMovement(row) : null;
    },

    async findByIdempotency(companyId, operation, idempotencyKey) {
      const row = await db.stockMovement.findFirst({
        where: { companyId, idempotencyOperation: operation, idempotencyKey },
      });
      return row ? toMovement(row) : null;
    },

    async initializedIds(companyId, options = {}) {
      const rows = await db.stockBalance.findMany({
        where: { companyId, ...(options.negative ? { balance: { lt: 0 } } : {}) },
        select: { productId: true },
      });
      return rows.map((row) => row.productId);
    },
  };
}
