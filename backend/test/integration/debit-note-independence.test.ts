// Independencia de la nota de débito con PostgreSQL real (add-debit-notes, tarea 8.1, design D12): una
// nota de débito autorizada no cambia la capacidad acreditable de su factura, que sigue admitiendo
// una anulación total por su total original; una nota de crédito no puede tener una nota de débito
// como documento sustento; y una nota de débito autorizada, devuelta o no autorizada no registra
// movimientos de inventario ni cambia saldos. Las reconciliaciones diagnósticas no informan
// diferencias.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { DebitNoteView, InvoiceCreditView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { reconcileCreditCapacity } from "../../src/modules/credit-notes/infrastructure/index.ts";
import {
  reconcileStock,
  reconcileStockReturnCapacity,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { receptionResponse, response } from "../support/sri-responses.ts";
import {
  IVA0,
  insertAuthorizedInvoice,
  recordOutflow,
  type AuthorizedInvoiceDocument,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: DebitNoteView & InvoiceCreditView & { id: string; version: number } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("la nota de débito no cambia la capacidad acreditable ni el inventario", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let good: string;
  let sri: CreditNoteTransmission;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const companyOf = (company: ReadyCompany): InvoiceCompany => ({
    companyId: company.companyId,
    adminId: company.adminId,
    establishmentId: company.establishmentId,
    emissionPointId: company.emissionPointId,
  });
  /** Factura de 100.00: 10 unidades de un bien con inventario a 10.00, sin IVA, con su salida. */
  const invoice = async () => {
    const created = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      {
        productId: good,
        quantity: "10",
        unitPrice: "10.00",
        rate: IVA0,
        inventoryAffectsStock: true,
      },
    ]);
    await recordOutflow(db.database.prisma, a, created, good, "10");
    return created;
  };
  /** Nota de débito de 20.00 emitida por la API y firmada. */
  const debitNote = async (target: AuthorizedInvoiceDocument) => {
    const draft = await request(api.app)
      .post("/api/v1/debit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: target.id,
        emissionPointId: a.emissionPointId,
        paymentMethod: "20",
        concepts: [
          {
            cause: "LATE_PAYMENT_INTEREST",
            description: "Intereses de mora",
            amount: "20.00",
            taxTreatment: "2:0",
          },
        ],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const res = await request(api.app)
      .post("/api/v1/debit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: bodyOf(draft).data.id,
        expectedVersion: 1,
        declarations: { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data as unknown as TestDocument;
  };
  /** Transmite la nota firmada: recibida y, después, autorizada o no autorizada. */
  const conclude = async (note: TestDocument, outcome: "AUTHORIZED" | "NOT_AUTHORIZED") => {
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(note.id, "sri.transmit"), sri.context());
    sri.reply(note, [
      outcome === "AUTHORIZED"
        ? sri.authorized(note)
        : sri.authorized(note, { estado: "NO AUTORIZADO", comprobante: undefined }),
    ]);
    await sri.authorize().run(await sri.leasePending(note.id, "sri.authorize"), sri.context());
  };
  const stateOf = async (id: string) =>
    (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const inventory = async () => ({
    movements: await db.database.prisma.stockMovement.count({ where: { companyId: a.companyId } }),
    balances: (
      await db.database.prisma.stockBalance.findMany({ where: { companyId: a.companyId } })
    ).map((balance) => [balance.productId, balance.balance.toFixed()]),
    returns: await db.database.prisma.stockReturnReservation.count(),
  });

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_independence");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    a = await readyCompany(api, db, {
      slug: "independencia-nd",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    good = await insertProduct(db.database.prisma, {
      companyId: a.companyId,
      adminId: a.adminId,
      points: [],
    });
    sri = creditNoteTransmission(
      db.database.prisma,
      createPrismaJobStore(db.database.prisma, db.name),
    );
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("una factura de 100.00 con una nota de débito autorizada de 20.00 sigue con 100.00 acreditables", async () => {
    const target = await invoice();
    expect(target.total).toBe("100.00");
    const note = await debitNote(target);
    await conclude(note, "AUTHORIZED");
    expect(await stateOf(note.id)).toBe("AUTHORIZED");

    const credit = await request(api.app)
      .get(`/api/v1/credit-notes/invoices/${target.id}/credit`)
      .set("Cookie", a.cookies.operator);
    expect(credit.status).toBe(200);
    expect(bodyOf(credit).data).toMatchObject({
      total: "100.00",
      applied: "0.00",
      reserved: "0.00",
      available: "100.00",
      totalAnnulmentAvailable: true,
    });
    // La anulación total sigue acreditando el total original de la factura.
    const draft = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: target.id,
        emissionPointId: a.emissionPointId,
        cause: "TOTAL_ANNULMENT",
        reason: "Anulación de la venta",
        lines: [],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const annulment = await request(api.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: bodyOf(draft).data.id,
        expectedVersion: 1,
        declarations: {
          version: 1,
          statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
        },
      });
    expect(annulment.status, JSON.stringify(annulment.body)).toBe(201);
    expect((bodyOf(annulment).data as unknown as { totals: { total: string } }).totals.total).toBe(
      "100.00",
    );
    expect(await reconcileCreditCapacity(db.database.prisma, a.companyId)).toEqual([]);
  });

  it("una nota de crédito no puede tener una nota de débito como documento sustento", async () => {
    const note = await debitNote(await invoice());
    const eligible = await request(api.app)
      .get("/api/v1/credit-notes/eligible-invoices?pageSize=100")
      .set("Cookie", a.cookies.operator);
    expect((eligible.body as { data: { id: string }[] }).data.map((i) => i.id)).not.toContain(
      note.id,
    );
    const draft = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: note.id,
        emissionPointId: a.emissionPointId,
        cause: "TOTAL_ANNULMENT",
        reason: "Anulación",
        lines: [],
      });
    expect([draft.status, (draft.body as { error: { code: string } }).error.code]).toEqual([
      404,
      "CREDIT_NOTE_INVOICE_NOT_FOUND",
    ]);
    const credit = await request(api.app)
      .get(`/api/v1/credit-notes/invoices/${note.id}/credit`)
      .set("Cookie", a.cookies.operator);
    expect(credit.status).toBe(404);
  });

  it("autorizada, devuelta o no autorizada, una nota de débito no mueve el inventario", async () => {
    const before = await inventory();
    const authorized = await debitNote(await invoice());
    const afterInvoices = await inventory();
    await conclude(authorized, "AUTHORIZED");
    const rejected = await debitNote(await invoice());
    const afterSecondInvoice = await inventory();
    await conclude(rejected, "NOT_AUTHORIZED");
    const returned = await debitNote(await invoice());
    const afterThirdInvoice = await inventory();
    sri.replies.push(
      response(
        receptionResponse("DEVUELTA", [
          {
            accessKey: returned.accessKey,
            messages: [{ identifier: "35", message: "mensaje sintético", type: "ERROR" }],
          },
        ]),
      ),
    );
    await sri.transmit().run(await sri.leasePending(returned.id, "sri.transmit"), sri.context());
    expect([
      await stateOf(authorized.id),
      await stateOf(rejected.id),
      await stateOf(returned.id),
    ]).toEqual(["AUTHORIZED", "NOT_AUTHORIZED", "RETURNED"]);
    // Cada factura registró su salida; ninguna nota de débito registró un movimiento.
    expect(afterInvoices.movements).toBeGreaterThan(before.movements);
    expect(await inventory()).toEqual(afterThirdInvoice);
    expect(afterSecondInvoice.returns).toBe(before.returns);
    expect(
      await db.database.prisma.stockMovement.count({
        where: { documentId: { in: [authorized.id, rejected.id, returned.id] } },
      }),
    ).toBe(0);
    expect(await reconcileStock(db.database.prisma, a.companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(db.database.prisma, a.companyId)).toEqual([]);
  });
});
