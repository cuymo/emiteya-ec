// Capacidad acreditable con Prisma (add-credit-notes, design D7 y D8). Cada consulta filtra por la
// empresa. La capacidad cambia solo con incrementos atómicos (`increment`/`decrement`); el `CHECK`
// de la base es la última defensa contra un exceso y los triggers diferidos exigen que la capacidad
// sea la suma de sus reservas. Las reservas solo pasan de RESERVED a APPLIED o RELEASED con una
// actualización guardada.
import type { DbClient } from "../../../platform/db/database.ts";
import {
  CreditCapacityExceededError,
  type CreditCapacityRepository,
} from "../application/ports.ts";

/** Texto exacto de un `Decimal` de Prisma, sin exponente. */
const text = (value: { toFixed(): string }) => value.toFixed();

/** Código de Prisma o de PostgreSQL de un error, si lo tiene. */
const codeOf = (error: unknown) => (error as { code?: unknown } | null)?.code;
const mentions = (error: unknown, name: string) =>
  JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(name);

/** Una violación del `CHECK` de la capacidad es un exceso: importe o cantidad de una línea. */
function exceeded(error: unknown): CreditCapacityExceededError | null {
  const code = codeOf(error);
  if (code !== "P2004" && code !== "23514" && !mentions(error, "23514")) return null;
  if (mentions(error, "credit_capacity_line_values_check")) {
    return new CreditCapacityExceededError("QUANTITY");
  }
  if (mentions(error, "credit_capacity_values_check"))
    return new CreditCapacityExceededError("AMOUNT");
  return null;
}

type TaxRow = { taxCode: string; rateCode: string; amount: string };

export function createCreditCapacityRepository(db: DbClient): CreditCapacityRepository {
  const capacityKey = (companyId: string, invoiceId: string) => ({
    companyId_invoiceId: { companyId, invoiceId },
  });
  const lineKey = (companyId: string, invoiceId: string, position: number) => ({
    companyId_invoiceId_position: { companyId, invoiceId, position },
  });

  return {
    async lock(companyId, invoiceId) {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`credit-capacity:${companyId}:${invoiceId}`}))`;
    },

    async initialize({ companyId, invoiceId, total, lines }) {
      await db.creditCapacity.createMany({
        data: [{ companyId, invoiceId, originalTotal: total }],
        skipDuplicates: true,
      });
      await db.creditCapacityLine.createMany({
        data: lines.map((line) => ({
          companyId,
          invoiceId,
          position: line.position,
          productId: line.productId,
          originalQuantity: line.quantity,
        })),
        skipDuplicates: true,
      });
    },

    async read(companyId, invoiceId) {
      const capacity = await db.creditCapacity.findUnique({
        where: capacityKey(companyId, invoiceId),
        include: { lines: { orderBy: { position: "asc" } } },
      });
      const credited = await db.creditReservationLine.findMany({
        where: {
          companyId,
          invoiceId,
          reservation: { status: { in: ["RESERVED", "APPLIED"] } },
        },
        orderBy: [{ position: "asc" }, { reservationId: "asc" }],
      });
      return {
        exists: capacity !== null,
        reserved: capacity ? text(capacity.reservedTotal) : "0",
        applied: capacity ? text(capacity.appliedTotal) : "0",
        lines: (capacity?.lines ?? []).map((line) => ({
          position: line.position,
          productId: line.productId,
          original: text(line.originalQuantity),
          reserved: text(line.reservedQuantity),
          applied: text(line.appliedQuantity),
        })),
        credited: credited.map((line) => ({
          position: line.position,
          quantity: text(line.quantity),
          subtotal: text(line.subtotal),
          discount: text(line.discount),
          taxableBase: text(line.taxableBase),
          taxes: (line.taxes as TaxRow[]).map(({ taxCode, rateCode, amount }) => ({
            taxCode,
            rateCode,
            amount,
          })),
        })),
      };
    },

    async reserve({ companyId, invoiceId, amount, lines }) {
      try {
        await db.creditCapacity.update({
          where: capacityKey(companyId, invoiceId),
          data: { reservedTotal: { increment: amount } },
        });
        for (const line of lines) {
          await db.creditCapacityLine.update({
            where: lineKey(companyId, invoiceId, line.position),
            data: { reservedQuantity: { increment: line.quantity } },
          });
        }
      } catch (error) {
        throw exceeded(error) ?? error;
      }
    },

    async record({ companyId, invoiceId, creditNoteId, cause, amount, lines }) {
      const reservation = await db.creditReservation.create({
        data: { companyId, invoiceId, creditNoteId, cause, amount },
      });
      await db.creditReservationLine.createMany({
        data: lines.map((line) => ({
          reservationId: reservation.id,
          companyId,
          invoiceId,
          position: line.position,
          quantity: line.quantity,
          subtotal: line.subtotal,
          discount: line.discount,
          taxableBase: line.taxableBase,
          taxes: line.taxes.map((tax) => ({ ...tax })),
          physicalReturn: line.physicalReturn,
        })),
      });
    },

    async conclude(companyId, creditNoteId, outcome, at) {
      const changed = await db.creditReservation.updateMany({
        where: { companyId, creditNoteId, status: "RESERVED" },
        data: { status: outcome, concludedAt: at },
      });
      if (changed.count === 0) return false;
      const reservation = await db.creditReservation.findUniqueOrThrow({
        where: { companyId_creditNoteId: { companyId, creditNoteId } },
        // En orden de posición: el mismo orden de bloqueo que la reserva (design D8).
        include: { lines: { orderBy: { position: "asc" } } },
      });
      const applied = outcome === "APPLIED";
      await db.creditCapacity.update({
        where: capacityKey(companyId, reservation.invoiceId),
        data: {
          reservedTotal: { decrement: reservation.amount },
          ...(applied ? { appliedTotal: { increment: reservation.amount } } : {}),
        },
      });
      for (const line of reservation.lines) {
        await db.creditCapacityLine.update({
          where: lineKey(companyId, reservation.invoiceId, line.position),
          data: {
            reservedQuantity: { decrement: line.quantity },
            ...(applied ? { appliedQuantity: { increment: line.quantity } } : {}),
          },
        });
      }
      return true;
    },
  };
}
