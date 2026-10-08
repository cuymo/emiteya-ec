// Lecturas de los reportes sobre Prisma (add-reports-export, design D10): la lista lee suelta, y la
// exportación lee en una transacción `REPEATABLE READ` de solo lectura, de modo que el conteo, el
// rechazo por máximo de filas y los lotes del cursor ven un solo momento. La transacción no escribe
// nada; la auditoría va después, en su propia escritura.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { ReportsDatabase } from "../application/ports.ts";

/** Plazo de la transacción de una exportación; el máximo de filas acota su duración real. */
export const EXPORT_TRANSACTION_TIMEOUT_MS = 5 * 60_000;
/** Espera por una conexión del pool antes de empezar. */
const EXPORT_TRANSACTION_MAX_WAIT_MS = 10_000;

export function createReportsDatabase(prisma: PrismaClient): ReportsDatabase {
  return {
    db: prisma,
    readOnlySnapshot(work) {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
          return work(tx);
        },
        { timeout: EXPORT_TRANSACTION_TIMEOUT_MS, maxWait: EXPORT_TRANSACTION_MAX_WAIT_MS },
      );
    },
  };
}
