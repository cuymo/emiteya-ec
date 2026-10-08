// Invariantes de la migración add_purchase_settlements en PostgreSQL (design D3, D14 y D25): una
// liquidación 03 no se confirma sin su registro y exactamente sus cuatro declaraciones de procedencia;
// el registro es de un 03 de la empresa; registro y declaraciones son inmutables y tienen su dominio
// (solo el caso c) con la versión 1 de la política y la base declarada por el usuario); un borrador
// emitido no cambia y su contenido está acotado; y la emisión tiene su operación de idempotencia.
// Aplica las migraciones anteriores, crea una factura, una retención y una guía como en una
// instalación existente y después aplica la de las liquidaciones.
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

const PURCHASE_MIGRATION = "20261012100000_add_purchase_settlements";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

const STATEMENTS = [
  "NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING",
  "NO_RUC_OR_SUSPENDED_RUC",
  "UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY",
  "MOVABLE_GOODS_OR_SERVICES_TRANSACTION",
] as const;

type SettlementValues = {
  eligibilityCase?: string;
  eligibilityPolicy?: string;
  policyVersion?: number;
  lineCount?: number;
  paymentCount?: number;
};
type Declaration = { statementId?: string; policyVersion?: number; basis?: string };

describe("liquidaciones de compra en la base de datos", () => {
  const name = `t_purchase_schema_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let supplierA: string;
  let supplierB: string;
  let legacy: TestDocument[];

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
          identificationType: "05",
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
  const record = (
    company: FiscalCompany,
    documentId: string,
    partyId: string,
    values: SettlementValues = {},
  ) => ({
    companyId: company.companyId,
    documentId,
    supplierPartyId: partyId,
    eligibilityCase: values.eligibilityCase ?? "ART_13_C",
    eligibilityPolicy: values.eligibilityPolicy ?? "PURCHASE_SETTLEMENT_ELIGIBILITY_V1",
    policyVersion: values.policyVersion ?? 1,
    lineCount: values.lineCount ?? 2,
    paymentCount: values.paymentCount ?? 1,
  });
  const declaration = (
    company: FiscalCompany,
    documentId: string,
    statementId: string,
    values: Declaration = {},
  ) => ({
    companyId: company.companyId,
    documentId,
    statementId: values.statementId ?? statementId,
    policyVersion: values.policyVersion ?? 1,
    basis: values.basis ?? "USER_DECLARED",
    declaredBy: company.adminId,
    declaredAt: new Date("2026-10-07T15:00:00Z"),
  });
  /** Liquidación 03 con su registro y sus declaraciones escritos en la misma transacción. */
  const settlement = (
    company: FiscalCompany,
    partyId: string,
    options: {
      record?: SettlementValues;
      declarations?: (Declaration & { statementId: string })[];
      write?: (tx: Prisma.TransactionClient, documentId: string) => Promise<void>;
    } = {},
  ) =>
    insertDocument(database.prisma, company, "SIGNED", {
      documentType: "03",
      total: "106.00",
      buyer: { identification: "0102030405", name: "María Quishpe" },
      alongside: async (tx, document) => {
        if (options.write) return options.write(tx, document.id);
        await tx.purchaseSettlement.create({
          data: record(company, document.id, partyId, options.record),
        });
        await tx.purchaseSettlementDeclaration.createMany({
          data: (options.declarations ?? STATEMENTS.map((statementId) => ({ statementId }))).map(
            (values) => declaration(company, document.id, values.statementId, values),
          ),
        });
      },
    });
  const draft = (company: FiscalCompany, data: { [key: string]: unknown } = {}) =>
    database.prisma.purchaseSettlementDraft.create({
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
    for (const migration of MIGRATIONS.filter((m) => m < PURCHASE_MIGRATION)) {
      execute(migration);
    }

    // Una instalación con una factura, una retención y una guía antes de las liquidaciones.
    await loadInstalledFiscalCatalogs(database.prisma);
    companyA = await insertFiscalCompany(database.prisma, "Liquidación A", 1);
    companyB = await insertFiscalCompany(database.prisma, "Liquidación B", 1);
    const legacySupplier = await supplier(companyA, "0912345678");
    legacy = [
      await insertDocument(database.prisma, companyA, "AUTHORIZED", { total: "115.00" }),
      await insertDocument(database.prisma, companyA, "AUTHORIZED", {
        documentType: "07",
        total: "1.76",
        alongside: async (tx, document) => {
          await tx.withholdingReceipt.create({
            data: {
              companyId: companyA.companyId,
              documentId: document.id,
              partyId: legacySupplier,
              relatedParty: "NO",
              fiscalPeriod: "10/2026",
            },
          });
          await tx.withholdingReceiptLine.create({
            data: {
              companyId: companyA.companyId,
              documentId: document.id,
              supportPosition: 1,
              position: 1,
              supportDocumentType: "01",
              supportCode: "01",
              supportNumber: "001001000000123",
              supportIssueDate: new Date("2026-10-01"),
              tax: "1",
              withholdingCode: "312C",
              entryKey: "312C",
              base: "100.29",
              percentage: "1.75",
              amount: "1.76",
            },
          });
        },
      }),
    ];

    execute(PURCHASE_MIGRATION);
    supplierA = await supplier(companyA, "0102030405");
    supplierB = await supplier(companyB, "1712345678");
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("los comprobantes existentes no cambian y una liquidación se registra con sus cuatro declaraciones", async () => {
    for (const document of legacy) {
      expect(
        await database.prisma.electronicDocument.findUniqueOrThrow({ where: { id: document.id } }),
      ).toEqual(document);
    }
    const created = await settlement(companyA, supplierA);
    expect(
      await database.prisma.purchaseSettlementDeclaration.count({
        where: { documentId: created.id },
      }),
    ).toBe(4);
    expect(created).toMatchObject({ documentType: "03", buyerName: "María Quishpe" });
  });

  it("un 03 sin su registro, con tres declaraciones o con una repetida no se confirma; el trigger solo mira el tipo 03", async () => {
    expect(
      await fails(insertDocument(database.prisma, companyA, "SIGNED", { documentType: "03" })),
    ).toMatch(/no tiene su registro/);
    expect(
      await fails(
        settlement(companyA, supplierA, {
          declarations: STATEMENTS.slice(0, 3).map((statementId) => ({ statementId })),
        }),
      ),
    ).toMatch(/no tiene sus cuatro declaraciones/);
    expect(
      await fails(
        settlement(companyA, supplierA, {
          write: async (tx, documentId) => {
            await tx.purchaseSettlement.create({ data: record(companyA, documentId, supplierA) });
          },
        }),
      ),
    ).toMatch(/no tiene sus cuatro declaraciones/);
    // Una declaración repetida choca con la clave primaria antes del diferido.
    expect(
      await fails(
        settlement(companyA, supplierA, {
          declarations: [...STATEMENTS.slice(0, 3), STATEMENTS[0]].map((statementId) => ({
            statementId,
          })),
        }),
      ),
    ).toMatch(/Unique constraint|unique constraint|duplicate key/);
    // Una factura nueva se confirma sin registro de liquidación.
    expect(
      await fails(insertDocument(database.prisma, companyA, "AUTHORIZED", { total: "1.00" })),
    ).toBeNull();
    const [definition] = await database.prisma.$queryRaw<{ definition: string }[]>`
      SELECT pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${name} AND t.tgname = 'purchase_settlement_complete'`;
    expect(definition!.definition).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
    expect(definition!.definition).toMatch(/document_type = '03'/);
  });

  it("el registro es de una liquidación 03 de la empresa, con su proveedor de la empresa", async () => {
    expect(
      await fails(
        database.prisma.purchaseSettlement.create({
          data: record(companyA, legacy[0]!.id, supplierA),
        }),
      ),
    ).toMatch(/liquidación de compra de la empresa/);
    const foreign = await settlement(companyB, supplierB);
    expect(
      await fails(
        database.prisma.purchaseSettlement.create({
          data: record(companyA, foreign.id, supplierA),
        }),
      ),
    ).toMatch(/liquidación de compra de la empresa/);
    expect(
      await fails(
        settlement(companyA, supplierA, {
          write: async (tx, documentId) => {
            await tx.purchaseSettlement.create({ data: record(companyA, documentId, supplierB) });
          },
        }),
      ),
    ).toMatch(/foreign key|Foreign key/);
  });

  it("el registro y sus declaraciones no cambian ni se borran", async () => {
    const created = await settlement(companyA, supplierA);
    const where = {
      companyId_documentId: { companyId: companyA.companyId, documentId: created.id },
    };
    expect(
      await fails(database.prisma.purchaseSettlement.update({ where, data: { lineCount: 3 } })),
    ).toMatch(/no admite UPDATE/);
    expect(await fails(database.prisma.purchaseSettlement.delete({ where }))).toMatch(
      /no admite DELETE/,
    );
    const declarationWhere = {
      companyId_documentId_statementId: {
        companyId: companyA.companyId,
        documentId: created.id,
        statementId: STATEMENTS[1],
      },
    };
    expect(
      await fails(
        database.prisma.purchaseSettlementDeclaration.update({
          where: declarationWhere,
          data: { declaredAt: new Date() },
        }),
      ),
    ).toMatch(/no admite UPDATE/);
    expect(
      await fails(
        database.prisma.purchaseSettlementDeclaration.delete({ where: declarationWhere }),
      ),
    ).toMatch(/no admite DELETE/);
    for (const table of ["purchase_settlement_declaration", "purchase_settlement"]) {
      expect(
        await fails(database.prisma.$executeRawUnsafe(`TRUNCATE "${name}"."${table}" CASCADE`)),
      ).toMatch(/no admite TRUNCATE/);
    }
  });

  it("el registro admite solo el caso c) con la versión 1 de su política y conteos acotados", async () => {
    const rejected: SettlementValues[] = [
      { eligibilityCase: "ART_13_A" },
      { eligibilityCase: "art_13_c" },
      { eligibilityPolicy: "PURCHASE_SETTLEMENT_ELIGIBILITY_V2" },
      { policyVersion: 2 },
      { lineCount: 0 },
      { lineCount: 501 },
      { paymentCount: 0 },
      { paymentCount: 21 },
    ];
    for (const values of rejected) {
      expect(
        await fails(settlement(companyA, supplierA, { record: values })),
        JSON.stringify(values),
      ).toMatch(/purchase_settlement_values_check/);
    }
    expect(
      await fails(
        settlement(companyA, supplierA, { record: { lineCount: 500, paymentCount: 20 } }),
      ),
    ).toBeNull();
  });

  it("cada declaración es uno de los cuatro identificadores, de la versión 1 y declarada por el usuario", async () => {
    const rejected: Declaration[] = [
      { statementId: "PROVIDER_HAS_ACTIVE_RUC" },
      { policyVersion: 2 },
      { basis: "SYSTEM_VERIFIED" },
    ];
    for (const values of rejected) {
      expect(
        await fails(
          settlement(companyA, supplierA, {
            declarations: STATEMENTS.map((statementId, index) =>
              index === 0 ? { statementId, ...values } : { statementId },
            ),
          }),
        ),
        JSON.stringify(values),
      ).toMatch(/purchase_settlement_declaration_values_check/);
    }
  });

  it("un borrador emitido no cambia; uno en preparación sí", async () => {
    const open = await draft(companyA, { supplierPartyId: supplierA, supplierAddress: "Cayambe" });
    await database.prisma.purchaseSettlementDraft.update({
      where: { id: open.id },
      data: { supplierPartyId: null, lines: [{ description: "Cacao" }], version: 2 },
    });
    await database.prisma.purchaseSettlementDraft.delete({ where: { id: open.id } });

    const emitted = await draft(companyA, { supplierPartyId: supplierA });
    const created = await settlement(companyA, supplierA);
    await database.prisma.purchaseSettlementDraft.update({
      where: { id: emitted.id },
      data: { status: "EMITTED", documentId: created.id, updatedBy: companyA.adminId },
    });
    expect(
      await fails(
        database.prisma.purchaseSettlementDraft.update({
          where: { id: emitted.id },
          data: { supplierAddress: "Otra" },
        }),
      ),
    ).toMatch(/emitido no cambia/);
    expect(
      await fails(database.prisma.purchaseSettlementDraft.delete({ where: { id: emitted.id } })),
    ).toMatch(/emitido no cambia/);
    const another = await draft(companyA);
    expect(
      await fails(
        database.prisma.purchaseSettlementDraft.update({
          where: { id: another.id },
          data: { status: "EMITTED" },
        }),
      ),
    ).toMatch(/purchase_settlement_draft_values_check/);
    expect(
      await fails(
        database.prisma.purchaseSettlementDraft.update({
          where: { id: another.id },
          data: { createdBy: companyB.adminId },
        }),
      ),
    ).toMatch(/no cambian/);
  });

  it("el borrador tiene su dominio: dirección, líneas y pagos como arreglos acotados", async () => {
    for (const supplierAddress of ["", "Calle\nprincipal", "x".repeat(301)]) {
      expect(
        await fails(draft(companyA, { supplierAddress })),
        supplierAddress.slice(0, 20),
      ).toMatch(/purchase_settlement_draft_values_check|too long/);
    }
    for (const data of [
      { lines: { description: "x" } },
      { lines: Array.from({ length: 501 }, () => ({})) },
      { lines: [{ blob: "x".repeat(4_194_304) }] },
      { payments: "01" },
      { payments: Array.from({ length: 21 }, () => ({})) },
      { payments: [{ blob: "x".repeat(65_536) }] },
    ]) {
      expect(await fails(draft(companyA, data)), JSON.stringify(data).slice(0, 40)).toMatch(
        /purchase_settlement_draft_content_check/,
      );
    }
    expect(
      await fails(
        draft(companyA, {
          supplierAddress: "á".repeat(300),
          lines: Array.from({ length: 500 }, () => ({ description: "Cacao" })),
          payments: Array.from({ length: 20 }, () => ({ paymentMethod: "01" })),
        }),
      ),
    ).toBeNull();
  });

  it("un borrador, su proveedor y su punto pertenecen a la misma empresa", async () => {
    expect(await fails(draft(companyA, { supplierPartyId: supplierB }))).toMatch(
      /foreign key|Foreign key/,
    );
    expect(
      await fails(draft(companyA, { emissionPointId: companyB.points[0]!.emissionPointId })),
    ).toMatch(/foreign key|Foreign key/);
  });

  it("el registro de idempotencia admite la emisión de liquidaciones", async () => {
    const created = await settlement(companyA, supplierA);
    const idempotency = (operation: string) =>
      database.prisma.idempotencyRecord.create({
        data: {
          companyId: companyA.companyId,
          operation,
          idempotencyKey: randomUUID(),
          requestFingerprint: "a".repeat(64),
          documentId: created.id,
          createdBy: companyA.adminId,
        },
      });
    expect(await fails(idempotency("purchase_settlement.emit"))).toBeNull();
    expect(await fails(idempotency("shipping_guide.emit"))).toBeNull();
    expect(await fails(idempotency("purchase_settlement.cancel"))).toMatch(
      /idempotency_record_values_check/,
    );
  });
});
