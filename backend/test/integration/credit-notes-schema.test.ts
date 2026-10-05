// Invariantes de la migración add_credit_notes en PostgreSQL (design D5, D7, D10, D22 y D25): la
// capacidad acreditable y la devolvible nacen de la factura autorizada y su salida, con su original
// inmutable y un CHECK que impide el exceso; las reservas son de solo agregado y solo pasan de
// RESERVED a APPLIED o RELEASED; los triggers diferidos exigen al confirmar que la capacidad sea la
// suma de sus reservas y que cada reserva corresponda al estado de su nota. Aplica las migraciones
// anteriores, crea facturas como en una instalación existente y después aplica la de las notas.
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDatabase, type Database } from "../../src/platform/db/database.ts";
import { TEST_DATABASE_URL, requireTestDatabase, runBin, withSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

const CREDIT_NOTES_MIGRATION = "20261008100000_add_credit_notes";
const MIGRATIONS = readdirSync(new URL("../../prisma/migrations/", import.meta.url))
  .filter((name) => /^\d{14}_/.test(name))
  .sort();

type Tx = Prisma.TransactionClient;
type NoteLine = { position: number; quantity: string; physicalReturn?: string };
type Return = { productId: string; quantity: string };

describe("notas de crédito en la base de datos", () => {
  const name = `t_credit_notes_schema_${randomBytes(4).toString("hex")}`;
  const url = withSchema(TEST_DATABASE_URL, name);
  let database: Database;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let productA: string;
  let productB: string;
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
  const createProduct = (company: FiscalCompany) =>
    database.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          companyId: company.companyId,
          kind: "GOOD",
          name: "Cemento 50 kg",
          unitPrice: "10.00",
          stockTracked: true,
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
  /** Factura autorizada con sus líneas en el snapshot: una de 10 unidades por defecto. */
  const invoice = (
    company: FiscalCompany,
    lines: { productId: string; quantity: string }[] = [{ productId: productA, quantity: "10" }],
    total = "115.00",
    state = "AUTHORIZED",
  ) =>
    insertDocument(database.prisma, company, state, {
      total,
      snapshot: {
        snapshotVersion: 2,
        lines: lines.map((line, index) => ({ position: index + 1, ...line })),
      },
    });
  const capacityKey = (company: FiscalCompany, invoiceId: string) => ({
    companyId_invoiceId: { companyId: company.companyId, invoiceId },
  });
  /** Inicialización perezosa de la capacidad desde la factura, como la hará el repositorio. */
  const initialize = async (tx: Tx, company: FiscalCompany, target: TestDocument) => {
    const snapshot = target.snapshot as {
      lines: { position: number; productId: string; quantity: string }[];
    };
    await tx.creditCapacity.createMany({
      data: [{ companyId: company.companyId, invoiceId: target.id, originalTotal: target.total }],
      skipDuplicates: true,
    });
    await tx.creditCapacityLine.createMany({
      data: snapshot.lines.map((line) => ({
        companyId: company.companyId,
        invoiceId: target.id,
        position: line.position,
        productId: line.productId,
        originalQuantity: line.quantity,
      })),
      skipDuplicates: true,
    });
  };
  /** Capacidad devolvible de la factura y producto desde su salida, si falta. */
  const initializeReturn = (
    tx: Tx,
    company: FiscalCompany,
    invoiceId: string,
    ret: Return,
    original: string,
  ) =>
    tx.stockReturnCapacity.createMany({
      data: [
        {
          companyId: company.companyId,
          invoiceId,
          productId: ret.productId,
          originalQuantity: original,
        },
      ],
      skipDuplicates: true,
    });
  /** Reserva completa de una nota, en la transacción de la nota: capacidad y reservas juntas. */
  const reserveIn = async (
    tx: Tx,
    company: FiscalCompany,
    target: TestDocument,
    noteId: string,
    input: { amount: string; lines: NoteLine[]; returns?: Return[]; returnOriginal?: string },
  ) => {
    await initialize(tx, company, target);
    await tx.creditCapacity.update({
      where: capacityKey(company, target.id),
      data: { reservedTotal: { increment: input.amount } },
    });
    for (const line of input.lines) {
      await tx.creditCapacityLine.update({
        where: {
          companyId_invoiceId_position: {
            companyId: company.companyId,
            invoiceId: target.id,
            position: line.position,
          },
        },
        data: { reservedQuantity: { increment: line.quantity } },
      });
    }
    const reservation = await tx.creditReservation.create({
      data: {
        companyId: company.companyId,
        invoiceId: target.id,
        creditNoteId: noteId,
        cause: "RETURN",
        amount: input.amount,
      },
    });
    await tx.creditReservationLine.createMany({
      data: input.lines.map((line) => ({
        reservationId: reservation.id,
        companyId: company.companyId,
        invoiceId: target.id,
        position: line.position,
        quantity: line.quantity,
        subtotal: "10.000000",
        discount: "0.00",
        taxableBase: "10.00",
        taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: "10.00", amount: "1.50" }],
        physicalReturn: line.physicalReturn ?? "0",
      })),
    });
    for (const ret of input.returns ?? []) {
      await initializeReturn(tx, company, target.id, ret, input.returnOriginal ?? "0");
      await tx.stockReturnCapacity.update({
        where: {
          companyId_invoiceId_productId: {
            companyId: company.companyId,
            invoiceId: target.id,
            productId: ret.productId,
          },
        },
        data: { reservedQuantity: { increment: ret.quantity } },
      });
      await tx.stockReturnReservation.create({
        data: {
          companyId: company.companyId,
          creditNoteId: noteId,
          productId: ret.productId,
          invoiceId: target.id,
          quantity: ret.quantity,
        },
      });
    }
  };
  /** Nota de crédito en `state` con su reserva, todo en una transacción. */
  const note = (
    company: FiscalCompany,
    target: TestDocument,
    input: { amount: string; lines: NoteLine[]; returns?: Return[]; returnOriginal?: string },
    state = "RECEIVED",
  ) =>
    insertDocument(database.prisma, company, state, {
      documentType: "04",
      total: input.amount,
      alongside: (tx, document) => reserveIn(tx, company, target, document.id, input),
    });
  /** Transición terminal coherente: la nota y sus reservas juntas (design D25). */
  const conclude = (
    company: FiscalCompany,
    target: TestDocument,
    noteDoc: TestDocument,
    to: "AUTHORIZED" | "NOT_AUTHORIZED",
    lines: NoteLine[],
  ) =>
    database.prisma.$transaction(async (tx) => {
      const applied = to === "AUTHORIZED";
      await tx.electronicDocument.update({
        where: { id: noteDoc.id },
        data: applied
          ? {
              state: to,
              authorizationNumber: noteDoc.accessKey,
              authorizationDate: new Date(),
              authorizationEnvironment: noteDoc.environment,
            }
          : { state: to },
      });
      const reservation = await tx.creditReservation.update({
        where: {
          companyId_creditNoteId: { companyId: company.companyId, creditNoteId: noteDoc.id },
        },
        data: { status: applied ? "APPLIED" : "RELEASED", concludedAt: new Date() },
      });
      await tx.creditCapacity.update({
        where: capacityKey(company, target.id),
        data: {
          reservedTotal: { decrement: reservation.amount },
          ...(applied ? { appliedTotal: { increment: reservation.amount } } : {}),
        },
      });
      for (const line of lines) {
        await tx.creditCapacityLine.update({
          where: {
            companyId_invoiceId_position: {
              companyId: company.companyId,
              invoiceId: target.id,
              position: line.position,
            },
          },
          data: {
            reservedQuantity: { decrement: line.quantity },
            ...(applied ? { appliedQuantity: { increment: line.quantity } } : {}),
          },
        });
      }
    });
  const capacity = (company: FiscalCompany, invoiceId: string) =>
    database.prisma.creditCapacity.findUniqueOrThrow({
      where: capacityKey(company, invoiceId),
      include: { lines: true },
    });
  const notes = () => database.prisma.electronicDocument.count({ where: { documentType: "04" } });

  beforeAll(async () => {
    await requireTestDatabase();
    database = createDatabase(url);
    await database.prisma.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    for (const migration of MIGRATIONS.filter((m) => m < CREDIT_NOTES_MIGRATION)) {
      execute(migration);
    }

    // Una instalación con facturas autorizadas antes de las notas de crédito.
    await loadInstalledFiscalCatalogs(database.prisma);
    companyA = await insertFiscalCompany(database.prisma, "Notas A", 1);
    companyB = await insertFiscalCompany(database.prisma, "Notas B", 1);
    productA = await createProduct(companyA);
    productB = await createProduct(companyB);
    legacyInvoice = await invoice(companyA);

    execute(CREDIT_NOTES_MIGRATION);
  });

  afterAll(async () => {
    await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
    await database.close();
  });

  it("las facturas existentes no cambian y su capacidad no existe hasta su primera nota", async () => {
    expect(await database.prisma.creditCapacity.count()).toBe(0);
    expect(await database.prisma.stockReturnCapacity.count()).toBe(0);
    const unchanged = await database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: legacyInvoice.id },
    });
    expect(unchanged).toEqual(legacyInvoice);

    await note(companyA, legacyInvoice, {
      amount: "11.50",
      lines: [{ position: 1, quantity: "1" }],
    });
    const created = await capacity(companyA, legacyInvoice.id);
    expect([created.originalTotal.toFixed(), created.reservedTotal.toFixed()]).toEqual([
      "115",
      "11.5",
    ]);
    expect(
      created.lines.map((line) => [
        line.originalQuantity.toFixed(),
        line.reservedQuantity.toFixed(),
      ]),
    ).toEqual([["10", "1"]]);
  });

  it("la capacidad nace de una factura propia autorizada, con su total y sus líneas", async () => {
    const received = await invoice(companyA, undefined, "115.00", "RECEIVED");
    const authorized = await invoice(companyA);
    const create = (invoiceId: string, originalTotal: string) =>
      database.prisma.creditCapacity.create({
        data: { companyId: companyA.companyId, invoiceId, originalTotal },
      });
    expect(await fails(create(received.id, "115.00"))).toMatch(/nace de una factura autorizada/);
    expect(await fails(create(authorized.id, "100.00"))).toMatch(/nace de una factura autorizada/);
    await create(authorized.id, "115.00");
    const line = (position: number, productId: string, originalQuantity: string) =>
      database.prisma.creditCapacityLine.create({
        data: {
          companyId: companyA.companyId,
          invoiceId: authorized.id,
          position,
          productId,
          originalQuantity,
        },
      });
    expect(await fails(line(1, productA, "9"))).toMatch(/no es la de la factura/);
    expect(await fails(line(2, productA, "10"))).toMatch(/no es la de la factura/);
    expect(await fails(line(1, productB, "10"))).not.toBeNull();
    await line(1, productA, "10");
  });

  it("un exceso de capacidad viola el CHECK y revierte la nota entera", async () => {
    const target = await invoice(companyA);
    await note(companyA, target, { amount: "69.00", lines: [{ position: 1, quantity: "6" }] });
    const before = await notes();
    expect(
      await fails(
        note(companyA, target, { amount: "57.50", lines: [{ position: 1, quantity: "5" }] }),
      ),
    ).toMatch(/credit_capacity_values_check/);
    expect(
      await fails(
        note(companyA, target, { amount: "46.00", lines: [{ position: 1, quantity: "5" }] }),
      ),
    ).toMatch(/credit_capacity_line_values_check/);
    expect(await notes()).toBe(before);
    expect((await capacity(companyA, target.id)).reservedTotal.toFixed()).toBe("69");
    await note(companyA, target, { amount: "46.00", lines: [{ position: 1, quantity: "4" }] });
    const full = await capacity(companyA, target.id);
    expect([full.reservedTotal.toFixed(), full.lines[0]!.reservedQuantity.toFixed()]).toEqual([
      "115",
      "10",
    ]);
  });

  it("el original de la capacidad no cambia y la capacidad no se borra", async () => {
    const target = await invoice(companyA);
    await note(companyA, target, { amount: "11.50", lines: [{ position: 1, quantity: "1" }] });
    expect(
      await fails(
        database.prisma.creditCapacity.update({
          where: capacityKey(companyA, target.id),
          data: { originalTotal: "200.00" },
        }),
      ),
    ).toMatch(/no cambia/);
    expect(
      await fails(
        database.prisma.creditCapacityLine.updateMany({
          where: { invoiceId: target.id },
          data: { originalQuantity: "20" },
        }),
      ),
    ).toMatch(/no cambia/);
    expect(
      await fails(
        database.prisma.creditCapacityLine.deleteMany({ where: { invoiceId: target.id } }),
      ),
    ).toMatch(/no admite DELETE/);
    expect(
      await fails(
        database.prisma.creditCapacity.delete({ where: capacityKey(companyA, target.id) }),
      ),
    ).toMatch(/no admite DELETE/);
  });

  it("una reserva solo pasa de RESERVED a APPLIED o RELEASED, no vuelve, no cambia y no se borra", async () => {
    const target = await invoice(companyA);
    const lines = [{ position: 1, quantity: "2" }];
    const applied = await note(companyA, target, { amount: "23.00", lines });
    const released = await note(companyA, target, { amount: "23.00", lines });
    await conclude(companyA, target, applied, "AUTHORIZED", lines);
    await conclude(companyA, target, released, "NOT_AUTHORIZED", lines);
    const after = await capacity(companyA, target.id);
    expect([after.reservedTotal.toFixed(), after.appliedTotal.toFixed()]).toEqual(["0", "23"]);
    expect([
      after.lines[0]!.reservedQuantity.toFixed(),
      after.lines[0]!.appliedQuantity.toFixed(),
    ]).toEqual(["0", "2"]);

    const update = (creditNoteId: string, data: Prisma.CreditReservationUpdateInput) =>
      database.prisma.creditReservation.update({
        where: { companyId_creditNoteId: { companyId: companyA.companyId, creditNoteId } },
        data,
      });
    expect(await fails(update(applied.id, { status: "RESERVED", concludedAt: null }))).toMatch(
      /solo pasa de RESERVED/,
    );
    expect(await fails(update(applied.id, { status: "RELEASED" }))).toMatch(
      /solo pasa de RESERVED/,
    );
    expect(await fails(update(released.id, { status: "APPLIED" }))).toMatch(
      /solo pasa de RESERVED/,
    );
    expect(await fails(update(applied.id, { amount: "1.00" }))).toMatch(/solo cambia su estado/);
    expect(await fails(update(applied.id, { concludedAt: new Date() }))).toMatch(
      /concluida no cambia/,
    );
    expect(
      await fails(
        database.prisma.creditReservation.deleteMany({ where: { creditNoteId: released.id } }),
      ),
    ).toMatch(/no admite DELETE/);
    expect(
      await fails(
        database.prisma.creditReservationLine.updateMany({
          where: { invoiceId: target.id },
          data: { quantity: "1" },
        }),
      ),
    ).toMatch(/no admite UPDATE/);
    expect(
      await fails(
        database.prisma.creditReservationLine.deleteMany({ where: { invoiceId: target.id } }),
      ),
    ).toMatch(/no admite DELETE/);
  });

  it("una reserva nace RESERVED y para una nota de crédito", async () => {
    const target = await invoice(companyA);
    const other = await invoice(companyA);
    expect(
      await fails(
        database.prisma.$transaction(async (tx) => {
          await initialize(tx, companyA, target);
          await tx.creditReservation.create({
            data: {
              companyId: companyA.companyId,
              invoiceId: target.id,
              creditNoteId: other.id,
              cause: "RETURN",
              amount: "0.00",
            },
          });
        }),
      ),
    ).toMatch(/es de una nota de crédito/);
    expect(
      await fails(
        insertDocument(database.prisma, companyA, "RECEIVED", {
          documentType: "04",
          alongside: async (tx, document) => {
            await initialize(tx, companyA, target);
            await tx.creditReservation.create({
              data: {
                companyId: companyA.companyId,
                invoiceId: target.id,
                creditNoteId: document.id,
                cause: "RETURN",
                amount: "0.00",
                status: "APPLIED",
                concludedAt: new Date(),
              },
            });
          },
        }),
      ),
    ).toMatch(/nace RESERVED/);
  });

  describe("triggers diferidos al confirmar (design D7 y D25)", () => {
    it("la capacidad acreditable sin su reserva, o la reserva sin su capacidad, falla", async () => {
      const target = await invoice(companyA);
      const before = await notes();
      expect(
        await fails(
          database.prisma.$transaction(async (tx) => {
            await initialize(tx, companyA, target);
            await tx.creditCapacity.update({
              where: capacityKey(companyA, target.id),
              data: { reservedTotal: { increment: "11.50" } },
            });
          }),
        ),
      ).toMatch(/no es la suma de sus reservas/);
      expect(
        await fails(
          insertDocument(database.prisma, companyA, "RECEIVED", {
            documentType: "04",
            alongside: async (tx, document) => {
              await initialize(tx, companyA, target);
              const reservation = await tx.creditReservation.create({
                data: {
                  companyId: companyA.companyId,
                  invoiceId: target.id,
                  creditNoteId: document.id,
                  cause: "RETURN",
                  amount: "11.50",
                },
              });
              await tx.creditReservationLine.create({
                data: {
                  reservationId: reservation.id,
                  companyId: companyA.companyId,
                  invoiceId: target.id,
                  position: 1,
                  quantity: "1",
                  subtotal: "10",
                  discount: "0.00",
                  taxableBase: "10.00",
                  taxes: [],
                  physicalReturn: "0",
                },
              });
            },
          }),
        ),
      ).toMatch(/no es la suma de sus reservas/);
      expect(await notes()).toBe(before);
    });

    it("una línea de la capacidad que no es la suma de sus reservas falla", async () => {
      const target = await invoice(companyA);
      expect(
        await fails(
          insertDocument(database.prisma, companyA, "RECEIVED", {
            documentType: "04",
            total: "11.50",
            alongside: async (tx, document) => {
              await reserveIn(tx, companyA, target, document.id, {
                amount: "11.50",
                lines: [{ position: 1, quantity: "1" }],
              });
              await tx.creditCapacityLine.updateMany({
                where: { invoiceId: target.id },
                data: { reservedQuantity: { increment: "1" } },
              });
            },
          }),
        ),
      ).toMatch(/línea 1 de la capacidad acreditable no es la suma/);
    });

    it("una reserva aplicada o liberada exige su nota autorizada, o devuelta o no autorizada", async () => {
      const target = await invoice(companyA);
      const lines = [{ position: 1, quantity: "1" }];
      const pending = await note(companyA, target, { amount: "11.50", lines });
      const move = (status: "APPLIED" | "RELEASED") =>
        database.prisma.$transaction(async (tx) => {
          await tx.creditReservation.update({
            where: {
              companyId_creditNoteId: { companyId: companyA.companyId, creditNoteId: pending.id },
            },
            data: { status, concludedAt: new Date() },
          });
          await tx.creditCapacity.update({
            where: capacityKey(companyA, target.id),
            data: {
              reservedTotal: { decrement: "11.50" },
              ...(status === "APPLIED" ? { appliedTotal: { increment: "11.50" } } : {}),
            },
          });
          await tx.creditCapacityLine.updateMany({
            where: { invoiceId: target.id },
            data: {
              reservedQuantity: { decrement: "1" },
              ...(status === "APPLIED" ? { appliedQuantity: { increment: "1" } } : {}),
            },
          });
        });
      expect(await fails(move("APPLIED"))).toMatch(/no corresponde a su estado RECEIVED/);
      expect(await fails(move("RELEASED"))).toMatch(/no corresponde a su estado RECEIVED/);
      // Con la nota y su reserva juntas, la misma transición se confirma.
      await conclude(companyA, target, pending, "NOT_AUTHORIZED", lines);
    });

    it("una nota terminal con capacidad reservada, o una nota sin su reserva, falla", async () => {
      const target = await invoice(companyA);
      const pending = await note(companyA, target, {
        amount: "11.50",
        lines: [{ position: 1, quantity: "1" }],
      });
      expect(
        await fails(
          database.prisma.electronicDocument.update({
            where: { id: pending.id },
            data: { state: "NOT_AUTHORIZED" },
          }),
        ),
      ).toMatch(/terminó con capacidad reservada/);
      expect(
        await fails(
          database.prisma.electronicDocument.update({
            where: { id: pending.id },
            data: {
              state: "AUTHORIZED",
              authorizationNumber: pending.accessKey,
              authorizationDate: new Date(),
              authorizationEnvironment: pending.environment,
            },
          }),
        ),
      ).toMatch(/terminó con capacidad reservada/);
      // En verificación o en revisión manual la capacidad sigue reservada (design D7).
      await database.prisma.electronicDocument.update({
        where: { id: pending.id },
        data: { state: "MANUAL_REVIEW" },
      });
      expect(
        await fails(insertDocument(database.prisma, companyA, "RECEIVED", { documentType: "04" })),
      ).toMatch(/no tiene su reserva acreditable/);
    });

    it("sin salida de la factura, la capacidad devolvible es cero y cualquier retorno se rechaza", async () => {
      const target = await invoice(companyA);
      expect(
        await fails(
          note(companyA, target, {
            amount: "11.50",
            lines: [{ position: 1, quantity: "1", physicalReturn: "1" }],
            returns: [{ productId: productA, quantity: "1" }],
          }),
        ),
      ).toMatch(/stock_return_capacity_values_check/);
    });
  });

  describe("capacidad devolvible desde la salida de la factura (design D10)", () => {
    /** Producto con inventario y una factura con su SALIDA_FACTURA de `quantity`. */
    const invoiceWithOutflow = async (quantity: string) => {
      const product = await createProduct(companyA);
      const target = await invoice(companyA, [{ productId: product, quantity }]);
      await database.prisma.$transaction(async (tx) => {
        await tx.stockBalance.create({
          data: {
            companyId: companyA.companyId,
            productId: product,
            balance: "100",
            lastPosition: 1,
            initializedBy: companyA.adminId,
          },
        });
        await tx.stockMovement.create({
          data: {
            companyId: companyA.companyId,
            productId: product,
            position: 1,
            movementType: "INICIAL",
            delta: "100",
            balanceAfter: "100",
            origin: "USER",
            actorUserId: companyA.adminId,
          },
        });
      });
      await database.prisma.$transaction(async (tx) => {
        await tx.stockBalance.update({
          where: { companyId_productId: { companyId: companyA.companyId, productId: product } },
          data: { balance: { decrement: quantity }, lastPosition: 2 },
        });
        await tx.stockMovement.create({
          data: {
            companyId: companyA.companyId,
            productId: product,
            position: 2,
            movementType: "SALIDA_FACTURA",
            delta: `-${quantity}`,
            balanceAfter: (100 - Number(quantity)).toString(),
            documentId: target.id,
            documentNumber: target.documentNumber,
            origin: "SYSTEM",
          },
        });
      });
      return { product, target };
    };

    it("nace con la salida original y nunca la supera, independiente de lo acreditado", async () => {
      const { product, target } = await invoiceWithOutflow("10");
      expect(
        await fails(
          database.prisma.stockReturnCapacity.create({
            data: {
              companyId: companyA.companyId,
              invoiceId: target.id,
              productId: product,
              originalQuantity: "9",
            },
          }),
        ),
      ).toMatch(/nace de la salida/);
      // Factura de 10 con salida de 10: la nota acredita 5 con retorno físico 2.
      const lines = [{ position: 1, quantity: "5", physicalReturn: "2" }];
      const first = await note(companyA, target, {
        amount: "57.50",
        lines,
        returns: [{ productId: product, quantity: "2" }],
        returnOriginal: "10",
      });
      await database.prisma.$transaction(async (tx) => {
        await tx.electronicDocument.update({
          where: { id: first.id },
          data: {
            state: "AUTHORIZED",
            authorizationNumber: first.accessKey,
            authorizationDate: new Date(),
            authorizationEnvironment: first.environment,
          },
        });
        await tx.creditReservation.updateMany({
          where: { creditNoteId: first.id },
          data: { status: "APPLIED", concludedAt: new Date() },
        });
        await tx.creditCapacity.update({
          where: capacityKey(companyA, target.id),
          data: { reservedTotal: { decrement: "57.50" }, appliedTotal: { increment: "57.50" } },
        });
        await tx.creditCapacityLine.updateMany({
          where: { invoiceId: target.id },
          data: { reservedQuantity: { decrement: "5" }, appliedQuantity: { increment: "5" } },
        });
        await tx.stockReturnReservation.updateMany({
          where: { creditNoteId: first.id },
          data: { status: "APPLIED", concludedAt: new Date() },
        });
        await tx.stockReturnCapacity.updateMany({
          where: { invoiceId: target.id },
          data: { reservedQuantity: { decrement: "2" }, appliedQuantity: { increment: "2" } },
        });
      });
      const credit = await capacity(companyA, target.id);
      const returnable = await database.prisma.stockReturnCapacity.findFirstOrThrow({
        where: { invoiceId: target.id },
      });
      const remaining = (
        original: Prisma.Decimal,
        reserved: Prisma.Decimal,
        applied: Prisma.Decimal,
      ) => original.minus(reserved).minus(applied).toFixed();
      // Quedan 5 acreditables y 8 devolvibles.
      expect(
        remaining(
          credit.lines[0]!.originalQuantity,
          credit.lines[0]!.reservedQuantity,
          credit.lines[0]!.appliedQuantity,
        ),
      ).toBe("5");
      expect(
        remaining(
          returnable.originalQuantity,
          returnable.reservedQuantity,
          returnable.appliedQuantity,
        ),
      ).toBe("8");
      expect(
        await fails(
          note(companyA, target, {
            amount: "57.50",
            lines: [{ position: 1, quantity: "5", physicalReturn: "5" }],
            returns: [{ productId: product, quantity: "9" }],
            returnOriginal: "10",
          }),
        ),
      ).toMatch(/stock_return_capacity_values_check/);
    });

    it("la capacidad devolvible sin su reserva falla al confirmar", async () => {
      const { product, target } = await invoiceWithOutflow("3");
      expect(
        await fails(
          database.prisma.$transaction(async (tx) => {
            await initializeReturn(
              tx,
              companyA,
              target.id,
              { productId: product, quantity: "1" },
              "3",
            );
            await tx.stockReturnCapacity.updateMany({
              where: { invoiceId: target.id },
              data: { reservedQuantity: { increment: "1" } },
            });
          }),
        ),
      ).toMatch(/capacidad devolvible del producto .* no es la suma de sus reservas/);
    });

    it("una reserva devolvible aplicada exige su nota autorizada, y una nota terminal no la deja reservada", async () => {
      const { product, target } = await invoiceWithOutflow("4");
      const pending = await note(companyA, target, {
        amount: "11.50",
        lines: [{ position: 1, quantity: "1", physicalReturn: "1" }],
        returns: [{ productId: product, quantity: "1" }],
        returnOriginal: "4",
      });
      expect(
        await fails(
          database.prisma.$transaction(async (tx) => {
            await tx.stockReturnReservation.updateMany({
              where: { creditNoteId: pending.id },
              data: { status: "APPLIED", concludedAt: new Date() },
            });
            await tx.stockReturnCapacity.updateMany({
              where: { invoiceId: target.id },
              data: { reservedQuantity: { decrement: "1" }, appliedQuantity: { increment: "1" } },
            });
          }),
        ),
      ).toMatch(/no corresponde a su estado RECEIVED/);
      // La acreditable liberada sin liberar la devolvible deja la nota con capacidad reservada.
      expect(
        await fails(
          conclude(companyA, target, pending, "NOT_AUTHORIZED", [{ position: 1, quantity: "1" }]),
        ),
      ).toMatch(/terminó con capacidad reservada/);
      expect(
        await fails(
          database.prisma.stockReturnReservation.deleteMany({
            where: { creditNoteId: pending.id },
          }),
        ),
      ).toMatch(/no admite DELETE/);
    });
  });

  describe("empresas y borradores", () => {
    it("rechaza capacidades y reservas sobre la factura de otra empresa", async () => {
      const foreign = await invoice(companyA);
      expect(
        await fails(
          database.prisma.creditCapacity.create({
            data: { companyId: companyB.companyId, invoiceId: foreign.id, originalTotal: "115.00" },
          }),
        ),
      ).toMatch(/foreign key|Foreign key|nace de una factura/);
      expect(
        await fails(
          database.prisma.stockReturnCapacity.create({
            data: {
              companyId: companyB.companyId,
              invoiceId: foreign.id,
              productId: productB,
              originalQuantity: "0",
            },
          }),
        ),
      ).not.toBeNull();
      // Una nota de B no reserva la capacidad de una factura de A.
      expect(
        await fails(
          insertDocument(database.prisma, companyB, "RECEIVED", {
            documentType: "04",
            total: "11.50",
            alongside: (tx, document) =>
              reserveIn(tx, companyB, foreign, document.id, {
                amount: "11.50",
                lines: [{ position: 1, quantity: "1" }],
              }),
          }),
        ),
      ).not.toBeNull();
      expect(
        await database.prisma.creditCapacity.count({ where: { companyId: companyB.companyId } }),
      ).toBe(0);
    });

    it("admite la operación credit_note.emit en el registro de idempotencia", async () => {
      const target = await invoice(companyA);
      const created = await note(companyA, target, {
        amount: "11.50",
        lines: [{ position: 1, quantity: "1" }],
      });
      const record = (operation: string, idempotencyKey: string) =>
        database.prisma.idempotencyRecord.create({
          data: {
            companyId: companyA.companyId,
            operation,
            idempotencyKey,
            requestFingerprint: "b".repeat(64),
            documentId: created.id,
            createdBy: companyA.adminId,
          },
        });
      await record("credit_note.emit", "nota-1");
      expect(await fails(record("credit_note.void", "nota-2"))).toMatch(
        /idempotency_record_values_check/,
      );
    });

    it("valida el borrador y lo deja inmutable al emitirse", async () => {
      const target = await invoice(companyA);
      const draft = (data: Partial<Prisma.CreditNoteDraftUncheckedCreateInput>) =>
        database.prisma.creditNoteDraft.create({
          data: {
            companyId: companyA.companyId,
            invoiceId: target.id,
            cause: "RETURN",
            createdBy: companyA.adminId,
            updatedBy: companyA.adminId,
            ...data,
          },
        });
      expect(await fails(draft({ cause: "DISCOUNT" }))).toMatch(/credit_note_draft_values_check/);
      expect(await fails(draft({ reason: "dos\nlíneas" }))).toMatch(
        /credit_note_draft_values_check/,
      );
      expect(await fails(draft({ reason: "x".repeat(301) }))).toMatch(
        /credit_note_draft_values_check/,
      );
      expect(await fails(draft({ reason: "   " }))).toMatch(/credit_note_draft_values_check/);
      expect(
        await fails(
          draft({
            companyId: companyB.companyId,
            createdBy: companyB.adminId,
            updatedBy: companyB.adminId,
          }),
        ),
      ).toMatch(/foreign key|Foreign key/);
      const created = await draft({ reason: "Devolución de mercadería" });
      const line = (quantity: string, physicalReturn: string, position = 1) =>
        database.prisma.creditNoteDraftLine.create({
          data: {
            draftId: created.id,
            companyId: companyA.companyId,
            position,
            quantity,
            physicalReturn,
          },
        });
      expect(await fails(line("1", "2"))).toMatch(/credit_note_draft_line_values_check/);
      expect(await fails(line("1.0000001", "0"))).toMatch(/credit_note_draft_line_values_check/);
      await line("2", "1");

      const emitted = await note(companyA, target, {
        amount: "23.00",
        lines: [{ position: 1, quantity: "2" }],
      });
      await database.prisma.creditNoteDraft.update({
        where: { id: created.id },
        data: { status: "EMITTED", documentId: emitted.id },
      });
      expect(
        await fails(
          database.prisma.creditNoteDraft.update({
            where: { id: created.id },
            data: { reason: "Otro" },
          }),
        ),
      ).toMatch(/emitido no cambia/);
      expect(await fails(line("1", "0", 2))).toMatch(/emitido no cambia/);
      expect(
        await fails(database.prisma.creditNoteDraft.delete({ where: { id: created.id } })),
      ).toMatch(/emitido no cambia/);
    });
  });
});
