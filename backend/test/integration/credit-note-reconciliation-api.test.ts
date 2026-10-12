// Reconciliación manual de una nota de crédito (add-credit-notes, tarea 10.2, design D2, D13 y D18),
// con los handlers reales y respuestas del SRI SINTÉTICAS: un administrador reconcilia una nota en
// revisión manual que pasa a autorizada con su crédito aplicado; un operador recibe `403`; un estado
// no reconciliable y una interacción en curso se rechazan; los eventos de auditoría no llevan SOAP.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CreditNoteView } from "@facturador/contracts";
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

type Body = { data: CreditNoteView & { id: string }; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};

describe("reconciliación manual de una nota de crédito", () => {
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

  /** Nota emitida por la API y llevada a revisión manual: recibida y con dos autorizaciones. */
  const inManualReview = async () => {
    const invoice = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: good, quantity: "5", unitPrice: "10.00" }],
    );
    const draft = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: invoice.id,
        emissionPointId: a.emissionPointId,
        cause: "RETURN",
        reason: "Devolución",
        lines: [{ position: 1, quantity: "2" }],
      });
    const emitted = await request(api.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: (draft.body as Body).data.id,
        expectedVersion: 1,
        declarations: DECLARATIONS,
      });
    const note = bodyOf(emitted).data as unknown as TestDocument;
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
      .post(`/api/v1/credit-notes/${id}/reconciliations`)
      .set("Cookie", cookie)
      .send({ reason });

  beforeAll(async () => {
    db = await createMigratedSchema("credit_note_reconciliation_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    a = await readyCompany(api, db, {
      slug: "reconcilia-nc",
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

  it("el administrador reconcilia una nota en revisión manual que pasa a autorizada con su crédito aplicado", async () => {
    const note = await inManualReview();
    const operator = await reconcile(note.id, a.cookies.operator);
    expect(operator.status).toBe(403);

    const requested = await reconcile(note.id, a.cookies.admin);
    expect([requested.status, bodyOf(requested).data.state]).toEqual([202, "MANUAL_REVIEW"]);
    // Mientras el job está activo, otra solicitud se rechaza sin programar otra.
    const again = await reconcile(note.id, a.cookies.admin);
    expect([again.status, bodyOf(again).error.code]).toEqual([409, "SRI_INTERACTION_IN_PROGRESS"]);

    sri.reply(note, [sri.authorized(note)]);
    await sri.reconcile().run(await sri.leasePending(note.id, "sri.reconcile"), sri.context());
    expect(await stateOf(note.id)).toBe("AUTHORIZED");
    const reservation = await db.database.prisma.creditReservation.findFirstOrThrow({
      where: { creditNoteId: note.id },
    });
    expect(reservation.status).toBe("APPLIED");

    const events = await db.database.prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: { startsWith: "credit_note.reconciliation" } },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => [event.action, event.actorUserId])).toEqual([
      ["credit_note.reconciliation_requested", a.adminId],
      ["credit_note.reconciliation_completed", a.adminId],
    ]);
    expect(events[0]!.changes).toEqual({
      creditNoteId: note.id,
      documentNumber: note.documentNumber,
      state: "MANUAL_REVIEW",
      reason: "El SRI confirmó la autorización",
    });
    expect(events[1]!.changes).toMatchObject({
      creditNoteId: note.id,
      documentNumber: note.documentNumber,
      state: "AUTHORIZED",
    });
    for (const event of events) {
      expect(JSON.stringify(event.changes)).not.toMatch(/soap|<|claveAcceso/i);
    }
  });

  it("un estado que no se reconcilia se rechaza", async () => {
    const note = await inManualReview();
    sri.reply(note, [sri.authorized(note)]);
    await reconcile(note.id, a.cookies.admin);
    await sri.reconcile().run(await sri.leasePending(note.id, "sri.reconcile"), sri.context());
    const authorized = await reconcile(note.id, a.cookies.admin);
    expect([authorized.status, bodyOf(authorized).error.code]).toEqual([
      409,
      "CREDIT_NOTE_NOT_RECONCILABLE",
    ]);
    const empty = await reconcile(note.id, a.cookies.admin, "  ");
    expect(empty.status).toBe(400);
  });
});
