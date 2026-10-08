// Fuentes del inventario y de los productos para los reportes (add-reports-export, tarea 3.3, design
// D1, D2 y D3): Existencias con el saldo registrado de los productos inicializados (también negativo)
// y ninguno sin inventario; Movimientos de toda la empresa por producto, fechas de Ecuador y tipo,
// con el número del comprobante; el código y el nombre en lote; y otra empresa ausente.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InventoryMovementsFilters } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  createInventoryMovementsReportSource,
  createStockRepository,
  inventoryBalanceReads,
} from "../../src/modules/inventory/infrastructure/index.ts";
import {
  createReportProductsSource,
  reportProductLabels,
} from "../../src/modules/products/infrastructure/index.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { allBatches, allPages, invoiceAmounts } from "./reports-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

describe("fuentes del inventario y de los productos", () => {
  let db: MigratedSchema;
  let movements: ReturnType<typeof createInventoryMovementsReportSource>;
  let products: ReturnType<typeof createReportProductsSource>;
  let a: FiscalCompany;
  let b: FiscalCompany;
  const id = {} as Record<
    "zeta" | "alfa" | "negative" | "untracked" | "uninitialized" | "other",
    string
  >;
  let invoiceNumber: string;

  beforeAll(async () => {
    db = await createMigratedSchema("report_sources_inventory");
    movements = createInventoryMovementsReportSource(db.name);
    products = createReportProductsSource(db.name);
    const prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    a = await insertFiscalCompany(prisma, "Empresa A", 1);
    b = await insertFiscalCompany(prisma, "Empresa B", 1);
    id.zeta = await insertProduct(prisma, a, { name: "Zeta tornillo", mainCode: "Z-1" });
    id.alfa = await insertProduct(prisma, a, { name: "Alfa arandela", mainCode: "A-1" });
    id.negative = await insertProduct(prisma, a, { name: "Beta clavo" });
    id.untracked = await insertProduct(prisma, a, { name: "Servicio", stockTracked: false });
    id.uninitialized = await insertProduct(prisma, a, { name: "Gamma sin iniciar" });
    id.other = await insertProduct(prisma, b, { name: "Ajeno" });
    const invoice = await insertDocument(prisma, a, "AUTHORIZED", {
      documentType: "01",
      issueDate: "2026-09-30",
      total: "11.50",
      snapshot: invoiceAmounts("10.00", [{ taxCode: "2", amount: "1.50" }], "11.50"),
    });
    invoiceNumber = invoice.documentNumber;
    const at = (iso: string) => new Date(iso);
    const write = (
      work: (repository: ReturnType<typeof createStockRepository>) => Promise<unknown>,
    ) => prisma.$transaction((tx) => work(createStockRepository(tx)));
    const init = (
      companyId: string,
      productId: string,
      quantity: string,
      iso: string,
      actor: string,
    ) =>
      write((stock) =>
        stock.initialize({
          companyId,
          productId,
          quantity,
          note: null,
          actorUserId: actor,
          at: at(iso),
        }),
      );
    // Zeta: 20 iniciales (31 de agosto, 23:30 en Ecuador), salida por factura de 5 y entrada de 3.
    await init(a.companyId, id.zeta, "20", "2026-09-01T04:30:00.000Z", a.adminId);
    await write((stock) =>
      stock.append({
        companyId: a.companyId,
        productId: id.zeta,
        type: "SALIDA_FACTURA",
        delta: "-5",
        origin: "SYSTEM",
        actorUserId: null,
        documentId: invoice.id,
        documentNumber: invoice.documentNumber,
        occurredAt: at("2026-09-15T15:00:00.000Z"),
      }),
    );
    await write((stock) =>
      stock.append({
        companyId: a.companyId,
        productId: id.zeta,
        type: "ENTRADA_MANUAL",
        delta: "3",
        origin: "USER",
        actorUserId: a.adminId,
        idempotency: {
          operation: "inventory.entry",
          key: randomUUID(),
          requestHash: "a".repeat(64),
        },
        occurredAt: at("2026-10-01T04:59:59.999Z"),
      }),
    );
    await init(a.companyId, id.alfa, "2.5", "2026-09-02T12:00:00.000Z", a.adminId);
    // Beta: salidas que superan sus existencias.
    await init(a.companyId, id.negative, "1", "2026-09-03T12:00:00.000Z", a.adminId);
    await write((stock) =>
      stock.append({
        companyId: a.companyId,
        productId: id.negative,
        type: "AJUSTE",
        delta: "-4",
        origin: "USER",
        actorUserId: a.adminId,
        reason: "Conteo físico",
        idempotency: {
          operation: "inventory.adjust",
          key: randomUUID(),
          requestHash: "b".repeat(64),
        },
        occurredAt: at("2026-09-20T12:00:00.000Z"),
      }),
    );
    await init(b.companyId, id.other, "7", "2026-09-05T12:00:00.000Z", b.adminId);
  }, 180_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("Existencias lista los inicializados por nombre con su saldo registrado, también negativo", async () => {
    const prisma = db.database.prisma;
    const ids = await inventoryBalanceReads.initializedProductIds(prisma, a.companyId);
    expect(new Set(ids)).toEqual(new Set([id.zeta, id.alfa, id.negative]));
    const ordered = await allPages(prisma, products, a.companyId, { productIds: ids });
    expect(ordered).toEqual([
      { productId: id.alfa, code: "A-1", name: "Alfa arandela" },
      { productId: id.negative, code: "", name: "Beta clavo" },
      { productId: id.zeta, code: "Z-1", name: "Zeta tornillo" },
    ]);
    const balances = await inventoryBalanceReads.balances(prisma, a.companyId, ids);
    expect(Object.fromEntries(balances)).toEqual({
      [id.alfa]: "2.5",
      [id.negative]: "-3",
      // 20 - 5 + 3: el saldo del inventario, sin recalcular.
      [id.zeta]: "18",
    });
    expect(await products.count(prisma, a.companyId, { productIds: ids })).toBe(3);
    const cursor = await allBatches(prisma, products, a.companyId, { productIds: ids }, 2);
    expect(cursor.rows).toEqual(ordered);
  });

  it("Existencias filtra por producto y no muestra los productos sin inventario", async () => {
    const prisma = db.database.prisma;
    expect(await inventoryBalanceReads.initializedProductIds(prisma, a.companyId, id.alfa)).toEqual(
      [id.alfa],
    );
    for (const productId of [id.untracked, id.uninitialized, id.other]) {
      expect(
        await inventoryBalanceReads.initializedProductIds(prisma, a.companyId, productId),
      ).toEqual([]);
    }
    // Un producto de otra empresa nunca entra en la lista de esta.
    expect(await allPages(prisma, products, a.companyId, { productIds: [id.other] })).toEqual([]);
  });

  it("Movimientos lista los de toda la empresa del más reciente al más antiguo", async () => {
    const prisma = db.database.prisma;
    const rows = await allPages(prisma, movements, a.companyId, {});
    expect(
      rows.map((row) => [row.productId, row.movementType, row.quantity, row.balanceAfter]),
    ).toEqual([
      [id.zeta, "ENTRADA_MANUAL", "3", "18"],
      [id.negative, "AJUSTE", "-4", "-3"],
      [id.zeta, "SALIDA_FACTURA", "-5", "15"],
      [id.negative, "INICIAL", "1", "1"],
      [id.alfa, "INICIAL", "2.5", "2.5"],
      [id.zeta, "INICIAL", "20", "20"],
    ]);
    expect(rows[2]).toMatchObject({
      documentNumber: invoiceNumber,
      occurredAt: "2026-09-15T15:00:00.000Z",
    });
    expect(rows[0]?.documentNumber).toBeNull();
    expect(await movements.count(prisma, a.companyId, {})).toBe(6);
    const cursor = await allBatches(prisma, movements, a.companyId, {}, 4);
    expect(cursor.rows).toEqual(rows);
  });

  it("Movimientos filtra por producto, por fechas de Ecuador y por tipo", async () => {
    const prisma = db.database.prisma;
    const types = async (filters: InventoryMovementsFilters) =>
      (await allPages(prisma, movements, a.companyId, filters)).map((row) => row.movementType);
    expect(await types({ productId: id.zeta })).toEqual([
      "ENTRADA_MANUAL",
      "SALIDA_FACTURA",
      "INICIAL",
    ]);
    expect(await types({ movementType: "SALIDA_FACTURA" })).toEqual(["SALIDA_FACTURA"]);
    // 04:30 UTC del 1 de septiembre es el 31 de agosto en Ecuador; 04:59:59.999 UTC del 1 de octubre
    // es el 30 de septiembre.
    expect(await types({ productId: id.zeta, from: "2026-09-01", to: "2026-09-30" })).toEqual([
      "ENTRADA_MANUAL",
      "SALIDA_FACTURA",
    ]);
    expect(await types({ productId: id.zeta, to: "2026-08-31" })).toEqual(["INICIAL"]);
    expect(await types({ productId: id.zeta, from: "2026-10-01" })).toEqual([]);
  });

  it("da el código y el nombre vigentes en lote, solo de la empresa", async () => {
    const prisma = db.database.prisma;
    const labels = await reportProductLabels(prisma, a.companyId, [
      id.zeta,
      id.alfa,
      id.zeta,
      id.other,
    ]);
    expect(Object.fromEntries(labels)).toEqual({
      [id.zeta]: { productId: id.zeta, code: "Z-1", name: "Zeta tornillo" },
      [id.alfa]: { productId: id.alfa, code: "A-1", name: "Alfa arandela" },
    });
  });

  it("aísla los movimientos de cada empresa", async () => {
    const prisma = db.database.prisma;
    const rows = await allPages(prisma, movements, b.companyId, {});
    expect(rows.map((row) => row.productId)).toEqual([id.other]);
  });
});
