// Emisión hasta RESERVED (add-invoice-emission, tareas 8.2 y 8.3, design D4, D6 y D7), por HTTP y
// contra PostgreSQL: reserva atómica con número, clave de 49 dígitos e identidad bloqueada; snapshot
// congelado; fecha de Ecuador; transición y auditoría; y cada rechazo antes de reservar sin número,
// clave, identidad bloqueada ni comprobante.
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { InvoiceSnapshotV1 } from "../../src/modules/invoices/domain/snapshot.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { createTaxpayerScope } from "../../src/modules/taxpayer/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { FIXTURE_RUC } from "../support/p12-fixtures.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  CUSTODY,
  createProduct,
  profileOf,
  readyCompany,
  uploadCertificate,
  type ReadyCompany,
} from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: InvoiceView & { id: string; version: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
// 10:00 del 3 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-03T15:00:00Z");

/** Dígito verificador de CTX §8.3, independiente del adaptador. */
function modulo11(base: string): number {
  let factor = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const result = 11 - (sum % 11);
  return result === 11 ? 0 : result === 10 ? 1 : result;
}

describe("emisión de facturas hasta RESERVED", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let now = NOW;
  let failCompose = false;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const p12Dir = inject("p12FixturesDir");
  const accessKeys = createAccessKeys();
  const companies: Record<string, ReadyCompany> = {};

  const call = (cookie: string, method: "get" | "post" | "put", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookie);
  async function draftFor(company: ReadyCompany, overrides: Record<string, unknown> = {}) {
    const res = await call(company.cookies.admin, "post", "/invoices/drafts").send({
      emissionPointId: company.emissionPointId,
      buyerPartyId: company.customerId,
      lines: [{ productId: company.productId, quantity: "3", discount: "1.25" }],
      payments: [{ paymentMethod: "01" }],
      ...overrides,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  }
  const emit = (
    company: ReadyCompany,
    draft: { id: string; version: number },
    key: string = randomUUID(),
    who: "admin" | "operator" = "admin",
    app = api.app,
  ) =>
    request(app)
      .post("/api/v1/invoices")
      .set("Cookie", company.cookies[who])
      .set("Idempotency-Key", key)
      .send({ draftId: draft.id, expectedVersion: draft.version });

  /** Rastro fiscal de una empresa: lo que un rechazo antes de reservar nunca deja. */
  async function trace(company: ReadyCompany) {
    const prisma = db.database.prisma;
    const config = await createTaxpayerScope(prisma).configs.findCurrent(company.companyId);
    return {
      reservations: await prisma.fiscalSequenceReservation.count({
        where: { companyId: company.companyId },
      }),
      documents: await prisma.electronicDocument.count({ where: { companyId: company.companyId } }),
      idempotency: await prisma.idempotencyRecord.count({
        where: { companyId: company.companyId },
      }),
      audits: await prisma.auditEvent.count({
        where: { companyId: company.companyId, action: { startsWith: "invoice." } },
      }),
      locked: config?.taxIdentityLocked ?? false,
    };
  }

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_emission");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      now: () => now,
      signing: { pool, custody: CUSTODY },
      invoices: {
        accessKeys: {
          numericCode: () => accessKeys.numericCode(),
          compose: (input) => {
            if (failCompose) throw new Error("fallo inyectado dentro de la transacción");
            return accessKeys.compose(input);
          },
        },
      },
    });
    for (const slug of ["a", "r"]) {
      companies[slug] = await readyCompany(api, db, { slug, pool, p12Dir });
    }
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  describe("reserva (spec document-emission: Comprobante reservado de forma atómica)", () => {
    it("reserva con número, clave de 49 dígitos e identidad bloqueada, con su transición y su evento", async () => {
      const a = companies.a!;
      const draft = await draftFor(a);
      const res = await emit(a, draft);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const invoice = bodyOf(res).data;
      expect(invoice).toMatchObject({
        documentType: "01",
        environment: "TEST",
        documentNumber: "001-001-000000001",
        issueDate: "2026-10-03",
        state: "RESERVED",
        issuer: { ruc: FIXTURE_RUC, establishmentAddress: "Av. 6 de Diciembre, Quito" },
        buyer: { identification: "0992877878001", consumerFinal: false },
        lines: [{ unitPrice: "8.75", quantity: "3", discount: "1.25", taxableBase: "25.00" }],
        payments: [{ code: "01", amount: "28.75" }],
        totals: { withoutTaxes: "25.00", total: "28.75" },
        diagnostic: null,
        artifact: null,
        signedAt: null,
      });
      const key = invoice.accessKey;
      expect(key).toMatch(/^\d{49}$/);
      expect(key.slice(0, 23)).toBe(`0310202601${FIXTURE_RUC}`);
      expect(key.slice(23, 39)).toBe("1001001000000001");
      expect(Number(key[48])).toBe(modulo11(key.slice(0, 48)));

      const prisma = db.database.prisma;
      expect(await trace(a)).toEqual({
        reservations: 1,
        documents: 1,
        idempotency: 1,
        audits: 1,
        locked: true,
      });
      const transitions = await prisma.documentStateTransition.findMany({
        where: { documentId: invoice.id },
      });
      expect(transitions).toEqual([
        expect.objectContaining({
          fromState: null,
          toState: "RESERVED",
          cause: "EMISSION",
          actorType: "USER",
          actorUserId: a.adminId,
        }),
      ]);
      const [event] = await prisma.auditEvent.findMany({
        where: { companyId: a.companyId, action: "invoice.reserved" },
      });
      expect(event).toMatchObject({ actorUserId: a.adminId });
      expect(event?.changes).toEqual({
        invoiceId: invoice.id,
        documentNumber: "001-001-000000001",
        accessKey: key,
        environment: "TEST",
        total: "28.75",
      });
      expect(JSON.stringify(event)).not.toMatch(/<factura|<\?xml/);
      const stored = await prisma.invoiceDraft.findUniqueOrThrow({ where: { id: draft.id } });
      expect([stored.status, stored.documentId]).toEqual(["EMITTED", invoice.id]);
    });

    it("el número de un comprobante reservado no vuelve al contador", async () => {
      const a = companies.a!;
      const res = await emit(a, await draftFor(a), randomUUID(), "operator");
      expect(res.status).toBe(201);
      expect(bodyOf(res).data.documentNumber).toBe("001-001-000000002");
    });

    it("un fallo dentro de la transacción no deja comprobante, número ni identidad bloqueada", async () => {
      const company = await readyCompany(api, db, { slug: "f", pool, p12Dir });
      const draft = await draftFor(company);
      const before = await trace(company);
      failCompose = true;
      try {
        const res = await emit(company, draft);
        expect(res.status).toBe(500);
      } finally {
        failCompose = false;
      }
      expect(await trace(company)).toEqual(before);
      expect(before.locked).toBe(false);
      const stored = await db.database.prisma.invoiceDraft.findUniqueOrThrow({
        where: { id: draft.id },
      });
      expect(stored.status).toBe("DRAFT");
      // El número que no se confirmó lo recibe la siguiente emisión.
      const retry = await emit(company, draft);
      expect(bodyOf(retry).data.documentNumber).toBe("001-001-000000001");
    });

    it("el snapshot no cambia aunque cambien el producto o la configuración", async () => {
      const a = companies.a!;
      const productId = await createProduct(db, a, { unitPrice: "10", name: "Varilla" });
      const draft = await draftFor(a, { lines: [{ productId, quantity: "1" }] });
      const invoice = bodyOf(await emit(a, draft)).data;
      const prisma = db.database.prisma;
      await prisma.product.update({ where: { id: productId }, data: { unitPrice: "99" } });
      await createTaxpayerScope(prisma).configs.appendVersion(a.companyId, {
        version: 2,
        config: {
          profile: profileOf({ headOfficeAddress: "Nueva dirección matriz" }),
          environment: "TEST",
          logo: null,
        },
        createdBy: a.adminId,
      });
      const document = await prisma.electronicDocument.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      const snapshot = document.snapshot as unknown as InvoiceSnapshotV1;
      expect(snapshot.lines[0]).toMatchObject({ unitPrice: "10", description: "Varilla" });
      expect(snapshot.issuer.headOfficeAddress).toBe("Av. Amazonas N24-03, Quito");
      expect(snapshot).toMatchObject({
        snapshotVersion: 1,
        builderVersion: "1",
        taxpayerConfig: { version: 1 },
        environmentCode: "1",
        schema: {
          documentType: "01",
          version: "1.1.0",
          path: "sri-xsd/factura_V1.1.0.xsd",
          imports: [{ path: "w3c-xsd/xmldsig-core-schema.xsd" }],
        },
        key: {
          documentNumber: invoice.documentNumber,
          accessKey: invoice.accessKey,
          emissionType: "1",
        },
      });
      expect(snapshot.catalogDatasets).toMatchObject({ "iva-rate": 1, "schema-registry": 2 });
      await expect(
        prisma.electronicDocument.update({
          where: { id: invoice.id },
          data: { snapshot: { snapshotVersion: 2 } },
        }),
      ).rejects.toThrow(/no cambia sus datos fiscales/);
    });

    it("a las 22:30 del 3 de octubre en Ecuador, que ya es 4 en UTC, la fecha es el 3", async () => {
      const a = companies.a!;
      now = new Date("2026-10-04T03:30:00Z");
      try {
        const invoice = bodyOf(await emit(a, await draftFor(a))).data;
        expect(invoice.issueDate).toBe("2026-10-03");
        expect(invoice.accessKey.slice(0, 8)).toBe("03102026");
        const document = await db.database.prisma.electronicDocument.findUniqueOrThrow({
          where: { id: invoice.id },
        });
        expect((document.snapshot as unknown as InvoiceSnapshotV1).issueDate).toBe("2026-10-03");
      } finally {
        now = NOW;
      }
    });

    it("una solicitud con fecha de emisión se rechaza por campo no permitido", async () => {
      const a = companies.a!;
      const draft = await draftFor(a);
      const res = await call(a.cookies.admin, "post", "/invoices")
        .set("Idempotency-Key", randomUUID())
        .send({ draftId: draft.id, expectedVersion: 1, issueDate: "2026-10-01" });
      expect(res.status).toBe(400);
      expect(bodyOf(res).error.message).toBe("La solicitud contiene campos no permitidos.");
    });
  });

  describe("rechazos antes de reservar (spec document-emission: Validación completa antes de reservar)", () => {
    /** Emite y comprueba el rechazo sin rastro fiscal ni cambio del borrador. */
    async function rejected(
      company: ReadyCompany,
      draft: { id: string; version: number },
      code: string,
      options: { expectedVersion?: number; app?: typeof api.app } = {},
    ) {
      const before = await trace(company);
      const res = await emit(
        company,
        { id: draft.id, version: options.expectedVersion ?? draft.version },
        randomUUID(),
        "admin",
        options.app,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(bodyOf(res).error.code).toBe(code);
      expect(await trace(company)).toEqual(before);
      const stored = await db.database.prisma.invoiceDraft.findUniqueOrThrow({
        where: { id: draft.id },
      });
      expect(stored.status).toBe("DRAFT");
      return bodyOf(res).error;
    }

    it("borrador incompleto o con otra versión", async () => {
      const r = companies.r!;
      await rejected(
        r,
        bodyOf(await call(r.cookies.admin, "post", "/invoices/drafts").send({})).data,
        "INVOICE_DRAFT_INCOMPLETE",
      );
      await rejected(r, await draftFor(r), "INVOICE_DRAFT_CHANGED", { expectedVersion: 2 });
      expect((await trace(r)).locked).toBe(false);
    });

    it("empresa sin datos tributarios: la identidad sigue sin bloquear", async () => {
      const company = await readyCompany(api, db, { slug: "n", pool, p12Dir, configured: false });
      await rejected(company, await draftFor(company), "TAXPAYER_NOT_CONFIGURED");
      expect(
        await createTaxpayerScope(db.database.prisma).configs.findCurrent(company.companyId),
      ).toBeNull();
    });

    it("punto de emisión desactivado", async () => {
      const r = companies.r!;
      const draft = await draftFor(r);
      const prisma = db.database.prisma;
      await prisma.emissionPoint.update({
        where: { id: r.emissionPointId },
        data: { active: false },
      });
      try {
        await rejected(r, draft, "EMISSION_POINT_UNAVAILABLE");
      } finally {
        await prisma.emissionPoint.update({
          where: { id: r.emissionPointId },
          data: { active: true },
        });
      }
    });

    it("sin firma utilizable; el siguiente comprobante recibe el número que habría recibido", async () => {
      const company = await readyCompany(api, db, { slug: "s" });
      await rejected(company, await draftFor(company), "SIGNING_CERTIFICATE_NOT_USABLE");
      await uploadCertificate(db, company, pool, p12Dir);
      const res = await emit(company, await draftFor(company));
      expect(res.status).toBe(201);
      expect(bodyOf(res).data.documentNumber).toBe("001-001-000000001");
    });

    it("comprador sin rol de cliente o desactivado", async () => {
      const r = companies.r!;
      const error = await rejected(
        r,
        await draftFor(r, { buyerPartyId: r.supplierId }),
        "BUYER_NOT_CUSTOMER",
      );
      expect(error.message).toContain("PROVEEDORA DEL SUR S.A.");
      const draft = await draftFor(r);
      const prisma = db.database.prisma;
      await prisma.$transaction((tx) =>
        tx.party.update({ where: { id: r.customerId }, data: { status: "INACTIVE" } }),
      );
      try {
        await rejected(r, draft, "BUYER_INACTIVE");
      } finally {
        await prisma.$transaction((tx) =>
          tx.party.update({ where: { id: r.customerId }, data: { status: "ACTIVE" } }),
        );
      }
    });

    it("producto desactivado y descuento mayor que el subtotal, con la línea", async () => {
      const r = companies.r!;
      const productId = await createProduct(db, r, { unitPrice: "1", name: "Retirado" });
      const draft = await draftFor(r, {
        lines: [
          { productId: r.productId, quantity: "1" },
          { productId, quantity: "1" },
        ],
      });
      await db.database.prisma.product.update({
        where: { id: productId },
        data: { status: "INACTIVE" },
      });
      expect((await rejected(r, draft, "PRODUCT_INACTIVE")).message).toBe(
        "Línea 2: el producto Retirado está desactivado.",
      );
      const discount = await draftFor(r, {
        lines: [{ productId: r.productId, quantity: "3", discount: "26.26" }],
      });
      expect((await rejected(r, discount, "DISCOUNT_EXCEEDS_SUBTOTAL")).message).toContain(
        "Línea 1",
      );
    });

    it("tarifa deshabilitada, ICE e IVA diferenciado sin datos de cálculo", async () => {
      const r = companies.r!;
      const prisma = db.database.prisma;
      const iva12 = await createProduct(db, r, { unitPrice: "1", iva: "2", name: "Doce" });
      await prisma.companyFiscalCatalogSetting.create({
        data: {
          companyId: r.companyId,
          catalogType: "iva-rate",
          entryKey: "2",
          enabled: false,
          updatedBy: r.adminId,
        },
      });
      const disabled = await rejected(
        r,
        await draftFor(r, { lines: [{ productId: iva12, quantity: "1" }] }),
        "TAX_REFERENCE_NOT_USABLE",
      );
      expect(disabled.message).toContain("IVA 2");
      const differentiated = await createProduct(db, r, {
        unitPrice: "1",
        iva: "8",
        name: "Diferenciado",
      });
      await rejected(
        r,
        await draftFor(r, { lines: [{ productId: differentiated, quantity: "1" }] }),
        "TAX_CALCULATION_DATA_MISSING",
      );
      await prisma.companyFiscalCatalogSetting.create({
        data: {
          companyId: r.companyId,
          catalogType: "ice-rate",
          entryKey: "3011",
          enabled: true,
          updatedBy: r.adminId,
        },
      });
      const ice = await createProduct(db, r, { unitPrice: "1", ice: "3011", name: "Cigarrillos" });
      const missing = await rejected(
        r,
        await draftFor(r, { lines: [{ productId: ice, quantity: "1" }] }),
        "TAX_CALCULATION_DATA_MISSING",
      );
      expect(missing.message).toContain("ICE 3011");
    });

    it("importe calculado fuera del XSD", async () => {
      const r = companies.r!;
      const huge = await createProduct(db, r, { unitPrice: "999999999999.999999", name: "Enorme" });
      await rejected(
        r,
        await draftFor(r, { lines: [{ productId: huge, quantity: "999999999999.999999" }] }),
        "AMOUNT_OUT_OF_RANGE",
      );
    });

    it("forma de pago deshabilitada y pagos que no suman el total", async () => {
      const r = companies.r!;
      await db.database.prisma.companyFiscalCatalogSetting.create({
        data: {
          companyId: r.companyId,
          catalogType: "payment-method",
          entryKey: "20",
          enabled: false,
          updatedBy: r.adminId,
        },
      });
      await rejected(
        r,
        await draftFor(r, { payments: [{ paymentMethod: "20" }] }),
        "PAYMENT_METHOD_NOT_USABLE",
      );
      const error = await rejected(
        r,
        await draftFor(r, {
          payments: [
            { paymentMethod: "01", amount: "20.00" },
            { paymentMethod: "19", amount: "5.00" },
          ],
        }),
        "PAYMENTS_DO_NOT_MATCH_TOTAL",
      );
      expect(error.message).toBe(
        "Las formas de pago suman USD 25.00 y el importe total es USD 28.75: la diferencia es USD 3.75.",
      );
    });

    it("consumidor final por encima del monto máximo", async () => {
      const r = companies.r!;
      const product = await createProduct(db, r, { unitPrice: "43.49", name: "Tope" });
      const error = await rejected(
        r,
        await draftFor(r, {
          buyerPartyId: r.consumerFinalId,
          lines: [{ productId: product, quantity: "1" }],
        }),
        "CONSUMER_FINAL_LIMIT_EXCEEDED",
      );
      expect(error.message).toBe(
        "El importe total USD 50.01 supera el monto máximo de USD 50.00 para consumidor final: identifica al comprador.",
      );
    });

    it("anexo 26 aplicable no soportado; sin él o con el RUC propio, se emite", async () => {
      const third = await readyCompany(api, db, {
        slug: "t",
        pool,
        p12Dir,
        profile: { providerRuc: "0992877878001" },
      });
      const error = await rejected(third, await draftFor(third), "SPECIAL_CASE_UNSUPPORTED");
      expect(error.message).toContain("anexo 26");
      const own = await readyCompany(api, db, {
        slug: "o",
        pool,
        p12Dir,
        profile: { providerRuc: FIXTURE_RUC },
      });
      expect((await emit(own, await draftFor(own))).status).toBe(201);
    });

    it("esquema ausente o alterado en la instalación", async () => {
      const r = companies.r!;
      const root = mkdtempSync(join(tmpdir(), "facturador-emission-xsd-"));
      try {
        cpSync(
          fileURLToPath(new URL("../../../docs/product/sri-xsd/", import.meta.url)),
          join(root, "sri-xsd"),
          { recursive: true },
        );
        cpSync(
          fileURLToPath(new URL("../../../docs/product/w3c-xsd/", import.meta.url)),
          join(root, "w3c-xsd"),
          { recursive: true },
        );
        writeFileSync(join(root, "w3c-xsd", "xmldsig-core-schema.xsd"), "<alterado/>");
        const broken = buildTaxpayerApp(db, {
          now: () => now,
          signing: { pool, custody: CUSTODY },
          invoices: { xsd: createXmllintXsdValidator({ root }) },
        });
        const error = await rejected(r, await draftFor(r), "SCHEMA_NOT_AVAILABLE", {
          app: broken.app,
        });
        expect(error.message).toContain("imports");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("numeración agotada en el punto", async () => {
      const company = await readyCompany(api, db, { slug: "x", pool, p12Dir });
      await db.database.prisma.fiscalSequence.create({
        data: {
          companyId: company.companyId,
          environment: "TEST",
          establishmentId: company.establishmentId,
          emissionPointId: company.emissionPointId,
          documentType: "01",
          nextNumber: 999_999_999,
        },
      });
      const last = await emit(company, await draftFor(company));
      expect(bodyOf(last).data.documentNumber).toBe("001-001-999999999");
      await rejected(company, await draftFor(company), "SEQUENCE_EXHAUSTED");
    });
  });
});
