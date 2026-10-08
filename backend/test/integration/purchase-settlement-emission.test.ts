// Emisión de liquidaciones de compra por HTTP (add-purchase-settlements, tarea 7.1, design D3, D12 a
// D14, D23 y D26): un operador emite una liquidación firmada con su propio contador, su proveedor como
// contraparte y su importe total; las cuatro declaraciones se congelan con su autor y su momento en el
// snapshot, en el registro y en la auditoría, nunca en el XML; cada rechazo antes de reservar no
// consume número (declaración faltante o de otra versión, proveedor inválido, dirección vacía, pagos
// que no suman, tarifa no vigente); la idempotencia (repetición, clave reutilizada con otras
// declaraciones, sin clave); y `403`, `401` y otra empresa `404`.
import { randomUUID } from "node:crypto";
import { Registry } from "@prometheus-io/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  PURCHASE_SETTLEMENT_STATEMENTS,
  type PurchaseSettlementDraftView,
  type PurchaseSettlementView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { PurchaseSettlementSnapshot } from "../../src/modules/purchase-settlements/domain/snapshot.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: PurchaseSettlementView & PurchaseSettlementDraftView;
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const compact = (xml: string) => xml.replace(/>\s+</g, "><");

// 10:00 del 7 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-07T15:00:00Z");
const ALL = { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS] };

