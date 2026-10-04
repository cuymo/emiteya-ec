// Reconciliación diagnóstica del inventario (add-minimal-inventory, design D2): compara el saldo
// materializado de cada producto con la suma de las variaciones de su kárdex, con su número de
// movimientos y con el saldo después del último. La usan las pruebas y `bench:inventory`. No es un
// endpoint y no corrige nada: la base ya impide las diferencias con sus triggers.
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
