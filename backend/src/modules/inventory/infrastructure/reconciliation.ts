// Reconciliación diagnóstica del inventario (add-minimal-inventory, design D2): compara el saldo
// materializado de cada producto con la suma de las variaciones de su kárdex, con su número de
// movimientos y con el saldo después del último. La usan las pruebas y `bench:inventory`. No es un
// endpoint y no corrige nada: la base ya impide las diferencias con sus triggers.
import { compareDecimalStrings } from "@facturador/contracts";
import { sumExact } from "../../../platform/decimal/fiscal-decimal.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { toMovement } from "./prisma-stock.ts";

export type StockDifference = Readonly<{
  companyId: string;
  productId: string;
  balance: string;
  ledgerSum: string;
  lastBalanceAfter: string | null;
  lastPosition: number;
  movements: number;
}>;

const CHUNK = 500;

/** Diferencias entre los saldos y sus kárdex, de una empresa o de todas; vacía si coinciden. */
export async function reconcileStock(db: DbClient, companyId?: string): Promise<StockDifference[]> {
  const where = companyId ? { companyId } : {};
  const balances = await db.stockBalance.findMany({
    where,
    orderBy: [{ companyId: "asc" }, { productId: "asc" }],
  });
  const sums = await db.stockMovement.groupBy({
    by: ["companyId", "productId"],
    where,
    _sum: { delta: true },
    _count: { _all: true },
  });
  const sumOf = new Map(
    sums.map((row) => [
      `${row.companyId}:${row.productId}`,
      { sum: sumExact([row._sum.delta?.toFixed() ?? "0"]), count: row._count._all },
    ]),
  );
  const lastOf = new Map<string, string>();
  for (let start = 0; start < balances.length; start += CHUNK) {
    const chunk = balances.slice(start, start + CHUNK);
    const rows = await db.stockMovement.findMany({
      where: {
        OR: chunk.map((balance) => ({
          companyId: balance.companyId,
          productId: balance.productId,
          position: balance.lastPosition,
        })),
      },
    });
    for (const row of rows.map(toMovement))
      lastOf.set(`${row.companyId}:${row.productId}`, row.balanceAfter);
  }
  const differences: StockDifference[] = [];
  for (const row of balances) {
    const id = `${row.companyId}:${row.productId}`;
    const balance = sumExact([row.balance.toFixed()]);
    const ledger = sumOf.get(id) ?? { sum: "0", count: 0 };
    const last = lastOf.get(id) ?? null;
    if (
      balance !== ledger.sum ||
      last === null ||
      sumExact([last]) !== balance ||
      ledger.count !== row.lastPosition
    ) {
      differences.push({
        companyId: row.companyId,
        productId: row.productId,
        balance,
        ledgerSum: ledger.sum,
        lastBalanceAfter: last,
        lastPosition: row.lastPosition,
        movements: ledger.count,
      });
    }
  }
  return differences;
}

export type StockReturnDifference = Readonly<{
  companyId: string;
  invoiceId: string;
  productId: string;
  original: string;
  reserved: string;
  applied: string;
  reservedSum: string;
  appliedSum: string;
}>;

/**
 * Diferencias de la capacidad devolvible (add-credit-notes, design D10): lo reservado y lo aplicado
 * de cada factura y producto contra la suma de sus reservas por estado, y que nada supere la salida.
 * Como la del saldo, no corrige nada: la base ya lo impide.
 */
export async function reconcileStockReturnCapacity(
  db: DbClient,
  companyId?: string,
): Promise<StockReturnDifference[]> {
  const where = companyId ? { companyId } : {};
  const [capacities, sums] = await Promise.all([
    db.stockReturnCapacity.findMany({ where }),
    db.stockReturnReservation.groupBy({
      by: ["companyId", "invoiceId", "productId", "status"],
      where: { ...where, status: { in: ["RESERVED", "APPLIED"] } },
      _sum: { quantity: true },
    }),
  ]);
  const sumOf = (
    row: { companyId: string; invoiceId: string; productId: string },
    status: string,
  ) =>
    sumExact([
      sums
        .find(
          (sum) =>
            sum.companyId === row.companyId &&
            sum.invoiceId === row.invoiceId &&
            sum.productId === row.productId &&
            sum.status === status,
        )
        ?._sum.quantity?.toFixed() ?? "0",
    ]);
  const differences: StockReturnDifference[] = [];
  for (const row of capacities) {
    const reserved = sumExact([row.reservedQuantity.toFixed()]);
    const applied = sumExact([row.appliedQuantity.toFixed()]);
    const original = sumExact([row.originalQuantity.toFixed()]);
    const reservedSum = sumOf(row, "RESERVED");
    const appliedSum = sumOf(row, "APPLIED");
    const exceeds = compareDecimalStrings(sumExact([reserved, applied]), original) > 0;
    if (reserved !== reservedSum || applied !== appliedSum || exceeds) {
      differences.push({
        companyId: row.companyId,
        invoiceId: row.invoiceId,
        productId: row.productId,
        original,
        reserved,
        applied,
        reservedSum,
        appliedSum,
      });
    }
  }
  return differences;
}
