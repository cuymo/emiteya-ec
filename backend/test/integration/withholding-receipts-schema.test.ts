// Invariantes de la migración add_withholding_receipts en PostgreSQL (design D15, D16 y D28): un
// comprobante 07 no se confirma sin su registro y al menos una línea; el registro es de un 07 de la
// empresa; registro y líneas son inmutables y las líneas tienen su dominio, con el valor retenido
// igual al cálculo; un borrador emitido no cambia; y la emisión de retenciones tiene su operación de
// idempotencia. Aplica las migraciones anteriores, crea una factura y una nota de débito como en una
// instalación existente y después aplica la de las retenciones.
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

const WITHHOLDING_MIGRATION = "20261010110000_add_withholding_receipts";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

type Line = {
  supportPosition?: number;
  position?: number;
  supportDocumentType?: string;
  supportCode?: string;
  supportNumber?: string;
  tax?: string;
  withholdingCode?: string;
  entryKey?: string;
  base?: string;
  percentage?: string;
  amount?: string;
};

describe("comprobantes de retención en la base de datos", () => {
  const name = `t_withholding_schema_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let supplierA: string;
  let supplierB: string;
  let legacyInvoice: TestDocument;
  let legacyDebitNote: TestDocument;

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
  const supplier = (company: FiscalCompany, identification: string) =>
    database.prisma.party
      .create({
        data: {
          companyId: company.companyId,
          identificationType: "04",
          identification,
          legalName: `Proveedor ${identification}`,
          roles: ["SUPPLIER"],
          searchName: `proveedor ${identification}`,
          searchIdentification: identification,
          createdBy: company.adminId,
          updatedBy: company.adminId,
        },
      })
      .then((party) => party.id);
  const invoice = (company: FiscalCompany) =>
    insertDocument(database.prisma, company, "AUTHORIZED", { total: "115.00" });
  const line = (company: FiscalCompany, documentId: string, values: Line = {}) => ({
    companyId: company.companyId,
    documentId,
    supportPosition: values.supportPosition ?? 1,
    position: values.position ?? 1,
    supportDocumentType: values.supportDocumentType ?? "01",
    supportCode: values.supportCode ?? "01",
    supportNumber: values.supportNumber ?? "001001000000123",
    supportIssueDate: new Date("2026-10-01"),
    tax: values.tax ?? "1",
    withholdingCode: values.withholdingCode ?? "312C",
    entryKey: values.entryKey ?? "312C",
    base: values.base ?? "100.29",
    percentage: values.percentage ?? "1.75",
    amount: values.amount ?? "1.76",
  });
  const record = (company: FiscalCompany, documentId: string, partyId: string) => ({
    companyId: company.companyId,
    documentId,
    partyId,
    relatedParty: "NO",
    fiscalPeriod: "10/2026",
  });
  /** Comprobante 07 con su registro y sus líneas escritos en la misma transacción. */
  const withholding = (
    company: FiscalCompany,
    partyId: string,
    options: {
      lines?: Line[];
      write?: (tx: Prisma.TransactionClient, documentId: string) => Promise<void>;
    } = {},
  ) =>
    insertDocument(database.prisma, company, "SIGNED", {
      documentType: "07",
      total: "1.76",
      alongside: async (tx, document) => {
        if (options.write) return options.write(tx, document.id);
        await tx.withholdingReceipt.create({ data: record(company, document.id, partyId) });
        await tx.withholdingReceiptLine.createMany({
          data: (options.lines ?? [{}]).map((values) => line(company, document.id, values)),
        });
      },
    });
  const draft = (company: FiscalCompany, data: Record<string, unknown> = {}) =>
    database.prisma.withholdingReceiptDraft.create({
      data: {
        companyId: company.companyId,
        createdBy: company.adminId,
        updatedBy: company.adminId,
        ...data,
      },
    });

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < WITHHOLDING_MIGRATION)) {
      execute(migration);
    }

    // Una instalación con una factura y una nota de débito antes de las retenciones.
    await loadInstalledFiscalCatalogs(database.prisma);
    companyA = await insertFiscalCompany(database.prisma, "Retención A", 1);
    companyB = await insertFiscalCompany(database.prisma, "Retención B", 1);
    legacyInvoice = await invoice(companyA);
    legacyDebitNote = await insertDocument(database.prisma, companyA, "RECEIVED", {
      documentType: "05",
      total: "23.00",
      alongside: async (tx, document) => {
        await tx.debitNoteSupport.create({
          data: {
            companyId: companyA.companyId,
            debitNoteId: document.id,
            invoiceId: legacyInvoice.id,
          },
        });
      },
    });

    execute(WITHHOLDING_MIGRATION);
    supplierA = await supplier(companyA, "1791234567001");
    supplierB = await supplier(companyB, "0992877878001");
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("los comprobantes existentes no cambian y una retención se registra con sus líneas", async () => {
    for (const document of [legacyInvoice, legacyDebitNote]) {
      expect(
        await database.prisma.electronicDocument.findUniqueOrThrow({ where: { id: document.id } }),
      ).toEqual(document);
    }
    const receipt = await withholding(companyA, supplierA, {
      lines: [
        {},
        {
          position: 2,
          tax: "2",
          withholdingCode: "7",
          entryKey: "7",
          percentage: "0",
          amount: "0",
        },
      ],
    });
    expect(
      await database.prisma.withholdingReceiptLine.count({ where: { documentId: receipt.id } }),
    ).toBe(2);
  });

  it("un 07 sin su registro o sin líneas no se confirma, y el trigger solo mira el tipo 07", async () => {
    expect(
      await fails(insertDocument(database.prisma, companyA, "SIGNED", { documentType: "07" })),
    ).toMatch(/no tiene su registro/);
    expect(
      await fails(
        withholding(companyA, supplierA, {
          write: async (tx, documentId) => {
            await tx.withholdingReceipt.create({ data: record(companyA, documentId, supplierA) });
          },
        }),
      ),
    ).toMatch(/no tiene retenciones/);
    // Una factura y una nota de débito nuevas se confirman sin registro de retención.
    expect(await fails(invoice(companyA))).toBeNull();
    expect(
      await fails(
        insertDocument(database.prisma, companyA, "RECEIVED", {
          documentType: "05",
          alongside: async (tx, document) => {
            await tx.debitNoteSupport.create({
              data: {
                companyId: companyA.companyId,
                debitNoteId: document.id,
                invoiceId: legacyInvoice.id,
              },
            });
          },
        }),
      ),
    ).toBeNull();
    const [definition] = await database.prisma.$queryRaw<{ definition: string }[]>`
      SELECT pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${name} AND t.tgname = 'withholding_receipt_complete'`;
    expect(definition!.definition).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
    expect(definition!.definition).toMatch(/document_type = '07'/);
  });

  it("el registro es de un comprobante 07 de la empresa", async () => {
    expect(
      await fails(
        database.prisma.withholdingReceipt.create({
          data: record(companyA, legacyInvoice.id, supplierA),
        }),
      ),
    ).toMatch(/comprobante de retención de la empresa/);
    // Un comprobante o un proveedor de otra empresa no son de la empresa A.
    const foreign = await withholding(companyB, supplierB);
    expect(
      await fails(
        database.prisma.withholdingReceipt.create({
          data: record(companyA, foreign.id, supplierA),
        }),
      ),
    ).toMatch(/comprobante de retención de la empresa/);
    expect(
      await fails(
        withholding(companyA, supplierA, {
          write: async (tx, documentId) => {
            await tx.withholdingReceipt.create({ data: record(companyA, documentId, supplierB) });
          },
        }),
      ),
    ).toMatch(/foreign key|Foreign key/);
  });

  it("el registro y sus líneas no cambian ni se borran", async () => {
    const receipt = await withholding(companyA, supplierA);
    const where = {
      companyId_documentId: { companyId: companyA.companyId, documentId: receipt.id },
    };
    expect(
      await fails(
        database.prisma.withholdingReceipt.update({ where, data: { fiscalPeriod: "09/2026" } }),
      ),
    ).toMatch(/no admite UPDATE/);
    expect(await fails(database.prisma.withholdingReceipt.delete({ where }))).toMatch(
      /no admite DELETE/,
    );
    const lineWhere = {
      companyId_documentId_supportPosition_position: {
        companyId: companyA.companyId,
        documentId: receipt.id,
        supportPosition: 1,
        position: 1,
      },
    };
    expect(
      await fails(
        database.prisma.withholdingReceiptLine.update({
          where: lineWhere,
          data: { base: "200.00" },
        }),
      ),
    ).toMatch(/no admite UPDATE/);
    expect(
      await fails(database.prisma.withholdingReceiptLine.delete({ where: lineWhere })),
    ).toMatch(/no admite DELETE/);
    for (const table of ["withholding_receipt_line", "withholding_receipt"]) {
      expect(
        await fails(database.prisma.$executeRawUnsafe(`TRUNCATE "${name}"."${table}" CASCADE`)),
      ).toMatch(/no admite TRUNCATE/);
    }
  });

  it("las líneas tienen su dominio, y el valor retenido es la base por el porcentaje redondeado", async () => {
    const rejected: Line[] = [
      { supportDocumentType: "04" },
      { supportDocumentType: "1" },
      { supportCode: "1" },
      { supportNumber: "00100100000012" },
      { supportNumber: "001-001-0000012" },
      { tax: "3" },
      { tax: "6" },
      { withholdingCode: "" },
      { withholdingCode: "323B12" },
      { entryKey: "323 M" },
      { base: "0", amount: "0" },
      { base: "-10.00", amount: "0" },
      { base: "10.005" },
      { percentage: "1000", amount: "1002.90" },
      { percentage: "10.25", amount: "10.28" },
      { percentage: "-1", amount: "0" },
      { amount: "1.75" },
      { amount: "1.755" },
      { supportPosition: 31 },
      { position: 11 },
      { position: 0 },
    ];
    for (const values of rejected) {
      expect(
        await fails(withholding(companyA, supplierA, { lines: [values] })),
        JSON.stringify(values),
      ).toMatch(/withholding_receipt_line_values_check/);
    }
    expect(
      await fails(
        withholding(companyA, supplierA, {
          lines: [
            {
              supportDocumentType: "02",
              supportCode: "02",
              base: "100.00",
              percentage: "30",
              amount: "30.00",
              tax: "2",
              withholdingCode: "1",
              entryKey: "1",
            },
            {
              position: 2,
              supportDocumentType: "03",
              base: "0.03",
              percentage: "2",
              amount: "0.00",
              withholdingCode: "312",
              entryKey: "312",
            },
            {
              supportPosition: 30,
              position: 10,
              base: "99999999999999",
              percentage: "100",
              amount: "99999999999999",
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("un borrador emitido no cambia; uno en preparación sí", async () => {
    const open = await draft(companyA, {
      partyId: supplierA,
      relatedParty: "SI",
      fiscalPeriod: "10/2026",
    });
    await database.prisma.withholdingReceiptDraft.update({
      where: { id: open.id },
      data: { partyId: null, relatedParty: "NO", supports: [{ documentType: "01" }], version: 2 },
    });
    await database.prisma.withholdingReceiptDraft.delete({ where: { id: open.id } });

    const emitted = await draft(companyA, { partyId: supplierA });
    const receipt = await withholding(companyA, supplierA);
    await database.prisma.withholdingReceiptDraft.update({
      where: { id: emitted.id },
      data: { status: "EMITTED", documentId: receipt.id, updatedBy: companyA.adminId },
    });
    expect(
      await fails(
        database.prisma.withholdingReceiptDraft.update({
          where: { id: emitted.id },
          data: { fiscalPeriod: "09/2026" },
        }),
      ),
    ).toMatch(/emitido no cambia/);
    expect(
      await fails(database.prisma.withholdingReceiptDraft.delete({ where: { id: emitted.id } })),
    ).toMatch(/emitido no cambia/);
    // EMITTED exige su comprobante, y la empresa y el autor de un borrador no cambian.
    const another = await draft(companyA);
    expect(
      await fails(
        database.prisma.withholdingReceiptDraft.update({
          where: { id: another.id },
          data: { status: "EMITTED" },
        }),
      ),
    ).toMatch(/withholding_receipt_draft_values_check/);
    expect(
      await fails(
        database.prisma.withholdingReceiptDraft.update({
          where: { id: another.id },
          data: { createdBy: companyB.adminId },
        }),
      ),
    ).toMatch(/no cambian/);
  });

  it("el borrador tiene su dominio: parte relacionada, período y documentos como arreglo acotado", async () => {
    for (const data of [
      { relatedParty: "YES" },
      { relatedParty: "si" },
      { fiscalPeriod: "13/2026" },
      { fiscalPeriod: "00/2026" },
      { fiscalPeriod: "10/1999" },
      { fiscalPeriod: "2026-10" },
    ]) {
      expect(await fails(draft(companyA, data)), JSON.stringify(data)).toMatch(
        /withholding_receipt_draft_values_check/,
      );
    }
    for (const supports of [{ documentType: "01" }, "01", Array.from({ length: 31 }, () => ({}))]) {
      expect(
        await fails(draft(companyA, { supports })),
        JSON.stringify(supports).slice(0, 40),
      ).toMatch(/withholding_receipt_draft_supports_check/);
    }
    expect(
      await fails(
        draft(companyA, { supports: Array.from({ length: 30 }, () => ({ documentType: "01" })) }),
      ),
    ).toBeNull();
    expect(await fails(draft(companyA, { supports: [{ blob: "x".repeat(262_144) }] }))).toMatch(
      /withholding_receipt_draft_supports_check/,
    );
  });

  it("un borrador, su proveedor y su punto pertenecen a la misma empresa", async () => {
    expect(await fails(draft(companyA, { partyId: supplierB }))).toMatch(/foreign key|Foreign key/);
    expect(
      await fails(draft(companyA, { emissionPointId: companyB.points[0]!.emissionPointId })),
    ).toMatch(/foreign key|Foreign key/);
  });

  it("el registro de idempotencia admite la emisión de retenciones", async () => {
    const receipt = await withholding(companyA, supplierA);
    const idempotency = (operation: string) =>
      database.prisma.idempotencyRecord.create({
        data: {
          companyId: companyA.companyId,
          operation,
          idempotencyKey: randomUUID(),
          requestFingerprint: "a".repeat(64),
          documentId: receipt.id,
          createdBy: companyA.adminId,
        },
      });
    expect(await fails(idempotency("withholding_receipt.emit"))).toBeNull();
    expect(await fails(idempotency("withholding_receipt.cancel"))).toMatch(
      /idempotency_record_values_check/,
    );
  });
});
