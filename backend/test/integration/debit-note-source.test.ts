// Factura de origen de una nota de débito (add-debit-notes, tarea 5.1, design D3 y D6): la nota lee
// la factura con la lectura inmutable que exporta `invoices`, sin cambiarla. Los tratamientos de IVA
// salen del snapshot con sus referencias fiscales, aunque después cambien el producto, el tercero o
// el catálogo; la integridad alterada se detecta y nunca se repara; y una factura de otra empresa,
// una nota de crédito o una nota de débito no se encuentran.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { loadDebitContext } from "../../src/modules/debit-notes/application/context.ts";
import { createDebitNotesReads } from "../../src/modules/debit-notes/infrastructure/reads.ts";
import { invoiceCreditSource } from "../../src/modules/invoices/infrastructure/index.ts";
import { corruptArtifact } from "./archive-harness.ts";
import {
  IVA0,
  insertAuthorizedInvoice,
  insertCreditNote,
  tamperSnapshot,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

const DRAFT = { emissionPointId: null, paymentMethod: null, concepts: [] };

describe("factura de origen de una nota de débito", () => {
  let db: MigratedSchema;
  let a: FiscalCompany;
  let b: FiscalCompany;
  let good: string;
  let service: string;
  const companyOf = (company: FiscalCompany): InvoiceCompany => ({
    companyId: company.companyId,
    adminId: company.adminId,
    establishmentId: company.points[0]!.establishmentId,
    emissionPointId: company.points[0]!.emissionPointId,
  });
  const reader = () => invoiceCreditSource(db.database.prisma);
  const context = async (company: FiscalCompany, invoiceId: string) => {
    const invoice = await reader().find(company.companyId, invoiceId);
    if (!invoice) throw new Error("factura no encontrada");
    return loadDebitContext(
      {
        reads: createDebitNotesReads(db.database.prisma, () => ({
          activeCertificate: () => Promise.resolve(null),
        })),
        invoices: reader(),
      },
      company.companyId,
      invoice,
      DRAFT,
      "2026-10-09",
    );
  };

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_source");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    a = await insertFiscalCompany(db.database.prisma, "Débito origen A", 1);
    b = await insertFiscalCompany(db.database.prisma, "Débito origen B", 1);
    good = await insertProduct(db.database.prisma, a, { name: "Cemento 50 kg" });
    service = await insertProduct(db.database.prisma, a, { kind: "SERVICE", stockTracked: false });
  });

  afterAll(async () => {
    await db.drop();
  });

  it("toma los tratamientos de IVA del snapshot, sin el producto, el tercero ni el catálogo vigentes", async () => {
    const invoice = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "3", unitPrice: "10.00", inventoryAffectsStock: true },
      { productId: service, quantity: "1", unitPrice: "15.00", rate: IVA0 },
    ]);
    // Después de facturar cambian el precio, el nombre, las tarifas del producto y la habilitación
    // del catálogo: la nota no los ve.
    await db.database.prisma.product.update({
      where: { id: good },
      data: { unitPrice: "99.00", name: "Otro nombre", searchName: "otro nombre" },
    });
    await db.database.prisma.productTax.updateMany({
      where: { productId: good },
      data: { entryKey: "2" },
    });
    await db.database.prisma.companyFiscalCatalogSetting.create({
      data: {
        companyId: a.companyId,
        catalogType: "iva-rate",
        entryKey: "4",
        enabled: false,
        updatedBy: a.adminId,
      },
    });
    const loaded = await context(a, invoice.id);
    expect(loaded.treatments).toEqual([
      {
        key: "2:0",
        taxCode: "2",
        rateCode: "0",
        percentage: "0",
        catalogType: "iva-rate",
        entryKey: "0",
        versionId: "0@1",
        officialLabel: "IVA 0 %",
      },
      {
        key: "2:4",
        taxCode: "2",
        rateCode: "4",
        percentage: "15",
        catalogType: "iva-rate",
        entryKey: "4",
        versionId: "4@1",
        officialLabel: "IVA 15 %",
      },
    ]);
    expect(loaded.invoice).toMatchObject({
      id: invoice.id,
      documentNumber: invoice.documentNumber,
      accessKey: invoice.accessKey,
      environment: "TEST",
      state: "AUTHORIZED",
      consumerFinal: false,
      buyer: { identification: "0992877878001", legalName: "EL PERNO CIA. LTDA." },
      integrity: { intact: true, problems: [] },
    });
    expect(loaded.invoice.authorization).toMatchObject({ number: invoice.accessKey });
    // Sin conceptos ni forma de pago, la nota todavía no se calcula, pero la factura es admisible.
    expect(loaded.evaluation.issues.map((issue) => issue.code)).toEqual(
      expect.not.arrayContaining([
        "DEBIT_NOTE_INVOICE_NOT_ELIGIBLE",
        "DEBIT_NOTE_INVOICE_INTEGRITY",
        "DEBIT_NOTE_CONSUMER_FINAL",
      ]),
    );
  });

  it("detecta un snapshot o un XML alterado y no lo repara", async () => {
    const signed = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "1", unitPrice: "10.00" },
    ]);
    await corruptArtifact(db.database.prisma, db.name, signed.id, "SIGNED_XML");
    const altered = await context(a, signed.id);
    expect(altered.invoice.integrity.intact).toBe(false);
    expect(altered.evaluation.issues.map((issue) => issue.code)).toEqual([
      "DEBIT_NOTE_INVOICE_INTEGRITY",
    ]);

    const totals = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "1", unitPrice: "10.00" },
    ]);
    await tamperSnapshot(db.database.prisma, db.name, totals.id, (snapshot) => ({
      ...snapshot,
      totals: { ...(snapshot.totals as object), total: "999.99" },
    }));
    expect((await context(a, totals.id)).evaluation.issues.map((issue) => issue.code)).toEqual([
      "DEBIT_NOTE_INVOICE_INTEGRITY",
    ]);
    // La lectura no reparó nada: el snapshot sigue alterado.
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: totals.id },
    });
    expect((stored.snapshot as { totals: { total: string } }).totals.total).toBe("999.99");
  });

  it("una factura de otra empresa, una nota de crédito o una nota de débito no se encuentran", async () => {
    const invoice = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "2", unitPrice: "10.00" },
    ]);
    expect(await reader().find(b.companyId, invoice.id)).toBeNull();
    const creditNote = await insertCreditNote(db.database.prisma, a, invoice, {
      lines: [{ position: 1, quantity: "1" }],
    });
    expect(await reader().find(a.companyId, creditNote.id)).toBeNull();
    const debitNote = await insertDocument(db.database.prisma, a, "SIGNED", {
      documentType: "05",
      total: "23.00",
      alongside: async (tx, document) => {
        await tx.debitNoteSupport.create({
          data: { companyId: a.companyId, debitNoteId: document.id, invoiceId: invoice.id },
        });
      },
    });
    expect(await reader().find(a.companyId, debitNote.id)).toBeNull();
  });
});
