// Decisión de inventario congelada en el snapshot de la factura (add-minimal-inventory, tarea 4.1,
// design D4): por línea, producto marcado y con inventario inicializado al reservar; la versión 1 se
// sigue leyendo sin esa decisión; el XML es el mismo con o sin ella.
import { randomInt, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createInventoryUnitOfWork } from "../../src/modules/inventory/infrastructure/index.ts";
import { toXmlSnapshot } from "../../src/modules/invoices/application/xml-snapshot.ts";
import type { InvoiceSnapshot } from "../../src/modules/invoices/domain/snapshot.ts";
import { invoiceStockLines } from "../../src/modules/invoices/infrastructure/index.ts";
import { createProductRepository } from "../../src/modules/products/infrastructure/prisma-products.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createInvoiceXmlBuilder } from "../../src/modules/sri-engine/infrastructure/invoice-xml-builder.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, createProduct, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

describe("decisión de inventario en el snapshot de la factura", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let company: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const p12Dir = inject("p12FixturesDir");
  const products: Record<"tracked" | "notInitialized" | "untracked" | "service", string> = {
    tracked: "",
    notInitialized: "",
    untracked: "",
    service: "",
  };

  const prisma = () => db.database.prisma;
  const call = (method: "get" | "post", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", company.cookies.admin);
  const initialize = (productId: string, quantity = "10") =>
    createInventoryUnitOfWork(prisma()).run(({ stock }) =>
      stock.initialize({
        companyId: company.companyId,
        productId,
        quantity,
        note: null,
        actorUserId: company.adminId,
        at: new Date(),
      }),
    );
  async function emit(lines: { productId: string; quantity: string }[]) {
    const draft = await call("post", "/invoices/drafts").send({
      emissionPointId: company.emissionPointId,
      buyerPartyId: company.customerId,
      lines: lines.map((line) => ({ ...line, discount: "0" })),
      payments: [{ paymentMethod: "01" }],
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const { id, version } = (draft.body as { data: { id: string; version: number } }).data;
    const res = await call("post", "/invoices")
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: id, expectedVersion: version });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { data: { id: string; state: string } }).data;
  }
  const snapshotOf = async (documentId: string) =>
    (await prisma().electronicDocument.findUniqueOrThrow({ where: { id: documentId } }))
      .snapshot as unknown as InvoiceSnapshot;

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_stock_snapshot");
    await loadInstalledFiscalCatalogs(prisma());
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    company = await readyCompany(api, db, { slug: "stock", pool, p12Dir });
    for (const key of ["tracked", "notInitialized", "untracked"] as const) {
      products[key] = await createProduct(db, company, { unitPrice: "2.5", name: `Bien ${key}` });
    }
    await prisma().product.updateMany({
      where: { id: { in: [products.tracked, products.notInitialized] } },
      data: { stockTracked: true },
    });
    await initialize(products.tracked);
    products.service = (
      await prisma().$transaction((tx) =>
        createProductRepository(tx).create(
          company.companyId,
          {
            kind: "SERVICE",
            mainCode: null,
            auxiliaryCode: null,
            name: "Transporte",
            description: null,
            unitPrice: "5",
            stockTracked: false,
            taxes: { iva: "4", ice: null, irbpnr: null },
          },
          company.adminId,
        ),
      )
    ).id;
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("congela por línea si afecta al inventario: marcado e inicializado, y nada más", async () => {
    const invoice = await emit([
      { productId: products.tracked, quantity: "1.5" },
      { productId: products.notInitialized, quantity: "2" },
      { productId: products.untracked, quantity: "1" },
      { productId: products.service, quantity: "1" },
      { productId: products.tracked, quantity: "2.25" },
    ]);
    expect(invoice.state).toBe("SIGNED");
    const snapshot = await snapshotOf(invoice.id);
    expect(snapshot.snapshotVersion).toBe(2);
    expect(snapshot.lines.map((line) => line.inventoryAffectsStock)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
    expect((await invoiceStockLines(prisma()).of(company.companyId, invoice.id))!.lines).toEqual([
      { productId: products.tracked, quantity: "1.5", inventoryAffectsStock: true },
      { productId: products.notInitialized, quantity: "2", inventoryAffectsStock: false },
      { productId: products.untracked, quantity: "1", inventoryAffectsStock: false },
      { productId: products.service, quantity: "1", inventoryAffectsStock: false },
      { productId: products.tracked, quantity: "2.25", inventoryAffectsStock: true },
    ]);
  });

  it("la decisión no cambia aunque después cambien el producto o su inventario", async () => {
    const invoice = await emit([
      { productId: products.tracked, quantity: "1" },
      { productId: products.notInitialized, quantity: "1" },
    ]);
    const before = await invoiceStockLines(prisma()).of(company.companyId, invoice.id);
    await prisma().product.update({
      where: { id: products.tracked },
      data: { stockTracked: false },
    });
    await initialize(products.notInitialized, "4");
    const after = await invoiceStockLines(prisma()).of(company.companyId, invoice.id);
    expect(after).toEqual(before);
    expect(after!.lines.map((line) => line.inventoryAffectsStock)).toEqual([true, false]);
    await prisma().product.update({
      where: { id: products.tracked },
      data: { stockTracked: true },
    });
  });

  it("el XML es el mismo con o sin la decisión de inventario", async () => {
    const invoice = await emit([{ productId: products.tracked, quantity: "3" }]);
    const v2 = await snapshotOf(invoice.id);
    const v1: InvoiceSnapshot = {
      ...v2,
      snapshotVersion: 1,
      lines: v2.lines.map(({ inventoryAffectsStock: _ignored, ...line }) => line),
    };
    const builder = createInvoiceXmlBuilder();
    expect(builder.build(toXmlSnapshot(v1))).toBe(builder.build(toXmlSnapshot(v2)));
  });

  it("un snapshot de la versión 1 se sigue leyendo en la consulta y en la lectura de inventario", async () => {
    const reference = await snapshotOf(
      (await emit([{ productId: products.tracked, quantity: "1" }])).id,
    );
    const v1 = {
      ...reference,
      snapshotVersion: 1,
      lines: reference.lines.map(({ inventoryAffectsStock: _ignored, ...line }) => line),
    };
    const reservation = await createSequentialReservation(createFiscalUnitOfWork(prisma())).reserve(
      {
        companyId: company.companyId,
        environment: "TEST",
        establishmentId: company.establishmentId,
        emissionPointId: company.emissionPointId,
        documentType: "01",
        reservedBy: company.adminId,
        correlationId: "version-1",
      },
    );
    const legacy = await prisma().electronicDocument.create({
      data: {
        companyId: company.companyId,
        documentType: "01",
        environment: "TEST",
        establishmentId: company.establishmentId,
        emissionPointId: company.emissionPointId,
        documentNumber: reservation.documentNumber,
        sequential: reservation.sequential,
        reservationId: reservation.reservationId,
        accessKey: Array.from({ length: 49 }, () => randomInt(10)).join(""),
        numericCode: "12345678",
        issueDate: new Date("2026-10-03"),
        state: "RESERVED",
        snapshot: v1,
        schemaVersion: "1.1.0",
        buyerIdentification: "0992877878001",
        buyerName: "EL PERNO CIA. LTDA.",
        total: "2.88",
        createdBy: company.adminId,
      },
    });
    const res = await call("get", `/invoices/${legacy.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as { data: { lines: { description: string }[] } }).data.lines).toHaveLength(1);
    expect((await invoiceStockLines(prisma()).of(company.companyId, legacy.id))!.lines).toEqual([
      { productId: products.tracked, quantity: "1", inventoryAffectsStock: false },
    ]);
  });
});
