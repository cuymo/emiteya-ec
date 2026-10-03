// Consulta de facturas (add-invoice-emission, tarea 9.3, design D13): lista paginada por estado y
// búsqueda por número o comprador, de la más reciente a la más antigua; detalle desde el snapshot
// con el diagnóstico si sigue reservada; sin el XML firmado; aislamiento por empresa y permisos.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InvoiceSummaryView, InvoiceView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: InvoiceView & InvoiceSummaryView[] & { id: string; version: number };
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("consulta de facturas", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let busy: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const invoices: InvoiceView[] = [];
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  async function emit(company: ReadyCompany, app = api, buyerPartyId = company.customerId) {
    const draft = await request(app.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", company.cookies.operator)
      .send({
        emissionPointId: company.emissionPointId,
        buyerPartyId,
        lines: [{ productId: company.productId, quantity: "1" }],
        payments: [{ paymentMethod: "01" }],
      });
    const res = await request(app.app)
      .post("/api/v1/invoices")
      .set("Cookie", company.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  }
  const list = async (company: ReadyCompany, query = "") =>
    bodyOf(
      await request(api.app).get(`/api/v1/invoices${query}`).set("Cookie", company.cookies.admin),
    );

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_queries");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    busy = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      invoices: {
        signer: {
          signDocument: () =>
            Promise.reject(Object.assign(new Error("saturado"), { code: "CRYPTO_BUSY" })),
        },
      },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "b", pool, p12Dir });
    invoices.push(await emit(a));
    invoices.push(await emit(a, api, a.consumerFinalId));
    invoices.push(await emit(a, busy));
    await emit(b);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("lista las facturas de la empresa de la más reciente a la más antigua, paginadas", async () => {
    const all = await list(a);
    expect(all.meta).toEqual({ page: 1, pageSize: 25, total: 3 });
    expect(all.data.map((item) => item.documentNumber)).toEqual([
      "001-001-000000003",
      "001-001-000000002",
      "001-001-000000001",
    ]);
    expect(all.data[0]).toMatchObject({
      id: invoices[2]!.id,
      state: "RESERVED",
      diagnosticCode: "CRYPTO_BUSY",
      buyerName: "EL PERNO CIA. LTDA.",
      total: "10.06",
    });
    expect(all.data[2]).toMatchObject({ state: "SIGNED", diagnosticCode: null });
    const page = await list(a, "?pageSize=1&page=2");
    expect(page.meta).toEqual({ page: 2, pageSize: 1, total: 3 });
    expect(page.data.map((item) => item.documentNumber)).toEqual(["001-001-000000002"]);
  });

  it("filtra por estado", async () => {
    expect((await list(a, "?state=RESERVED")).data.map((i) => i.id)).toEqual([invoices[2]!.id]);
    expect((await list(a, "?state=SIGNED")).meta?.total).toBe(2);
  });

  it("busca por número o por comprador, solo en la empresa", async () => {
    const byNumber = await list(a, "?search=001-001-000000002");
    expect(byNumber.data.map((i) => i.id)).toEqual([invoices[1]!.id]);
    expect((await list(a, "?search=consumidor")).data.map((i) => i.id)).toEqual([invoices[1]!.id]);
    expect((await list(a, "?search=0992877878001")).meta?.total).toBe(2);
    // El número 000000001 existe también en la empresa B, que nunca aparece.
    expect((await list(a, "?search=001-001-000000001")).meta?.total).toBe(1);
  });

  it("el detalle de una factura firmada muestra número, clave, totales y estado, sin diagnóstico ni XML", async () => {
    const res = await request(api.app)
      .get(`/api/v1/invoices/${invoices[0]!.id}`)
      .set("Cookie", a.cookies.operator);
    expect(res.status).toBe(200);
    const view = bodyOf(res).data;
    expect(view).toMatchObject({
      state: "SIGNED",
      documentNumber: "001-001-000000001",
      accessKey: invoices[0]!.accessKey,
      totals: { total: "10.06" },
      diagnostic: null,
      lines: [{ description: "Cemento 50 kg", unitPrice: "8.75" }],
      payments: [{ code: "01", amount: "10.06" }],
    });
    expect(view.artifact?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/<factura|ds:Signature|content/);
  });

  it("el detalle de una factura reservada muestra la etapa, el motivo y si es reintentable", async () => {
    const view = bodyOf(
      await request(api.app)
        .get(`/api/v1/invoices/${invoices[2]!.id}`)
        .set("Cookie", a.cookies.admin),
    ).data;
    expect(view).toMatchObject({
      state: "RESERVED",
      artifact: null,
      diagnostic: {
        stage: "SIGN",
        code: "CRYPTO_BUSY",
        class: "RETRYABLE_OPERATIONAL",
        message: "El servicio de firma está saturado. Reintenta en unos segundos.",
        attemptCount: 1,
      },
    });
  });

  it("la factura emitida por un operador queda registrada con él como autor", async () => {
    const document = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: invoices[0]!.id },
    });
    expect(document.createdBy).toBe(a.operatorId);
  });

  it("una factura de otra empresa no existe para ella y no aparece en su lista", async () => {
    const res = await request(api.app)
      .get(`/api/v1/invoices/${invoices[0]!.id}`)
      .set("Cookie", b.cookies.admin);
    expect(res.status).toBe(404);
    expect(bodyOf(res).error.code).toBe("INVOICE_NOT_FOUND");
    expect((await list(b)).data.map((i) => i.id)).not.toContain(invoices[0]!.id);
  });

  it("sin sesión, consultar o emitir responde no autenticado", async () => {
    expect((await request(api.app).get("/api/v1/invoices")).status).toBe(401);
    expect((await request(api.app).get(`/api/v1/invoices/${invoices[0]!.id}`)).status).toBe(401);
    expect(
      (
        await request(api.app)
          .post("/api/v1/invoices")
          .set("Idempotency-Key", randomUUID())
          .send({ draftId: "x", expectedVersion: 1 })
      ).status,
    ).toBe(401);
  });

  it("rechaza un estado desconocido en el filtro", async () => {
    const res = await request(api.app)
      .get("/api/v1/invoices?state=DRAFT")
      .set("Cookie", a.cookies.admin);
    expect(res.status).toBe(400);
  });
});
