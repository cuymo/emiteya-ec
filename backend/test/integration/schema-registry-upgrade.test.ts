// Actualización del registro de esquemas (add-invoice-emission, tarea 2.1, design D11): una
// instalación que cargó la versión 1 del registro antes de la migración
// `20261004100100_schema_registry_imports` la conserva intacta, con su ruta lógica rellenada y el
// trigger de inmutabilidad otra vez activo, y el arranque siguiente aplica la versión 2.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import schemaRegistry1 from "../../src/modules/catalogs/datasets/schema-registry/1.json" with { type: "json" };
import { datasetChecksum, type DatasetFile } from "../../src/modules/catalogs/domain/datasets.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";

const REGISTRY_MIGRATION = "20261004100100_schema_registry_imports";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

type V1Row = {
  document_type: string;
  version: string;
  root: string;
  file: string;
  sha256: string;
  source: string;
  downloaded_at: Date;
  supported: boolean;
};

describe("migración del registro de esquemas sobre una instalación con la versión 1", () => {
  const name = `t_registry_upgrade_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let before: V1Row[];

  const execute = (migration: string) => {
    const result = runBin(
      "prisma",
      ["db", "execute", "--file", `prisma/migrations/${migration}/migration.sql`],
      { DATABASE_URL: url },
    );
    if (result.status !== 0) throw new Error(`${migration}:\n${result.stdout}${result.stderr}`);
  };
  const v1Rows = () =>
    database.prisma.$queryRawUnsafe<(V1Row & Record<string, unknown>)[]>(
      `SELECT * FROM "${name}"."schema_registry_entry" WHERE "dataset_version" = 1 ORDER BY "file"`,
    );

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < REGISTRY_MIGRATION)) execute(migration);

    // La versión 1 tal como la cargaba el arranque antes de esta migración.
    const v1 = schemaRegistry1 as DatasetFile & typeof schemaRegistry1;
    await database.prisma.$executeRawUnsafe(
      `INSERT INTO "${name}"."fiscal_catalog_dataset" ("catalog_type", "version", "source_document",
         "source_version", "source_published_on", "source_url", "source_sha256",
         "enablement_policy", "checksum")
       VALUES ('schema-registry', 1, $1, $2, $3::date, $4, $5, $6, $7)`,
      v1.source.document,
      v1.source.version,
      v1.source.publishedOn,
      v1.source.url,
      v1.source.sha256,
      v1.enablementPolicy,
      datasetChecksum(v1),
    );
    for (const entry of v1.entries) {
      await database.prisma.$executeRawUnsafe(
        `INSERT INTO "${name}"."schema_registry_entry" ("document_type", "version",
           "dataset_version", "root", "file", "sha256", "source", "downloaded_at", "supported")
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7::timestamptz, $8)`,
        entry.documentType,
        entry.version,
        entry.root,
        entry.file,
        entry.sha256,
        entry.source,
        entry.downloadedAt,
        entry.supported,
      );
    }
    before = await v1Rows();
    for (const migration of MIGRATIONS.filter((m) => m >= REGISTRY_MIGRATION)) execute(migration);
  }, 180_000);

  afterAll(async () => {
    await database?.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    await database?.close();
  });

  it("conserva la versión 1 y rellena su ruta lógica", async () => {
    const after = await v1Rows();
    expect(before).toHaveLength(6);
    expect(after.map(({ path: _p, kind: _k, revision: _r, imports: _i, ...row }) => row)).toEqual(
      before,
    );
    for (const row of after) {
      expect(row).toMatchObject({
        path: `sri-xsd/${row.file}`,
        kind: "DOCUMENT",
        revision: null,
        imports: [],
      });
    }
  });

  it("deja otra vez activo el trigger de inmutabilidad", async () => {
    await expect(
      database.prisma.$executeRawUnsafe(
        `UPDATE "${name}"."schema_registry_entry" SET "supported" = false`,
      ),
    ).rejects.toThrow(/no admite UPDATE/);
  });

  it("el arranque reconoce la versión 1 y aplica la versión 2", async () => {
    const report = await loadInstalledFiscalCatalogs(database.prisma);
    expect(report.alreadyApplied).toEqual([{ catalogType: "schema-registry", version: 1 }]);
    expect(report.applied).toContainEqual({
      catalogType: "schema-registry",
      version: 2,
      newEntries: 7,
    });
    expect(await v1Rows()).toHaveLength(6);
  });
});
