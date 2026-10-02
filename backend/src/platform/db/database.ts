// Acceso a PostgreSQL con Prisma 7 y su adapter de PostgreSQL. Una sola instancia por proceso.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";

export const READINESS_TIMEOUT_MS = 2_000;

export type Database = {
  prisma: PrismaClient;
  /** true si PostgreSQL responde a SELECT 1 antes del tiempo límite. */
  ping: (timeoutMs?: number) => Promise<boolean>;
  close: () => Promise<void>;
};

export function createDatabase(connectionString: string): Database {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: READINESS_TIMEOUT_MS }),
  });

  async function ping(timeoutMs = READINESS_TIMEOUT_MS): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const query = prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );
    try {
      return await Promise.race([query, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return { prisma, ping, close: () => prisma.$disconnect() };
}
