// Repositorio del inventario sobre PostgreSQL (add-minimal-inventory, tarea 3.1, design D2 y D5):
// la inicialización con su INICIAL, el movimiento que avanza el saldo con una actualización atómica
// y toma de él su posición y su saldo resultante, y la reconciliación diagnóstica.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  StockAlreadyInitializedError,
  StockIdempotencyCollisionError,
  StockNotInitializedError,
  type NewMovement,
} from "../../src/modules/inventory/application/ports.ts";
import { reconcileStock } from "../../src/modules/inventory/infrastructure/reconciliation.ts";
import { createInventoryUnitOfWork } from "../../src/modules/inventory/infrastructure/unit-of-work.ts";
import { sumExact } from "../../src/platform/decimal/fiscal-decimal.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { balanceOf, expectReconciled, insertProduct } from "./inventory-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

describe("repositorio del inventario", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let company: FiscalCompany;
  const uow = () => createInventoryUnitOfWork(prisma);
  const at = new Date("2026-10-07T15:00:00Z");

  const initialize = (productId: string, quantity: string) =>
    uow().run(({ stock }) =>
      stock.initialize({
        companyId: company.companyId,
        productId,
        quantity,
        note: null,
        actorUserId: company.adminId,
        at,
      }),
    );
  const append = (movement: Partial<NewMovement> & Pick<NewMovement, "productId" | "delta">) =>
    uow().run(({ stock }) =>
      stock.append({
        companyId: company.companyId,
        type: "ENTRADA_MANUAL",
        origin: "USER",
        actorUserId: company.adminId,
        idempotency: {
          operation: "inventory.entry",
          key: `clave-${Math.random().toString(36).slice(2)}`,
          requestHash: "b".repeat(64),
        },
        occurredAt: at,
        ...movement,
      }),
    );
  const adjust = (productId: string, delta: string) =>
    append({
      productId,
      delta,
      type: "AJUSTE",
      reason: "Conteo",
      idempotency: {
        operation: "inventory.adjust",
        key: `ajuste-${Math.random().toString(36).slice(2)}`,
        requestHash: "c".repeat(64),
      },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("inventory_repository");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    company = await insertFiscalCompany(prisma, "Inventario", 1);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("una secuencia mixta encadena cada saldo con el anterior y el saldo es la suma de las variaciones", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await insertDocument(prisma, company, "AUTHORIZED");
    const other = await insertDocument(prisma, company, "AUTHORIZED");
    const initial = await initialize(product, "10");
    expect(initial).toMatchObject({
      position: 1,
      type: "INICIAL",
      delta: "10",
      balanceAfter: "10",
    });
    const movements = [
      initial,
      await append({ productId: product, delta: "5" }),
      await append({
        productId: product,
        delta: "-3",
        type: "SALIDA_FACTURA",
        origin: "SYSTEM",
        actorUserId: null,
        documentId: invoice.id,
        documentNumber: invoice.documentNumber,
        idempotency: undefined,
      }),
      await adjust(product, "-1"),
      await adjust(product, "0.5"),
      await append({
        productId: product,
        delta: "-20",
        type: "SALIDA_FACTURA",
        origin: "SYSTEM",
        actorUserId: null,
        documentId: other.id,
        documentNumber: other.documentNumber,
        idempotency: undefined,
      }),
      await append({ productId: product, delta: "1.25" }),
    ];
    expect(movements.map((movement) => movement.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (let index = 1; index < movements.length; index++) {
      expect(movements[index]!.balanceAfter).toBe(
        sumExact([movements[index - 1]!.balanceAfter, movements[index]!.delta]),
      );
    }
    const sum = sumExact(movements.map((movement) => movement.delta));
    expect(sum).toBe("-7.25");
    expect(await balanceOf(prisma, company.companyId, product)).toBe(sum);
    expect(movements.at(-1)!.balanceAfter).toBe(sum);
    await expectReconciled(prisma, company.companyId);
  });

  it("la reconciliación informa un saldo alterado sin pasar por los movimientos", async () => {
    const product = await insertProduct(prisma, company);
    await initialize(product, "4");
    // Solo en la prueba: los triggers se desactivan para simular una alteración.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.stockBalance.update({
        where: { companyId_productId: { companyId: company.companyId, productId: product } },
        data: { balance: "40" },
      });
    });
    expect(await reconcileStock(prisma, company.companyId)).toEqual([
      expect.objectContaining({
        productId: product,
        balance: "40",
        ledgerSum: "4",
        lastBalanceAfter: "4",
      }),
    ]);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.stockBalance.update({
        where: { companyId_productId: { companyId: company.companyId, productId: product } },
        data: { balance: "4" },
      });
    });
    await expectReconciled(prisma, company.companyId);
  });

  it("sin inventario no se agrega un movimiento ni se bloquea un saldo", async () => {
    const product = await insertProduct(prisma, company);
    await expect(append({ productId: product, delta: "1" })).rejects.toBeInstanceOf(
      StockNotInitializedError,
    );
    expect(await uow().run(({ stock }) => stock.lock(company.companyId, product, at))).toBeNull();
    expect(await balanceOf(prisma, company.companyId, product)).toBeNull();
  });

  it("una segunda inicialización choca con la clave del saldo", async () => {
    const product = await insertProduct(prisma, company);
    await initialize(product, "0");
    await expect(initialize(product, "3")).rejects.toBeInstanceOf(StockAlreadyInitializedError);
    expect(await balanceOf(prisma, company.companyId, product)).toBe("0");
  });

  it("la misma clave en la misma operación choca, y se lee el movimiento ganador", async () => {
    const product = await insertProduct(prisma, company);
    await initialize(product, "0");
    const idempotency = {
      operation: "inventory.entry" as const,
      key: "entrada-unica",
      requestHash: "d".repeat(64),
    };
    const first = await append({ productId: product, delta: "2", idempotency });
    await expect(append({ productId: product, delta: "2", idempotency })).rejects.toBeInstanceOf(
      StockIdempotencyCollisionError,
    );
    expect(
      await uow().run(({ stock }) =>
        stock.findByIdempotency(company.companyId, "inventory.entry", "entrada-unica"),
      ),
    ).toMatchObject({ id: first.id, delta: "2" });
    expect(await balanceOf(prisma, company.companyId, product)).toBe("2");
  });

  it("lee los saldos de una lista de productos y la salida de una factura", async () => {
    const tracked = await insertProduct(prisma, company);
    const untracked = await insertProduct(prisma, company, { stockTracked: false });
    const invoice = await insertDocument(prisma, company, "AUTHORIZED");
    await initialize(tracked, "6");
    await append({
      productId: tracked,
      delta: "-2",
      type: "SALIDA_FACTURA",
      origin: "SYSTEM",
      actorUserId: null,
      documentId: invoice.id,
      documentNumber: invoice.documentNumber,
      idempotency: undefined,
    });
    const found = await uow().run(({ stock }) =>
      stock.findMany(company.companyId, [tracked, untracked]),
    );
    expect([...found.keys()]).toEqual([tracked]);
    expect(found.get(tracked)).toMatchObject({ balance: "4", lastPosition: 2 });
    expect(
      await uow().run(({ stock }) => stock.findOutflow(company.companyId, invoice.id, tracked)),
    ).toMatchObject({ delta: "-2", documentNumber: invoice.documentNumber, origin: "SYSTEM" });
    expect(
      await uow().run(({ stock }) => stock.lock(company.companyId, tracked, at)),
    ).toMatchObject({ balance: "4" });
  });
});
