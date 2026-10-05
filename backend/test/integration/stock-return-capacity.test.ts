// Capacidad devolvible del inventario (add-credit-notes, tarea 7.1, design D10) sobre PostgreSQL:
// nace de la `SALIDA_FACTURA` de la factura (cero sin salida), reserva por producto con el `CHECK`
// como última defensa, no se duplica al inicializarse otra vez y es independiente de la capacidad
// acreditable: el ejemplo de design D7 deja 5 unidades acreditables y 8 devolvibles.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { ReturnCapacity } from "../../src/modules/credit-notes/application/ports.ts";
import { createCreditCapacityRepository } from "../../src/modules/credit-notes/infrastructure/prisma-credit-capacity.ts";
import { StockReturnExceededError } from "../../src/modules/inventory/application/ports.ts";
import {
  createStockRepository,
  stockReturnCapacity,
} from "../../src/modules/inventory/infrastructure/index.ts";
import {
  insertAuthorizedInvoice,
  type AuthorizedInvoiceDocument,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

// El inventario implementa el puerto que define `credit-notes`, sin importarlo.
const port: ReturnCapacity = stockReturnCapacity;

describe("capacidad devolvible del inventario", () => {
  let db: MigratedSchema;
  let company: FiscalCompany;
  const invoiceCompany = (): InvoiceCompany => ({
    companyId: company.companyId,
    adminId: company.adminId,
    establishmentId: company.points[0]!.establishmentId,
    emissionPointId: company.points[0]!.emissionPointId,
  });
  /** Producto con inventario inicializado en 100 y una factura autorizada con su salida. */
  const invoiceWithOutflow = async (quantity: string) => {
    const product = await insertProduct(db.database.prisma, company);
    const invoice = await insertAuthorizedInvoice(db.database.prisma, invoiceCompany(), [
      { productId: product, quantity, unitPrice: "10.00", inventoryAffectsStock: true },
    ]);
    // La inicialización y la salida van en transacciones separadas, como en la aplicación.
    await db.database.prisma.$transaction((tx) =>
      createStockRepository(tx).initialize({
        companyId: company.companyId,
        productId: product,
        quantity: "100",
        note: null,
        actorUserId: company.adminId,
        at: new Date(),
      }),
    );
    await db.database.prisma.$transaction((tx) =>
      createStockRepository(tx).append({
        companyId: company.companyId,
        productId: product,
        type: "SALIDA_FACTURA",
        delta: `-${quantity}`,
        origin: "SYSTEM",
        actorUserId: null,
        documentId: invoice.id,
        documentNumber: invoice.documentNumber,
        occurredAt: new Date(),
      }),
    );
    return { product, invoice };
  };
  const available = (invoiceId: string, productIds: string[]) =>
    port(db.database.prisma).available(company.companyId, invoiceId, productIds);
  /** Nota con su reserva acreditable y su retorno físico, en una transacción, como la emisión. */
  const note = (
    invoice: AuthorizedInvoiceDocument,
    quantity: string,
    returns: { productId: string; quantity: string }[],
  ) =>
    insertDocument(db.database.prisma, company, "RECEIVED", {
      documentType: "04",
      total: "0.00",
      alongside: async (tx: Prisma.TransactionClient, document) => {
        const credit = createCreditCapacityRepository(tx);
        await credit.lock(company.companyId, invoice.id);
        await credit.initialize({
          companyId: company.companyId,
          invoiceId: invoice.id,
          total: invoice.total,
          lines: invoice.snapshot.lines.map(({ position, productId, quantity: q }) => ({
            position,
            productId,
            quantity: q,
          })),
        });
        await credit.reserve({
          companyId: company.companyId,
          invoiceId: invoice.id,
          amount: "0.00",
          lines: [{ position: 1, quantity }],
        });
        await port(tx).reserve({ companyId: company.companyId, invoiceId: invoice.id, returns });
        await credit.record({
          companyId: company.companyId,
          invoiceId: invoice.id,
          creditNoteId: document.id,
          cause: "RETURN",
          amount: "0.00",
          lines: [
            {
              position: 1,
              quantity,
              subtotal: "0",
              discount: "0.00",
              taxableBase: "0.00",
              taxes: [],
              physicalReturn: returns[0]?.quantity ?? "0",
            },
          ],
        });
        await port(tx).record({
          companyId: company.companyId,
          invoiceId: invoice.id,
          creditNoteId: document.id,
          returns,
        });
      },
    });
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error,
    );

  beforeAll(async () => {
    db = await createMigratedSchema("stock_return_capacity");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    company = await insertFiscalCompany(db.database.prisma, "Devoluciones", 1);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("antes de la primera nota, lo disponible es la salida de la factura; sin salida, cero", async () => {
    const { product, invoice } = await invoiceWithOutflow("5");
    const other = await insertProduct(db.database.prisma, company);
    expect(await available(invoice.id, [product, other])).toEqual(
      new Map([
        [product, "5"],
        [other, "0"],
      ]),
    );
    expect(await db.database.prisma.stockReturnCapacity.count()).toBe(0);
  });

  it("reserva un retorno dentro de la salida y rechaza el que la excede, sin dejar la nota", async () => {
    const { product, invoice } = await invoiceWithOutflow("5");
    await note(invoice, "3", [{ productId: product, quantity: "3" }]);
    expect((await available(invoice.id, [product])).get(product)).toBe("2");
    const notes = () =>
      db.database.prisma.electronicDocument.count({ where: { documentType: "04" } });
    const before = await notes();
    const error = await fails(note(invoice, "2", [{ productId: product, quantity: "2.5" }]));
    expect(error).toBeInstanceOf(StockReturnExceededError);
    expect((error as StockReturnExceededError).code).toBe("STOCK_RETURN_EXCEEDED");
    expect(await notes()).toBe(before);
    await note(invoice, "2", [{ productId: product, quantity: "2" }]);
    expect((await available(invoice.id, [product])).get(product)).toBe("0");
  });

  it("una factura sin salida del producto no admite retorno físico", async () => {
    const product = await insertProduct(db.database.prisma, company);
    const invoice = await insertAuthorizedInvoice(db.database.prisma, invoiceCompany(), [
      { productId: product, quantity: "4", unitPrice: "10.00" },
    ]);
    const error = await fails(note(invoice, "1", [{ productId: product, quantity: "1" }]));
    expect(error).toBeInstanceOf(StockReturnExceededError);
  });

  it("la inicialización repetida no duplica la capacidad, y los retornos de un producto se agrupan", async () => {
    const { product, invoice } = await invoiceWithOutflow("10");
    await note(invoice, "1", [{ productId: product, quantity: "1" }]);
    await note(invoice, "2", [
      { productId: product, quantity: "0.5" },
      { productId: product, quantity: "1.5" },
    ]);
    const rows = await db.database.prisma.stockReturnCapacity.findMany({
      where: { invoiceId: invoice.id },
    });
    expect(
      rows.map((row) => [row.originalQuantity.toFixed(), row.reservedQuantity.toFixed()]),
    ).toEqual([["10", "3"]]);
    expect(
      await db.database.prisma.stockReturnReservation.count({ where: { invoiceId: invoice.id } }),
    ).toBe(2);
  });

  it("es independiente de lo acreditable: acreditar 5 con retorno 2 deja 5 acreditables y 8 devolvibles", async () => {
    const { product, invoice } = await invoiceWithOutflow("10");
    await note(invoice, "5", [{ productId: product, quantity: "2" }]);
    const credit = await createCreditCapacityRepository(db.database.prisma).read(
      company.companyId,
      invoice.id,
    );
    const line = credit.lines[0]!;
    expect(Number(line.original) - Number(line.reserved) - Number(line.applied)).toBe(5);
    expect((await available(invoice.id, [product])).get(product)).toBe("8");
  });
});
