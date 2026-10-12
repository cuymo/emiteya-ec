// S-3 offline reproducido con la implementación real (add-invoice-emission, tarea 9.4, design D17):
// del borrador a SIGNED por la API y los casos de uso del cambio, con el reloj y el código numérico
// inyectados y sin el SRI. El XML sin firmar, el que el procedimiento entrega al firmador, se
// compara byte a byte con los XML de referencia revisados a mano en el spike S-3
// (test/fixtures/s3-offline/), y el XML firmado vuelve a validar contra el XSD y a verificar.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, describe, expect, inject, it } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import {
  fiscalCatalogQueries,
  loadInstalledFiscalCatalogs,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import {
  certificateTasksEntry,
  signingModule,
} from "../../src/modules/signing/infrastructure/index.ts";
import { registeredSchema } from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../src/modules/sri-engine/infrastructure/signature-inspection.ts";
import type { TaxpayerProfile } from "../../src/modules/taxpayer/domain/taxpayer-config.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, createProduct, readyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp, testXsdValidator } from "./taxpayer-harness.ts";

type Body = {
  data: InvoiceView & { id: string; version: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
// 22:30 del 3 de octubre de 2026 en Ecuador, que ya es el 4 de octubre en UTC.
const NOW = new Date("2026-10-04T03:30:00Z");
const NUMERIC_CODE = "12345678";
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/s3-offline/${name}.xml`, import.meta.url), "utf8");

type Line = {
  mainCode: string | null;
  name: string;
  quantity?: string;
  unitPrice?: string;
  discount?: string;
  iva?: string;
};

/** Línea del spike: código principal derivado del nombre, cantidad y precio 1, IVA 15 %. */
const line = (overrides: Omit<Line, "mainCode"> & { mainCode?: string | null }): Line => ({
  mainCode: overrides.name.toUpperCase().slice(0, 10),
  ...overrides,
});

// Varias líneas con descuento, tarifas de 15 %, 0 % y 5 %, y fronteras de cantidad por precio.
const MANY_LINES: Line[] = [
  line({
    mainCode: "CEM-50",
    name: "Cemento 50 kg",
    quantity: "3",
    unitPrice: "8.75",
    discount: "1.25",
  }),
  line({ mainCode: "SERV-1", name: "Corte", quantity: "1.5", unitPrice: "0.015" }),
  line({ mainCode: "VAR-8", name: "Varilla", quantity: "2.5", unitPrice: "0.01", iva: "0" }),
  line({ mainCode: "ARROZ", name: "Arroz", unitPrice: "1.005", iva: "5" }),
  line({ mainCode: "CLAVO", name: "Clavo", unitPrice: "0.10" }),
  line({ mainCode: null, name: "Tercio sin código", quantity: "3", unitPrice: "0.333333" }),
];
const regression = (field: "unitPrice" | "quantity") =>
  ["123456789012.123456", "99999999999.999999"].map((value, index) =>
    line({ mainCode: `REG-${index + 1}`, name: `Regresión ${value}`, [field]: value }),
  );

describe("S-3 offline con la implementación real", () => {
  // Cada escenario usa su propio esquema: los XML de referencia comparten RUC, fecha, punto,
  // secuencial y código numérico, y la clave de acceso es única en toda la base de datos.
  const schemas: MigratedSchema[] = [];
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const p12Dir = inject("p12FixturesDir");
  const xsd = testXsdValidator();
  const keys = createAccessKeys();

  /** Esquema nuevo con los catálogos y la app real, con el reloj y el código numérico inyectados. */
  async function scenario() {
    const db = await createMigratedSchema("s_three_offline");
    schemas.push(db);
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const unsigned: string[] = [];
    const signing = signingModule({
      prisma: db.database.prisma,
      authorizer: createAuthorizer({
        memberships: createMembershipReader(db.database.prisma),
        securityEvents: { emit: () => undefined },
      }),
      custody: CUSTODY,
      maxBytes: 64 * 1024,
      pool,
    });
    const api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      invoices: {
        now: () => NOW,
        accessKeys: { numericCode: () => NUMERIC_CODE, compose: (input) => keys.compose(input) },
        // El XML sin firmar es exactamente el que el procedimiento entrega al firmador.
        signer: {
          signDocument: (companyId, xml, documentType) => {
            unsigned.push(xml);
            return signing.documents.signDocument(companyId, xml, documentType);
          },
        },
      },
    });
    return { db, api, unsigned };
  }

  /** Emite por la API en un esquema propio y devuelve la factura y su XML sin firmar. */
  async function emitted(
    lines: Line[],
    options: { consumerFinal?: boolean; profile?: Partial<TaxpayerProfile> } = {},
  ) {
    const { db, api, unsigned } = await scenario();
    const company = await readyCompany(api, db, {
      slug: "s",
      pool,
      p12Dir,
      establishmentAddress: "Av. Amazonas N24-03, Quito",
      profile: { tradeName: "ANDINA", ...options.profile },
    });
    // El comprador identificado del spike: mismo tercero de la empresa, con sus datos.
    const buyer = await db.database.prisma.party.update({
      where: { id: company.customerId },
      data: {
        legalName: "FERRETERIA EL PERNO CIA. LTDA.",
        address: "Guayaquil",
        searchName: "ferreteria el perno cia. ltda.",
      },
    });
    const draftLines = [];
    for (const item of lines) {
      // El producto del arnés ya es la primera línea del spike: Cemento 50 kg a 8.75 con IVA 15 %.
      const productId =
        item.mainCode === "CEM-50"
          ? company.productId
          : await createProduct(db, company, {
              unitPrice: item.unitPrice ?? "1",
              iva: item.iva ?? "4",
              name: item.name,
              mainCode: item.mainCode,
            });
      draftLines.push({
        productId,
        quantity: item.quantity ?? "1",
        discount: item.discount ?? "0",
      });
    }
    const draft = await request(api.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", company.cookies.operator)
      .send({
        emissionPointId: company.emissionPointId,
        buyerPartyId: options.consumerFinal ? company.consumerFinalId : buyer.id,
        lines: draftLines,
        payments: [{ paymentMethod: "01" }],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const res = await request(api.app)
      .post("/api/v1/invoices")
      .set("Cookie", company.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: 1 });
    return {
      db,
      status: res.status,
      invoice: bodyOf(res).data,
      error: bodyOf(res).error,
      xml: unsigned[0],
      company,
    };
  }

  /** El XML firmado del artefacto vuelve a validar contra el XSD y verifica con su certificado. */
  async function expectSignedValid(db: MigratedSchema, invoice: InvoiceView) {
    const artifact = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: invoice.id },
    });
    const signed = Buffer.from(artifact.content).toString("utf8");
    const registry = await fiscalCatalogQueries(db.database.prisma).schemaRegistry();
    expect(await xsd.validate(signed, registeredSchema(registry, "01", "1.1.0")!)).toEqual({
      valid: true,
    });
    const signature = readEnvelopedSignature(signed);
    const publicKey = signature.certificate.publicKey.export({ type: "spki", format: "pem" });
    expect(verifyEnvelopedSignature(signature, publicKey as string)).toBe(true);
    return signed;
  }

  afterAll(async () => {
    await pool.close();
    for (const db of schemas) await db.drop();
  });

  describe("consumidor final con el monto de la política vigente", () => {
    for (const [unitPrice, total] of [
      ["43.47", "49.99"],
      ["43.48", "50.00"],
    ] as const) {
      it(`${total} se emite hasta SIGNED con la identidad canónica y el XML de referencia`, async () => {
        const { db, status, invoice, xml } = await emitted(
          [line({ name: "Producto", unitPrice })],
          {
            consumerFinal: true,
          },
        );
        expect(status).toBe(201);
        expect(invoice).toMatchObject({
          state: "SIGNED",
          issueDate: "2026-10-03",
          totals: { total },
          buyer: { identificationType: "07", identification: "9999999999999", consumerFinal: true },
        });
        expect(xml).toBe(fixture(`consumidor-final-${total}`));
        await expectSignedValid(db, invoice);
      });
    }

    it("50.01 se rechaza antes de reservar el secuencial y de crear la clave", async () => {
      const { db, status, error, company, xml } = await emitted(
        [line({ name: "Producto", unitPrice: "43.49" })],
        { consumerFinal: true },
      );
      expect(status).toBe(409);
      expect(error.code).toBe("CONSUMER_FINAL_LIMIT_EXCEEDED");
      expect(xml).toBeUndefined();
      const prisma = db.database.prisma;
      expect(
        await prisma.fiscalSequenceReservation.count({ where: { companyId: company.companyId } }),
      ).toBe(0);
      expect(
        await prisma.electronicDocument.count({ where: { companyId: company.companyId } }),
      ).toBe(0);
    });
  });

  it("varias líneas con descuento, IVA 15 %, 5 % y 0 %", async () => {
    const { db, invoice, xml } = await emitted(MANY_LINES);
    expect(invoice).toMatchObject({
      state: "SIGNED",
      totals: { withoutTaxes: "27.16", discount: "1.25", total: "31.13" },
    });
    expect(xml).toBe(fixture("varias-lineas"));
    await expectSignedValid(db, invoice);
  });

  it("valores grandes: 999999.999999 × 1.000001", async () => {
    const { db, invoice, xml } = await emitted([
      line({ name: "Grande", quantity: "999999.999999", unitPrice: "1.000001" }),
    ]);
    expect(invoice.totals.total).toBe("1150001.15");
    expect(xml).toBe(fixture("valores-grandes"));
    await expectSignedValid(db, invoice);
  });

  for (const [field, name] of [
    ["unitPrice", "precioUnitario"],
    ["quantity", "cantidad"],
  ] as const) {
    it(`regresiones 123456789012.123456 y 99999999999.999999 como ${name}, exactas también firmadas`, async () => {
      const { db, invoice, xml } = await emitted(regression(field));
      expect(invoice.totals.total).toBe("256975307363.94");
      expect(xml).toBe(fixture(`regresion-${name}`));
      const signed = await expectSignedValid(db, invoice);
      expect(
        [...signed.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, "g"))].map((m) => m[1]),
      ).toEqual(["123456789012.123456", "99999999999.999999"]);
    });
  }

  it("emisor con agente de retención y RIMPE", async () => {
    const { db, invoice, xml } = await emitted([line({ name: "A" })], {
      profile: { withholdingAgentResolution: "12345678", rimpeCategory: "EMPRENDEDOR" },
    });
    expect(xml).toBe(fixture("emisor-agente-rimpe"));
    await expectSignedValid(db, invoice);
  });

  it("la fecha de Ecuador, el ambiente y el código numérico inyectados forman la clave del XML", async () => {
    const { invoice, xml } = await emitted([line({ name: "A" })]);
    expect(invoice.accessKey).toBe("0310202601179001234500110010010000000011234567816");
    expect(xml).toContain(`<claveAcceso>${invoice.accessKey}</claveAcceso>`);
    expect(xml).toContain("<fechaEmision>03/10/2026</fechaEmision>");
  });
});
