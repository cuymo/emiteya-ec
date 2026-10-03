// API de borradores de factura con dos empresas (add-invoice-emission, tareas 7.1 y 7.2, design D2,
// D6 y D13): guardar, corregir con versión y eliminar sin datos fiscales, borradores incompletos,
// vista previa no fiscal con el precio vigente del producto, límites del contenido, referencias de
// la empresa, aislamiento, permisos y borrador emitido inmutable.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { DraftSummaryView, DraftView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  CUSTODY,
  createProduct,
  insertReservedDocument,
  readyCompany,
  type ReadyCompany,
} from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: DraftView & DraftSummaryView[];
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
// 10:00 del 3 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-03T15:00:00Z");
const MAX_LINES = 3;

describe("API de borradores de factura", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const call = (cookie: string, method: "get" | "post" | "put" | "delete", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookie);
  const body = (company: ReadyCompany, overrides: Record<string, unknown> = {}) => ({
    emissionPointId: company.emissionPointId,
    buyerPartyId: company.customerId,
    lines: [{ productId: company.productId, quantity: "3", discount: "1.25" }],
    payments: [{ paymentMethod: "01" }],
    ...overrides,
  });
  async function created(company: ReadyCompany, overrides: Record<string, unknown> = {}) {
    const res = await call(company.cookies.admin, "post", "/invoices/drafts").send(
      body(company, overrides),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  }
  const fiscalTrace = async () => ({
    documents: await db.database.prisma.electronicDocument.count(),
    reservations: await db.database.prisma.fiscalSequenceReservation.count(),
    sequences: await db.database.prisma.fiscalSequence.count(),
  });

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_drafts_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      now: () => NOW,
      signing: { pool, custody: CUSTODY },
      invoices: { maxLines: MAX_LINES },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "b", pool, p12Dir });
  }, 120_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  describe("borradores (spec invoices: Borradores de factura)", () => {
    it("guarda un borrador sin número ni clave, con su autor y su fecha, sin tocar el contador", async () => {
      const before = await fiscalTrace();
      const draft = await created(a);
      expect(draft).toMatchObject({
        version: 1,
        emissionPoint: { establishmentCode: "001", code: "001", available: true },
        buyer: { id: a.customerId, identification: "0992877878001", systemRecord: null },
        lines: [
          {
            position: 1,
            product: { id: a.productId, name: "Cemento 50 kg", unitPrice: "8.75" },
            quantity: "3",
            discount: "1.25",
          },
        ],
        payments: [{ position: 1, paymentMethod: "01", code: "01", amount: null }],
        createdBy: a.adminId,
        updatedBy: a.adminId,
      });
      expect(JSON.stringify(draft)).not.toMatch(/accessKey|documentNumber|sequential/);
      expect(await fiscalTrace()).toEqual(before);
    });

    it("la vista previa no fiscal calcula con el precio vigente y la fecha de hoy en Ecuador", async () => {
      const draft = await created(a);
      expect(draft.preview).toEqual({
        evaluatedOn: "2026-10-03",
        lines: [
          {
            position: 1,
            unitPrice: "8.75",
            taxableBase: "25.00",
            taxes: [
              { taxCode: "2", rateCode: "4", percentage: "15", base: "25.00", amount: "3.75" },
            ],
          },
        ],
        totals: {
          withoutTaxes: "25.00",
          discount: "1.25",
          taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: "25.00", amount: "3.75" }],
          total: "28.75",
        },
        issues: [],
      });
    });

    it("guarda un borrador incompleto y su vista previa dice lo que falta", async () => {
      const res = await call(a.cookies.operator, "post", "/invoices/drafts").send({});
      expect(res.status).toBe(201);
      const draft = bodyOf(res).data;
      expect(draft).toMatchObject({ emissionPoint: null, buyer: null, lines: [], payments: [] });
      expect(draft.preview.totals).toBeNull();
      expect(draft.preview.issues[0]).toMatchObject({
        code: "INVOICE_DRAFT_INCOMPLETE",
        message:
          "Al borrador le falta el punto de emisión, el comprador, al menos una línea, al menos una forma de pago.",
      });
    });

    it("corrige con la versión vigente y rechaza una versión desactualizada sin cambiarlo", async () => {
      const draft = await created(a);
      const updated = await call(a.cookies.operator, "put", `/invoices/drafts/${draft.id}`).send(
        body(a, {
          lines: [{ productId: a.productId, quantity: "1", discount: "0" }],
          expectedVersion: 1,
        }),
      );
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(bodyOf(updated).data).toMatchObject({
        version: 2,
        updatedBy: a.operatorId,
        lines: [{ quantity: "1", discount: "0" }],
      });
      const stale = await call(a.cookies.admin, "put", `/invoices/drafts/${draft.id}`).send(
        body(a, { expectedVersion: 1 }),
      );
      expect(stale.status).toBe(409);
      expect(bodyOf(stale).error.code).toBe("INVOICE_DRAFT_CHANGED");
      const current = bodyOf(
        await call(a.cookies.admin, "get", `/invoices/drafts/${draft.id}`),
      ).data;
      expect(current).toMatchObject({ version: 2, lines: [{ quantity: "1" }] });
    });

    it("elimina un borrador sin dejar rastro fiscal", async () => {
      const before = await fiscalTrace();
      const draft = await created(a);
      const deleted = await call(a.cookies.operator, "delete", `/invoices/drafts/${draft.id}`);
      expect(deleted.status).toBe(204);
      const gone = await call(a.cookies.admin, "get", `/invoices/drafts/${draft.id}`);
      expect(gone.status).toBe(404);
      expect(bodyOf(gone).error.code).toBe("INVOICE_DRAFT_NOT_FOUND");
      expect(await fiscalTrace()).toEqual(before);
      expect(
        await db.database.prisma.invoiceDraftLine.count({ where: { draftId: draft.id } }),
      ).toBe(0);
    });

    it("un borrador emitido no se corrige ni se elimina, y la factura no cambia", async () => {
      const draft = await created(a);
      const prisma = db.database.prisma;
      const document = await insertReservedDocument(db, a);
      await prisma.invoiceDraft.update({
        where: { id: draft.id },
        data: { status: "EMITTED", documentId: document.id },
      });
      for (const res of [
        await call(a.cookies.admin, "put", `/invoices/drafts/${draft.id}`).send(
          body(a, { expectedVersion: 1 }),
        ),
        await call(a.cookies.admin, "delete", `/invoices/drafts/${draft.id}`),
        await call(a.cookies.admin, "get", `/invoices/drafts/${draft.id}`),
      ]) {
        expect(res.status).toBe(409);
        expect(bodyOf(res).error.code).toBe("INVOICE_DRAFT_ALREADY_EMITTED");
        expect(bodyOf(res).error.message).toContain(document.id);
      }
      const unchanged = await prisma.electronicDocument.findUniqueOrThrow({
        where: { id: document.id },
      });
      expect([unchanged.state, unchanged.total.toFixed()]).toEqual(["RESERVED", "28.75"]);
      const listed = bodyOf(await call(a.cookies.admin, "get", "/invoices/drafts")).data;
      expect(listed.map((item) => item.id)).not.toContain(draft.id);
    });
  });

  describe("contenido (spec invoices: Contenido de la factura y Formas de pago)", () => {
    it("rechaza un precio enviado en la línea por ser un campo no permitido", async () => {
      const res = await call(a.cookies.admin, "post", "/invoices/drafts").send(
        body(a, { lines: [{ productId: a.productId, quantity: "1", unitPrice: "1.00" }] }),
      );
      expect(res.status).toBe(400);
      expect(bodyOf(res).error.message).toBe("La solicitud contiene campos no permitidos.");
    });

    it("rechaza una cantidad de 7 decimales sin redondearla", async () => {
      const res = await call(a.cookies.admin, "post", "/invoices/drafts").send(
        body(a, { lines: [{ productId: a.productId, quantity: "1.1234567" }] }),
      );
      expect(res.status).toBe(400);
      expect(bodyOf(res).error.message).toBe("Admite como máximo 6 decimales.");
    });

    it("rechaza más líneas que el límite configurado de la aplicación", async () => {
      const line = { productId: a.productId, quantity: "1" };
      const res = await call(a.cookies.admin, "post", "/invoices/drafts").send(
        body(a, { lines: Array.from({ length: MAX_LINES + 1 }, () => line) }),
      );
      expect(res.status).toBe(400);
      expect(bodyOf(res).error).toMatchObject({
        code: "INVOICE_TOO_MANY_LINES",
        message: `El borrador admite como máximo ${MAX_LINES} líneas. Es un límite de la aplicación, no del SRI.`,
      });
      const ok = await call(a.cookies.admin, "post", "/invoices/drafts").send(
        body(a, { lines: Array.from({ length: MAX_LINES }, () => line) }),
      );
      expect(ok.status).toBe(201);
    });

    it("rechaza una forma de pago que no está en el catálogo e identifica cuál", async () => {
      const res = await call(a.cookies.admin, "post", "/invoices/drafts").send(
        body(a, { payments: [{ paymentMethod: "01", amount: "1.00" }, { paymentMethod: "99" }] }),
      );
      expect(res.status).toBe(400);
      expect(bodyOf(res).error).toMatchObject({
        code: "PAYMENT_METHOD_NOT_FOUND",
        message: "Forma de pago 2: 99 no existe en el catálogo de formas de pago.",
      });
    });

    it("la vista previa sigue el precio vigente del producto, que el borrador no guarda", async () => {
      const productId = await createProduct(db, a, { unitPrice: "10", name: "Varilla" });
      const draft = await created(a, {
        lines: [{ productId, quantity: "2" }],
      });
      expect(draft.preview.totals?.total).toBe("23.00");
      await db.database.prisma.product.update({
        where: { id: productId },
        data: { unitPrice: "12" },
      });
      const reread = bodyOf(
        await call(a.cookies.admin, "get", `/invoices/drafts/${draft.id}`),
      ).data;
      expect(reread.lines[0]?.product.unitPrice).toBe("12");
      expect(reread.preview.totals?.total).toBe("27.60");
    });

    it("la vista previa muestra todos los problemas de la emisión, por línea", async () => {
      const ice = await createProduct(db, a, { unitPrice: "1", ice: "3011", name: "Cigarrillos" });
      const draft = await created(a, {
        buyerPartyId: a.supplierId,
        lines: [
          { productId: a.productId, quantity: "1", discount: "9" },
          { productId: ice, quantity: "1" },
        ],
      });
      expect(draft.preview.totals).toBeNull();
      expect(draft.preview.issues.map((i) => [i.code, i.line])).toEqual([
        ["BUYER_NOT_CUSTOMER", null],
        ["DISCOUNT_EXCEEDS_SUBTOTAL", 1],
        ["TAX_REFERENCE_NOT_USABLE", 2],
      ]);
    });
  });

  describe("aislamiento, referencias y permisos (design D13)", () => {
    it("sin sesión responde 401", async () => {
      const res = await request(api.app).get("/api/v1/invoices/drafts");
      expect(res.status).toBe(401);
    });

    it("un borrador de otra empresa no existe para ella", async () => {
      const draft = await created(a);
      for (const res of [
        await call(b.cookies.admin, "get", `/invoices/drafts/${draft.id}`),
        await call(b.cookies.admin, "put", `/invoices/drafts/${draft.id}`).send(
          body(b, { expectedVersion: 1 }),
        ),
        await call(b.cookies.admin, "delete", `/invoices/drafts/${draft.id}`),
      ]) {
        expect(res.status).toBe(404);
        expect(bodyOf(res).error.code).toBe("INVOICE_DRAFT_NOT_FOUND");
      }
      const listed = bodyOf(await call(b.cookies.admin, "get", "/invoices/drafts")).data;
      expect(listed.map((item) => item.id)).not.toContain(draft.id);
    });

    it("rechaza referencias de otra empresa con la línea", async () => {
      for (const [overrides, code] of [
        [{ emissionPointId: b.emissionPointId }, "EMISSION_POINT_NOT_FOUND"],
        [{ buyerPartyId: b.customerId }, "BUYER_NOT_FOUND"],
        [{ lines: [{ productId: b.productId, quantity: "1" }] }, "PRODUCT_NOT_FOUND"],
      ] as const) {
        const res = await call(a.cookies.admin, "post", "/invoices/drafts").send(
          body(a, overrides),
        );
        expect(res.status, code).toBe(400);
        expect(bodyOf(res).error.code).toBe(code);
      }
    });

    it("rechaza un companyId en el cuerpo", async () => {
      const res = await call(a.cookies.admin, "post", "/invoices/drafts").send(
        body(a, { companyId: b.companyId }),
      );
      expect(res.status).toBe(400);
      expect(bodyOf(res).error.message).toBe("La solicitud contiene campos no permitidos.");
    });

    it("lista los borradores pendientes por última actualización, con su total previo", async () => {
      const company = await readyCompany(api, db, { slug: "c" });
      const first = await created(company);
      const second = await created(company, {
        lines: [{ productId: company.productId, quantity: "1" }],
      });
      const res = await call(company.cookies.operator, "get", "/invoices/drafts?pageSize=1");
      expect(res.status).toBe(200);
      expect(bodyOf(res).meta).toEqual({ page: 1, pageSize: 1, total: 2 });
      expect(bodyOf(res).data).toEqual([
        expect.objectContaining({ id: second.id, lineCount: 1, previewTotal: "10.06" }),
      ]);
      const page2 = bodyOf(
        await call(company.cookies.operator, "get", "/invoices/drafts?pageSize=1&page=2"),
      );
      expect(page2.data[0]).toMatchObject({ id: first.id, previewTotal: "28.75" });
    });
  });
});
