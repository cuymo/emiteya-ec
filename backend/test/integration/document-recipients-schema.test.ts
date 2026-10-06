// Invariantes de la migración document_recipients_optional_totals en PostgreSQL (add-shipping-guides,
// design D10 y D26, P10): el total y el comprador son nulos si y solo si el comprobante es una guía de
// remisión (06), en las dos direcciones; los destinatarios son de un comprobante sin comprador, no
// cambian ni se borran, existen al confirmar y tienen posiciones contiguas desde 1. Aplica las
// migraciones anteriores, crea una factura como en una instalación existente y después aplica esta.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  reserveDocumentIn,
  type DocumentColumns,
} from "../../src/modules/fiscal/application/document-reservation.ts";
import { documentBuyer } from "../../src/modules/fiscal/application/ports.ts";
import {
  createDocumentRepository,
  createFiscalScope,
  reserveSequentialIn,
} from "../../src/modules/fiscal/infrastructure/index.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

const RECIPIENTS_MIGRATION = "20261011100000_document_recipients_optional_totals";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

describe("comprobantes sin total ni comprador único en la base de datos", () => {
  const name = `t_document_recipients_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let company: FiscalCompany;
  let other: FiscalCompany;
  let legacyInvoice: TestDocument;

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
  const guide = (
    owner: FiscalCompany,
    recipients?: readonly { identification: string; name: string }[],
  ) => insertDocument(database.prisma, owner, "RESERVED", { documentType: "06", recipients });

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < RECIPIENTS_MIGRATION)) execute(migration);

    // Una instalación con una factura autorizada antes de esta migración.
    await loadInstalledFiscalCatalogs(database.prisma);
    company = await insertFiscalCompany(database.prisma, "Destinatarios A", 1);
    other = await insertFiscalCompany(database.prisma, "Destinatarios B", 1);
    legacyInvoice = await insertDocument(database.prisma, company, "AUTHORIZED", {
      total: "115.00",
      buyer: { identification: "1790012345001", name: "Comercial Andina S.A." },
    });

    execute(RECIPIENTS_MIGRATION);
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("conserva el total y el comprador de los comprobantes existentes", async () => {
    const row = await database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: legacyInvoice.id },
    });
    expect(row.total?.toString()).toBe("115");
    expect(row.buyerIdentification).toBe("1790012345001");
    expect(row.buyerName).toBe("Comercial Andina S.A.");
    const [violations] = await database.prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM ${table("electronic_document")}
       WHERE ("document_type" = '06') <> ("total" IS NULL)
          OR ("document_type" = '06') <> ("buyer_identification" IS NULL)`,
    );
    expect(Number(violations!.count)).toBe(0);
  });

  it("guarda una guía sin total ni comprador, con sus destinatarios en orden", async () => {
    const created = await guide(company, [
      { identification: "1790012345001", name: "Comercial Andina S.A." },
      { identification: "0102030405", name: "María Pérez" },
    ]);
    const row = await database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: created.id },
      include: { recipients: { orderBy: { position: "asc" } } },
    });
    expect(row.total).toBeNull();
    expect(row.buyerIdentification).toBeNull();
    expect(row.buyerName).toBeNull();
    expect(row.recipients.map((recipient) => [recipient.position, recipient.name])).toEqual([
      [1, "Comercial Andina S.A."],
      [2, "María Pérez"],
    ]);
  });

  /**
   * Inserta una copia de la factura existente con `changes` aplicados, como lo haría una escritura
   * directa: el CHECK se evalúa antes que los índices únicos, así que el error es el del CHECK.
   */
  const insertCopy = (changes: string) =>
    database.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE "copia" ON COMMIT DROP AS
         SELECT * FROM ${table("electronic_document")} WHERE "id" = $1`,
        legacyInvoice.id,
      );
      await tx.$executeRawUnsafe(`UPDATE "copia" SET "id" = gen_random_uuid()::text, ${changes}`);
      await tx.$executeRawUnsafe(
        `INSERT INTO ${table("electronic_document")} SELECT * FROM "copia"`,
      );
    });

  it("rechaza un tipo con total sin total o sin comprador", async () => {
    for (const documentType of ["01", "04", "05", "07"]) {
      for (const missing of [
        `"total" = NULL`,
        `"buyer_identification" = NULL`,
        `"buyer_name" = NULL`,
      ]) {
        const error = await fails(insertCopy(`"document_type" = '${documentType}', ${missing}`));
        expect(error, `${documentType}: ${missing}`).toContain("electronic_document_values_check");
      }
    }
  });

  it("rechaza una guía con total o con comprador", async () => {
    for (const present of [
      `"total" = 0, "buyer_identification" = NULL, "buyer_name" = NULL`,
      `"total" = NULL, "buyer_identification" = '1790012345001', "buyer_name" = NULL`,
      `"total" = NULL, "buyer_identification" = NULL, "buyer_name" = 'Comercial Andina S.A.'`,
    ]) {
      const error = await fails(insertCopy(`"document_type" = '06', ${present}`));
      expect(error, present).toContain("electronic_document_values_check");
    }
    // Una guía guardada no puede ganar un total ni un comprador.
    const created = await guide(company);
    for (const change of [`"total" = 0`, `"buyer_name" = 'Comercial Andina S.A.'`]) {
      const error = await fails(
        database.prisma.$executeRawUnsafe(
          `UPDATE ${table("electronic_document")} SET ${change} WHERE "id" = $1`,
          created.id,
        ),
      );
      expect(error, change).not.toBeNull();
    }
  });

  it("no confirma una guía sin destinatarios ni con posiciones que no son contiguas", async () => {
    expect(await fails(guide(company, []))).toContain("no tiene destinatarios");
    const gap = await fails(
      insertDocument(database.prisma, company, "RESERVED", {
        documentType: "06",
        recipients: [],
        alongside: async (tx, document) => {
          await tx.electronicDocumentRecipient.createMany({
            data: [1, 3].map((position) => ({
              companyId: company.companyId,
              documentId: document.id,
              position,
              identification: "0102030405",
              name: "María Pérez",
            })),
          });
        },
      }),
    );
    expect(gap).toContain("posiciones contiguas");
  });

  it("solo admite destinatarios de un comprobante de la empresa sin comprador", async () => {
    const recipient = (companyId: string, documentId: string) =>
      database.prisma.electronicDocumentRecipient.create({
        data: { companyId, documentId, position: 9, identification: "0102030405", name: "X" },
      });
    expect(await fails(recipient(company.companyId, legacyInvoice.id))).toContain(
      "sin comprador único",
    );
    const created = await guide(company);
    expect(await fails(recipient(other.companyId, created.id))).not.toBeNull();
  });

  it("los destinatarios no cambian ni se borran, y el comprobante conserva sus nulos", async () => {
    const created = await guide(company);
    const where = `WHERE "document_id" = '${created.id}'`;
    for (const statement of [
      `UPDATE ${table("electronic_document_recipient")} SET "name" = 'Otro' ${where}`,
      `DELETE FROM ${table("electronic_document_recipient")} ${where}`,
      `TRUNCATE ${table("electronic_document_recipient")}`,
    ]) {
      expect(await fails(database.prisma.$executeRawUnsafe(statement)), statement).toContain(
        "no admite",
      );
    }
    // El estado cambia por su máquina; los nulos fiscales no se tocan.
    await database.prisma.electronicDocument.update({
      where: { id: created.id },
      data: { lastAttemptCode: "PRUEBA" },
    });
    const row = await database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect([row.total, row.buyerIdentification, row.buyerName]).toEqual([null, null, null]);
  });

  it("rechaza identificaciones y nombres fuera de su dominio", async () => {
    for (const recipient of [
      { identification: "", name: "Vacío" },
      { identification: "0102030405", name: "" },
      { identification: "0102030405", name: "Con\nsalto" },
    ]) {
      expect(await fails(guide(company, [recipient])), JSON.stringify(recipient)).toContain(
        "electronic_document_recipient_values_check",
      );
    }
    // Una identificación de 21 caracteres la rechaza ya el tipo de la columna (VARCHAR(20)).
    expect(
      await fails(guide(company, [{ identification: "1".repeat(21), name: "Larga" }])),
    ).not.toBeNull();
  });

  describe("reserva con receptor tipado (design D10)", () => {
    const reserve = (documentType: "01" | "06", columns: DocumentColumns) =>
      database.prisma.$transaction((tx) =>
        reserveDocumentIn(
          {
            reserveSequential: ({ reservedBy, correlationId, ...key }) =>
              reserveSequentialIn(createFiscalScope(tx), { ...key, reservedBy, correlationId }),
            // El bloqueo de la identidad tributaria no es parte de esta prueba.
            lockTaxIdentity: () => Promise.resolve(true),
            documents: createDocumentRepository(tx),
          },
          createAccessKeys(),
          {
            companyId: company.companyId,
            documentType,
            issueDate: "2026-10-06",
            environment: "TEST",
            environmentCode: "1",
            ruc: "1790012345001",
            establishment: { id: company.points[0]!.establishmentId, code: "001" },
            emissionPoint: { id: company.points[0]!.emissionPointId, code: "001" },
            reservedBy: company.adminId,
            correlationId: "prueba",
            withKey: (key) => ({ snapshotVersion: 1, key }),
            columns: () => columns,
          },
        ),
      );

    it("reserva una guía con sus destinatarios en orden, sin total ni comprador", async () => {
      const { document } = await reserve("06", {
        schemaVersion: "1.1.0",
        receiver: "RECIPIENTS",
        recipients: [
          { identification: "1790012345001", name: "Comercial Andina S.A." },
          { identification: "0102030405", name: "María Pérez" },
        ],
      });
      expect([document.total, document.buyerIdentification, document.buyerName]).toEqual([
        null,
        null,
        null,
      ]);
      const recipients = await database.prisma.electronicDocumentRecipient.findMany({
        where: { documentId: document.id },
        orderBy: { position: "asc" },
      });
      expect(recipients.map((recipient) => [recipient.position, recipient.identification])).toEqual(
        [
          [1, "1790012345001"],
          [2, "0102030405"],
        ],
      );
      expect(() => documentBuyer(document)).toThrow(/no tiene comprador ni total/);
    });

    it("reserva un tipo con comprador como antes, y la guarda lo devuelve", async () => {
      const { document } = await reserve("01", {
        schemaVersion: "1.1.0",
        receiver: "BUYER",
        buyerIdentification: "0992877878001",
        buyerName: "EL PERNO CIA. LTDA.",
        total: "28.75",
      });
      expect(documentBuyer(document)).toEqual({
        identification: "0992877878001",
        name: "EL PERNO CIA. LTDA.",
        total: "28.75",
      });
      expect(
        await database.prisma.electronicDocumentRecipient.count({
          where: { documentId: document.id },
        }),
      ).toBe(0);
    });

    it("no reserva un comprobante sin comprador y sin destinatarios", async () => {
      const before = await database.prisma.electronicDocument.count();
      expect(
        await fails(
          reserve("06", { schemaVersion: "1.1.0", receiver: "RECIPIENTS", recipients: [] }),
        ),
      ).toContain("al menos un destinatario");
      expect(await database.prisma.electronicDocument.count()).toBe(before);
    });
  });
});
