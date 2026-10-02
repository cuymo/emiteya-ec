// Base de pruebas: facturador_test de compose.yaml, o DATABASE_URL_TEST.
import { createDatabase } from "../../src/platform/db/database.ts";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://facturador:facturador@127.0.0.1:5432/facturador_test";

/** Falla con una indicación clara si PostgreSQL no está disponible, en lugar de saltarse las pruebas. */
export async function requireTestDatabase(): Promise<void> {
  const database = createDatabase(TEST_DATABASE_URL);
  const available = await database.ping();
  await database.close();
  if (!available) {
    const { hostname, port, pathname } = new URL(TEST_DATABASE_URL);
    throw new Error(
      `PostgreSQL no está disponible en ${hostname}:${port}${pathname}. ` +
        "Levántalo con `docker compose up -d` desde la raíz del repositorio, o define DATABASE_URL_TEST.",
    );
  }
}
