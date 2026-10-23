// Migración add_party_emails (add-email-delivery, design D8; spec parties, «Tercero registrado antes
// con un correo»): el correo de un tercero existente queda como el primero de su lista, y uno sin
// correo queda sin correos. Aplica las migraciones anteriores, escribe terceros como los de una
// instalación existente y después aplica la de los correos.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";
import { insertFiscalCompany } from "./fiscal-harness.ts";

const EMAILS_MIGRATION = "20261023110000_add_party_emails";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

describe("correos de los terceros existentes", () => {
  const name = `t_party_emails_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;

  const execute = (migration: string) => {
    const result = runBin(
      "prisma",
      ["db", "execute", "--file", `prisma/migrations/${migration}/migration.sql`],
      { DATABASE_URL: url },
    );
    if (result.status !== 0) throw new Error(`${migration}:\n${result.stdout}${result.stderr}`);
  };
  // El cliente de Prisma ya no conoce la columna anterior: los terceros se escriben con SQL.
  const insertLegacyParty = (
    company: { companyId: string; adminId: string },
    identification: string,
    email: string | null,
  ) =>
    database.prisma.$executeRawUnsafe(
      `INSERT INTO "${name}"."party" ("id", "company_id", "identification_type", "identification",
         "legal_name", "email", "search_name", "search_identification", "created_by", "updated_at")
       VALUES ($1, $2, '05', $3, 'Tercero anterior', $4, 'tercero anterior', $5, $6, now())`,
      `p-${identification}`,
      company.companyId,
      identification,
      email,
      identification,
      company.adminId,
    );

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < EMAILS_MIGRATION)) execute(migration);
    const company = await insertFiscalCompany(database.prisma, "Empresa con terceros", 1);
    await insertLegacyParty(company, "0102030405", "compras@cliente.ec");
    await insertLegacyParty(company, "0102030406", null);
    execute(EMAILS_MIGRATION);
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("el correo existente queda como el primero de la lista, y sin correo la lista queda vacía", async () => {
    const rows = await database.prisma.party.findMany({
      where: { identification: { in: ["0102030405", "0102030406"] } },
      select: {
        identification: true,
        emails: { select: { position: true, address: true }, orderBy: { position: "asc" } },
      },
      orderBy: { identification: "asc" },
    });
    expect(rows).toEqual([
      { identification: "0102030405", emails: [{ position: 1, address: "compras@cliente.ec" }] },
      { identification: "0102030406", emails: [] },
    ]);
  });

  it("la columna anterior ya no existe", async () => {
    const columns = await database.prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${name}' AND table_name = 'party' AND column_name LIKE 'email%'`,
    );
    expect(columns).toEqual([]);
  });
});
