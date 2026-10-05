// Consulta de las notas de débito (add-debit-notes, tarea 7.1, design D20): el detalle desde el
// snapshot con la factura, los conceptos con su causa y su tratamiento, los impuestos por
// tratamiento, la forma de pago y la declaración presentada como declarada por el usuario; la lista
// con búsqueda, filtros y paginación; el historial de la transmisión; sin sesión `401` y otra
// empresa `404`.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  DebitNoteSummaryView,
  DebitNoteTransmissionView,
  DebitNoteView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { IVA0, insertAuthorizedInvoice, type InvoiceCompany } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: DebitNoteView & DebitNoteSummaryView[] & DebitNoteTransmissionView & { id: string };
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] };
const INTEREST = {
  cause: "LATE_PAYMENT_INTEREST",
  description: "Intereses por 30 días de mora",
  amount: "20.00",
  taxTreatment: "2:4",
};
const FREIGHT = {
  cause: "POST_INVOICE_COST_EXPENSE",
  description: "Flete posterior a la venta",
  amount: "5.00",
  taxTreatment: "2:0",
};

describe("consulta de notas de débito", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let good: string;
  let service: string;
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
  const get = (path: string, cookie = a.cookies.operator) =>
    request(api.app).get(`/api/v1${path}`).set("Cookie", cookie);
  const emitted = async (concepts: unknown[]) => {
    const invoice = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "10", unitPrice: "10.00" },
      { productId: service, quantity: "1", unitPrice: "15.00", rate: IVA0 },
    ]);
    const draft = await request(api.app)
      .post("/api/v1/debit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: invoice.id,
        emissionPointId: a.emissionPointId,
        paymentMethod: "20",
        concepts,
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const res = await request(api.app)
      .post("/api/v1/debit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: 1, declarations: DECLARATIONS });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { note: bodyOf(res).data, invoice };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_queries_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "consulta-nd-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "consulta-nd-b", pool, p12Dir });
    const fiscal = { companyId: a.companyId, adminId: a.adminId, points: [] };
    good = await insertProduct(db.database.prisma, fiscal, { name: "Cemento 50 kg" });
    service = await insertProduct(db.database.prisma, fiscal, {
      kind: "SERVICE",
      stockTracked: false,
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("el detalle muestra la factura, los conceptos, los impuestos, la forma de pago y la declaración como declarada", async () => {
    const { note, invoice } = await emitted([INTEREST, FREIGHT]);
    const res = await get(`/debit-notes/${note.id}`);
    expect(res.status).toBe(200);
    const detail = bodyOf(res).data;
    expect(detail).toMatchObject({
      id: note.id,
      documentType: "05",
      state: "SIGNED",
      invoice: {
        id: invoice.id,
        documentNumber: invoice.documentNumber,
        accessKey: invoice.accessKey,
        authorizationNumber: invoice.accessKey,
      },
      buyer: { identification: "0992877878001", legalName: "EL PERNO CIA. LTDA." },
      totals: {
        withoutTaxes: "25.00",
        taxes: [
          { key: "2:0", label: "IVA 0 %", base: "5.00", amount: "0.00" },
          { key: "2:4", label: "IVA 15 %", base: "20.00", amount: "3.00" },
        ],
        total: "28.00",
      },
      payment: {
        entryKey: "20",
        code: "20",
        label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
        amount: "28.00",
      },
    });
    expect(
      detail.concepts.map((c) => [c.cause, c.description, c.amount, c.taxTreatment.label]),
    ).toEqual([
      ["LATE_PAYMENT_INTEREST", "Intereses por 30 días de mora", "20.00", "IVA 15 %"],
      ["POST_INVOICE_COST_EXPENSE", "Flete posterior a la venta", "5.00", "IVA 0 %"],
    ]);
    expect(detail.declarations).toMatchObject({
      version: 1,
      basis: "USER_DECLARED",
      declaredBy: a.operatorId,
      declaredByName: "Operador consulta-nd-a",
      statements: [{ id: "NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE" }],
    });
    expect(detail.declarations.statements[0]!.source).toMatch(/art\. 16/);
    expect(detail.artifact).not.toBeNull();
    // Firmada, su envío al SRI quedó encolado: la transmisión está en curso y sin autorización.
    expect(detail.transmission).toMatchObject({ inProgress: true, authorization: null });
  });

  it("la lista busca por número o comprador, filtra por estado y causa, y pagina", async () => {
    const interest = await emitted([INTEREST]);
    const freight = await emitted([FREIGHT]);
    const all = await get("/debit-notes?pageSize=100");
    expect(all.status).toBe(200);
    const ids = bodyOf(all).data.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([interest.note.id, freight.note.id]));
    expect(bodyOf(all).data.find((item) => item.id === freight.note.id)).toMatchObject({
      invoice: { id: freight.invoice.id, documentNumber: freight.invoice.documentNumber },
      causes: ["POST_INVOICE_COST_EXPENSE"],
      buyerName: "EL PERNO CIA. LTDA.",
      total: "5.00",
      state: "SIGNED",
      transmissionStopped: false,
    });
    const byCause = await get("/debit-notes?cause=POST_INVOICE_COST_EXPENSE&pageSize=100");
    const causeIds = bodyOf(byCause).data.map((item) => item.id);
    expect(causeIds).toContain(freight.note.id);
    expect(causeIds).not.toContain(interest.note.id);
    const byNumber = await get(`/debit-notes?search=${interest.note.documentNumber}`);
    expect(bodyOf(byNumber).data.map((item) => item.id)).toEqual([interest.note.id]);
    const byState = await get("/debit-notes?state=AUTHORIZED");
    expect(bodyOf(byState).data).toEqual([]);
    const page = await get("/debit-notes?pageSize=1&page=1");
    expect([bodyOf(page).data.length, bodyOf(page).meta?.pageSize]).toEqual([1, 1]);
    expect(bodyOf(page).meta?.total).toBeGreaterThanOrEqual(2);
    const invalid = await get("/debit-notes?cause=RETURN");
    expect(invalid.status).toBe(400);
  });

  it("el historial de la transmisión muestra sus transiciones sin respuestas originales", async () => {
    const { note } = await emitted([INTEREST]);
    const res = await get(`/debit-notes/${note.id}/transmission`);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({ debitNoteId: note.id, state: "SIGNED" });
    expect(
      bodyOf(res).data.events.map((event) => (event.kind === "TRANSITION" ? event.toState : null)),
    ).toEqual(expect.arrayContaining(["RESERVED", "SIGNED"]));
    expect(JSON.stringify(bodyOf(res).data)).not.toMatch(/<\?xml|soap/i);
  });

  it("sin sesión responde 401; otra empresa, una factura o una nota inexistente, 404", async () => {
    const { note, invoice } = await emitted([INTEREST]);
    for (const path of [
      "/debit-notes",
      `/debit-notes/${note.id}`,
      `/debit-notes/${note.id}/transmission`,
    ]) {
      expect((await request(api.app).get(`/api/v1${path}`)).status, path).toBe(401);
    }
    for (const path of [`/debit-notes/${note.id}`, `/debit-notes/${note.id}/transmission`]) {
      const foreign = await get(path, b.cookies.admin);
      expect([foreign.status, bodyOf(foreign).error.code], path).toEqual([
        404,
        "DEBIT_NOTE_NOT_FOUND",
      ]);
    }
    const others = await get("/debit-notes?pageSize=100", b.cookies.admin);
    expect(bodyOf(others).data.map((item) => item.id)).not.toContain(note.id);
    const notANote = await get(`/debit-notes/${invoice.id}`);
    expect([notANote.status, bodyOf(notANote).error.code]).toEqual([404, "DEBIT_NOTE_NOT_FOUND"]);
    const missing = await get(`/debit-notes/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });
});
