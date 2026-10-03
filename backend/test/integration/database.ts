// Base de pruebas: facturador_test de compose.yaml, o DATABASE_URL_TEST.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://facturador:facturador@127.0.0.1:5432/facturador_test";

export const BACKEND_DIR = fileURLToPath(new URL("../..", import.meta.url));
export const BIN_DIR = fileURLToPath(new URL("../../node_modules/.bin/", import.meta.url));

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

export function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
}

/** Ejecuta un binario del backend (prisma, auth) y devuelve su salida; nunca usa una shell. */
export function runBin(bin: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(`${BIN_DIR}${bin}`, args, {
    cwd: BACKEND_DIR,
    env: { ...process.env, BETTER_AUTH_TELEMETRY: "0", CHECKPOINT_DISABLE: "1", ...env },
    encoding: "utf8",
  });
}

export type MigratedSchema = {
  name: string;
  url: string;
  database: Database;
  drop: () => Promise<void>;
};

/**
 * Crea un esquema PostgreSQL propio de un archivo de pruebas y le aplica las migraciones del
 * proyecto. Aísla los datos entre archivos que corren en paralelo y permite partir de una
 * instalación vacía.
 */
export async function createMigratedSchema(label: string): Promise<MigratedSchema> {
  if (!/^[a-z_]+$/.test(label)) throw new Error("label solo admite letras minúsculas y _");
  await requireTestDatabase();
  const name = `t_${label}_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  // Prisma serializa toda migración de la base con un único advisory lock. Cada esquema de prueba
  // es nuevo y lo migra una sola vez su propio archivo, así que el lock solo encola esquemas
  // independientes y, con la suite en paralelo, agota su espera de 10 s (P1002).
  const migrate = runBin("prisma", ["migrate", "deploy"], {
    DATABASE_URL: url,
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
  });
  if (migrate.status !== 0)
    throw new Error(`prisma migrate deploy falló:\n${migrate.stdout}${migrate.stderr}`);
  const database = createDatabase(url);
  return {
    name,
    url,
    database,
    drop: async () => {
      // El nombre lo genera esta función; no contiene datos externos.
      await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
      await database.close();
    },
  };
}
