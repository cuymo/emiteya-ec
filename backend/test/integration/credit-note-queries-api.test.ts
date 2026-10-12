// Consulta de notas de crédito y crédito de una factura (add-credit-notes, tarea 10.1, design D16):
// el detalle desde el snapshot con la factura, la causa, las líneas con su retorno físico y las
// declaraciones presentadas como declaradas por el usuario; la lista con búsqueda, filtros y
// paginación; el historial de la transmisión; el crédito aplicado, reservado y disponible de una
// factura; sin sesión `401` y otra empresa `404`.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  CreditNoteSummaryView,
  CreditNoteTransmissionView,
  CreditNoteView,
  InvoiceCreditView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  insertAuthorizedInvoice,
  insertCreditNote,
  recordOutflow,
  type AuthorizedInvoiceDocument,
} from "./credit-notes-harness.ts";
import { creditNoteTransmission } from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: CreditNoteView &
    CreditNoteSummaryView[] &
    CreditNoteTransmissionView &
    InvoiceCreditView & { id: string; version: number };
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};

describe("consulta de notas de crédito", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let good: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const fiscal = (company: ReadyCompany): FiscalCompany => ({
    companyId: company.companyId,
    adminId: company.adminId,
    points: [
      {
        establishmentId: company.establishmentId,
        emissionPointId: company.emissionPointId,
        code: "001",
      },
    ],
  });
  const invoice = async () => {
    const created = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: good, quantity: "10", unitPrice: "10.00", inventoryAffectsStock: true }],
    );
    await recordOutflow(db.database.prisma, a, created, good, "10");
    return created;
  };
  const emitNote = async (
    target: AuthorizedInvoiceDocument,
    quantity: string,
    physicalReturn = "0",
  ) => {
    const draft = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: target.id,
        emissionPointId: a.emissionPointId,
        cause: "RETURN",
        reason: "Devolución de mercadería",
        lines: [{ position: 1, quantity, physicalReturn }],
      });
    const res = await request(api.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: 1, declarations: DECLARATIONS });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const get = (path: string, cookie = a.cookies.operator) =>
    request(api.app).get(`/api/v1${path}`).set("Cookie", cookie);

  beforeAll(async () => {
    db = await createMigratedSchema("credit_note_queries_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "consulta-nc-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "consulta-nc-b", pool, p12Dir });
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

  it("el detalle muestra la factura, la causa, las líneas con su retorno físico y las declaraciones declaradas", async () => {
    const target = await invoice();
    const note = await emitNote(target, "2", "1");
    const res = await get(`/credit-notes/${note.id}`);
    expect(res.status).toBe(200);
    const detail = bodyOf(res).data;
    expect(detail).toMatchObject({
      id: note.id,
      documentType: "04",
      state: "SIGNED",
      cause: "RETURN",
      reason: "Devolución de mercadería",
      invoice: {
        id: target.id,
        documentNumber: target.documentNumber,
        accessKey: target.accessKey,
      },
      buyer: { identification: "0992877878001", legalName: "EL PERNO CIA. LTDA." },
      lines: [
        {
          position: 1,
          quantity: "2",
          unitPrice: "10.00",
          taxableBase: "20.00",
          physicalReturn: "1",
        },
      ],
      totals: { withoutTaxes: "20.00", total: "23.00" },
      diagnostic: null,
      // Firmada, su envío al SRI está programado.
      transmission: { inProgress: true, authorization: null },
    });
    expect(detail.declarations).toMatchObject({
      version: 1,
      basis: "USER_DECLARED",
      declaredBy: a.operatorId,
      declaredByName: "Operador consulta-nc-a",
    });
    expect(detail.declarations.statements.map((s) => s.id)).toEqual(DECLARATIONS.statements);
    expect(detail.declarations.statements[0]!.source).toMatch(/disposición general segunda/);
    expect(detail.artifact).toMatchObject({ sizeBytes: expect.any(Number) as number });

    const history = await get(`/credit-notes/${note.id}/transmission`);
    expect(
      bodyOf(history).data.events.map((e) => (e.kind === "TRANSITION" ? e.toState : e.kind)),
    ).toEqual(["SIGNED", "RESERVED"]);
  });

  it("lista con búsqueda, filtros de estado y causa, y paginación", async () => {
    const target = await invoice();
    const first = await emitNote(target, "1");
    const second = await emitNote(target, "1");
    const all = await get("/credit-notes?pageSize=1");
    expect(bodyOf(all).data).toHaveLength(1);
    expect(bodyOf(all).meta!.total).toBeGreaterThanOrEqual(2);
    expect(bodyOf(all).data[0]).toMatchObject({
      id: second.id,
      invoice: { id: target.id },
      cause: "RETURN",
    });
    const search = await get(`/credit-notes?search=${first.documentNumber}`);
    expect(bodyOf(search).data.map((n) => n.id)).toEqual([first.id]);
    expect(bodyOf(await get("/credit-notes?cause=TOTAL_ANNULMENT")).data).toEqual([]);
    expect(
      bodyOf(await get("/credit-notes?state=SIGNED&pageSize=100")).data.map((n) => n.id),
    ).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(bodyOf(await get("/credit-notes?state=AUTHORIZED")).data).toEqual([]);
    expect((await get("/credit-notes?cause=DISCOUNT")).status).toBe(400);
  });

  it("el crédito de una factura muestra lo aplicado, lo reservado y lo disponible, por línea y con el retorno posible", async () => {
    const target = await invoice();
    const sri = creditNoteTransmission(
      db.database.prisma,
      createPrismaJobStore(db.database.prisma, db.name),
    );
    const applied = await insertCreditNote(db.database.prisma, fiscal(a), target, {
      lines: [{ position: 1, quantity: "3", physicalReturn: "3" }],
    });
    sri.reply(applied, [sri.authorized(applied)]);
    await sri.authorize().run(await sri.jobFor(applied, "sri.authorize"), sri.context());
    await insertCreditNote(db.database.prisma, fiscal(a), target, {
      lines: [{ position: 1, quantity: "2", physicalReturn: "1" }],
    });
    const res = await get(`/credit-notes/invoices/${target.id}/credit`);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      invoiceId: target.id,
      documentNumber: target.documentNumber,
      total: "115.00",
      applied: "34.50",
      reserved: "23.00",
      available: "57.50",
      totalAnnulmentAvailable: false,
    });
    expect(bodyOf(res).data.lines).toMatchObject([
      {
        position: 1,
        quantity: "10",
        inventoryAffectsStock: true,
        credited: { applied: "3", reserved: "2", available: "5" },
        returnable: { original: "10", applied: "3", reserved: "1", available: "6" },
      },
    ]);
    const fresh = await invoice();
    const untouched = await get(`/credit-notes/invoices/${fresh.id}/credit`);
    expect(bodyOf(untouched).data).toMatchObject({
      applied: "0.00",
      reserved: "0.00",
      available: "115.00",
      totalAnnulmentAvailable: true,
      lines: [{ credited: { applied: "0", reserved: "0", available: "10" } }],
    });
  });

  it("sin sesión responde 401 y la nota o la factura de otra empresa, 404", async () => {
    const target = await invoice();
    const note = await emitNote(target, "1");
    for (const path of [
      "/credit-notes",
      `/credit-notes/${note.id}`,
      `/credit-notes/invoices/${target.id}/credit`,
    ]) {
      expect((await request(api.app).get(`/api/v1${path}`)).status).toBe(401);
    }
    for (const path of [`/credit-notes/${note.id}`, `/credit-notes/${note.id}/transmission`]) {
      const res = await get(path, b.cookies.admin);
      expect([res.status, bodyOf(res).error.code]).toEqual([404, "CREDIT_NOTE_NOT_FOUND"]);
    }
    const credit = await get(`/credit-notes/invoices/${target.id}/credit`, b.cookies.admin);
    expect([credit.status, bodyOf(credit).error.code]).toEqual([
      404,
      "CREDIT_NOTE_INVOICE_NOT_FOUND",
    ]);
    expect(bodyOf(await get("/credit-notes?pageSize=100", b.cookies.admin)).data).toEqual([]);
    // Una factura no se consulta como nota de crédito.
    expect((await get(`/credit-notes/${target.id}`)).status).toBe(404);
  });
});
