// Ciclo de vida de la capacidad de una nota de crédito y devolución de stock (add-credit-notes, tarea
// 9.1, design D7, D10 y D25), con los handlers reales de la transmisión y respuestas del SRI
// SINTÉTICAS: autorizada, en la misma transacción, crédito aplicado, retorno aplicado y una
// DEVOLUCION_NC por producto con la suma exacta que referencia la nota y cruza un saldo negativo;
// devuelta y no autorizada, capacidades liberadas sin devolución y filas conservadas; verificando,
// revisión manual, job detenido, error de transporte o del parser y reintentos agotados, capacidades
// reservadas; repetir cada decisión no aplica ni libera dos veces; y el control del producto
// desactivado después de facturar no impide la devolución. Sin retorno físico declarado, una
// anulación total o una devolución autorizadas no cambian el inventario, y una nota reservada o
// firmada todavía no devuelve nada.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { reconcileCreditCapacity } from "../../src/modules/credit-notes/infrastructure/index.ts";
import {
  reconcileStock,
  reconcileStockReturnCapacity,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { failure, receptionResponse, response } from "../support/sri-responses.ts";
import {
  insertAuthorizedInvoice,
  insertCreditNote,
  recordOutflow,
  type AuthorizedInvoiceDocument,
} from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { balanceOf, insertProduct } from "./inventory-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

describe("ciclo de vida de la capacidad de una nota de crédito", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let sri: CreditNoteTransmission;

  const invoiceCompany = () => ({
    companyId: company.companyId,
    adminId: company.adminId,
    establishmentId: company.points[0]!.establishmentId,
    emissionPointId: company.points[0]!.emissionPointId,
  });
  /** Factura autorizada con dos líneas del mismo producto (5 + 5) y su salida de 10. */
  const invoiceOf = async (product: string, initial = "100") => {
    const invoice = await insertAuthorizedInvoice(prisma, invoiceCompany(), [
      { productId: product, quantity: "5", unitPrice: "10.00", inventoryAffectsStock: true },
      { productId: product, quantity: "5", unitPrice: "10.00", inventoryAffectsStock: true },
    ]);
    await recordOutflow(prisma, company, invoice, product, "10", initial);
    return invoice;
  };
  const reservationOf = (note: TestDocument) =>
    prisma.creditReservation.findFirstOrThrow({ where: { creditNoteId: note.id } });
  const returnsOf = (note: TestDocument) =>
    prisma.stockReturnReservation.findMany({ where: { creditNoteId: note.id } });
  const devolutionsOf = (note: TestDocument) =>
    prisma.stockMovement.findMany({
      where: { documentId: note.id, movementType: "DEVOLUCION_NC" },
    });
  const capacityOf = (invoice: AuthorizedInvoiceDocument) =>
    prisma.creditCapacity.findFirstOrThrow({ where: { invoiceId: invoice.id } });
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const reconciled = async () => {
    expect(await reconcileCreditCapacity(prisma, company.companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(prisma, company.companyId)).toEqual([]);
    expect(await reconcileStock(prisma, company.companyId)).toEqual([]);
  };

  beforeAll(async () => {
    db = await createMigratedSchema("credit_note_lifecycle");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Ciclo de notas", 1);
    sri = creditNoteTransmission(prisma, store);
  });

  beforeEach(() => {
    sri.calls.length = 0;
    sri.replies.length = 0;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("autorizada: crédito y retorno aplicados y una devolución por producto con la suma exacta, que cruza un saldo negativo", async () => {
    const product = await insertProduct(prisma, company);
    // El inventario empezó en 4 y la factura sacó 10: el saldo es -6.
    const invoice = await invoiceOf(product, "4");
    expect(await balanceOf(prisma, company.companyId, product)).toBe("-6");
    const note = await insertCreditNote(prisma, company, invoice, {
      lines: [
        { position: 1, quantity: "2", physicalReturn: "2" },
        { position: 2, quantity: "1.5", physicalReturn: "1.5" },
      ],
    });
    sri.reply(note, [sri.authorized(note)]);
    await sri.authorize().run(await sri.jobFor(note, "sri.authorize"), sri.context());

    expect(await stateOf(note.id)).toBe("AUTHORIZED");
    const reservation = await reservationOf(note);
    expect([reservation.status, reservation.amount.toFixed()]).toEqual(["APPLIED", "40.25"]);
    expect(
      (await returnsOf(note)).map((r) => [r.productId, r.quantity.toFixed(), r.status]),
    ).toEqual([[product, "3.5", "APPLIED"]]);
    const movements = await devolutionsOf(note);
    expect(
      movements.map((m) => [
        m.productId,
        m.delta.toFixed(),
        m.origin,
        m.actorUserId,
        m.documentNumber,
      ]),
    ).toEqual([[product, "3.5", "SYSTEM", null, note.documentNumber]]);
    expect(await balanceOf(prisma, company.companyId, product)).toBe("-2.5");
    const capacity = await capacityOf(invoice);
    expect([capacity.reservedTotal.toFixed(), capacity.appliedTotal.toFixed()]).toEqual([
      "0",
      "40.25",
    ]);
    await reconciled();
  });

  it("devuelta y no autorizada: capacidades liberadas en la transición, sin devolución y con las filas conservadas", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await invoiceOf(product);
    const returned = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 1, quantity: "2", physicalReturn: "2" }],
      state: "SIGNED",
    });
    sri.replies.push(
      response(
        receptionResponse("DEVUELTA", [
          {
            accessKey: returned.accessKey,
            messages: [
              { identifier: "35", message: "ARCHIVO NO CUMPLE ESTRUCTURA XML", type: "ERROR" },
            ],
          },
        ]),
      ),
    );
    await sri.transmit().run(await sri.jobFor(returned, "sri.transmit"), sri.context());
    const notAuthorized = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 2, quantity: "3", physicalReturn: "1" }],
    });
    sri.reply(notAuthorized, [
      sri.authorized(notAuthorized, { estado: "NO AUTORIZADO", comprobante: undefined }),
    ]);
    await sri.authorize().run(await sri.jobFor(notAuthorized, "sri.authorize"), sri.context());

    expect([await stateOf(returned.id), await stateOf(notAuthorized.id)]).toEqual([
      "RETURNED",
      "NOT_AUTHORIZED",
    ]);
    for (const note of [returned, notAuthorized]) {
      expect((await reservationOf(note)).status).toBe("RELEASED");
      expect((await returnsOf(note)).map((r) => r.status)).toEqual(["RELEASED"]);
      expect(await devolutionsOf(note)).toEqual([]);
    }
    const capacity = await capacityOf(invoice);
    expect([capacity.reservedTotal.toFixed(), capacity.appliedTotal.toFixed()]).toEqual(["0", "0"]);
    const returnable = await prisma.stockReturnCapacity.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect([returnable.reservedQuantity.toFixed(), returnable.appliedQuantity.toFixed()]).toEqual([
      "0",
      "0",
    ]);
    expect(await balanceOf(prisma, company.companyId, product)).toBe("90");
    await reconciled();
  });

  it("verificando, revisión manual, job detenido, transporte, parser y reintentos agotados: la capacidad sigue reservada", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await invoiceOf(product);
    const balance = await balanceOf(prisma, company.companyId, product);
    const lines = [{ position: 1, quantity: "1", physicalReturn: "1" }];
    // Envío sin respuesta concluyente: verificando con el SRI.
    const unknown = await insertCreditNote(prisma, company, invoice, { lines, state: "SIGNED" });
    sri.replies.push(failure("REQUEST_TIMEOUT"));
    await sri
      .transmit()
      .run(await sri.jobFor(unknown, "sri.transmit"), sri.context())
      .catch(() => undefined);
    // Dos autorizaciones para la misma clave: revisión manual.
    const review = await insertCreditNote(prisma, company, invoice, { lines });
    sri.reply(review, [sri.authorized(review), sri.authorized(review)]);
    await sri.authorize().run(await sri.jobFor(review, "sri.authorize"), sri.context());
    // Error de transporte y respuesta que no se interpreta en la consulta de autorización.
    const transport = await insertCreditNote(prisma, company, invoice, { lines });
    sri.replies.push(failure("CONNECTION_LOST"));
    await sri
      .authorize()
      .run(await sri.jobFor(transport, "sri.authorize"), sri.context())
      .catch(() => undefined);
    const unparseable = await insertCreditNote(prisma, company, invoice, { lines });
    sri.replies.push(response("<no-es-soap/>"));
    await sri
      .authorize()
      .run(await sri.jobFor(unparseable, "sri.authorize"), sri.context())
      .catch(() => undefined);
    // Job detenido con los reintentos agotados.
    const stopped = await insertCreditNote(prisma, company, invoice, { lines });
    const stoppedJob = await sri.jobFor(stopped, "sri.authorize");
    await store.stop(
      prisma,
      stoppedJob,
      { code: "SRI_UNAVAILABLE", errorClass: "RETRYABLE" },
      new Date(),
    );

    const states = await Promise.all(
      [unknown, review, transport, unparseable, stopped].map((n) => stateOf(n.id)),
    );
    expect(states).toEqual(["SEND_UNKNOWN", "MANUAL_REVIEW", "RECEIVED", "RECEIVED", "RECEIVED"]);
    for (const note of [unknown, review, transport, unparseable, stopped]) {
      expect((await reservationOf(note)).status).toBe("RESERVED");
      expect((await returnsOf(note)).map((r) => r.status)).toEqual(["RESERVED"]);
      expect(await devolutionsOf(note)).toEqual([]);
    }
    expect((await capacityOf(invoice)).reservedTotal.toFixed()).toBe("57.5");
    // Ninguna de esas notas con retorno físico cambió el saldo.
    expect(await balanceOf(prisma, company.companyId, product)).toBe(balance);
    await reconciled();
  });

  it("sin retorno físico declarado, una anulación total o una devolución autorizadas no cambian el inventario; reservada o firmada tampoco devuelve", async () => {
    const product = await insertProduct(prisma, company);
    const annulled = await invoiceOf(product);
    const annulment = await insertCreditNote(prisma, company, annulled, {
      cause: "TOTAL_ANNULMENT",
      lines: [
        { position: 1, quantity: "5" },
        { position: 2, quantity: "5" },
      ],
    });
    const returned = await invoiceOf(product);
    const withoutReturn = await insertCreditNote(prisma, company, returned, {
      lines: [{ position: 1, quantity: "3", physicalReturn: "0" }],
    });
    // Dos salidas de 10 sobre un inventario inicial de 100.
    expect(await balanceOf(prisma, company.companyId, product)).toBe("80");
    for (const note of [annulment, withoutReturn]) {
      sri.reply(note, [sri.authorized(note)]);
      await sri.authorize().run(await sri.jobFor(note, "sri.authorize"), sri.context());
      expect(await stateOf(note.id)).toBe("AUTHORIZED");
      expect((await reservationOf(note)).status).toBe("APPLIED");
      expect(await returnsOf(note)).toEqual([]);
      expect(await devolutionsOf(note)).toEqual([]);
    }
    expect((await capacityOf(annulled)).appliedTotal.toFixed(2)).toBe(annulled.total);

    // Con retorno físico declarado, una nota reservada o firmada todavía no devuelve nada.
    const pending = await invoiceOf(product);
    const lines = [{ position: 1, quantity: "2", physicalReturn: "2" }];
    const reserved = await insertCreditNote(prisma, company, pending, { lines, state: "RESERVED" });
    const signed = await insertCreditNote(prisma, company, pending, { lines, state: "SIGNED" });
    for (const note of [reserved, signed]) {
      expect((await returnsOf(note)).map((r) => r.status)).toEqual(["RESERVED"]);
      expect(await devolutionsOf(note)).toEqual([]);
    }
    expect(await balanceOf(prisma, company.companyId, product)).toBe("70");
    await reconciled();
  });

  it("repetir la decisión no aplica ni libera dos veces, ni registra otra devolución", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await invoiceOf(product);
    const authorized = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 1, quantity: "2", physicalReturn: "2" }],
    });
    sri.reply(authorized, [sri.authorized(authorized)]);
    await sri.authorize().run(await sri.jobFor(authorized, "sri.authorize"), sri.context());
    const released = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 2, quantity: "1", physicalReturn: "1" }],
    });
    sri.reply(released, [
      sri.authorized(released, { estado: "NO AUTORIZADO", comprobante: undefined }),
    ]);
    await sri.authorize().run(await sri.jobFor(released, "sri.authorize"), sri.context());
    const before = {
      capacity: await capacityOf(invoice),
      balance: await balanceOf(prisma, company.companyId, product),
      movements: (await devolutionsOf(authorized)).length,
    };
    // Los seguidores reciben otra vez cada decisión, como en un reintento o una reconciliación.
    for (const [note, to] of [
      [authorized, "AUTHORIZED"],
      [released, "NOT_AUTHORIZED"],
    ] as const) {
      await prisma.$transaction(async (tx) => {
        for (const follower of sri.followers) {
          await follower(tx, {
            companyId: company.companyId,
            documentId: note.id,
            from: "RECEIVED",
            to,
            cause: "RECONCILIATION",
            at: new Date(),
          });
        }
      });
    }
    expect(await capacityOf(invoice)).toEqual(before.capacity);
    expect(await balanceOf(prisma, company.companyId, product)).toBe(before.balance);
    expect(await devolutionsOf(authorized)).toHaveLength(before.movements);
    await reconciled();
  });

  it("con el control del producto desactivado después de facturar, la devolución se registra", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await invoiceOf(product);
    await prisma.product.update({ where: { id: product }, data: { stockTracked: false } });
    const note = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 1, quantity: "1", physicalReturn: "1" }],
    });
    sri.reply(note, [sri.authorized(note)]);
    await sri.authorize().run(await sri.jobFor(note, "sri.authorize"), sri.context());
    expect((await devolutionsOf(note)).map((m) => m.delta.toFixed())).toEqual(["1"]);
    expect(await balanceOf(prisma, company.companyId, product)).toBe("91");
    await reconciled();
  });
});
