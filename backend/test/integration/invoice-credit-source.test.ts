// Factura de origen de una nota de crédito (add-credit-notes, tarea 6.1, design D3): la lectura
// inmutable desde el snapshot, sin consultar producto, tercero ni catálogo, y la integridad del
// snapshot y de sus artefactos fiscales, que se detecta y nunca se repara.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { invoiceCreditSource } from "../../src/modules/invoices/infrastructure/index.ts";
import { corruptArtifact } from "./archive-harness.ts";
import {
  IVA0,
  insertAuthorizedInvoice,
  tamperSnapshot,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

describe("factura de origen de una nota de crédito", () => {
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
  const source = () => invoiceCreditSource(db.database.prisma);

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_credit_source");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    a = await insertFiscalCompany(db.database.prisma, "Origen A", 1);
    b = await insertFiscalCompany(db.database.prisma, "Origen B", 1);
    good = await insertProduct(db.database.prisma, a, { name: "Cemento 50 kg" });
    service = await insertProduct(db.database.prisma, a, { kind: "SERVICE", stockTracked: false });
  });

  afterAll(async () => {
    await db.drop();
  });

  it("lee la factura autorizada desde su snapshot, sin el producto, el tercero ni el catálogo vigentes", async () => {
    const invoice = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      {
        productId: good,
        quantity: "3",
        unitPrice: "10.00",
        discount: "3.00",
        inventoryAffectsStock: true,
      },
      { productId: service, quantity: "1", unitPrice: "15.00", rate: IVA0 },
    ]);
    // Después de facturar cambian el precio, el nombre y las tarifas vigentes: la lectura no los ve.
    await db.database.prisma.product.update({
      where: { id: good },
      data: { unitPrice: "99.00", name: "Otro nombre", searchName: "otro nombre" },
    });
    await db.database.prisma.productTax.updateMany({
      where: { productId: good },
      data: { entryKey: "0" },
    });
    const read = await source().find(a.companyId, invoice.id);
    expect(read).toMatchObject({
      id: invoice.id,
      documentType: "01",
      documentNumber: invoice.documentNumber,
      accessKey: invoice.accessKey,
      state: "AUTHORIZED",
      snapshotVersion: 2,
      consumerFinal: false,
      buyer: { identification: "0992877878001", legalName: "EL PERNO CIA. LTDA." },
      integrity: { intact: true, problems: [] },
    });
    expect(read!.authorization).toMatchObject({ number: invoice.accessKey, environment: "TEST" });
    expect(
      read!.lines.map((l) => [
        l.position,
        l.productId,
        l.description,
        l.quantity,
        l.unitPrice,
        l.discount,
        l.taxableBase,
        l.taxes.map((t) => [t.rateCode, t.percentage, t.amount]),
        l.inventoryAffectsStock,
      ]),
    ).toEqual([
      [1, good, "Producto 1", "3", "10.00", "3.00", "27.00", [["4", "15", "4.05"]], true],
      [2, service, "Producto 2", "1", "15.00", "0.00", "15.00", [["0", "0", "0.00"]], false],
    ]);
    expect(read!.totals.total).toBe("46.05");
  });

  it("detecta un XML firmado o autorizado alterado y no lo repara", async () => {
    const signed = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "1", unitPrice: "10.00" },
    ]);
    await corruptArtifact(db.database.prisma, db.name, signed.id, "SIGNED_XML");
    expect((await source().find(a.companyId, signed.id))!.integrity).toEqual({
      intact: false,
      problems: ["SIGNED_XML_ALTERED"],
    });
    const authorized = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "1", unitPrice: "10.00" },
    ]);
    await corruptArtifact(db.database.prisma, db.name, authorized.id, "AUTHORIZED_XML");
    expect((await source().find(a.companyId, authorized.id))!.integrity.problems).toEqual([
      "AUTHORIZED_XML_ALTERED",
    ]);
    // Leer no repara nada: la alteración sigue ahí.
    expect((await source().find(a.companyId, authorized.id))!.integrity.intact).toBe(false);
  });

  it("detecta un snapshot alterado: totales que no suman, clave distinta o forma inválida", async () => {
    const totals = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "2", unitPrice: "10.00" },
    ]);
    await tamperSnapshot(db.database.prisma, db.name, totals.id, (snapshot) => ({
      ...snapshot,
      lines: (snapshot.lines as Record<string, unknown>[]).map((line) => ({
        ...line,
        taxableBase: "1.00",
      })),
    }));
    expect((await source().find(a.companyId, totals.id))!.integrity.problems).toEqual([
      "SNAPSHOT_TOTALS",
    ]);

    const key = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "1", unitPrice: "10.00" },
    ]);
    await tamperSnapshot(db.database.prisma, db.name, key.id, (snapshot) => ({
      ...snapshot,
      key: { ...(snapshot.key as object), accessKey: "1".repeat(49) },
    }));
    expect((await source().find(a.companyId, key.id))!.integrity.problems).toEqual([
      "SNAPSHOT_KEY",
    ]);

    const shape = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "1", unitPrice: "10.00" },
    ]);
    await tamperSnapshot(db.database.prisma, db.name, shape.id, (snapshot) => ({
      ...snapshot,
      lines: [],
    }));
    const broken = await source().find(a.companyId, shape.id);
    expect(broken!.integrity.problems).toEqual(["SNAPSHOT_SHAPE"]);
    expect(broken!.lines).toEqual([]);
  });

  it("informa el consumidor final y el estado tal como están", async () => {
    const consumer = await insertAuthorizedInvoice(
      db.database.prisma,
      companyOf(a),
      [{ productId: good, quantity: "1", unitPrice: "10.00" }],
      { consumerFinal: true },
    );
    expect((await source().find(a.companyId, consumer.id))!.consumerFinal).toBe(true);
    const received = await insertAuthorizedInvoice(
      db.database.prisma,
      companyOf(a),
      [{ productId: good, quantity: "1", unitPrice: "10.00" }],
      { state: "RECEIVED" },
    );
    const read = await source().find(a.companyId, received.id);
    expect([read!.state, read!.authorization, read!.integrity.intact]).toEqual([
      "RECEIVED",
      null,
      true,
    ]);
  });

  it("una factura de otra empresa o un comprobante que no es factura no se encuentran", async () => {
    const invoice = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "1", unitPrice: "10.00" },
    ]);
    expect(await source().find(b.companyId, invoice.id)).toBeNull();
    expect(await source().find(a.companyId, "inexistente")).toBeNull();
    const note = await insertDocument(db.database.prisma, a, "RECEIVED", {
      documentType: "04",
      alongside: async (tx, document) => {
        // Una nota de crédito confirmada exige su reserva acreditable (design D25).
        await tx.creditCapacity.create({
          data: { companyId: a.companyId, invoiceId: invoice.id, originalTotal: invoice.total },
        });
        await tx.creditReservation.create({
          data: {
            companyId: a.companyId,
            invoiceId: invoice.id,
            creditNoteId: document.id,
            cause: "RETURN",
            amount: "0.00",
          },
        });
      },
    });
    expect(await source().find(a.companyId, note.id)).toBeNull();
  });
});
