// Capacidad devolvible de las facturas (add-credit-notes, design D10): lo que la salida de una
// factura sacó del inventario para cada producto y lo que los retornos físicos de sus notas
// reservaron y aplicaron. La crea la primera nota desde la `SALIDA_FACTURA` (cero sin salida), la
// reserva suma con incrementos atómicos por producto en orden estable y el `CHECK` de la base
// rechaza un exceso. Es independiente de la capacidad acreditable de `credit-notes`, que la recibe
// por un puerto que compone `main.ts`; el inventario no importa `credit-notes`.
import { compareDecimalStrings } from "@facturador/contracts";
import { subtractExact, sumExact } from "../../../platform/decimal/fiscal-decimal.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { StockReturnReservations } from "../application/credit-note-return.ts";
import { StockReturnExceededError } from "../application/ports.ts";

type ProductReturn = Readonly<{ productId: string; quantity: string }>;

/** Código de Prisma o de PostgreSQL de un error, si lo tiene. */
const codeOf = (error: unknown) => (error as { code?: unknown } | null)?.code;
const mentions = (error: unknown, name: string) =>
  JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(name);

/** Retornos agrupados por producto con la suma exacta, en orden estable de `productId`. */
function byProduct(returns: readonly ProductReturn[]): ProductReturn[] {
  const totals = new Map<string, string>();
  for (const ret of returns) {
    totals.set(ret.productId, sumExact([totals.get(ret.productId) ?? "0", ret.quantity]));
  }
  return [...totals]
    .filter(([, quantity]) => compareDecimalStrings(quantity, "0") > 0)
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

/** Valor absoluto exacto de una variación negativa. */
const absolute = (delta: string) => (delta.startsWith("-") ? delta.slice(1) : delta);

export function stockReturnCapacity(db: DbClient) {
  /** La salida de la factura por producto: el valor absoluto de cada `SALIDA_FACTURA`. */
  async function outflows(
    companyId: string,
    invoiceId: string,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const rows = await db.stockMovement.findMany({
      where: {
        companyId,
        documentId: invoiceId,
        movementType: "SALIDA_FACTURA",
        productId: { in: [...productIds] },
      },
      select: { productId: true, delta: true },
    });
    return new Map(rows.map((row) => [row.productId, absolute(row.delta.toFixed())]));
  }

  return {
    async available(companyId: string, invoiceId: string, productIds: readonly string[]) {
      const [capacities, original] = await Promise.all([
        db.stockReturnCapacity.findMany({
          where: { companyId, invoiceId, productId: { in: [...productIds] } },
        }),
        outflows(companyId, invoiceId, productIds),
      ]);
      const byId = new Map(capacities.map((row) => [row.productId, row]));
      return new Map(
        productIds.map((productId) => {
          const row = byId.get(productId);
          const available = row
            ? subtractExact(
                subtractExact(row.originalQuantity.toFixed(), row.appliedQuantity.toFixed()),
                row.reservedQuantity.toFixed(),
              )
            : (original.get(productId) ?? "0");
          return [productId, available] as const;
        }),
      );
    },

    async reserve(input: {
      companyId: string;
      invoiceId: string;
      returns: readonly ProductReturn[];
    }) {
      const grouped = byProduct(input.returns);
      if (grouped.length === 0) return;
      const original = await outflows(
        input.companyId,
        input.invoiceId,
        grouped.map((ret) => ret.productId),
      );
      for (const ret of grouped) {
        await db.stockReturnCapacity.createMany({
          data: [
            {
              companyId: input.companyId,
              invoiceId: input.invoiceId,
              productId: ret.productId,
              originalQuantity: original.get(ret.productId) ?? "0",
            },
          ],
          skipDuplicates: true,
        });
        try {
          await db.stockReturnCapacity.update({
            where: {
              companyId_invoiceId_productId: {
                companyId: input.companyId,
                invoiceId: input.invoiceId,
                productId: ret.productId,
              },
            },
            data: { reservedQuantity: { increment: ret.quantity } },
          });
        } catch (error) {
          const code = codeOf(error);
          if (
            (code === "P2004" || code === "23514" || mentions(error, "23514")) &&
            mentions(error, "stock_return_capacity_values_check")
          ) {
            throw new StockReturnExceededError(ret.productId);
          }
          throw error;
        }
      }
    },

    async record(input: {
      companyId: string;
      invoiceId: string;
      creditNoteId: string;
      returns: readonly ProductReturn[];
    }) {
      const grouped = byProduct(input.returns);
      if (grouped.length === 0) return;
      await db.stockReturnReservation.createMany({
        data: grouped.map((ret) => ({
          companyId: input.companyId,
          creditNoteId: input.creditNoteId,
          productId: ret.productId,
          invoiceId: input.invoiceId,
          quantity: ret.quantity,
        })),
      });
    },
  };
}

/** Reservas devolvibles de las notas, para el seguidor de la autorización (design D10). */
export function stockReturnReservations(db: DbClient): StockReturnReservations {
  return {
    async reservedOf(companyId, creditNoteId) {
      const rows = await db.stockReturnReservation.findMany({
        where: { companyId, creditNoteId, status: "RESERVED" },
        orderBy: { productId: "asc" },
      });
      return rows.map((row) => ({ productId: row.productId, quantity: row.quantity.toFixed() }));
    },

    async conclude(companyId, creditNoteId, productId, outcome, at) {
      const changed = await db.stockReturnReservation.updateMany({
        where: { companyId, creditNoteId, productId, status: "RESERVED" },
        data: { status: outcome, concludedAt: at },
      });
      if (changed.count === 0) return false;
      const reservation = await db.stockReturnReservation.findUniqueOrThrow({
        where: { companyId_creditNoteId_productId: { companyId, creditNoteId, productId } },
      });
      await db.stockReturnCapacity.update({
        where: {
          companyId_invoiceId_productId: { companyId, invoiceId: reservation.invoiceId, productId },
        },
        data: {
          reservedQuantity: { decrement: reservation.quantity },
          ...(outcome === "APPLIED"
            ? { appliedQuantity: { increment: reservation.quantity } }
            : {}),
        },
      });
      return true;
    },
  };
}
