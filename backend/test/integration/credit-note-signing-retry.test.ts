// Reintento de la firma de una nota de crédito (add-credit-notes, tarea 8.4, design D2 y D7): una
// nota que quedó reservada por un servicio ocupado se firma con su mismo número, su misma clave y su
// mismo snapshot, con `credit_note.signing_retried`, y su capacidad sigue reservada. Una nota firmada
// se devuelve sin efecto ni auditoría; la de otra empresa o una factura responden `404`.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CreditNoteView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { insertAuthorizedInvoice, type InvoiceCompany } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = { data: CreditNoteView & { id: string; version: number }; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};
type App = ReturnType<typeof buildTaxpayerApp>;

describe("reintento de la firma de una nota de crédito", () => {
  let db: MigratedSchema;
  let api: App;
  let busy: App;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let good: string;
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
  /** Nota de devolución emitida con `app`: con el firmador ocupado queda reservada. */
  const emitted = async (app: App) => {
    const invoice = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "5", unitPrice: "10.00" },
    ]);
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
    const res = await request(app.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: 1, declarations: DECLARATIONS });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { note: bodyOf(res).data, invoice };
  };
  const retry = (app: App, id: string, cookie = a.cookies.operator) =>
    request(app.app).post(`/api/v1/credit-notes/${id}/signing-attempts`).set("Cookie", cookie);
  const retried = (id: string) =>
    db.database.prisma.auditEvent.count({
      where: {
        action: "credit_note.signing_retried",
        changes: { path: ["creditNoteId"], equals: id },
      },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("credit_note_signing_retry");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    busy = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      creditNotes: {
        signer: {
          signDocument: () =>
            Promise.reject(Object.assign(new Error("ocupado"), { code: "CRYPTO_BUSY" })),
        },
      },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "reintento-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "reintento-b", pool, p12Dir });
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

  it("firma la nota reservada con su mismo número y su misma clave, y la capacidad sigue reservada", async () => {
    const { note, invoice } = await emitted(busy);
    expect(note.state).toBe("RESERVED");
    expect(note.diagnostic).toMatchObject({ code: "CRYPTO_BUSY", class: "RETRYABLE_OPERATIONAL" });
    const snapshot = (
      await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id: note.id } })
    ).snapshot;

    const res = await retry(api, note.id);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      id: note.id,
      state: "SIGNED",
      documentNumber: note.documentNumber,
      accessKey: note.accessKey,
      diagnostic: null,
    });
    const document = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: note.id },
    });
    expect(document.snapshot).toEqual(snapshot);
    expect(await retried(note.id)).toBe(1);
    const reservation = await db.database.prisma.creditReservation.findFirstOrThrow({
      where: { creditNoteId: note.id },
    });
    expect(reservation.status).toBe("RESERVED");
    const capacity = await db.database.prisma.creditCapacity.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(capacity.reservedTotal.toFixed()).toBe("23");
  });

  it("un reintento sin éxito deja el diagnóstico y lo audita; una nota firmada se devuelve sin efecto", async () => {
    const { note } = await emitted(busy);
    const failed = await retry(busy, note.id);
    expect([
      failed.status,
      bodyOf(failed).data.state,
      bodyOf(failed).data.diagnostic?.code,
    ]).toEqual([200, "RESERVED", "CRYPTO_BUSY"]);
    expect(await retried(note.id)).toBe(1);
    await retry(api, note.id);
    const unchanged = await retry(api, note.id);
    expect([unchanged.status, bodyOf(unchanged).data.state]).toEqual([200, "SIGNED"]);
    expect(await retried(note.id)).toBe(2);
  });

  it("una nota de otra empresa o una factura responden 404", async () => {
    const { note, invoice } = await emitted(api);
    const foreign = await retry(api, note.id, b.cookies.admin);
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([404, "CREDIT_NOTE_NOT_FOUND"]);
    const notANote = await retry(api, invoice.id);
    expect([notANote.status, bodyOf(notANote).error.code]).toEqual([404, "CREDIT_NOTE_NOT_FOUND"]);
    expect(
      (await request(api.app).post(`/api/v1/credit-notes/${note.id}/signing-attempts`)).status,
    ).toBe(401);
  });
});
