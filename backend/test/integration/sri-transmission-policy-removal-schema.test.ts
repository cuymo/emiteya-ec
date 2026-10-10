// Migración remove_sri_transmission_policy en PostgreSQL (adopt-conservative-sri-transmission-size-
// policy-v1, design D6). Aplica las migraciones anteriores y simula un esquema de pruebas o el sandbox
// manual con una política sintética aplicada. Después aplica esta migración y comprueba:
// - que solo se retira la infraestructura de `sri-transmission-policy`;
// - que los demás catálogos fiscales no cambian;
// - que el registro de datasets sigue siendo inmutable.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";

const REMOVAL_MIGRATION = "20261014100000_remove_sri_transmission_policy";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
const HASH = "0".repeat(64);

describe("retiro del catálogo sri-transmission-policy en la base de datos", () => {
  const name = `t_size_policy_removal_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let datasetsBefore: { catalogType: string; version: number }[];

  const table = (relation: string) => `"${name}"."${relation}"`;
  const execute = (migration: string) => {
    const result = runBin(
      "prisma",
      ["db", "execute", "--file", `prisma/migrations/${migration}/migration.sql`],
      { DATABASE_URL: url },
    );
    if (result.status !== 0) throw new Error(`${migration}:\n${result.stdout}${result.stderr}`);
  };
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const datasets = async () =>
    (
      await database.prisma.$queryRawUnsafe<{ catalog_type: string; version: number }[]>(
        `SELECT "catalog_type", "version" FROM ${table("fiscal_catalog_dataset")}
         ORDER BY "catalog_type", "version"`,
      )
    ).map((row) => ({ catalogType: row.catalog_type, version: row.version }));
  const insertDataset = (catalogType: string) =>
    database.prisma.$executeRawUnsafe(
      `INSERT INTO ${table("fiscal_catalog_dataset")}
         ("catalog_type", "version", "source_document", "source_version", "source_published_on",
          "source_url", "source_sha256", "enablement_policy", "checksum")
       VALUES ('${catalogType}', 99, 'Fuente sintética', 'sintética', DATE '2026-07-27',
               'https://politica-sintetica.invalid/limite', '${HASH}', 'NOT_ENABLEABLE', '${HASH}')`,
    );

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < REMOVAL_MIGRATION)) execute(migration);

    // Los catálogos distribuidos, más una política sintética como la que aplicaban las pruebas.
    await loadInstalledFiscalCatalogs(database.prisma);
    await insertDataset("sri-transmission-policy");
    await database.prisma.$executeRawUnsafe(
      `INSERT INTO ${table("sri_transmission_policy")}
         ("id", "max_signed_document_bytes", "source_text", "source_section", "literal_unit",
          "interpretation", "effective_from", "effective_from_basis", "dataset_version")
       VALUES ('sintetica', 4096, 'Texto sintético', 'Sección sintética', 'bytes', 'Sintética',
               DATE '2026-07-27', 'PROJECT_BASELINE', 99)`,
    );
    datasetsBefore = await datasets();

    execute(REMOVAL_MIGRATION);
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("la tabla y sus dos funciones ya no existen; la función compartida se conserva", async () => {
    const [relation] = await database.prisma.$queryRawUnsafe<{ oid: string | null }[]>(
      `SELECT to_regclass('${table("sri_transmission_policy")}')::text AS oid`,
    );
    expect(relation!.oid).toBeNull();
    const functions = (
      await database.prisma.$queryRawUnsafe<{ proname: string }[]>(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = '${name}'`,
      )
    ).map((row) => row.proname);
    expect(functions).not.toContain("sri_transmission_policy_guard");
    expect(functions).not.toContain("sri_transmission_policy_no_overlap");
    expect(functions).toContain("fiscal_catalog_reject_change");
  });

  it("borra solo las filas del tipo retirado del registro de datasets", async () => {
    expect(datasetsBefore.some((d) => d.catalogType === "sri-transmission-policy")).toBe(true);
    expect(await datasets()).toEqual(
      datasetsBefore.filter((d) => d.catalogType !== "sri-transmission-policy"),
    );
  });

  it("un dataset nuevo del tipo retirado se rechaza; los demás tipos siguen admitidos", async () => {
    expect(await fails(insertDataset("sri-transmission-policy"))).toContain(
      "fiscal_catalog_dataset_catalog_type_check",
    );
    expect(await fails(insertDataset("special-case-matrix"))).toBeNull();
  });

  it("el registro de datasets sigue siendo inmutable después de la migración", async () => {
    expect(
      await fails(
        database.prisma.$executeRawUnsafe(
          `DELETE FROM ${table("fiscal_catalog_dataset")} WHERE "catalog_type" = 'payment-method'`,
        ),
      ),
    ).toContain("no admite DELETE");
  });

  it("los catálogos distribuidos se vuelven a cargar sin cambios", async () => {
    const before = await datasets();
    await loadInstalledFiscalCatalogs(database.prisma);
    expect(await datasets()).toEqual(before);
  });
});
