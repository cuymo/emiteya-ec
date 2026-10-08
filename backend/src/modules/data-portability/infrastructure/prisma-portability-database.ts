// La base de la portabilidad sobre Prisma (add-data-portability, design D12): la transacción de
// solo lectura de la fase 1 con su momento (`transaction_timestamp()`, el mismo para todas sus
// consultas) y las transacciones de escritura del registro y de la cola.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { readOnlySnapshot } from "../../../platform/db/read-only-snapshot.ts";
import type { PortabilityDatabase } from "../application/ports.ts";

export function createPortabilityDatabase(prisma: PrismaClient): PortabilityDatabase {
  return {
    db: prisma,
    readOnlySnapshot: (work, timeoutMs) =>
      readOnlySnapshot(
        prisma,
        async (db) => {
          const [row] = await db.$queryRaw<{ at: Date }[]>`SELECT transaction_timestamp() AS at`;
          return work(db, row!.at);
        },
        { timeoutMs },
      ),
    transaction: (work) => prisma.$transaction((tx) => work(tx)),
  };
}
