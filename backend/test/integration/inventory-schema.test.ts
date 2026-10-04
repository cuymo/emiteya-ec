// Invariantes de la migración add_minimal_inventory en PostgreSQL (design D2 y D3): el saldo cuya
// existencia es la inicialización, con su INICIAL obligatorio y siempre igual al kárdex; los
// movimientos de solo agregado, encadenados, con su signo por tipo, su comprobante de la misma
// empresa, una sola salida por factura y producto y la idempotencia por empresa, operación y clave.
// Aplica las migraciones anteriores, crea un producto marcado como en una instalación existente y
// después aplica la del inventario.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertMember } from "./fixtures.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

const INVENTORY_MIGRATION = "20261007100000_add_minimal_inventory";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();
const HASH = "a".repeat(64);

type Movement = Partial<Prisma.StockMovementUncheckedCreateInput>;

describe("inventario en la base de datos", () => {
  const name = `t_inventory_schema_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let legacyProduct: string;
  let invoiceA: TestDocument;
  let invoiceB: TestDocument;

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
  const createProduct = (company: FiscalCompany, stockTracked = true) =>
    database.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          companyId: company.companyId,
          kind: "GOOD",
          name: "Cemento 50 kg",
          unitPrice: "8.75",
          stockTracked,
          searchName: "cemento 50 kg",
          createdBy: company.adminId,
          updatedBy: company.adminId,
        },
      });
      await tx.productTax.create({
        data: {
          productId: created.id,
          companyId: company.companyId,
          catalogType: "iva-rate",
          entryKey: "4",
        },
      });
      return created.id;
    });
  /** Inicializa el inventario de un producto con su INICIAL, en una transacción. */
  const initialize = (company: FiscalCompany, productId: string, quantity = "10") =>
    database.prisma.$transaction(async (tx) => {
      await tx.stockBalance.create({
        data: {
          companyId: company.companyId,
          productId,
          balance: quantity,
          lastPosition: 1,
          initializedBy: company.adminId,
        },
      });
      await tx.stockMovement.create({
        data: {
          companyId: company.companyId,
          productId,
          position: 1,
          movementType: "INICIAL",
          delta: quantity,
          balanceAfter: quantity,
          origin: "USER",
          actorUserId: company.adminId,
        },
      });
    });
  /** Agrega un movimiento como el repositorio: avanza el saldo y lo encadena, en una transacción. */
  const append = (company: FiscalCompany, productId: string, movement: Movement) =>
    database.prisma.$transaction(async (tx) => {
      const delta = (movement.delta as string | undefined) ?? "1";
      const after = await tx.stockBalance.update({
        where: { companyId_productId: { companyId: company.companyId, productId } },
        data: { balance: { increment: delta }, lastPosition: { increment: 1 } },
      });
      return tx.stockMovement.create({
        data: {
          companyId: company.companyId,
          productId,
          position: after.lastPosition,
          movementType: "ENTRADA_MANUAL",
          balanceAfter: after.balance.toFixed(),
          origin: "USER",
          actorUserId: company.adminId,
          idempotencyOperation: "inventory.entry",
          idempotencyKey: `clave-${randomBytes(4).toString("hex")}`,
          requestHash: HASH,
          ...movement,
          delta,
        },
      });
    });
  const outflow = (
    company: FiscalCompany,
    productId: string,
    document: TestDocument,
    delta = "-2",
  ) =>
    append(company, productId, {
      movementType: "SALIDA_FACTURA",
      delta,
      documentId: document.id,
      documentNumber: document.documentNumber,
      origin: "SYSTEM",
      actorUserId: null,
      idempotencyOperation: null,
      idempotencyKey: null,
      requestHash: null,
    });

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < INVENTORY_MIGRATION)) execute(migration);

    // Una instalación con un producto ya marcado como controlado antes del inventario.
    await loadInstalledFiscalCatalogs(database.prisma);
    companyA = await insertFiscalCompany(database.prisma, "Inventario A", 1);
    companyB = await insertFiscalCompany(database.prisma, "Inventario B", 1);
    legacyProduct = await createProduct(companyA);
    invoiceA = await insertDocument(database.prisma, companyA, "AUTHORIZED");
    invoiceB = await insertDocument(database.prisma, companyB, "AUTHORIZED");

    execute(INVENTORY_MIGRATION);
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("los productos marcados antes del inventario quedan sin inicializar", async () => {
    expect(await database.prisma.stockBalance.count()).toBe(0);
    expect(await database.prisma.stockMovement.count()).toBe(0);
    const product = await database.prisma.product.findUniqueOrThrow({
      where: { id: legacyProduct },
    });
    expect(product.stockTracked).toBe(true);
  });

  it("un saldo sin INICIAL falla al confirmar, y un movimiento sin saldo se rechaza", async () => {
    const product = await createProduct(companyA);
    expect(
      await fails(
        database.prisma.stockBalance.create({
          data: {
            companyId: companyA.companyId,
            productId: product,
            balance: "0",
            lastPosition: 1,
            initializedBy: companyA.adminId,
          },
        }),
      ),
    ).toMatch(/no tiene su INICIAL/);
    expect(
      await fails(
        database.prisma.stockMovement.create({
          data: {
            companyId: companyA.companyId,
            productId: product,
            position: 1,
            movementType: "INICIAL",
            delta: "0",
            balanceAfter: "0",
            origin: "USER",
            actorUserId: companyA.adminId,
          },
        }),
      ),
    ).toMatch(/stock_movement_company_id_product_id_fkey|Foreign key/);
    expect(await database.prisma.stockBalance.count({ where: { productId: product } })).toBe(0);
  });

  it("inicializa con el INICIAL en la posición 1 y admite un solo INICIAL", async () => {
    const product = await createProduct(companyA);
    await initialize(companyA, product, "12.5");
    const balance = await database.prisma.stockBalance.findUniqueOrThrow({
      where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
    });
    expect(balance.balance.toFixed()).toBe("12.5");
    expect(await fails(initialize(companyA, product, "3"))).not.toBeNull();
    expect(
      await fails(
        append(companyA, product, {
          movementType: "INICIAL",
          delta: "3",
          idempotencyOperation: null,
          idempotencyKey: null,
          requestHash: null,
        }),
      ),
    ).toMatch(/stock_movement_values_check/);
    expect(
      await database.prisma.stockMovement.count({
        where: { productId: product, movementType: "INICIAL" },
      }),
    ).toBe(1);
  });

  it("cada movimiento encadena con el anterior y el saldo siempre coincide con el kárdex", async () => {
    const product = await createProduct(companyA);
    await initialize(companyA, product, "2");
    await append(companyA, product, { delta: "5" });
    expect(
      await fails(
        database.prisma.$transaction(async (tx) => {
          await tx.stockBalance.update({
            where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
            data: { balance: "8", lastPosition: 3 },
          });
          await tx.stockMovement.create({
            data: {
              companyId: companyA.companyId,
              productId: product,
              position: 3,
              movementType: "ENTRADA_MANUAL",
              delta: "1",
              balanceAfter: "99",
              origin: "USER",
              actorUserId: companyA.adminId,
              idempotencyOperation: "inventory.entry",
              idempotencyKey: "cadena-rota",
              requestHash: HASH,
            },
          });
        }),
      ),
    ).toMatch(/el saldo después del movimiento no es el anterior más su variación/);
    expect(
      await fails(
        database.prisma.stockMovement.create({
          data: {
            companyId: companyA.companyId,
            productId: product,
            position: 5,
            movementType: "ENTRADA_MANUAL",
            delta: "1",
            balanceAfter: "8",
            origin: "USER",
            actorUserId: companyA.adminId,
            idempotencyOperation: "inventory.entry",
            idempotencyKey: "con-hueco",
            requestHash: HASH,
          },
        }),
      ),
    ).toMatch(/no sigue a otro/);
    expect(
      await fails(
        database.prisma.stockMovement.create({
          data: {
            companyId: companyA.companyId,
            productId: product,
            position: 3,
            movementType: "ENTRADA_MANUAL",
            delta: "1",
            balanceAfter: "8",
            origin: "USER",
            actorUserId: companyA.adminId,
            idempotencyOperation: "inventory.entry",
            idempotencyKey: "sin-saldo",
            requestHash: HASH,
          },
        }),
      ),
    ).toMatch(/no está en su saldo/);
    expect(
      await fails(
        database.prisma.stockBalance.update({
          where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
          data: { balance: "100" },
        }),
      ),
    ).toMatch(/no coincide con su kárdex/);
    const balance = await database.prisma.stockBalance.findUniqueOrThrow({
      where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
    });
    expect([balance.balance.toFixed(), balance.lastPosition]).toEqual(["7", 2]);
  });

  it("una sola salida por factura y producto, del comprobante de la misma empresa", async () => {
    const product = await createProduct(companyA);
    await initialize(companyA, product, "1");
    await outflow(companyA, product, invoiceA, "-3");
    expect(await fails(outflow(companyA, product, invoiceA, "-3"))).toMatch(
      /stock_movement_document_product_type_key|Unique constraint/,
    );
    expect(await fails(outflow(companyA, product, invoiceB, "-1"))).toMatch(
      /stock_movement_company_id_document_id_fkey|Foreign key/,
    );
    const balance = await database.prisma.stockBalance.findUniqueOrThrow({
      where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
    });
    expect(balance.balance.toFixed()).toBe("-2");
  });

  it("el signo, el comprobante, el origen, el motivo y el dominio se comprueban por tipo", async () => {
    const product = await createProduct(companyA);
    await initialize(companyA, product, "5");
    const manual = { idempotencyOperation: null, idempotencyKey: null, requestHash: null };
    for (const [label, movement] of [
      ["entrada de cero", { delta: "0" }],
      ["entrada negativa", { delta: "-1" }],
      [
        "entrada con comprobante",
        { documentId: invoiceA.id, documentNumber: invoiceA.documentNumber },
      ],
      ["entrada sin clave", { ...manual }],
      ["entrada con la operación del ajuste", { idempotencyOperation: "inventory.adjust" }],
      ["entrada sin actor", { actorUserId: null }],
      ["entrada con siete decimales", { delta: "0.0000001" }],
      [
        "ajuste de cero",
        {
          movementType: "AJUSTE",
          delta: "0",
          reason: "Merma",
          idempotencyOperation: "inventory.adjust",
        },
      ],
      [
        "ajuste sin motivo",
        { movementType: "AJUSTE", delta: "-1", idempotencyOperation: "inventory.adjust" },
      ],
      [
        "ajuste con motivo vacío",
        {
          movementType: "AJUSTE",
          delta: "-1",
          reason: "  ",
          idempotencyOperation: "inventory.adjust",
        },
      ],
      [
        "salida positiva",
        {
          movementType: "SALIDA_FACTURA",
          delta: "1",
          documentId: invoiceA.id,
          documentNumber: invoiceA.documentNumber,
          origin: "SYSTEM",
          actorUserId: null,
          ...manual,
        },
      ],
      [
        "salida sin comprobante",
        {
          movementType: "SALIDA_FACTURA",
          delta: "-1",
          origin: "SYSTEM",
          actorUserId: null,
          ...manual,
        },
      ],
      [
        "salida de un usuario",
        {
          movementType: "SALIDA_FACTURA",
          delta: "-1",
          documentId: invoiceA.id,
          documentNumber: invoiceA.documentNumber,
          ...manual,
        },
      ],
      [
        "salida con número mal formado",
        {
          movementType: "SALIDA_FACTURA",
          delta: "-1",
          documentId: invoiceA.id,
          documentNumber: "001-001-12345678x",
          origin: "SYSTEM",
          actorUserId: null,
          ...manual,
        },
      ],
      ["tipo desconocido", { movementType: "TRASPASO" }],
    ] as [string, Movement][]) {
      // Siete decimales los rechaza antes el dominio del saldo.
      expect(await fails(append(companyA, product, movement)), label).toMatch(
        /stock_(movement|balance)_values_check/,
      );
    }
    expect(
      await fails(
        database.prisma.stockMovement.findMany({ where: { productId: product } }).then((rows) => {
          if (rows.length !== 1) throw new Error(`hay ${rows.length} movimientos`);
        }),
      ),
    ).toBeNull();
  });

  it("la idempotencia tiene alcance empresa, operación y clave", async () => {
    const productA = await createProduct(companyA);
    const productB = await createProduct(companyB);
    await initialize(companyA, productA, "0");
    await initialize(companyB, productB, "0");
    await append(companyA, productA, { idempotencyKey: "misma-clave" });
    expect(await fails(append(companyA, productA, { idempotencyKey: "misma-clave" }))).toMatch(
      /stock_movement_idempotency_key|Unique constraint/,
    );
    await append(companyA, productA, {
      movementType: "AJUSTE",
      delta: "-1",
      reason: "Merma",
      idempotencyOperation: "inventory.adjust",
      idempotencyKey: "misma-clave",
    });
    await append(companyB, productB, { idempotencyKey: "misma-clave" });
    expect(
      await database.prisma.stockMovement.count({ where: { idempotencyKey: "misma-clave" } }),
    ).toBe(3);
  });

  it("los movimientos no cambian, no se borran ni se truncan, y el saldo no se borra", async () => {
    const product = await createProduct(companyA);
    await initialize(companyA, product, "4");
    const [movement] = await database.prisma.stockMovement.findMany({
      where: { productId: product },
    });
    expect(
      await fails(
        database.prisma.stockMovement.update({
          where: { id: movement!.id },
          data: { reason: "x" },
        }),
      ),
    ).toMatch(/no admite UPDATE/);
    expect(
      await fails(database.prisma.stockMovement.delete({ where: { id: movement!.id } })),
    ).toMatch(/no admite DELETE/);
    expect(
      await fails(database.prisma.$executeRawUnsafe(`TRUNCATE "${name}"."stock_movement" CASCADE`)),
    ).toMatch(/no admite TRUNCATE/);
    expect(
      await fails(
        database.prisma.stockBalance.delete({
          where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
        }),
      ),
    ).toMatch(/no admite DELETE/);
    expect(
      await fails(
        database.prisma.stockBalance.update({
          where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
          data: { initializedBy: companyB.adminId },
        }),
      ),
    ).toMatch(/la inicialización de un inventario no cambian/);
    expect(
      await fails(
        database.prisma.stockBalance.update({
          where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
          data: { lastPosition: 0 },
        }),
      ),
    ).not.toBeNull();
  });

  it("un usuario con movimientos o que inicializó un inventario no se puede borrar", async () => {
    const { userId: memberId } = await insertMember(database.prisma, companyA.companyId, {
      name: "Ana Inventario",
      role: "ADMIN",
    });
    const product = await createProduct(companyA);
    await database.prisma.$transaction(async (tx) => {
      await tx.stockBalance.create({
        data: {
          companyId: companyA.companyId,
          productId: product,
          balance: "1",
          lastPosition: 1,
          initializedBy: memberId,
        },
      });
      await tx.stockMovement.create({
        data: {
          companyId: companyA.companyId,
          productId: product,
          position: 1,
          movementType: "INICIAL",
          delta: "1",
          balanceAfter: "1",
          origin: "USER",
          actorUserId: memberId,
        },
      });
    });
    expect(await fails(database.prisma.user.delete({ where: { id: memberId } }))).toMatch(
      /Foreign key|violates|RESTRICT|constraint/i,
    );
  });
});
