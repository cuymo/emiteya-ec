// Independencia del comprobante de retención con PostgreSQL real (add-withholding-receipts, tarea
// 9.1, design D1 y D2): una retención autorizada, devuelta o no autorizada no registra movimientos
// de inventario, no cambia las capacidades acreditables ni las devolvibles y no modifica ninguna
// factura ni nota de la empresa. Sus documentos sustento son referencias externas: aunque el número
// coincida con el de una factura propia, la retención no la lee ni la toca. Las reconciliaciones
// diagnósticas no informan diferencias. Respuestas del SRI sintéticas, sin red.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
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
} from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { buildArchiveApp } from "./archive-api-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: TestDocument & { version: number } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("la retención no toca el inventario, las capacidades ni las facturas y notas", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let good: string;
  let sri: CreditNoteTransmission;
  let invoice: AuthorizedInvoiceDocument;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const post = async (path: string, body: object, key?: string) => {
    const req = request(api.app).post(`/api/v1${path}`).set("Cookie", a.cookies.operator);
    const res = await (key ? req.set("Idempotency-Key", key) : req).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  /**
   * Retención de renta e IVA firmada. El documento sustento declara el mismo número que la factura
   * propia de la empresa: es una referencia externa y la retención no la busca.
   */
  const withholding = async () => {
    const draft = await post("/withholding-receipts/drafts", {
      partyId: a.supplierId,
      relatedParty: "NO",
      emissionPointId: a.emissionPointId,
      supports: [
        {
          documentType: "01",
          supportCode: "01",
          number: invoice.documentNumber.replaceAll("-", ""),
          issueDate: "2026-10-01",
          totalWithoutTaxes: "100.00",
          importTotal: "115.00",
          taxes: [{ tax: "2", rateEntryKey: "4", base: "100.00", amount: "15.00" }],
          payments: [{ paymentMethod: "20", total: "115.00" }],
          withholdings: [
            { tax: "1", entryKey: "312", base: "100.00" },
            { tax: "2", entryKey: "9", base: "15.00" },
          ],
        },
      ],
    });
    return post(
      "/withholding-receipts",
      { draftId: draft.id, expectedVersion: draft.version },
      randomUUID(),
    );
  };
  /** Transmite la retención firmada: recibida y, después, autorizada o no autorizada. */
  const conclude = async (doc: TestDocument, outcome: "AUTHORIZED" | "NOT_AUTHORIZED") => {
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(doc.id, "sri.transmit"), sri.context());
    sri.reply(doc, [
      outcome === "AUTHORIZED"
        ? sri.authorized(doc)
        : sri.authorized(doc, { estado: "NO AUTORIZADO", comprobante: undefined }),
    ]);
    await sri.authorize().run(await sri.leasePending(doc.id, "sri.authorize"), sri.context());
  };
  const stateOf = async (id: string) =>
    (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  /** Inventario, capacidades y comprobantes que no son retenciones, tal como están en la base. */
  const ledger = async () => {
    const prisma = db.database.prisma;
    const companyId = a.companyId;
    return {
      movements: await prisma.stockMovement.findMany({
        where: { companyId },
        orderBy: { id: "asc" },
      }),
      balances: await prisma.stockBalance.findMany({
        where: { companyId },
        orderBy: { productId: "asc" },
      }),
      creditCapacities: await prisma.creditCapacity.findMany({ orderBy: { invoiceId: "asc" } }),
      creditCapacityLines: await prisma.creditCapacityLine.findMany({
        orderBy: [{ invoiceId: "asc" }, { position: "asc" }],
      }),
      creditReservations: await prisma.creditReservation.count(),
      returnCapacities: await prisma.stockReturnCapacity.findMany({
        orderBy: [{ invoiceId: "asc" }, { productId: "asc" }],
      }),
      returnReservations: await prisma.stockReturnReservation.count(),
      documents: await prisma.electronicDocument.findMany({
        where: { companyId, documentType: { not: "07" } },
        orderBy: { id: "asc" },
      }),
      transitions: await prisma.documentStateTransition.count({
        where: { document: { documentType: { not: "07" } } },
      }),
      artifacts: await prisma.documentArtifact.count({
        where: { document: { documentType: { not: "07" } } },
      }),
    };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_independence");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    // 10:00 del 6 de octubre de 2026 en Ecuador: la retención resuelve el bloque vigente del ATS.
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    a = await readyCompany(api, db, {
      slug: "independencia-ret",
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
    // Factura de 100.00 con inventario y su salida, y una nota de débito firmada sobre ella.
    invoice = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [
        {
          productId: good,
          quantity: "10",
          unitPrice: "10.00",
          rate: IVA0,
          inventoryAffectsStock: true,
        },
      ],
    );
    await recordOutflow(db.database.prisma, a, invoice, good, "10");
    const debitDraft = await post("/debit-notes/drafts", {
      invoiceId: invoice.id,
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
    await post(
      "/debit-notes",
      {
        draftId: debitDraft.id,
        expectedVersion: debitDraft.version,
        declarations: { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] },
      },
      randomUUID(),
    );
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("autorizada, devuelta o no autorizada, una retención no cambia nada fuera de ella", async () => {
    const before = await ledger();
    expect(before.movements.length).toBeGreaterThan(0);
    expect(before.documents.map((d) => d.documentType).sort()).toEqual(["01", "05"]);

    const authorized = await withholding();
    await conclude(authorized, "AUTHORIZED");
    const rejected = await withholding();
    await conclude(rejected, "NOT_AUTHORIZED");
    const returned = await withholding();
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

    // El inventario, las capacidades, las facturas y las notas siguen exactamente igual.
    expect(await ledger()).toEqual(before);
    const ids = [authorized.id, rejected.id, returned.id];
    expect(
      await db.database.prisma.stockMovement.count({ where: { documentId: { in: ids } } }),
    ).toBe(0);
    expect(
      await db.database.prisma.creditCapacity.count({ where: { invoiceId: { in: ids } } }),
    ).toBe(0);
    expect(
      await db.database.prisma.debitNoteSupport.count({ where: { invoiceId: { in: ids } } }),
    ).toBe(0);
    expect(await reconcileCreditCapacity(db.database.prisma, a.companyId)).toEqual([]);
    expect(await reconcileStock(db.database.prisma, a.companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(db.database.prisma, a.companyId)).toEqual([]);
  });

  it("la bandeja filtra las retenciones entre facturas, notas de débito y retenciones", async () => {
    const archive = buildArchiveApp(db);
    const all = await request(archive.app)
      .get("/api/v1/documents?pageSize=100")
      .set("Cookie", a.cookies.operator);
    const types = new Set(
      (all.body as { data: { documentType: string }[] }).data.map((d) => d.documentType),
    );
    expect([...types].sort()).toEqual(["01", "05", "07"]);
    const filtered = await request(archive.app)
      .get("/api/v1/documents?documentType=07&pageSize=100")
      .set("Cookie", a.cookies.operator);
    const rows = (filtered.body as { data: { documentType: string; buyer: { name: string } }[] })
      .data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.documentType === "07")).toBe(true);
    // El receptor de una retención en la bandeja es el sujeto retenido.
    expect(rows.every((row) => row.buyer.name === "PROVEEDORA DEL SUR S.A.")).toBe(true);
  });

  it("la factura sigue con todo su crédito y la retención no es un documento sustento de las notas", async () => {
    const credit = await request(api.app)
      .get(`/api/v1/credit-notes/invoices/${invoice.id}/credit`)
      .set("Cookie", a.cookies.operator);
    expect(credit.status).toBe(200);
    expect(credit.body).toMatchObject({
      data: { total: "100.00", applied: "0.00", reserved: "0.00", available: "100.00" },
    });
    const receipt = await withholding();
    for (const path of ["/credit-notes/eligible-invoices", "/debit-notes/eligible-invoices"]) {
      const eligible = await request(api.app)
        .get(`/api/v1${path}?pageSize=100`)
        .set("Cookie", a.cookies.operator);
      expect(eligible.status).toBe(200);
      expect((eligible.body as { data: { id: string }[] }).data.map((i) => i.id)).not.toContain(
        receipt.id,
      );
    }
    const draft = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: receipt.id,
        emissionPointId: a.emissionPointId,
        cause: "TOTAL_ANNULMENT",
        reason: "Anulación",
        lines: [],
      });
    expect([draft.status, (draft.body as { error: { code: string } }).error.code]).toEqual([
      404,
      "CREDIT_NOTE_INVOICE_NOT_FOUND",
    ]);
  });
});
