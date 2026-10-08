// Lectura consistente de solo lectura: una transacción `REPEATABLE READ, READ ONLY` en la que todas
// las consultas ven un solo momento. La usan la exportación de los reportes (add-reports-export,
// design D10) y la fase 1 de la portabilidad (add-data-portability, design D12). No escribe nada;
// quien la usa registra su auditoría después, en su propia escritura.
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { DbClient } from "./database.ts";

/** Plazo por defecto de la transacción; cada uso acota su duración real. */
export const READ_ONLY_SNAPSHOT_TIMEOUT_MS = 5 * 60_000;
/** Espera por una conexión del pool antes de empezar. */
const READ_ONLY_SNAPSHOT_MAX_WAIT_MS = 10_000;

export function readOnlySnapshot<T>(
  prisma: PrismaClient,
  work: (db: DbClient) => Promise<T>,
  options: Readonly<{ timeoutMs?: number }> = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      return work(tx);
    },
    {
      timeout: options.timeoutMs ?? READ_ONLY_SNAPSHOT_TIMEOUT_MS,
      maxWait: READ_ONLY_SNAPSHOT_MAX_WAIT_MS,
    },
  );
}
