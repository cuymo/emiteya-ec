// Concurrencia de la reserva de notas de crédito con PostgreSQL real (add-credit-notes, tarea 8.5,
// design D8). Las emisiones van a la vez por HTTP, cada una en su transacción; el bloqueo de la
// factura las serializa y el `CHECK` es la última defensa. Escenarios sobre una línea de 10 unidades:
// A (6 y 5: una se rechaza), B (6 y 4: ambas), C (devolución y anulación total: una), D (anulación
// total y devolución: una), G (dos retornos físicos que juntos exceden la salida: uno), dos
// anulaciones totales (una) y el remanente exacto de tres notas simultáneas de un tercio. Cada
// escenario se repite y la reconciliación de las capacidades no informa diferencias.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CreditNoteDraftView, CreditNoteView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  createCreditCapacityRepository,
  reconcileCreditCapacity,
} from "../../src/modules/credit-notes/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { sumExact } from "../../src/platform/decimal/fiscal-decimal.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  insertAuthorizedInvoice,
  recordOutflow,
  type AuthorizedInvoiceDocument,
  type InvoiceLineSpec,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { deferred, stillPending } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: CreditNoteView & CreditNoteDraftView & { id: string; version: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};
const REPEAT = 3;
type Request = { cause?: "RETURN" | "TOTAL_ANNULMENT"; quantity?: string; physicalReturn?: string };

