// Reconciliación manual de una nota de débito (add-debit-notes, tarea 7.2, design D2, D17 y D22), con
// los handlers reales y respuestas del SRI SINTÉTICAS: un administrador reconcilia una nota en
// revisión manual que pasa a autorizada, sin tocar la capacidad acreditable ni el inventario; un
// operador recibe `403`; un estado no reconciliable y una interacción en curso se rechazan; los
// eventos de auditoría de la solicitud y de la finalización no llevan SOAP.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { DebitNoteView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { receptionResponse, response } from "../support/sri-responses.ts";
import { insertAuthorizedInvoice } from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: DebitNoteView & { id: string }; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] };

describe("reconciliación manual de una nota de débito", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let good: string;
  let sri: CreditNoteTransmission;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  /** Nota emitida por la API, firmada y con su envío pendiente. */
  const signedNote = async () => {
    const invoice = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: good, quantity: "5", unitPrice: "10.00", inventoryAffectsStock: true }],
    );
    const draft = await request(api.app)
      .post("/api/v1/debit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: invoice.id,
        emissionPointId: a.emissionPointId,
        paymentMethod: "20",
        concepts: [
          {
            cause: "POST_INVOICE_COST_EXPENSE",
            description: "Flete posterior a la venta",
            amount: "10.00",
            taxTreatment: "2:4",
          },
        ],
      });
    const emitted = await request(api.app)
      .post("/api/v1/debit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: (draft.body as Body).data.id,
        expectedVersion: 1,
        declarations: DECLARATIONS,
      });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);
    return bodyOf(emitted).data as unknown as TestDocument;
  };
  /** Nota emitida por la API y llevada a revisión manual: recibida y con dos autorizaciones. */
  const inManualReview = async () => {
    const note = await signedNote();
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(note.id, "sri.transmit"), sri.context());
    sri.reply(note, [sri.authorized(note), sri.authorized(note)]);
    await sri.authorize().run(await sri.leasePending(note.id, "sri.authorize"), sri.context());
    expect(await stateOf(note.id)).toBe("MANUAL_REVIEW");
    return note;
  };
  const stateOf = async (id: string) =>
    (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const reconcile = (id: string, cookie: string, reason = "El SRI confirmó la autorización") =>
    request(api.app)
      .post(`/api/v1/debit-notes/${id}/reconciliations`)
      .set("Cookie", cookie)
      .send({ reason });

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_reconciliation_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "reconcilia-nd", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "reconcilia-nd-b", pool, p12Dir });
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

  it("el administrador reconcilia una nota en revisión manual que pasa a autorizada, sin capacidades ni inventario", async () => {
    const note = await inManualReview();
    const operator = await reconcile(note.id, a.cookies.operator);
    expect(operator.status).toBe(403);
    const foreign = await reconcile(note.id, b.cookies.admin);
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([404, "DEBIT_NOTE_NOT_FOUND"]);

    const requested = await reconcile(note.id, a.cookies.admin);
    expect([requested.status, bodyOf(requested).data.state]).toEqual([202, "MANUAL_REVIEW"]);
    // Mientras el job está activo, otra solicitud se rechaza sin programar otra.
    const again = await reconcile(note.id, a.cookies.admin);
    expect([again.status, bodyOf(again).error.code]).toEqual([409, "SRI_INTERACTION_IN_PROGRESS"]);

    sri.reply(note, [sri.authorized(note)]);
    await sri.reconcile().run(await sri.leasePending(note.id, "sri.reconcile"), sri.context());
    expect(await stateOf(note.id)).toBe("AUTHORIZED");
    expect(await db.database.prisma.creditCapacity.count()).toBe(0);
    expect(await db.database.prisma.stockMovement.count({ where: { documentId: note.id } })).toBe(
      0,
    );

    const events = await db.database.prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: { startsWith: "debit_note.reconciliation" } },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => [event.action, event.actorUserId])).toEqual([
      ["debit_note.reconciliation_requested", a.adminId],
      ["debit_note.reconciliation_completed", a.adminId],
    ]);
    expect(events[0]!.changes).toEqual({
      debitNoteId: note.id,
      documentNumber: note.documentNumber,
      state: "MANUAL_REVIEW",
      reason: "El SRI confirmó la autorización",
    });
    expect(events[1]!.changes).toMatchObject({
      debitNoteId: note.id,
      documentNumber: note.documentNumber,
      state: "AUTHORIZED",
    });
    for (const event of events) {
      expect(JSON.stringify(event.changes)).not.toMatch(/soap|<|claveAcceso/i);
    }
  });

  it("un estado que no se reconcilia se rechaza sin programarla, y un motivo vacío es inválido", async () => {
    const note = await inManualReview();
    sri.reply(note, [sri.authorized(note)]);
    await reconcile(note.id, a.cookies.admin);
    await sri.reconcile().run(await sri.leasePending(note.id, "sri.reconcile"), sri.context());
    const jobs = await db.database.prisma.job.count({
      where: { documentId: note.id, type: "sri.reconcile" },
    });
    const authorized = await reconcile(note.id, a.cookies.admin);
    expect([authorized.status, bodyOf(authorized).error.code]).toEqual([
      409,
      "DEBIT_NOTE_NOT_RECONCILABLE",
    ]);
    expect(
      await db.database.prisma.job.count({ where: { documentId: note.id, type: "sri.reconcile" } }),
    ).toBe(jobs);
    const empty = await reconcile(note.id, a.cookies.admin, "  ");
    expect(empty.status).toBe(400);
    // Devuelta o no autorizada tampoco se reconcilian, sin programar la reconciliación.
    const returned = await signedNote();
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
    const notAuthorized = await signedNote();
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
        "DEBIT_NOTE_NOT_RECONCILABLE",
      ]);
      expect(
        await db.database.prisma.job.count({
          where: { documentId: concluded.id, type: "sri.reconcile" },
        }),
      ).toBe(0);
    }
  });
});
