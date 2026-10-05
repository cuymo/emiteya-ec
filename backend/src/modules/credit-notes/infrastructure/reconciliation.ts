// Reconciliación diagnóstica de la capacidad acreditable (add-credit-notes, design D7): compara lo
// reservado y lo aplicado de cada factura y de cada línea con la suma de sus reservas por estado, y
// que nada supere lo original. La usan las pruebas y `bench:credit-notes`. No es un endpoint y no
// corrige nada: la base ya impide las diferencias con su `CHECK` y sus triggers diferidos.
import { compareDecimalStrings } from "@facturador/contracts";
import { sumExact } from "../../../platform/decimal/fiscal-decimal.ts";
import type { DbClient } from "../../../platform/db/database.ts";

export type CreditCapacityDifference = Readonly<{
  companyId: string;
  invoiceId: string;
  /** Posición de la línea, o null para el total de la factura. */
  position: number | null;
  original: string;
  reserved: string;
  applied: string;
  reservedSum: string;
  appliedSum: string;
}>;

const same = (a: string, b: string) => compareDecimalStrings(a, b) === 0;

/** Diferencias de la capacidad acreditable, de una empresa o de todas; vacía si coinciden. */
export async function reconcileCreditCapacity(
  db: DbClient,
  companyId?: string,
): Promise<CreditCapacityDifference[]> {
  const where = companyId ? { companyId } : {};
  const capacities = await db.creditCapacity.findMany({ where, include: { lines: true } });
  const reservations = await db.creditReservation.findMany({
    where: { ...where, status: { in: ["RESERVED", "APPLIED"] } },
    include: { lines: true },
  });
  const totals = new Map<string, { RESERVED: string[]; APPLIED: string[] }>();
  const lines = new Map<string, { RESERVED: string[]; APPLIED: string[] }>();
  const bucket = (map: typeof totals, key: string) => {
    const found = map.get(key) ?? { RESERVED: [], APPLIED: [] };
    map.set(key, found);
    return found;
  };
  for (const reservation of reservations) {
    const status = reservation.status as "RESERVED" | "APPLIED";
    const invoice = `${reservation.companyId}:${reservation.invoiceId}`;
    bucket(totals, invoice)[status].push(reservation.amount.toFixed());
    for (const line of reservation.lines) {
      bucket(lines, `${invoice}:${line.position}`)[status].push(line.quantity.toFixed());
    }
  }
  const differences: CreditCapacityDifference[] = [];
  const check = (
    capacity: { companyId: string; invoiceId: string },
    position: number | null,
    original: string,
    reserved: string,
    applied: string,
    sums: { RESERVED: string[]; APPLIED: string[] } | undefined,
  ) => {
    const reservedSum = sumExact(sums?.RESERVED ?? []);
    const appliedSum = sumExact(sums?.APPLIED ?? []);
    if (
      !same(reserved, reservedSum) ||
      !same(applied, appliedSum) ||
      compareDecimalStrings(sumExact([reserved, applied]), original) > 0
    ) {
      differences.push({
        companyId: capacity.companyId,
        invoiceId: capacity.invoiceId,
        position,
        original,
        reserved,
        applied,
        reservedSum,
        appliedSum,
      });
    }
  };
  for (const capacity of capacities) {
    const invoice = `${capacity.companyId}:${capacity.invoiceId}`;
    check(
      capacity,
      null,
      capacity.originalTotal.toFixed(),
      capacity.reservedTotal.toFixed(),
      capacity.appliedTotal.toFixed(),
      totals.get(invoice),
    );
    for (const line of capacity.lines) {
      check(
        capacity,
        line.position,
        line.originalQuantity.toFixed(),
        line.reservedQuantity.toFixed(),
        line.appliedQuantity.toFixed(),
        lines.get(`${invoice}:${line.position}`),
      );
    }
  }
  return differences;
}
