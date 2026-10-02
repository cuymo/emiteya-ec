import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_DIR, createMigratedSchema, runBin, type MigratedSchema } from "./database.ts";

const SCHEMA = join(BACKEND_DIR, "prisma/schema.prisma");
const CLI_CONFIG = "src/modules/identity/infrastructure/better-auth/cli.config.ts";

describe("migraciones sobre una base PostgreSQL limpia", () => {
  let db: MigratedSchema;
  const scratch = mkdtempSync(join(tmpdir(), "facturador-schema-"));

  beforeAll(async () => {
    db = await createMigratedSchema("migrations");
  });

  afterAll(async () => {
    await db.drop();
    rmSync(scratch, { recursive: true, force: true });
  });

  const constraints = async () =>
    (
      await db.database.prisma.$queryRaw<{ name: string; definition: string }[]>`
        SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = ${db.name}`
    ).map((row) => row.name);

  const indexes = async () =>
    (
      await db.database.prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE schemaname = ${db.name}`
    ).map((row) => row.indexname);

  const triggers = async () =>
    (
      await db.database.prisma.$queryRaw<{ name: string }[]>`
        SELECT t.tgname AS name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${db.name} AND NOT t.tgisinternal`
    ).map((row) => row.name);

  it("crea las restricciones propias que Prisma no expresa", async () => {
    expect(await constraints()).toEqual(
      expect.arrayContaining([
        "member_role_check",
        "member_status_check",
        "audit_event_actor_type_check",
        "audit_event_actor_user_check",
        "audit_event_company_id_fkey",
        "audit_event_actor_user_id_fkey",
        "audit_event_target_user_id_fkey",
      ]),
    );
    expect(await indexes()).toEqual(
      expect.arrayContaining([
        "member_organizationId_userId_key",
        "audit_event_company_id_occurred_at_idx",
      ]),
    );
    expect(await triggers()).toEqual(
      expect.arrayContaining(["audit_event_append_only", "audit_event_no_truncate"]),
    );
  });

  it("no limita el número de empresas con ninguna restricción", async () => {
    const organizationConstraints = await db.database.prisma.$queryRaw<{ name: string }[]>`
      SELECT c.conname AS name
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${db.name} AND t.relname = 'organization' AND c.contype NOT IN ('p')`;
    const organizationIndexes = await db.database.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${db.name} AND tablename = 'organization'`;
    expect(organizationConstraints).toEqual([]);
    expect(organizationIndexes.map((row) => row.indexname).sort()).toEqual([
      "organization_pkey",
      "organization_slug_key",
    ]);
  });

  it("las migraciones y el esquema de Prisma coinciden", () => {
    const diff = runBin(
      "prisma",
      ["migrate", "diff", "--from-config-datasource", "--to-schema", SCHEMA, "--exit-code"],
      { DATABASE_URL: db.url },
    );
    expect(diff.status, `${diff.stdout}${diff.stderr}`).toBe(0);
  });

  it("regenerar el esquema con el CLI de Better Auth conserva modelos y restricciones propios", () => {
    const regenerated = join(scratch, "schema.prisma");
    copyFileSync(SCHEMA, regenerated);
    const generate = runBin("auth", [
      "generate",
      "--config",
      CLI_CONFIG,
      "--output",
      regenerated,
      "-y",
    ]);
    expect(generate.status, `${generate.stdout}${generate.stderr}`).toBe(0);
    const format = runBin("prisma", ["format", "--schema", regenerated]);
    expect(format.status, `${format.stdout}${format.stderr}`).toBe(0);

    expect(readFileSync(regenerated, "utf8")).toBe(readFileSync(SCHEMA, "utf8"));
    const diff = runBin(
      "prisma",
      ["migrate", "diff", "--from-config-datasource", "--to-schema", regenerated, "--exit-code"],
      { DATABASE_URL: db.url },
    );
    expect(diff.status, `${diff.stdout}${diff.stderr}`).toBe(0);
  });
});
