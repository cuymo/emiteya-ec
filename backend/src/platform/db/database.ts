// Acceso a PostgreSQL con Prisma 7 y su adapter de PostgreSQL. Una sola instancia por proceso.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../generated/prisma/client.ts";

export const READINESS_TIMEOUT_MS = 2_000;

/** El cliente o una transacción en curso: los repositorios aceptan ambos. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export type Database = {
  prisma: PrismaClient;
  /** true si PostgreSQL responde a SELECT 1 antes del tiempo límite. */
  ping: (timeoutMs?: number) => Promise<boolean>;
  close: () => Promise<void>;
};

/** Separa el parámetro `schema` de la URL, la convención de Prisma, para pasarlo al adapter. */
export function parseDatabaseUrl(url: string): { connectionString: string; schema?: string } {
  const parsed = new URL(url);
  const schema = parsed.searchParams.get("schema");
  parsed.searchParams.delete("schema");
  return { connectionString: parsed.toString(), ...(schema ? { schema } : {}) };
}

export function createDatabase(url: string): Database {
  const { connectionString, schema } = parseDatabaseUrl(url);
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString, connectionTimeoutMillis: READINESS_TIMEOUT_MS },
      schema ? { schema } : undefined,
    ),
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
