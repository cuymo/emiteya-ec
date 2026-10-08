// Lecturas de los reportes sobre Prisma (add-reports-export, design D10): la lista lee suelta, y la
// exportación lee en una transacción `REPEATABLE READ` de solo lectura (`platform/db`), de modo que
// el conteo, el rechazo por máximo de filas y los lotes del cursor ven un solo momento. La
// transacción no escribe nada; la auditoría va después, en su propia escritura.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { readOnlySnapshot } from "../../../platform/db/read-only-snapshot.ts";
import type { ReportsDatabase } from "../application/ports.ts";

export function createReportsDatabase(prisma: PrismaClient): ReportsDatabase {
  return {
    db: prisma,
    readOnlySnapshot: (work) => readOnlySnapshot(prisma, work),
  };
}
