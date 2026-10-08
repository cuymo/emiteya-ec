// API de proveedores, opciones, borradores y vista previa de las liquidaciones de compra
// (add-purchase-settlements, tareas 6.1 y 6.2, design D3 a D9, D12, D21 y D22): los proveedores con su
// elegibilidad y su motivo, sin el consumidor final ni terceros sin el rol; las opciones con la
// política de procedencia, sus cuatro declaraciones, el aviso de la retención, las tarifas de IVA
// vigentes (sin el diferenciado), las formas de pago y los límites; el borrador incompleto que se
// guarda sin reservar; la dirección propuesta desde el tercero; la vista previa con los importes del
// spec y los problemas por línea o pago; la versión; el borrador emitido inmutable; los límites como
// defensa del sistema; y `403`, `401` y otra empresa `404`.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  PurchaseSettlementDraftSummaryView,
  PurchaseSettlementDraftView,
  PurchaseSettlementOptionsView,
  PurchaseSettlementSupplierView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, createProduct, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertPurchaseSettlement, insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body<T> = {
  data: T;
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const dataOf = <T>(res: { body: unknown }) => (res.body as Body<T>).data;
const errorOf = (res: { body: unknown }) => (res.body as Body<unknown>).error;
const codes = (draft: PurchaseSettlementDraftView) =>
  draft.preview.issues.map((issue) => issue.code);

// 10:00 del 7 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-07T15:00:00Z");

describe("API de borradores de liquidación de compra", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let limited: ReturnType<typeof buildTaxpayerApp>;
  let denied: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let supplierId: string;
  let passportId: string;
  let rucSupplierId: string;
  let noRoleId: string;
  let foreignSupplierId: string;
  let foreignProductId: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const call = (
    cookie: string,
    method: "get" | "post" | "put" | "delete",
    path: string,
    app = api,
  ) => request(app.app)[method](`/api/v1${path}`).set("Cookie", cookie);
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
  const payment = (overrides: Record<string, unknown> = {}) => ({
    paymentMethod: "01",
    total: "50.00",
    term: "0",
    timeUnit: "días",
    ...overrides,
  });
  const draftBody = (overrides: Record<string, unknown> = {}) => ({
    emissionPointId: a.emissionPointId,
    supplierPartyId: supplierId,
    lines: [
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
    ],
    payments: [payment(), payment({ paymentMethod: "20", total: "56.00", term: "30" })],
    ...overrides,
  });
  const createDraft = async (body: Record<string, unknown> = draftBody()) => {
    const res = await call(a.cookies.operator, "post", "/purchase-settlements/drafts").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return dataOf<PurchaseSettlementDraftView>(res);
  };
  const fiscalTrace = async () => ({
    documents: await db.database.prisma.electronicDocument.count({ where: { documentType: "03" } }),
    reservations: await db.database.prisma.fiscalSequenceReservation.count({
      where: { documentType: "03" },
    }),
    settlements: await db.database.prisma.purchaseSettlement.count(),
  });

  beforeAll(async () => {
    db = await createMigratedSchema("purchase_settlement_drafts_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const now = () => NOW;
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now });
    limited = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now,
      purchaseSettlements: { limits: { lines: 1, payments: 1 } },
    });
    denied = buildTaxpayerApp(db, {
      now,
      purchaseSettlements: { deny: ["purchaseSettlements.draft"] },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "liquidacion-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "liquidacion-b", pool, p12Dir });
    const prisma = db.database.prisma;
    supplierId = await insertPurchaseSupplier(prisma, a, "0102030405", {
      legalName: "María Quishpe",
    });
    passportId = await insertPurchaseSupplier(prisma, a, "AB1234567", {
      identificationType: "06",
      legalName: "Juan Pérez",
      address: null,
    });
    rucSupplierId = await insertPurchaseSupplier(prisma, a, "1790011223001", {
      legalName: "Agrícola con RUC S.A.",
    });
    noRoleId = await insertPurchaseSupplier(prisma, a, "1712345678", {
      legalName: "Cliente sin rol de proveedor",
      roles: ["CUSTOMER"],
    });
    foreignSupplierId = await insertPurchaseSupplier(prisma, b, "0912345678");
    foreignProductId = await createProduct(db, b, { unitPrice: "1.00" });
  }, 120_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  describe("proveedores (design D4)", () => {
    it("lista los terceros activos con el rol de proveedor: cédula y pasaporte seleccionables, el RUC con su motivo", async () => {
      const res = await call(a.cookies.operator, "get", "/purchase-settlements/suppliers");
      expect(res.status).toBe(200);
      const items = dataOf<PurchaseSettlementSupplierView[]>(res);
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get(supplierId)).toMatchObject({
        identificationType: "05",
        selectable: true,
        reason: null,
        address: "Comunidad San Pablo, Cayambe",
      });
      expect(byId.get(passportId)).toMatchObject({ identificationType: "06", selectable: true });
      expect(byId.get(rucSupplierId)).toMatchObject({ selectable: false });
      expect(byId.get(rucSupplierId)!.reason).toMatch(/Tiene RUC.*caso c\)/);
      // Sin el consumidor final, sin terceros sin el rol y sin los de otra empresa.
      expect(byId.has(a.consumerFinalId)).toBe(false);
      expect(byId.has(noRoleId)).toBe(false);
      expect(byId.has(foreignSupplierId)).toBe(false);
    });

    it("busca por identificación o por nombre sin tildes", async () => {
      const byId = await call(
        a.cookies.operator,
        "get",
        "/purchase-settlements/suppliers?search=0102",
      );
      expect(dataOf<PurchaseSettlementSupplierView[]>(byId).map((item) => item.id)).toEqual([
        supplierId,
      ]);
      const byName = await call(
        a.cookies.operator,
        "get",
        "/purchase-settlements/suppliers?search=perez",
      );
      expect(dataOf<PurchaseSettlementSupplierView[]>(byName).map((item) => item.id)).toEqual([
        passportId,
      ]);
    });
  });

  it("las opciones traen la política con sus cuatro declaraciones, el aviso, la moneda y los catálogos vigentes", async () => {
    const res = await call(a.cookies.operator, "get", "/purchase-settlements/options");
    expect(res.status).toBe(200);
    const options = dataOf<PurchaseSettlementOptionsView>(res);
    expect(options.evaluatedOn).toBe("2026-10-07");
    expect(options.limits).toEqual({ lines: 100, payments: 10 });
    expect(options.policy).toMatchObject({
      id: "PURCHASE_SETTLEMENT_ELIGIBILITY_V1",
      rule: "ART_13_C_RUSTICITY_NO_ACTIVE_RUC",
      case: "ART_13_C",
      version: 1,
    });
    expect(options.policy.statements.map((statement) => statement.id)).toEqual([
      "NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING",
      "NO_RUC_OR_SUSPENDED_RUC",
      "UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY",
      "MOVABLE_GOODS_OR_SERVICES_TRANSACTION",
    ]);
    expect(options.policy.statements[2]!.text).toBe(
      "Por su nivel cultural o rusticidad, el proveedor no puede emitir comprobantes de venta.",
    );
    expect(options.withholdingNotice).toBe(
      "Esta operación requiere la retención correspondiente conforme a la normativa aplicable.",
    );
    expect(options.currency).toBe("DOLAR");
    const rates = new Map(options.ivaRates.map((rate) => [rate.code, rate]));
    expect(rates.get("4")).toMatchObject({ percentage: "15", rateKind: "PERCENTAGE" });
    expect(rates.get("0")).toMatchObject({ percentage: "0" });
    expect(rates.get("6")).toMatchObject({ rateKind: "NOT_SUBJECT", percentage: "0" });
    expect(rates.get("7")).toMatchObject({ rateKind: "EXEMPT", percentage: "0" });
    expect(rates.has("8")).toBe(false);
    expect(options.paymentMethods.map((method) => method.code)).toEqual(
      expect.arrayContaining(["01", "20"]),
    );
  });

  describe("borradores (design D12)", () => {
    it("un borrador incompleto se guarda sin reservar y la vista previa informa lo que falta", async () => {
      const before = await fiscalTrace();
      const draft = await createDraft({});
      expect(draft).toMatchObject({ version: 1, supplier: null, lines: [], payments: [] });
      expect(codes(draft)).toEqual([
        "PURCHASE_SETTLEMENT_DRAFT_INCOMPLETE",
        "PURCHASE_SETTLEMENT_SUPPLIER_REQUIRED",
        "PURCHASE_SETTLEMENT_ADDRESS_REQUIRED",
        "PURCHASE_SETTLEMENT_LINES_REQUIRED",
        "PURCHASE_SETTLEMENT_PAYMENTS_REQUIRED",
      ]);
      expect(await fiscalTrace()).toEqual(before);
    });

    it("propone la dirección del proveedor y calcula los importes del spec con la política y el aviso", async () => {
      const draft = await createDraft();
      expect(draft.supplierAddress).toBe("Comunidad San Pablo, Cayambe");
      expect(draft.supplier).toMatchObject({ id: supplierId, selectable: true });
      expect(draft.preview.issues).toEqual([]);
      expect(draft.preview.totals).toMatchObject({
        withoutTaxes: "100.00",
        discount: "5.00",
        total: "106.00",
      });
      expect(
        draft.preview.totals!.taxes.map((tax) => [tax.rateCode, tax.base, tax.amount]),
      ).toEqual([
        ["0", "60.00", "0.00"],
        ["4", "40.00", "6.00"],
      ]);
      expect(draft.preview.paymentsTotal).toBe("106.00");
      expect(draft.preview.calculationVersion).toBe("purchase-settlement-amounts-1");
      expect(draft.preview.policy.statements).toHaveLength(4);
      expect(draft.preview.withholdingNotice).toMatch(/requiere la retención correspondiente/);
      // Un proveedor sin dirección no propone nada: la emisión la pedirá.
      const withoutAddress = await createDraft(draftBody({ supplierPartyId: passportId }));
      expect(withoutAddress.supplierAddress).toBeNull();
      expect(codes(withoutAddress)).toEqual(["PURCHASE_SETTLEMENT_ADDRESS_REQUIRED"]);
    });

    it("la vista previa lista cada problema junto a su línea o su pago", async () => {
      const draft = await createDraft(
        draftBody({
          lines: [line({ description: null }), line()],
          payments: [payment({ total: "50.00" }), payment({ total: "41.00" })],
        }),
      );
      expect(draft.preview.issues.map((issue) => [issue.code, issue.field, issue.line])).toEqual([
        ["PURCHASE_SETTLEMENT_DESCRIPTION_INVALID", "description", 1],
      ]);
      const mismatch = await createDraft(
        draftBody({ payments: [payment({ total: "50.00" }), payment({ total: "55.99" })] }),
      );
      expect(mismatch.preview.issues.map((issue) => issue.code)).toEqual([
        "PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH",
      ]);
      expect(mismatch.preview.issues[0]!.message).toMatch(/faltan USD 0.01/);
      expect(mismatch.preview.paymentsTotal).toBe("105.99");
    });

    it("el proveedor con RUC o sin el rol se informa sin asignar roles", async () => {
      const ruc = await createDraft(draftBody({ supplierPartyId: rucSupplierId }));
      expect(codes(ruc)).toEqual(["PURCHASE_SETTLEMENT_SUPPLIER_IDENTIFICATION_NOT_ALLOWED"]);
      const noRole = await createDraft(
        draftBody({ supplierPartyId: noRoleId, supplierAddress: "Quito" }),
      );
      expect(codes(noRole)).toEqual(["PURCHASE_SETTLEMENT_SUPPLIER_ROLE_REQUIRED"]);
      const party = await db.database.prisma.party.findUniqueOrThrow({ where: { id: noRoleId } });
      expect(party.roles).toEqual(["CUSTOMER"]);
    });

    it("una línea con producto lleva el precio de la compra, no el del producto", async () => {
      const draft = await createDraft(
        draftBody({
          lines: [line({ productId: a.productId, mainCode: "CEM-50", unitPrice: "4.50" })],
          payments: [payment({ total: "46.00" })],
        }),
      );
      expect(draft.preview.issues).toEqual([]);
      expect(draft.lines[0]).toMatchObject({
        productId: a.productId,
        productName: "Cemento 50 kg",
      });
      expect(draft.preview.totals!.total).toBe("46.00");
    });

    it("corrige con la versión, rechaza una versión vieja y lista los borradores", async () => {
      const draft = await createDraft();
      const corrected = await call(
        a.cookies.operator,
        "put",
        `/purchase-settlements/drafts/${draft.id}`,
      ).send({ ...draftBody({ supplierAddress: "Otra dirección" }), expectedVersion: 1 });
      expect(corrected.status).toBe(200);
      expect(dataOf<PurchaseSettlementDraftView>(corrected)).toMatchObject({
        version: 2,
        supplierAddress: "Otra dirección",
      });
      const stale = await call(
        a.cookies.operator,
        "put",
        `/purchase-settlements/drafts/${draft.id}`,
      ).send({ ...draftBody(), expectedVersion: 1 });
      expect([stale.status, errorOf(stale).code]).toEqual([
        409,
        "PURCHASE_SETTLEMENT_DRAFT_CHANGED",
      ]);
      const list = await call(a.cookies.operator, "get", "/purchase-settlements/drafts");
      const summaries = dataOf<PurchaseSettlementDraftSummaryView[]>(list);
      expect(summaries.find((item) => item.id === draft.id)).toMatchObject({
        supplierName: "María Quishpe",
        lineCount: 2,
        previewTotal: "106.00",
      });
      const removed = await call(
        a.cookies.operator,
        "delete",
        `/purchase-settlements/drafts/${draft.id}`,
      );
      expect(removed.status).toBe(204);
      const gone = await call(
        a.cookies.operator,
        "get",
        `/purchase-settlements/drafts/${draft.id}`,
      );
      expect([gone.status, errorOf(gone).code]).toEqual([
        404,
        "PURCHASE_SETTLEMENT_DRAFT_NOT_FOUND",
      ]);
    });

    it("un borrador emitido no se consulta, corrige ni elimina", async () => {
      const draft = await createDraft();
      const company = {
        companyId: a.companyId,
        adminId: a.adminId,
        points: [
          {
            establishmentId: a.establishmentId,
            emissionPointId: a.emissionPointId,
            code: "001",
          },
        ],
      };
      const settlement = await insertPurchaseSettlement(
        db.database.prisma,
        company,
        supplierId,
        "SIGNED",
      );
      await db.database.prisma.purchaseSettlementDraft.update({
        where: { id: draft.id },
        data: { status: "EMITTED", documentId: settlement.id },
      });
      for (const [method, body] of [
        ["get", undefined],
        ["put", { ...draftBody(), expectedVersion: 1 }],
        ["delete", undefined],
      ] as const) {
        const res = await call(
          a.cookies.operator,
          method,
          `/purchase-settlements/drafts/${draft.id}`,
        ).send(body);
        expect([method, res.status, errorOf(res).code]).toEqual([
          method,
          409,
          "PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED",
        ]);
      }
    });

    it("los límites efectivos se aplican al guardar, como defensa del sistema", async () => {
      const res = await call(
        a.cookies.operator,
        "post",
        "/purchase-settlements/drafts",
        limited,
      ).send(draftBody());
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: "PURCHASE_SETTLEMENT_RESOURCE_LIMIT",
        message:
          "La liquidación admite como máximo 1 líneas. Es una defensa de recursos del sistema, no un límite del SRI.",
      });
      // Un cuerpo de más de 100 KB dentro de los 4 MiB llega al dominio y lo rechaza el límite.
      const many = draftBody({
        lines: Array.from({ length: 101 }, (_, index) =>
          line({
            mainCode: "€中".repeat(12),
            auxiliaryCode: "ñÁ".repeat(12),
            unit: "漢字".repeat(25),
            description: `${index} ${"€中ñÁ漢字ü".repeat(60)}`.slice(0, 300),
          }),
        ),
      });
      expect(Buffer.byteLength(JSON.stringify(many))).toBeGreaterThan(100 * 1024);
      const big = await call(a.cookies.operator, "post", "/purchase-settlements/drafts").send(many);
      expect([big.status, errorOf(big).code]).toEqual([409, "PURCHASE_SETTLEMENT_RESOURCE_LIMIT"]);
    });

    it("rechaza un companyId, un total o un impuesto distinto del IVA", async () => {
      for (const body of [
        draftBody({ companyId: b.companyId }),
        draftBody({ total: "106.00" }),
        draftBody({ lines: [line({ ice: "3051" })] }),
      ]) {
        const res = await call(a.cookies.operator, "post", "/purchase-settlements/drafts").send(
          body,
        );
        expect([res.status, errorOf(res).code]).toEqual([400, "VALIDATION_ERROR"]);
      }
    });
  });

  describe("aislamiento y permisos", () => {
    it("un proveedor, un producto o un borrador de otra empresa responde como inexistente", async () => {
      const supplier = await call(a.cookies.operator, "post", "/purchase-settlements/drafts").send(
        draftBody({ supplierPartyId: foreignSupplierId }),
      );
      expect([supplier.status, errorOf(supplier).code]).toEqual([
        404,
        "PURCHASE_SETTLEMENT_SUPPLIER_NOT_FOUND",
      ]);
      const product = await call(a.cookies.operator, "post", "/purchase-settlements/drafts").send(
        draftBody({ lines: [line({ productId: foreignProductId })] }),
      );
      expect([product.status, errorOf(product).code]).toEqual([
        404,
        "PURCHASE_SETTLEMENT_PRODUCT_NOT_FOUND",
      ]);
      const point = await call(a.cookies.operator, "post", "/purchase-settlements/drafts").send(
        draftBody({ emissionPointId: b.emissionPointId }),
      );
      expect([point.status, errorOf(point).code]).toEqual([400, "EMISSION_POINT_NOT_FOUND"]);
      const draft = await createDraft();
      for (const method of ["get", "put", "delete"] as const) {
        const res = await call(
          b.cookies.admin,
          method,
          `/purchase-settlements/drafts/${draft.id}`,
        ).send(method === "put" ? { ...draftBody(), expectedVersion: 1 } : undefined);
        expect([method, res.status]).toEqual([method, 404]);
      }
    });

    it("sin el permiso responde 403 y sin sesión 401", async () => {
      for (const [method, path] of [
        ["get", "/purchase-settlements/suppliers"],
        ["get", "/purchase-settlements/options"],
        ["get", "/purchase-settlements/drafts"],
        ["post", "/purchase-settlements/drafts"],
      ] as const) {
        const forbidden = await call(a.cookies.operator, method, path, denied).send({});
        expect([path, forbidden.status]).toEqual([path, 403]);
        const anonymous = await request(api.app)[method](`/api/v1${path}`).send({});
        expect([path, anonymous.status]).toEqual([path, 401]);
      }
    });
  });
});
