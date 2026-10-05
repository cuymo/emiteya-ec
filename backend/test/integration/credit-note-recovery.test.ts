// Recuperación y concurrencia del ciclo de vida de una nota de crédito con PostgreSQL real
// (add-credit-notes, tarea 9.2, design D7, D8, D10 y D25), con respuestas del SRI SINTÉTICAS:
// E (una nota no autorizada libera su capacidad y otra la consume), F (una nota verificando con el
// SRI la conserva), el fallo después de la autorización externa y antes del commit local (sin
// devolución ni crédito aplicado, y el reintento que reclasifica la respuesta guardada sin otra
// llamada, con una sola devolución), y una nota autorizada a la vez que una entrada manual del mismo
// producto. Cada saldo es la suma de su kárdex y las capacidades coinciden con sus reservas.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { DocumentTransitionFollower } from "../../src/modules/fiscal/application/document-transitions.ts";
import { reconcileCreditCapacity } from "../../src/modules/credit-notes/infrastructure/index.ts";
import {
  createInventoryUnitOfWork,
  reconcileStock,
  reconcileStockReturnCapacity,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { failure } from "../support/sri-responses.ts";
import {
  insertAuthorizedInvoice,
  insertCreditNote,
  recordOutflow,
} from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { balanceOf, insertProduct } from "./inventory-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

describe("recuperación y concurrencia del ciclo de vida de una nota de crédito", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let sri: CreditNoteTransmission;

  const invoiceOf = async (product: string) => {
    const invoice = await insertAuthorizedInvoice(
      prisma,
      {
        companyId: company.companyId,
        adminId: company.adminId,
        establishmentId: company.points[0]!.establishmentId,
        emissionPointId: company.points[0]!.emissionPointId,
      },
      [{ productId: product, quantity: "10", unitPrice: "10.00", inventoryAffectsStock: true }],
    );
    await recordOutflow(prisma, company, invoice, product, "10");
    return invoice;
  };
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const reservationOf = (note: TestDocument) =>
    prisma.creditReservation.findFirstOrThrow({ where: { creditNoteId: note.id } });
  const devolutionsOf = (note: TestDocument) =>
    prisma.stockMovement.findMany({
      where: { documentId: note.id, movementType: "DEVOLUCION_NC" },
    });
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const reconciled = async () => {
    expect(await reconcileCreditCapacity(prisma, company.companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(prisma, company.companyId)).toEqual([]);
    expect(await reconcileStock(prisma, company.companyId)).toEqual([]);
  };

  beforeAll(async () => {
    db = await createMigratedSchema("credit_note_recovery");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Recuperación de notas", 1);
    sri = creditNoteTransmission(prisma, store);
  });

  beforeEach(() => {
    sri.calls.length = 0;
    sri.replies.length = 0;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("E: una nota no autorizada libera su capacidad y una devolución nueva la consume", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await invoiceOf(product);
    const first = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 1, quantity: "6", physicalReturn: "6" }],
    });
    // Mientras está reservada, otra de 5 no cabe.
    expect(
      await fails(
        insertCreditNote(prisma, company, invoice, {
          lines: [{ position: 1, quantity: "5", physicalReturn: "5" }],
        }),
      ),
    ).toMatch(/CREDIT_NOTE_QUANTITY_EXCEEDED/);
    sri.reply(first, [sri.authorized(first, { estado: "NO AUTORIZADO", comprobante: undefined })]);
    await sri.authorize().run(await sri.jobFor(first, "sri.authorize"), sri.context());
    expect(await stateOf(first.id)).toBe("NOT_AUTHORIZED");
    const second = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 1, quantity: "10", physicalReturn: "10" }],
    });
    expect((await reservationOf(second)).status).toBe("RESERVED");
    await reconciled();
  });

  it("F: una nota verificando con el SRI conserva su capacidad y una devolución nueva no la consume", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await invoiceOf(product);
    const uncertain = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 1, quantity: "6", physicalReturn: "6" }],
      state: "SIGNED",
    });
    sri.replies.push(failure("REQUEST_TIMEOUT"));
    await sri
      .transmit()
      .run(await sri.jobFor(uncertain, "sri.transmit"), sri.context())
      .catch(() => undefined);
    expect(await stateOf(uncertain.id)).toBe("SEND_UNKNOWN");
    expect(
      await fails(
        insertCreditNote(prisma, company, invoice, { lines: [{ position: 1, quantity: "5" }] }),
      ),
    ).toMatch(/CREDIT_NOTE_QUANTITY_EXCEEDED/);
    expect((await reservationOf(uncertain)).status).toBe("RESERVED");
    await reconciled();
  });

  it("un fallo local después de la autorización externa no deja devolución ni crédito; el reintento los aplica una vez sin llamar otra vez al SRI", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await invoiceOf(product);
    const note = await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 1, quantity: "3", physicalReturn: "3" }],
    });
    sri.reply(note, [sri.authorized(note)]);
    let failed = false;
    // Falla después de los seguidores de la nota, antes del commit local.
    const crashing: DocumentTransitionFollower = () => {
      if (failed) return Promise.resolve();
      failed = true;
      return Promise.reject(new Error("caída antes del commit local"));
    };
    const job = await sri.jobFor(note, "sri.authorize");
    await expect(
      sri.authorize([...sri.followers, crashing]).run(job, sri.context()),
    ).rejects.toThrow("caída antes del commit local");
    expect(await stateOf(note.id)).toBe("RECEIVED");
    expect((await reservationOf(note)).status).toBe("RESERVED");
    expect(await devolutionsOf(note)).toEqual([]);
    expect(await balanceOf(prisma, company.companyId, product)).toBe("90");
    expect(sri.calls).toEqual(["AUTHORIZATION"]);

    await sri.authorize([...sri.followers, crashing]).run(job, sri.context());
    expect(sri.calls).toEqual(["AUTHORIZATION"]);
    expect(await stateOf(note.id)).toBe("AUTHORIZED");
    expect((await reservationOf(note)).status).toBe("APPLIED");
    expect((await devolutionsOf(note)).map((m) => m.delta.toFixed())).toEqual(["3"]);
    expect(await balanceOf(prisma, company.companyId, product)).toBe("93");
    await reconciled();
  });

  it("una nota autorizada a la vez que una entrada manual del mismo producto: ambas quedan en el kárdex", async () => {
    const product = await insertProduct(prisma, company);
    const invoice = await invoiceOf(product);
    for (let round = 0; round < 3; round++) {
      const note = await insertCreditNote(prisma, company, invoice, {
        lines: [{ position: 1, quantity: "1", physicalReturn: "1" }],
      });
      sri.reply(note, [sri.authorized(note)]);
      const job = await sri.jobFor(note, "sri.authorize");
      await Promise.all([
        sri.authorize().run(job, sri.context()),
        createInventoryUnitOfWork(prisma).run(({ stock }) =>
          stock.append({
            companyId: company.companyId,
            productId: product,
            type: "ENTRADA_MANUAL",
            delta: "2",
            origin: "USER",
            actorUserId: company.adminId,
            idempotency: {
              operation: "inventory.entry",
              key: `entrada-${note.id}`,
              requestHash: "c".repeat(64),
            },
            occurredAt: new Date(),
          }),
        ),
      ]);
      expect(await stateOf(note.id)).toBe("AUTHORIZED");
    }
    // 100 iniciales − 10 de la factura + 3 devueltos + 6 de entradas.
    expect(await balanceOf(prisma, company.companyId, product)).toBe("99");
    await reconciled();
  });
});
