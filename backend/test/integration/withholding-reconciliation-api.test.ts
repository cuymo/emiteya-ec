// Reconciliación manual de un comprobante de retención (add-withholding-receipts, tarea 8.2, design
// D2, D18, D22 y D23), con los handlers reales y respuestas del SRI SINTÉTICAS: un administrador
// reconcilia una retención en revisión manual que pasa a autorizada; un operador recibe `403` y otra
// empresa `404`; un estado no reconciliable y una interacción en curso se rechazan; los eventos de la
// solicitud y de la finalización (`"07"` en `COMPLETED_AUDIT`) no llevan SOAP. Las reconciliaciones
// de los demás tipos siguen con sus propias pruebas, sin cambios.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { WithholdingReceiptView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { receptionResponse, response } from "../support/sri-responses.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: WithholdingReceiptView & { id: string }; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("reconciliación manual de un comprobante de retención", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let sri: CreditNoteTransmission;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  /** Retención emitida por la API, firmada y con su envío pendiente. */
  const signedReceipt = async () => {
    const draft = await request(api.app)
      .post("/api/v1/withholding-receipts/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        partyId: a.supplierId,
        relatedParty: "NO",
        emissionPointId: a.emissionPointId,
        supports: [
          {
            documentType: "01",
            supportCode: "01",
            number: "001001000000123",
            issueDate: "2026-10-01",
            totalWithoutTaxes: "100.00",
            importTotal: "115.00",
            taxes: [{ tax: "2", rateEntryKey: "4", base: "100.00", amount: "15.00" }],
            payments: [{ paymentMethod: "20", total: "115.00" }],
            withholdings: [{ tax: "1", entryKey: "312", base: "100.00" }],
          },
        ],
      });
    const emitted = await request(api.app)
      .post("/api/v1/withholding-receipts")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: (draft.body as Body).data.id, expectedVersion: 1 });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);
    return bodyOf(emitted).data as unknown as TestDocument;
  };
  /** Retención emitida por la API y llevada a revisión manual: recibida y con dos autorizaciones. */
  const inManualReview = async () => {
    const receipt = await signedReceipt();
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(receipt.id, "sri.transmit"), sri.context());
    sri.reply(receipt, [sri.authorized(receipt), sri.authorized(receipt)]);
    await sri.authorize().run(await sri.leasePending(receipt.id, "sri.authorize"), sri.context());
    expect(await stateOf(receipt.id)).toBe("MANUAL_REVIEW");
    return receipt;
  };
  const stateOf = async (id: string) =>
    (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const reconcile = (id: string, cookie: string, reason = "El SRI confirmó la autorización") =>
    request(api.app)
      .post(`/api/v1/withholding-receipts/${id}/reconciliations`)
      .set("Cookie", cookie)
      .send({ reason });

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_reconciliation_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "reconcilia-ret", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "reconcilia-ret-b", pool, p12Dir });
    sri = creditNoteTransmission(
      db.database.prisma,
      createPrismaJobStore(db.database.prisma, db.name),
    );
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("el administrador reconcilia una retención en revisión manual que pasa a autorizada", async () => {
    const receipt = await inManualReview();
    const operator = await reconcile(receipt.id, a.cookies.operator);
    expect(operator.status).toBe(403);
    const foreign = await reconcile(receipt.id, b.cookies.admin);
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([
      404,
      "WITHHOLDING_RECEIPT_NOT_FOUND",
    ]);

    const prisma = db.database.prisma;
    const untouched = async () => ({
      capacities: await prisma.creditCapacity.findMany(),
      returns: await prisma.stockReturnCapacity.findMany(),
      movements: await prisma.stockMovement.count(),
      balances: await prisma.stockBalance.findMany(),
      others: await prisma.electronicDocument.findMany({
        where: { documentType: { not: "07" } },
        orderBy: { id: "asc" },
      }),
    });
    const before = await untouched();
    const requested = await reconcile(receipt.id, a.cookies.admin);
    expect([requested.status, bodyOf(requested).data.state]).toEqual([202, "MANUAL_REVIEW"]);
    // Mientras el job está activo, otra solicitud se rechaza sin programar otra.
    const again = await reconcile(receipt.id, a.cookies.admin);
    expect([again.status, bodyOf(again).error.code]).toEqual([409, "SRI_INTERACTION_IN_PROGRESS"]);

    sri.reply(receipt, [sri.authorized(receipt)]);
    await sri.reconcile().run(await sri.leasePending(receipt.id, "sri.reconcile"), sri.context());
    expect(await stateOf(receipt.id)).toBe("AUTHORIZED");

    const events = await db.database.prisma.auditEvent.findMany({
      where: {
        companyId: a.companyId,
        action: { startsWith: "withholding_receipt.reconciliation" },
      },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => [event.action, event.actorUserId])).toEqual([
      ["withholding_receipt.reconciliation_requested", a.adminId],
      ["withholding_receipt.reconciliation_completed", a.adminId],
    ]);
    expect(events[0]!.changes).toEqual({
      withholdingReceiptId: receipt.id,
      documentNumber: receipt.documentNumber,
      state: "MANUAL_REVIEW",
      reason: "El SRI confirmó la autorización",
    });
    expect(events[1]!.changes).toEqual({
      withholdingReceiptId: receipt.id,
      documentNumber: receipt.documentNumber,
      result: "AUTHORIZED",
      state: "AUTHORIZED",
    });
    // Sin cambiar el inventario, las capacidades ni las facturas y notas.
    expect(await untouched()).toEqual(before);
    for (const event of events) {
      expect(JSON.stringify(event.changes)).not.toMatch(/soap|<|claveAcceso/i);
    }
    // La consulta muestra la autorización.
    const detail = await request(api.app)
      .get(`/api/v1/withholding-receipts/${receipt.id}`)
      .set("Cookie", a.cookies.operator);
    expect(bodyOf(detail).data).toMatchObject({
      state: "AUTHORIZED",
      transmission: { authorization: { number: receipt.accessKey } },
    });
    expect(bodyOf(detail).data.authorizedArtifact?.sizeBytes).toBeGreaterThan(0);
  });

  it("un estado que no se reconcilia se rechaza sin programarla, y un motivo vacío es inválido", async () => {
    const receipt = await inManualReview();
    sri.reply(receipt, [sri.authorized(receipt)]);
    await reconcile(receipt.id, a.cookies.admin);
    await sri.reconcile().run(await sri.leasePending(receipt.id, "sri.reconcile"), sri.context());
    const jobs = await db.database.prisma.job.count({
      where: { documentId: receipt.id, type: "sri.reconcile" },
    });
    const authorized = await reconcile(receipt.id, a.cookies.admin);
    expect([authorized.status, bodyOf(authorized).error.code]).toEqual([
      409,
      "WITHHOLDING_NOT_RECONCILABLE",
    ]);
    expect(
      await db.database.prisma.job.count({
        where: { documentId: receipt.id, type: "sri.reconcile" },
      }),
    ).toBe(jobs);
    const empty = await reconcile(receipt.id, a.cookies.admin, "  ");
    expect(empty.status).toBe(400);
    // Devuelta o no autorizada tampoco se reconcilian.
    const returned = await signedReceipt();
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
    const notAuthorized = await signedReceipt();
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri
      .transmit()
      .run(await sri.leasePending(notAuthorized.id, "sri.transmit"), sri.context());
    sri.reply(notAuthorized, [
      sri.authorized(notAuthorized, { estado: "NO AUTORIZADO", comprobante: undefined }),
    ]);
    await sri
      .authorize()
      .run(await sri.leasePending(notAuthorized.id, "sri.authorize"), sri.context());
    for (const [concluded, state] of [
      [returned, "RETURNED"],
      [notAuthorized, "NOT_AUTHORIZED"],
    ] as const) {
      expect(await stateOf(concluded.id)).toBe(state);
      const rejected = await reconcile(concluded.id, a.cookies.admin);
      expect([rejected.status, bodyOf(rejected).error.code], state).toEqual([
        409,
        "WITHHOLDING_NOT_RECONCILABLE",
      ]);
      expect(
        await db.database.prisma.job.count({
          where: { documentId: concluded.id, type: "sri.reconcile" },
        }),
      ).toBe(0);
    }
  });
});