describe("concurrencia de la reserva de notas de crédito", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let good: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 4,
    timeoutMs: 60_000,
  });

  const invoice = async (lines?: InvoiceLineSpec[], outflow = "10") => {
    const created = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      lines ?? [
        { productId: good, quantity: "10", unitPrice: "10.00", inventoryAffectsStock: true },
      ],
    );
    await recordOutflow(db.database.prisma, a, created, good, outflow, "1000");
    return created;
  };
  const draft = async (target: AuthorizedInvoiceDocument, spec: Request) => {
    const res = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: target.id,
        emissionPointId: a.emissionPointId,
        cause: spec.cause ?? "RETURN",
        reason: "Devolución concurrente",
        lines:
          spec.cause === "TOTAL_ANNULMENT"
            ? []
            : [
                {
                  position: 1,
                  quantity: spec.quantity,
                  physicalReturn: spec.physicalReturn ?? "0",
                },
              ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (created: { id: string; version: number }) =>
    request(api.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: created.id, expectedVersion: created.version, declarations: DECLARATIONS });
  /** Prepara los borradores y los emite a la vez; devuelve el estado y el código de cada uno. */
  const race = async (target: AuthorizedInvoiceDocument, specs: Request[]) => {
    const drafts = await Promise.all(specs.map((spec) => draft(target, spec)));
    const responses = await Promise.all(drafts.map(emit));
    return responses.map((res) => (res.status === 201 ? "OK" : bodyOf(res).error.code));
  };
  const capacity = (invoiceId: string) =>
    createCreditCapacityRepository(db.database.prisma).read(a.companyId, invoiceId);
  const noDifferences = async () =>
    expect(await reconcileCreditCapacity(db.database.prisma, a.companyId)).toEqual([]);

  beforeAll(async () => {
    db = await createMigratedSchema("credit_note_concurrency");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    a = await readyCompany(api, db, {
      slug: "concurrencia",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    good = await insertProduct(db.database.prisma, {
      companyId: a.companyId,
      adminId: a.adminId,
      points: [],
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("A: devoluciones de 6 y 5 de una línea de 10 a la vez, una se rechaza sin exceder ni reservar número", async () => {
    const issued = async () => ({
      notes: await db.database.prisma.electronicDocument.count({ where: { documentType: "04" } }),
      sequences: await db.database.prisma.fiscalSequenceReservation.count({
        where: { documentType: "04" },
      }),
    });
    for (let round = 0; round < REPEAT; round++) {
      const target = await invoice();
      const before = await issued();
      const outcomes = await race(target, [{ quantity: "6" }, { quantity: "5" }]);
      expect(outcomes.sort()).toEqual(["CREDIT_NOTE_QUANTITY_EXCEEDED", "OK"]);
      const state = await capacity(target.id);
      expect(["6", "5"]).toContain(state.lines[0]!.reserved);
      // Solo la nota reservada consumió un número: la rechazada no dejó secuencial ni comprobante.
      const after = await issued();
      expect([after.notes - before.notes, after.sequences - before.sequences]).toEqual([1, 1]);
    }
    await noDifferences();
  });

  it("B: devoluciones de 6 y 4 a la vez, ambas se reservan y la línea queda sin cantidad acreditable", async () => {
    for (let round = 0; round < REPEAT; round++) {
      const target = await invoice();
      expect(await race(target, [{ quantity: "6" }, { quantity: "4" }])).toEqual(["OK", "OK"]);
      const state = await capacity(target.id);
      expect([state.lines[0]!.reserved, state.reserved]).toEqual(["10", "115"]);
    }
    await noDifferences();
  });

  it("C y D: una devolución y una anulación total a la vez, exactamente una se reserva", async () => {
    for (let round = 0; round < REPEAT; round++) {
      const target = await invoice();
      const outcomes = await race(target, [{ quantity: "1" }, { cause: "TOTAL_ANNULMENT" }]);
      expect(outcomes.filter((o) => o === "OK")).toHaveLength(1);
      expect(outcomes.filter((o) => o !== "OK")).toHaveLength(1);
      expect([
        "CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE",
        "CREDIT_NOTE_QUANTITY_EXCEEDED",
        "CREDIT_NOTE_AMOUNT_EXCEEDED",
      ]).toContain(outcomes.find((o) => o !== "OK"));
    }
    // C en orden: con una devolución reservada, la anulación total se rechaza.
    const reserved = await invoice();
    expect(await race(reserved, [{ quantity: "1" }])).toEqual(["OK"]);
    expect(await race(reserved, [{ cause: "TOTAL_ANNULMENT" }])).toEqual([
      "CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE",
    ]);
    // D en orden: con una anulación total reservada, la devolución se rechaza.
    const annulled = await invoice();
    expect(await race(annulled, [{ cause: "TOTAL_ANNULMENT" }])).toEqual(["OK"]);
    expect(await race(annulled, [{ quantity: "1" }])).toEqual(["CREDIT_NOTE_QUANTITY_EXCEEDED"]);
    await noDifferences();
  });

  it("dos anulaciones totales a la vez: exactamente una se reserva", async () => {
    for (let round = 0; round < REPEAT; round++) {
      const target = await invoice();
      const outcomes = await race(target, [
        { cause: "TOTAL_ANNULMENT" },
        { cause: "TOTAL_ANNULMENT" },
      ]);
      expect(outcomes.filter((o) => o === "OK")).toHaveLength(1);
      expect((await capacity(target.id)).reserved).toBe("115");
    }
    await noDifferences();
  });

  it("G: dos retornos físicos a la vez que juntos exceden la salida, uno se rechaza", async () => {
    for (let round = 0; round < REPEAT; round++) {
      // 20 unidades facturadas, 10 salieron del inventario: cada nota acredita 6 con retorno 6.
      const target = await invoice(
        [{ productId: good, quantity: "20", unitPrice: "10.00", inventoryAffectsStock: true }],
        "10",
      );
      const outcomes = await race(target, [
        { quantity: "6", physicalReturn: "6" },
        { quantity: "6", physicalReturn: "6" },
      ]);
      expect(outcomes.sort()).toEqual(["CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED", "OK"]);
      const returns = await db.database.prisma.stockReturnCapacity.findFirstOrThrow({
        where: { invoiceId: target.id },
      });
      expect([returns.originalQuantity.toFixed(), returns.reservedQuantity.toFixed()]).toEqual([
        "10",
        "6",
      ]);
    }
    await noDifferences();
  });

  it("el remanente exacto: tres notas de un tercio a la vez suman exactamente la línea", async () => {
    for (let round = 0; round < REPEAT; round++) {
      const target = await invoice([
        { productId: good, quantity: "3", unitPrice: "3.333333", inventoryAffectsStock: true },
      ]);
      expect(await race(target, [{ quantity: "1" }, { quantity: "1" }, { quantity: "1" }])).toEqual(
        ["OK", "OK", "OK"],
      );
      const lines = await db.database.prisma.creditReservationLine.findMany({
        where: { invoiceId: target.id },
      });
      expect(sumExact(lines.map((line) => line.taxableBase.toFixed()))).toBe("10");
      expect(sumExact(lines.map((line) => (line.taxes as { amount: string }[])[0]!.amount))).toBe(
        "1.5",
      );
      expect(lines.map((line) => line.taxableBase.toFixed()).sort()).toEqual([
        "3.33",
        "3.33",
        "3.34",
      ]);
    }
    await noDifferences();
  });

  it("el bloqueo de la factura detiene la reserva hasta que la otra transacción termina", async () => {
    const target = await invoice();
    const created = await draft(target, { quantity: "2" });
    const holding = deferred();
    const release = deferred();
    const blocker = db.database.prisma.$transaction(
      async (tx) => {
        await createCreditCapacityRepository(tx).lock(a.companyId, target.id);
        holding.resolve();
        await release.promise;
      },
      { timeout: 20_000 },
    );
    await holding.promise;
    const pending = emit(created);
    expect(await stillPending(pending, 500)).toBe(true);
    release.resolve();
    await blocker;
    expect((await pending).status).toBe(201);
  });
});
