// Repositorio de la capacidad acreditable (add-credit-notes, tarea 6.2, design D7 y D8) sobre
// PostgreSQL: inicialización perezosa e idempotente, bloqueo de la factura, reserva con incrementos
// atómicos que la base rechaza al excederse, lectura de lo acreditado vigente, aplicación y
// liberación guardadas por estado, y la reconciliación diagnóstica sin diferencias.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  CreditCapacityExceededError,
  type CreditOutcome,
} from "../../src/modules/credit-notes/application/ports.ts";
import { createCreditCapacityRepository } from "../../src/modules/credit-notes/infrastructure/prisma-credit-capacity.ts";
import { reconcileCreditCapacity } from "../../src/modules/credit-notes/infrastructure/reconciliation.ts";
import {
  insertAuthorizedInvoice,
  type AuthorizedInvoiceDocument,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  deferred,
  insertFiscalCompany,
  stillPending,
  type FiscalCompany,
} from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

type Line = { position: number; quantity: string };

describe("repositorio de la capacidad acreditable", () => {
  let db: MigratedSchema;
  let company: FiscalCompany;
  let product: string;
  const invoiceCompany = (): InvoiceCompany => ({
    companyId: company.companyId,
    adminId: company.adminId,
    establishmentId: company.points[0]!.establishmentId,
    emissionPointId: company.points[0]!.emissionPointId,
  });
  /** Factura de 10 × 10.00 con IVA 15 % (115.00) y otra línea de 2 × 5.00 (11.50). */
  const invoice = () =>
    insertAuthorizedInvoice(db.database.prisma, invoiceCompany(), [
      { productId: product, quantity: "10", unitPrice: "10.00" },
      { productId: product, quantity: "2", unitPrice: "5.00" },
    ]);
  const initializeIn = (tx: Prisma.TransactionClient, target: AuthorizedInvoiceDocument) =>
    createCreditCapacityRepository(tx).initialize({
      companyId: company.companyId,
      invoiceId: target.id,
      total: target.total,
      lines: target.snapshot.lines.map(({ position, productId, quantity }) => ({
        position,
        productId,
        quantity,
      })),
    });
  /** Nota en `state` con su reserva en la misma transacción, como la emisión. */
  const note = (
    target: AuthorizedInvoiceDocument,
    amount: string,
    lines: Line[],
    state = "RECEIVED",
    cause: "RETURN" | "TOTAL_ANNULMENT" = "RETURN",
  ) =>
    insertDocument(db.database.prisma, company, state, {
      documentType: "04",
      total: amount,
      alongside: async (tx, document) => {
        const repository = createCreditCapacityRepository(tx);
        await repository.lock(company.companyId, target.id);
        await initializeIn(tx, target);
        await repository.reserve({
          companyId: company.companyId,
          invoiceId: target.id,
          amount,
          lines,
        });
        await repository.record({
          companyId: company.companyId,
          invoiceId: target.id,
          creditNoteId: document.id,
          cause,
          amount,
          lines: lines.map((line) => ({
            ...line,
            subtotal: "10",
            discount: "0.00",
            taxableBase: "10.00",
            taxes: [
              { taxCode: "2", rateCode: "4", percentage: "15", base: "10.00", amount: "1.50" },
            ],
            physicalReturn: "0",
          })),
        });
      },
    });
  /** Transición terminal de la nota y su reserva, en una transacción (design D25). */
  const conclude = (doc: TestDocument, to: "AUTHORIZED" | "NOT_AUTHORIZED" | "RETURNED") =>
    db.database.prisma.$transaction(async (tx) => {
      await tx.electronicDocument.update({
        where: { id: doc.id },
        data:
          to === "AUTHORIZED"
            ? {
                state: to,
                authorizationNumber: doc.accessKey,
                authorizationDate: new Date(),
                authorizationEnvironment: doc.environment,
              }
            : { state: to },
      });
      const outcome: CreditOutcome = to === "AUTHORIZED" ? "APPLIED" : "RELEASED";
      return createCreditCapacityRepository(tx).conclude(
        company.companyId,
        doc.id,
        outcome,
        new Date(),
      );
    });
  const read = (invoiceId: string) =>
    createCreditCapacityRepository(db.database.prisma).read(company.companyId, invoiceId);
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error,
    );

  beforeAll(async () => {
    db = await createMigratedSchema("credit_capacity_repository");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    company = await insertFiscalCompany(db.database.prisma, "Capacidad", 1);
    product = await insertProduct(db.database.prisma, company);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("sin notas no hay capacidad; la inicialización repetida no duplica filas", async () => {
    const target = await invoice();
    expect(await read(target.id)).toEqual({
      exists: false,
      reserved: "0",
      applied: "0",
      lines: [],
      credited: [],
    });
    await db.database.prisma.$transaction(async (tx) => {
      await initializeIn(tx, target);
      await initializeIn(tx, target);
    });
    await db.database.prisma.$transaction((tx) => initializeIn(tx, target));
    const state = await read(target.id);
    expect(state.exists).toBe(true);
    expect(state.lines.map((l) => [l.position, l.original, l.reserved, l.applied])).toEqual([
      [1, "10", "0", "0"],
      [2, "2", "0", "0"],
    ]);
    expect(await db.database.prisma.creditCapacity.count({ where: { invoiceId: target.id } })).toBe(
      1,
    );
  });

  it("la base rechaza un exceso de cantidad o de importe y la nota no queda", async () => {
    const target = await invoice();
    await note(target, "69.00", [{ position: 1, quantity: "6" }]);
    const before = await db.database.prisma.electronicDocument.count({
      where: { documentType: "04" },
    });
    const quantity = await fails(note(target, "46.00", [{ position: 1, quantity: "5" }]));
    expect(quantity).toBeInstanceOf(CreditCapacityExceededError);
    expect((quantity as CreditCapacityExceededError).kind).toBe("QUANTITY");
    const amount = await fails(note(target, "58.00", [{ position: 1, quantity: "4" }]));
    expect((amount as CreditCapacityExceededError).kind).toBe("AMOUNT");
    expect(
      await db.database.prisma.electronicDocument.count({ where: { documentType: "04" } }),
    ).toBe(before);
    const state = await read(target.id);
    expect([state.reserved, state.lines[0]!.reserved]).toEqual(["69", "6"]);
  });

  it("una anulación total con crédito previo excede la capacidad y se rechaza", async () => {
    const target = await invoice();
    await note(target, "11.50", [{ position: 1, quantity: "1" }]);
    const annulment = await fails(
      note(
        target,
        target.total,
        [
          { position: 1, quantity: "10" },
          { position: 2, quantity: "2" },
        ],
        "RECEIVED",
        "TOTAL_ANNULMENT",
      ),
    );
    expect(annulment).toBeInstanceOf(CreditCapacityExceededError);
  });

  it("aplica y libera una sola vez, lee solo lo vigente y la reconciliación no informa diferencias", async () => {
    const target = await invoice();
    const applied = await note(target, "23.00", [{ position: 1, quantity: "2" }]);
    const released = await note(target, "34.50", [{ position: 1, quantity: "3" }]);
    const returned = await note(target, "5.75", [{ position: 2, quantity: "1" }], "SIGNED");
    const pending = await note(target, "11.50", [{ position: 1, quantity: "1" }]);
    expect(await conclude(applied, "AUTHORIZED")).toBe(true);
    expect(await conclude(released, "NOT_AUTHORIZED")).toBe(true);
    expect(await conclude(returned, "RETURNED")).toBe(true);
    // La capacidad liberada vuelve a estar disponible para otra nota.
    await note(target, "57.50", [{ position: 1, quantity: "5" }]);

    const state = await read(target.id);
    expect([state.reserved, state.applied]).toEqual(["69", "23"]);
    expect(state.lines.map((l) => [l.position, l.reserved, l.applied])).toEqual([
      [1, "6", "2"],
      [2, "0", "0"],
    ]);
    expect(state.credited.map((l) => [l.position, l.quantity])).toEqual(
      expect.arrayContaining([
        [1, "2"],
        [1, "1"],
        [1, "5"],
      ]),
    );
    expect(state.credited).toHaveLength(3);

    // Repetir la decisión no aplica ni libera dos veces.
    const again = await db.database.prisma.$transaction((tx) =>
      createCreditCapacityRepository(tx).conclude(
        company.companyId,
        applied.id,
        "APPLIED",
        new Date(),
      ),
    );
    expect(again).toBe(false);
    expect((await read(target.id)).applied).toBe("23");
    expect(pending.state).toBe("RECEIVED");
    expect(await reconcileCreditCapacity(db.database.prisma, company.companyId)).toEqual([]);
  });

  it("el bloqueo de la factura serializa dos reservas sobre la misma capacidad", async () => {
    const target = await invoice();
    const holding = deferred();
    const release = deferred();
    const first = db.database.prisma.$transaction(
      async (tx) => {
        await createCreditCapacityRepository(tx).lock(company.companyId, target.id);
        holding.resolve();
        await release.promise;
      },
      { timeout: 10_000 },
    );
    await holding.promise;
    const second = db.database.prisma.$transaction((tx) =>
      createCreditCapacityRepository(tx).lock(company.companyId, target.id),
    );
    expect(await stillPending(second)).toBe(true);
    release.resolve();
    await first;
    await second;
  });
});