describe("emisión de liquidaciones de compra", () => {
  let db: MigratedSchema;
  let api: App;
  let denied: App;
  /** El mismo backend un día antes: el borrador se prepara el 6 y se emite el 7. */
  let yesterday: App;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let supplierId: string;
  let rucSupplierId: string;
  let noAddressId: string;
  const registry = new Registry();
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const line = (overrides: Record<string, unknown> = {}) => ({
    productId: null,
    description: "Saco de cacao en grano, 45 kg",
    unit: "saco",
    quantity: "10",
    unitPrice: "4.50",
    discount: "5.00",
    ivaRate: "4",
    ...overrides,
  });
  const lines = () => [
    line(),
    line({
      description: "Jornal de cosecha",
      unit: null,
      mainCode: "JOR-01",
      quantity: "2",
      unitPrice: "30.00",
      discount: "0",
      ivaRate: "0",
    }),
  ];
  const payments = () => [
    { paymentMethod: "01", total: "50.00", term: "0", timeUnit: "días" },
    { paymentMethod: "20", total: "56.00", term: "30", timeUnit: "días" },
  ];
  const draft = async (overrides: Record<string, unknown> = {}, company = a) => {
    const res = await request(api.app)
      .post("/api/v1/purchase-settlements/drafts")
      .set("Cookie", company.cookies.operator)
      .send({
        emissionPointId: company.emissionPointId,
        supplierPartyId: supplierId,
        lines: lines(),
        payments: payments(),
        ...overrides,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (
    app: App,
    created: { id: string; version: number },
    options: { key?: string | null; declarations?: unknown; cookie?: string } = {},
  ) => {
    const key = options.key === undefined ? randomUUID() : options.key;
    const req = request(app.app)
      .post("/api/v1/purchase-settlements")
      .set("Cookie", options.cookie ?? a.cookies.operator);
    return (key === null ? req : req.set("Idempotency-Key", key)).send({
      draftId: created.id,
      expectedVersion: created.version,
      declarations: options.declarations === undefined ? ALL : options.declarations,
    });
  };
  const trace = async () => {
    const prisma = db.database.prisma;
    return {
      documents: await prisma.electronicDocument.count({ where: { documentType: "03" } }),
      sequences: await prisma.fiscalSequenceReservation.count({ where: { documentType: "03" } }),
      settlements: await prisma.purchaseSettlement.count(),
      declarations: await prisma.purchaseSettlementDeclaration.count(),
      audit: await prisma.auditEvent.count({
        where: { action: { startsWith: "purchase_settlement." } },
      }),
      idempotency: await prisma.idempotencyRecord.count({
        where: { operation: "purchase_settlement.emit" },
      }),
    };
  };
  const signedXml = async (documentId: string) =>
    compact(
      Buffer.from(
        (
          await db.database.prisma.documentArtifact.findFirstOrThrow({
            where: { documentId, kind: "SIGNED_XML" },
          })
        ).content,
      ).toString("utf8"),
    );

  beforeAll(async () => {
    db = await createMigratedSchema("purchase_settlement_emission");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const now = () => NOW;
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      purchaseSettlements: { metrics: registry },
      now,
    });
    denied = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      purchaseSettlements: { deny: ["purchaseSettlements.emit"] },
      now,
    });
    yesterday = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "emision-liquidacion", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "emision-liquidacion-b", pool, p12Dir });
    supplierId = await insertPurchaseSupplier(db.database.prisma, a, "0102030405", {
      legalName: "María Quishpe",
    });
    rucSupplierId = await insertPurchaseSupplier(db.database.prisma, a, "1790011223001", {
      legalName: "Agrícola con RUC S.A.",
    });
    noAddressId = await insertPurchaseSupplier(db.database.prisma, a, "1712345678", {
      legalName: "Proveedor sin dirección",
      address: null,
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("un operador emite una liquidación firmada con su contador, su proveedor y su importe total", async () => {
    const created = await draft();
    expect(created.preview.issues).toEqual([]);
    const res = await emit(api, created);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const settlement = bodyOf(res).data;
    expect(settlement).toMatchObject({
      documentType: "03",
      state: "SIGNED",
      issueDate: "2026-10-07",
      documentNumber: "001-001-000000001",
      supplier: {
        partyId: supplierId,
        identificationType: "05",
        identification: "0102030405",
        legalName: "María Quishpe",
        address: "Comunidad San Pablo, Cayambe",
      },
      totals: { withoutTaxes: "100.00", discount: "5.00", total: "106.00" },
      currency: "DOLAR",
      calculationVersion: "purchase-settlement-amounts-1",
      withholdingNotice:
        "Esta operación requiere la retención correspondiente conforme a la normativa aplicable.",
    });
    expect(
      settlement.payments.map((paid) => [paid.code, paid.total, paid.term, paid.timeUnit]),
    ).toEqual([
      ["01", "50.00", "0", "días"],
      ["20", "56.00", "30", "días"],
    ]);
    expect(settlement.accessKey.slice(8, 10)).toBe("03");
    // La contraparte genérica del comprobante es el proveedor, con el importe total.
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: settlement.id },
    });
    expect([stored.buyerIdentification, stored.buyerName, stored.total?.toString()]).toEqual([
      "0102030405",
      "María Quishpe",
      "106",
    ]);
    const counter = await db.database.prisma.fiscalSequence.findFirstOrThrow({
      where: { companyId: a.companyId, documentType: "03" },
    });
    expect(counter.nextNumber).toBe(2);
    const artifact = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: settlement.id, kind: "SIGNED_XML" },
    });
    expect(artifact.metadata).toMatchObject({
      documentType: "03",
      schemaPath: "sri-xsd/LiquidacionCompra_V1.1.0.xsd",
    });
    const xml = await signedXml(settlement.id);
    expect(xml).toContain("<codDoc>03</codDoc>");
    expect(xml).toContain("<identificacionProveedor>0102030405</identificacionProveedor>");
    expect(xml).toContain("<importeTotal>106.00</importeTotal>");
    expect(xml).toContain("<plazo>30</plazo><unidadTiempo>días</unidadTiempo>");
    expect(xml).toContain("<descuento>0.00</descuento>");
  });

  it("un borrador preparado un día y emitido al siguiente lleva la fecha de la reserva, la de su clave", async () => {
    const prepared = await request(yesterday.app)
      .post("/api/v1/purchase-settlements/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        supplierPartyId: supplierId,
        lines: lines(),
        payments: payments(),
      });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
    expect(bodyOf(prepared).data.preview.evaluatedOn).toBe("2026-10-06");
    const res = await emit(api, bodyOf(prepared).data);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const settlement = bodyOf(res).data;
    expect(settlement.issueDate).toBe("2026-10-07");
    expect(settlement.accessKey.slice(0, 8)).toBe("07102026");
    expect(await signedXml(settlement.id)).toContain("<fechaEmision>07/10/2026</fechaEmision>");
  });

  it("congela las cuatro declaraciones con su autor y su momento, fuera del XML", async () => {
    const res = await emit(api, await draft());
    expect(res.status).toBe(201);
    const settlement = bodyOf(res).data;
    expect(settlement.eligibility).toMatchObject({
      case: "ART_13_C",
      policy: "PURCHASE_SETTLEMENT_ELIGIBILITY_V1",
      rule: "ART_13_C_RUSTICITY_NO_ACTIVE_RUC",
      policyVersion: 1,
    });
    expect(settlement.eligibility.declarations).toHaveLength(4);
    for (const declaration of settlement.eligibility.declarations) {
      expect(declaration).toMatchObject({
        basis: "USER_DECLARED",
        declaredBy: a.operatorId,
        declaredByName: "Operador emision-liquidacion",
        declaredAt: NOW.toISOString(),
        policyVersion: 1,
      });
    }
    const rows = await db.database.prisma.purchaseSettlementDeclaration.findMany({
      where: { documentId: settlement.id },
      orderBy: { statementId: "asc" },
    });
    expect(rows.map((row) => [row.statementId, row.basis, row.declaredBy])).toEqual(
      [...PURCHASE_SETTLEMENT_STATEMENTS].sort().map((id) => [id, "USER_DECLARED", a.operatorId]),
    );
    const record = await db.database.prisma.purchaseSettlement.findFirstOrThrow({
      where: { documentId: settlement.id },
    });
    expect(record).toMatchObject({
      supplierPartyId: supplierId,
      eligibilityCase: "ART_13_C",
      policyVersion: 1,
      lineCount: 2,
      paymentCount: 2,
    });
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: settlement.id },
    });
    const snapshot = stored.snapshot as unknown as PurchaseSettlementSnapshot;
    expect(snapshot.eligibility.declarations.map((item) => item.statementId)).toEqual([
      ...PURCHASE_SETTLEMENT_STATEMENTS,
    ]);
    const xml = await signedXml(settlement.id);
    for (const absent of ["USER_DECLARED", "ART_13_C", "NATURAL_PERSON", "Operador"]) {
      expect(xml).not.toContain(absent);
    }
  });

  it("rechaza cada problema antes de reservar, sin consumir número, clave, registro ni auditoría", async () => {
    const valid = await draft();
    const before = await trace();
    const cases: [string, Promise<request.Response>][] = [
      [
        "PURCHASE_SETTLEMENT_DECLARATION_REQUIRED",
        emit(api, valid, {
          declarations: {
            policyVersion: 1,
            statements: PURCHASE_SETTLEMENT_STATEMENTS.slice(0, 3),
          },
        }),
      ],
      [
        "PURCHASE_SETTLEMENT_DECLARATION_VERSION_MISMATCH",
        emit(api, valid, { declarations: { ...ALL, policyVersion: 2 } }),
      ],
      [
        "PURCHASE_SETTLEMENT_SUPPLIER_IDENTIFICATION_NOT_ALLOWED",
        emit(api, await draft({ supplierPartyId: rucSupplierId })),
      ],
      [
        "PURCHASE_SETTLEMENT_ADDRESS_REQUIRED",
        emit(api, await draft({ supplierPartyId: noAddressId, supplierAddress: "   " })),
      ],
      [
        "PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH",
        emit(
          api,
          await draft({
            payments: [
              { paymentMethod: "01", total: "50.00", term: "0", timeUnit: "días" },
              { paymentMethod: "20", total: "55.99", term: "30", timeUnit: "días" },
            ],
          }),
        ),
      ],
      [
        "PURCHASE_SETTLEMENT_IVA_RATE_NOT_EFFECTIVE",
        emit(api, await draft({ lines: [line({ ivaRate: "8" })] })),
      ],
    ];
    for (const [code, pending] of cases) {
      const res = await pending;
      expect([code, res.status, bodyOf(res).error?.code]).toEqual([code, 409, code]);
    }
    const missing = await emit(api, valid, {
      declarations: { policyVersion: 1, statements: PURCHASE_SETTLEMENT_STATEMENTS.slice(1) },
    });
    expect(bodyOf(missing).error.message).toContain(
      "El proveedor es una persona natural no obligada a llevar contabilidad.",
    );
    // Sin la cabecera o con una declaración desconocida, `400`.
    const noKey = await emit(api, valid, { key: null });
    expect([noKey.status, bodyOf(noKey).error.code]).toEqual([400, "IDEMPOTENCY_KEY_REQUIRED"]);
    const unknown = await emit(api, valid, {
      declarations: { policyVersion: 1, statements: ["PROVIDER_IS_RUSTIC"] },
    });
    expect([unknown.status, bodyOf(unknown).error.code]).toEqual([400, "VALIDATION_ERROR"]);
    const generic = await emit(api, valid, { declarations: { policyVersion: 1, accepted: true } });
    expect([generic.status, bodyOf(generic).error.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(await trace()).toEqual(before);
  });

  it("la repetición con la misma clave devuelve la misma liquidación; otras declaraciones son otra huella", async () => {
    const created = await draft();
    const key = randomUUID();
    const first = await emit(api, created, { key });
    expect(first.status).toBe(201);
    const before = await trace();
    const again = await emit(api, created, { key });
    expect([again.status, bodyOf(again).data.id]).toEqual([200, bodyOf(first).data.id]);
    // El orden de las declaraciones no cambia la huella.
    const reordered = await emit(api, created, {
      key,
      declarations: { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS].reverse() },
    });
    expect([reordered.status, bodyOf(reordered).data.id]).toEqual([200, bodyOf(first).data.id]);
    for (const declarations of [
      { ...ALL, policyVersion: 2 },
      { policyVersion: 1, statements: PURCHASE_SETTLEMENT_STATEMENTS.slice(0, 3) },
    ]) {
      const reused = await emit(api, created, { key, declarations });
      expect([reused.status, bodyOf(reused).error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    }
    // Otra clave sobre el borrador ya emitido.
    const other = await emit(api, created);
    expect([other.status, bodyOf(other).error.code]).toEqual([
      409,
      "PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED",
    ]);
    expect(await trace()).toEqual(before);
  });

  it("una versión vieja del borrador se rechaza sin reservar", async () => {
    const created = await draft();
    const before = await trace();
    const stale = await emit(api, { id: created.id, version: created.version + 1 });
    expect([stale.status, bodyOf(stale).error.code]).toEqual([
      409,
      "PURCHASE_SETTLEMENT_DRAFT_CHANGED",
    ]);
    expect(await trace()).toEqual(before);
  });

  it("audita la reserva y la firma con hechos seguros, sin descripciones, direcciones, XML ni SOAP, y cuenta la métrica", async () => {
    const res = await emit(api, await draft());
    const id = bodyOf(res).data.id;
    const events = await db.database.prisma.auditEvent.findMany({
      where: {
        action: { startsWith: "purchase_settlement." },
        changes: { path: ["purchaseSettlementId"], equals: id },
      },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual([
      "purchase_settlement.reserved",
      "purchase_settlement.signed",
    ]);
    expect(events[0]!.changes).toEqual({
      purchaseSettlementId: id,
      documentNumber: bodyOf(res).data.documentNumber,
      accessKey: bodyOf(res).data.accessKey,
      environment: "TEST",
      eligibilityCase: "ART_13_C",
      eligibilityPolicy: "PURCHASE_SETTLEMENT_ELIGIBILITY_V1",
      policyVersion: 1,
      statements: [...PURCHASE_SETTLEMENT_STATEMENTS],
      lineCount: 2,
      paymentCount: 2,
      total: "106.00",
    });
    const serialized = JSON.stringify(events.map((event) => event.changes));
    for (const absent of ["Cayambe", "cacao", "Jornal", "<", "soap"]) {
      expect(serialized).not.toContain(absent);
    }
    expect(
      await registry.getSingleMetricAsString("purchase_settlement_reservations_total"),
    ).toMatch(/purchase_settlement_reservations_total \d+/);
  });

  it("sin purchaseSettlements.emit responde 403, sin sesión 401 y un borrador de otra empresa 404", async () => {
    const created = await draft();
    const before = await trace();
    const forbidden = await emit(denied, created);
    expect(forbidden.status).toBe(403);
    const anonymous = await request(api.app)
      .post("/api/v1/purchase-settlements")
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: created.id, expectedVersion: created.version, declarations: ALL });
    expect(anonymous.status).toBe(401);
    const foreign = await emit(api, created, { cookie: b.cookies.operator });
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([
      404,
      "PURCHASE_SETTLEMENT_DRAFT_NOT_FOUND",
    ]);
    expect(await trace()).toEqual(before);
  });
});
