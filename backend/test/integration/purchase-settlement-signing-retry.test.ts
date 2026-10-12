// Reintento de la firma de una liquidación de compra (add-purchase-settlements, tarea 7.4, design D2,
// D11 y D23): una liquidación que quedó reservada por un servicio ocupado se firma otro día con su
// mismo número, su misma clave, su misma fecha de emisión y su mismo snapshot, con
// `purchase_settlement.signing_retried`, aunque entretanto cambien el proveedor, el producto y el
// catálogo: el XML sale del snapshot congelado. Una liquidación firmada se devuelve sin efecto; la de
// otra empresa o un comprobante de otro tipo responden `404`; sin sesión, `401`.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PURCHASE_SETTLEMENT_STATEMENTS, type PurchaseSettlementView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

type Body = {
  data: PurchaseSettlementView & { id: string; version: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const TODAY = new Date("2026-10-07T15:00:00Z");
let clock = TODAY;
const compact = (xml: string) => xml.replace(/>\s+</g, "><");

describe("reintento de la firma de una liquidación de compra", () => {
  let db: MigratedSchema;
  let api: App;
  let busy: App;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let supplierId: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  /** Liquidación emitida con `app`: con el firmador ocupado queda reservada. */
  const emitted = async (app: App) => {
    const draft = await request(api.app)
      .post("/api/v1/purchase-settlements/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        supplierPartyId: supplierId,
        lines: [
          {
            productId: a.productId,
            mainCode: "CEM-50",
            description: "Cemento comprado",
            quantity: "10",
            unitPrice: "4.50",
            discount: "5.00",
            ivaRate: "4",
          },
        ],
        payments: [{ paymentMethod: "01", total: "46.00", term: "15", timeUnit: "días" }],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const res = await request(app.app)
      .post("/api/v1/purchase-settlements")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: bodyOf(draft).data.id,
        expectedVersion: 1,
        declarations: { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS] },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const retry = (app: App, id: string, cookie = a.cookies.operator) =>
    request(app.app)
      .post(`/api/v1/purchase-settlements/${id}/signing-attempts`)
      .set("Cookie", cookie);
  const retried = (id: string) =>
    db.database.prisma.auditEvent.count({
      where: {
        action: "purchase_settlement.signing_retried",
        changes: { path: ["purchaseSettlementId"], equals: id },
      },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("purchase_settlement_signing_retry");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const now = () => clock;
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now });
    busy = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now,
      purchaseSettlements: {
        signer: {
          signDocument: () =>
            Promise.reject(Object.assign(new Error("ocupado"), { code: "CRYPTO_BUSY" })),
        },
      },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "reintento-liquidacion-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "reintento-liquidacion-b", pool, p12Dir });
    supplierId = await insertPurchaseSupplier(db.database.prisma, a, "0102030405", {
      legalName: "María Quishpe",
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("firma otro día la liquidación reservada con su número, su clave, su fecha y su snapshot, aunque cambien el tercero, el producto y el catálogo", async () => {
    const settlement = await emitted(busy);
    expect(settlement.state).toBe("RESERVED");
    expect(settlement.diagnostic).toMatchObject({
      code: "CRYPTO_BUSY",
      class: "RETRYABLE_OPERATIONAL",
    });
    const prisma = db.database.prisma;
    const snapshot = (
      await prisma.electronicDocument.findUniqueOrThrow({ where: { id: settlement.id } })
    ).snapshot;
    // Después de reservar cambian el proveedor, el producto y la habilitación del catálogo.
    await prisma.party.update({
      where: { id: supplierId },
      data: {
        legalName: "Nombre corregido",
        address: "Otra dirección",
        identification: "0102030406",
      },
    });
    await prisma.product.update({
      where: { id: a.productId },
      data: { name: "Producto renombrado", mainCode: "OTRO-1" },
    });
    await prisma.companyFiscalCatalogSetting.create({
      data: {
        companyId: a.companyId,
        catalogType: "iva-rate",
        entryKey: "4",
        enabled: false,
        updatedBy: a.adminId,
      },
    });
    clock = new Date("2026-10-09T15:00:00Z");
    try {
      const res = await retry(api, settlement.id);
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({
        id: settlement.id,
        state: "SIGNED",
        documentNumber: settlement.documentNumber,
        accessKey: settlement.accessKey,
        issueDate: "2026-10-07",
        diagnostic: null,
        supplier: { legalName: "María Quishpe", address: "Comunidad San Pablo, Cayambe" },
      });
    } finally {
      clock = TODAY;
    }
    const document = await prisma.electronicDocument.findUniqueOrThrow({
      where: { id: settlement.id },
    });
    expect(document.snapshot).toEqual(snapshot);
    const xml = compact(
      Buffer.from(
        (
          await prisma.documentArtifact.findFirstOrThrow({
            where: { documentId: settlement.id, kind: "SIGNED_XML" },
          })
        ).content,
      ).toString("utf8"),
    );
    expect(xml).toContain(`<claveAcceso>${settlement.accessKey}</claveAcceso>`);
    expect(xml).toContain("<fechaEmision>07/10/2026</fechaEmision>");
    expect(xml).toContain("<razonSocialProveedor>María Quishpe</razonSocialProveedor>");
    expect(xml).toContain("<identificacionProveedor>0102030405</identificacionProveedor>");
    expect(xml).toContain("<direccionProveedor>Comunidad San Pablo, Cayambe</direccionProveedor>");
    expect(xml).toContain(
      "<codigoPrincipal>CEM-50</codigoPrincipal><descripcion>Cemento comprado</descripcion>",
    );
    expect(xml).toContain("<codigoPorcentaje>4</codigoPorcentaje><tarifa>15</tarifa>");
    expect(xml).not.toContain("Nombre corregido");
    expect(xml).not.toContain("OTRO-1");
    expect(await retried(settlement.id)).toBe(1);
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "purchase_settlement.signing_retried" },
    });
    expect(event).toMatchObject({
      actorUserId: a.operatorId,
      changes: {
        purchaseSettlementId: settlement.id,
        documentNumber: settlement.documentNumber,
        result: "SIGNED",
      },
    });
    // El catálogo vuelve a habilitar el 15 % para las pruebas siguientes.
    await prisma.companyFiscalCatalogSetting.update({
      where: {
        companyId_catalogType_entryKey: {
          companyId: a.companyId,
          catalogType: "iva-rate",
          entryKey: "4",
        },
      },
      data: { enabled: true },
    });
    await prisma.party.update({
      where: { id: supplierId },
      data: {
        legalName: "María Quishpe",
        address: "Comunidad San Pablo, Cayambe",
        identification: "0102030405",
      },
    });
  });

  it("un reintento sin éxito deja el diagnóstico y lo audita; una liquidación firmada se devuelve sin efecto", async () => {
    const settlement = await emitted(busy);
    const failed = await retry(busy, settlement.id);
    expect([
      failed.status,
      bodyOf(failed).data.state,
      bodyOf(failed).data.diagnostic?.code,
    ]).toEqual([200, "RESERVED", "CRYPTO_BUSY"]);
    expect(await retried(settlement.id)).toBe(1);
    await retry(api, settlement.id);
    const unchanged = await retry(api, settlement.id);
    expect([unchanged.status, bodyOf(unchanged).data.state]).toEqual([200, "SIGNED"]);
    expect(await retried(settlement.id)).toBe(2);
  });

  it("una liquidación de otra empresa o un comprobante de otro tipo responden 404; sin sesión, 401", async () => {
    const settlement = await emitted(api);
    const foreign = await retry(api, settlement.id, b.cookies.admin);
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([
      404,
      "PURCHASE_SETTLEMENT_NOT_FOUND",
    ]);
    const invoice = await insertDocument(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        points: [
          { establishmentId: a.establishmentId, emissionPointId: a.emissionPointId, code: "001" },
        ],
      },
      "RESERVED",
    );
    const notASettlement = await retry(api, invoice.id);
    expect([notASettlement.status, bodyOf(notASettlement).error.code]).toEqual([
      404,
      "PURCHASE_SETTLEMENT_NOT_FOUND",
    ]);
    expect(
      (
        await request(api.app).post(
          `/api/v1/purchase-settlements/${settlement.id}/signing-attempts`,
        )
      ).status,
    ).toBe(401);
  });
});
