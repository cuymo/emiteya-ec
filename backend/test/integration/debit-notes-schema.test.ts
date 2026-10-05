// Invariantes de la migración add_debit_notes en PostgreSQL (design D8, D15 y D26): un comprobante
// 05 no se confirma sin su factura, que debe ser una factura autorizada de la misma empresa y del
// mismo ambiente; la relación es inmutable; un borrador emitido y sus conceptos no cambian; los
// conceptos y la forma de pago del borrador tienen su dominio; y la emisión de notas de débito tiene
// su operación de idempotencia. Aplica las migraciones anteriores, crea una factura como en una
// instalación existente y después aplica la de las notas de débito.
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

const DEBIT_NOTES_MIGRATION = "20261009100000_add_debit_notes";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

describe("notas de débito en la base de datos", () => {
  const name = `t_debit_notes_schema_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let legacyInvoice: TestDocument;

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
  const invoice = (
    company: FiscalCompany,
    state = "AUTHORIZED",
    environment: "TEST" | "PRODUCTION" = "TEST",
  ) => insertDocument(database.prisma, company, state, { environment, total: "115.00" });
  /** Nota de débito en `state` con su factura registrada en la misma transacción. */
  const debitNote = (
    company: FiscalCompany,
    supportId: string,
    options: { state?: string; environment?: "TEST" | "PRODUCTION" } = {},
  ) =>
    insertDocument(database.prisma, company, options.state ?? "RECEIVED", {
      documentType: "05",
      total: "23.00",
      ...(options.environment ? { environment: options.environment } : {}),
      alongside: async (tx, document) => {
        await tx.debitNoteSupport.create({
          data: { companyId: company.companyId, debitNoteId: document.id, invoiceId: supportId },
        });
      },
    });
  const draft = (company: FiscalCompany, invoiceId: string, paymentMethod: string | null = "01") =>
    database.prisma.debitNoteDraft.create({
      data: {
        companyId: company.companyId,
        invoiceId,
        paymentMethod,
        createdBy: company.adminId,
        updatedBy: company.adminId,
      },
    });
  const concept = (
    draftId: string,
    company: FiscalCompany,
    values: {
      position?: number;
      cause?: string | null;
      description?: string | null;
      amount?: string | null;
      taxTreatment?: string | null;
    } = {},
  ) =>
    database.prisma.debitNoteDraftConcept.create({
      data: {
        draftId,
        companyId: company.companyId,
        position: values.position ?? 1,
        cause: values.cause === undefined ? "LATE_PAYMENT_INTEREST" : values.cause,
        description: values.description === undefined ? "Interés por mora" : values.description,
        amount: values.amount === undefined ? "20.00" : values.amount,
        taxTreatment: values.taxTreatment === undefined ? "2:4" : values.taxTreatment,
      },
    });

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < DEBIT_NOTES_MIGRATION)) {
      execute(migration);
    }

    // Una instalación con una factura autorizada antes de las notas de débito.
    await loadInstalledFiscalCatalogs(database.prisma);
    companyA = await insertFiscalCompany(database.prisma, "Débito A", 1);
    companyB = await insertFiscalCompany(database.prisma, "Débito B", 1);
    legacyInvoice = await invoice(companyA);

    execute(DEBIT_NOTES_MIGRATION);
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("las facturas existentes no cambian y una nota de débito se registra con su factura", async () => {
    const unchanged = await database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: legacyInvoice.id },
    });
    expect(unchanged).toEqual(legacyInvoice);
    const note = await debitNote(companyA, legacyInvoice.id);
    expect(
      await database.prisma.debitNoteSupport.findUniqueOrThrow({
        where: {
          companyId_debitNoteId: { companyId: companyA.companyId, debitNoteId: note.id },
        },
      }),
    ).toMatchObject({ invoiceId: legacyInvoice.id });
  });

  it("una nota de débito no se confirma sin su factura, y el trigger solo mira el tipo 05", async () => {
    const error = await fails(
      insertDocument(database.prisma, companyA, "RECEIVED", { documentType: "05" }),
    );
    expect(error).toMatch(/no tiene su factura/);
    // Una factura nueva se confirma sin relación: el trigger diferido no la dispara.
    expect(await fails(invoice(companyA))).toBeNull();
    const [definition] = await database.prisma.$queryRaw<{ definition: string }[]>`
      SELECT pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${name} AND t.tgname = 'debit_note_has_support'`;
    expect(definition!.definition).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
    expect(definition!.definition).toMatch(/document_type = '05'/);
  });

  it("la factura es una factura autorizada de la misma empresa y del mismo ambiente", async () => {
    const received = await invoice(companyA, "RECEIVED");
    expect(await fails(debitNote(companyA, received.id))).toMatch(/factura autorizada/);
    const production = await invoice(companyA, "AUTHORIZED", "PRODUCTION");
    expect(await fails(debitNote(companyA, production.id))).toMatch(/mismo ambiente/);
    expect(
      await fails(debitNote(companyA, production.id, { environment: "PRODUCTION" })),
    ).toBeNull();
    // Una nota de débito no es una factura: no puede ser el documento modificado.
    const note = await debitNote(companyA, legacyInvoice.id);
    expect(await fails(debitNote(companyA, note.id))).toMatch(/factura autorizada/);
    // La factura de otra empresa no es una factura de la empresa A.
    const foreign = await invoice(companyB);
    expect(await fails(debitNote(companyA, foreign.id))).toMatch(
      /factura autorizada de la empresa/,
    );
  });

  it("la relación pertenece a una nota de débito de la empresa", async () => {
    const other = await invoice(companyA);
    const error = await fails(
      database.prisma.debitNoteSupport.create({
        data: { companyId: companyA.companyId, debitNoteId: other.id, invoiceId: legacyInvoice.id },
      }),
    );
    expect(error).toMatch(/nota de débito de la empresa/);
  });

  it("la relación de una nota con su factura no cambia ni se borra", async () => {
    const note = await debitNote(companyA, legacyInvoice.id);
    const other = await invoice(companyA);
    const where = {
      companyId_debitNoteId: { companyId: companyA.companyId, debitNoteId: note.id },
    };
    expect(
      await fails(
        database.prisma.debitNoteSupport.update({ where, data: { invoiceId: other.id } }),
      ),
    ).toMatch(/no admite UPDATE/);
    expect(await fails(database.prisma.debitNoteSupport.delete({ where }))).toMatch(
      /no admite DELETE/,
    );
  });

  it("un borrador emitido y sus conceptos no cambian; uno en preparación sí", async () => {
    const open = await draft(companyA, legacyInvoice.id);
    await concept(open.id, companyA);
    await database.prisma.debitNoteDraft.update({
      where: { id: open.id },
      data: { paymentMethod: "20", version: 2, updatedBy: companyA.adminId },
    });
    await database.prisma.debitNoteDraft.delete({ where: { id: open.id } });
    expect(await database.prisma.debitNoteDraftConcept.count({ where: { draftId: open.id } })).toBe(
      0,
    );

    const emitted = await draft(companyA, legacyInvoice.id);
    await concept(emitted.id, companyA);
    const note = await debitNote(companyA, legacyInvoice.id);
    await database.prisma.debitNoteDraft.update({
      where: { id: emitted.id },
      data: { status: "EMITTED", documentId: note.id, updatedBy: companyA.adminId },
    });
    expect(
      await fails(
        database.prisma.debitNoteDraft.update({
          where: { id: emitted.id },
          data: { paymentMethod: "20" },
        }),
      ),
    ).toMatch(/emitido no cambia/);
    expect(
      await fails(database.prisma.debitNoteDraft.delete({ where: { id: emitted.id } })),
    ).toMatch(/emitido no cambia/);
    expect(await fails(concept(emitted.id, companyA, { position: 2 }))).toMatch(
      /emitido no cambia/,
    );
    expect(
      await fails(
        database.prisma.debitNoteDraftConcept.update({
          where: { draftId_position: { draftId: emitted.id, position: 1 } },
          data: { amount: "1.00" },
        }),
      ),
    ).toMatch(/emitido no cambia/);
    // EMITTED exige su comprobante, y la factura del borrador no cambia.
    const another = await draft(companyA, legacyInvoice.id);
    expect(
      await fails(
        database.prisma.debitNoteDraft.update({
          where: { id: another.id },
          data: { status: "EMITTED" },
        }),
      ),
    ).toMatch(/debit_note_draft_values_check/);
    const other = await invoice(companyA);
    expect(
      await fails(
        database.prisma.debitNoteDraft.update({
          where: { id: another.id },
          data: { invoiceId: other.id },
        }),
      ),
    ).toMatch(/no cambian/);
  });

  it("la forma de pago del borrador es la clave de una entrada, nunca una etiqueta", async () => {
    expect(await fails(draft(companyA, legacyInvoice.id, "SIN UTILIZACION"))).toMatch(
      /debit_note_draft_values_check/,
    );
    expect(await fails(draft(companyA, legacyInvoice.id, "efectivo"))).toMatch(
      /debit_note_draft_values_check/,
    );
    expect(await fails(draft(companyA, legacyInvoice.id, null))).toBeNull();
  });

  it("los conceptos tienen su dominio: causa cerrada, descripción, importe y tratamiento", async () => {
    const target = await draft(companyA, legacyInvoice.id);
    const rejected = [
      { position: 0 },
      { position: 101 },
      { cause: "PRICE_CORRECTION" },
      { description: "" },
      { description: "   " },
      { description: "dos\nlíneas" },
      { description: "x".repeat(301) },
      { amount: "0" },
      { amount: "-5.00" },
      { amount: "10.005" },
      { amount: "1000000000000.00" },
      { taxTreatment: "IVA15" },
      { taxTreatment: "2:" },
    ];
    for (const [index, values] of rejected.entries()) {
      const error = await fails(concept(target.id, companyA, { position: index + 1, ...values }));
      expect(error, JSON.stringify(values)).toMatch(/debit_note_draft_concept_values_check/);
    }
    expect(
      await fails(
        concept(target.id, companyA, {
          position: 100,
          cause: "POST_INVOICE_COST_EXPENSE",
          description: "x".repeat(300),
          amount: "999999999999.99",
          taxTreatment: "2:0",
        }),
      ),
    ).toBeNull();
    // Mientras se prepara, cada campo puede faltar.
    expect(
      await fails(
        concept(target.id, companyA, {
          position: 99,
          cause: null,
          description: null,
          amount: null,
          taxTreatment: null,
        }),
      ),
    ).toBeNull();
  });

  it("un borrador y su factura pertenecen a la misma empresa", async () => {
    const foreign = await invoice(companyB);
    expect(await fails(draft(companyA, foreign.id))).toMatch(/foreign key|Foreign key/);
    const target = await draft(companyA, legacyInvoice.id);
    expect(
      await fails(
        database.prisma.debitNoteDraftConcept.create({
          data: { draftId: target.id, companyId: companyB.companyId, position: 1 },
        }),
      ),
    ).toMatch(/foreign key|Foreign key/);
  });

  it("el registro de idempotencia admite la emisión de notas de débito", async () => {
    const note = await debitNote(companyA, legacyInvoice.id);
    const record = (operation: string) =>
      database.prisma.idempotencyRecord.create({
        data: {
          companyId: companyA.companyId,
          operation,
          idempotencyKey: randomUUID(),
          requestFingerprint: "a".repeat(64),
          documentId: note.id,
          createdBy: companyA.adminId,
        },
      });
    expect(await fails(record("debit_note.emit"))).toBeNull();
    expect(await fails(record("debit_note.cancel"))).toMatch(/idempotency_record_values_check/);
  });
});
