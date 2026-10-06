// Consulta de los comprobantes de retención por HTTP (add-withholding-receipts, tarea 8.1, design D4,
// D18 y D21): el detalle desde el snapshot con el sujeto, la parte relacionada como declaración del
// usuario, el período, los documentos con sus impuestos, pagos y retenciones y el total retenido; la
// búsqueda por número o proveedor, los filtros de estado y período y la paginación; el historial de
// la transmisión; y `403`, `401` y otra empresa `404`.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  WithholdingReceiptSummaryView,
  WithholdingReceiptView,
  WithholdingTransmissionView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: WithholdingReceiptView & WithholdingReceiptSummaryView[] & WithholdingTransmissionView;
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const NOW = () => new Date("2026-10-06T15:00:00Z");
const SUPPORT = {
  documentType: "01",
  supportCode: "01",
  number: "001001000000123",
  issueDate: "2026-10-01",
  totalWithoutTaxes: "100.00",
  importTotal: "115.00",
  taxes: [
    { tax: "2", rateEntryKey: "4", base: "100.00", amount: "15.00" },
    { tax: "3", rateEntryKey: "3011", rate: "150", base: "10.00", amount: "15.00" },
  ],
  payments: [{ paymentMethod: "20", total: "115.00" }],
  withholdings: [
    { tax: "1", entryKey: "312", base: "100.00" },
    { tax: "2", entryKey: "9", base: "15.00" },
  ],
};

describe("consulta de los comprobantes de retención", () => {
  let db: MigratedSchema;
  let api: App;
  let reserving: App;
  let denied: App;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let other: string;
  let signed: WithholdingReceiptView;
  let september: WithholdingReceiptView;
  let reserved: WithholdingReceiptView;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const emit = async (app: App, overrides: Record<string, unknown> = {}) => {
    const draft = await request(api.app)
      .post("/api/v1/withholding-receipts/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        partyId: a.supplierId,
        relatedParty: "NO",
        emissionPointId: a.emissionPointId,
        supports: [SUPPORT],
        ...overrides,
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const res = await request(app.app)
      .post("/api/v1/withholding-receipts")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const get = (path: string, cookie = a.cookies.operator, app = api) =>
    request(app.app).get(`/api/v1${path}`).set("Cookie", cookie);

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_queries_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now: NOW });
    reserving = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: NOW,
      withholdingReceipts: { signAfterReserve: false },
    });
    denied = buildTaxpayerApp(db, {
      now: NOW,
      withholdingReceipts: { deny: ["withholdings.read"] },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "consulta-ret-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "consulta-ret-b", pool, p12Dir });
    other = (
      await db.database.prisma.party.create({
        data: {
          companyId: a.companyId,
          identificationType: "05",
          identification: "1710034065",
          legalName: "Ana Cédula Proveedora",
          roles: ["SUPPLIER"],
          searchName: "ana cédula proveedora",
          searchIdentification: "1710034065",
          createdBy: a.adminId,
          updatedBy: a.adminId,
        },
      })
    ).id;
    signed = await emit(api, { relatedParty: "SI" });
    september = await emit(api, { partyId: other, fiscalPeriod: "09/2026" });
    reserved = await emit(reserving);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("el detalle trae el sujeto, la parte relacionada declarada, el período, los documentos y el total", async () => {
    const res = await get(`/withholding-receipts/${signed.id}`);
    expect(res.status).toBe(200);
    const receipt = bodyOf(res).data;
    expect(receipt).toMatchObject({
      id: signed.id,
      documentType: "07",
      state: "SIGNED",
      documentNumber: signed.documentNumber,
      subject: {
        partyId: a.supplierId,
        identification: "1791234567001",
        legalName: "PROVEEDORA DEL SUR S.A.",
      },
      relatedParty: {
        value: "SI",
        basis: "USER_DECLARED",
        declaredBy: a.operatorId,
        declaredByName: "Operador consulta-ret-a",
      },
      fiscalPeriod: "10/2026",
      totals: { withheld: "3.50" },
      diagnostic: null,
    });
    expect(receipt.artifact?.sizeBytes).toBeGreaterThan(0);
    expect(receipt.supports).toHaveLength(1);
    expect(receipt.supports[0]).toMatchObject({
      documentType: "01",
      documentTypeLabel: "Factura",
      totalWithoutTaxes: "100.00",
      importTotal: "115.00",
    });
    expect(receipt.supports[0]!.supportCodeLabel).toContain("Crédito Tributario");
    expect(
      receipt.supports[0]!.taxes.map((t) => [t.tax, t.taxLabel, t.rateCode, t.rate, t.rateBasis]),
    ).toEqual([
      ["2", "IVA", "4", "15", "CATALOG"],
      ["3", "ICE", "3011", "150", "USER_DECLARED"],
    ]);
    expect(
      receipt.supports[0]!.withholdings.map((w) => [
        w.tax,
        w.taxLabel,
        w.code,
        w.base,
        w.percentage,
        w.amount,
      ]),
    ).toEqual([
      ["1", "RENTA", "312", "100.00", "2", "2.00"],
      ["2", "IVA", "9", "15.00", "10", "1.50"],
    ]);
  });

  it("lista las retenciones con su proveedor, su período, su total y su estado, las más recientes primero", async () => {
    const res = await get("/withholding-receipts");
    expect(res.status).toBe(200);
    expect(bodyOf(res).meta).toEqual({ page: 1, pageSize: 25, total: 3 });
    expect(
      bodyOf(res).data.map((r) => [
        r.id,
        r.state,
        r.fiscalPeriod,
        r.subjectName,
        r.total,
        r.supportCount,
      ]),
    ).toEqual([
      [reserved.id, "RESERVED", "10/2026", "PROVEEDORA DEL SUR S.A.", "3.50", 1],
      [september.id, "SIGNED", "09/2026", "Ana Cédula Proveedora", "3.50", 1],
      [signed.id, "SIGNED", "10/2026", "PROVEEDORA DEL SUR S.A.", "3.50", 1],
    ]);
  });

  it("busca por número o proveedor y filtra por estado y período, con paginación", async () => {
    const ids = async (query: string) =>
      bodyOf(await get(`/withholding-receipts${query}`)).data.map((r) => r.id);
    expect(await ids(`?search=${signed.documentNumber}`)).toEqual([signed.id]);
    expect(await ids("?search=1710034065")).toEqual([september.id]);
    expect(await ids(`?search=${encodeURIComponent("ana cédula")}`)).toEqual([september.id]);
    expect(await ids("?state=RESERVED")).toEqual([reserved.id]);
    expect(await ids("?state=SIGNED&fiscalPeriod=10/2026")).toEqual([signed.id]);
    expect(await ids(`?fiscalPeriod=${encodeURIComponent("09/2026")}`)).toEqual([september.id]);
    expect(await ids("?fiscalPeriod=08/2026")).toEqual([]);
    const page = bodyOf(await get("/withholding-receipts?pageSize=1&page=2"));
    expect([page.data.map((r) => r.id), page.meta]).toEqual([
      [september.id],
      { page: 2, pageSize: 1, total: 3 },
    ]);
    expect((await get("/withholding-receipts?fiscalPeriod=2026-10")).status).toBe(400);
  });

  it("una retención reservada muestra su diagnóstico; el historial lista sus transiciones", async () => {
    const pending = bodyOf(await get(`/withholding-receipts/${reserved.id}`)).data;
    expect(pending).toMatchObject({ state: "RESERVED", artifact: null });
    const history = await get(`/withholding-receipts/${signed.id}/transmission`);
    expect(history.status).toBe(200);
    expect(bodyOf(history).data).toMatchObject({
      withholdingReceiptId: signed.id,
      state: "SIGNED",
    });
    expect(
      bodyOf(history)
        .data.events.filter((e) => e.kind === "TRANSITION")
        .map((e) => (e.kind === "TRANSITION" ? e.toState : null)),
    ).toEqual(expect.arrayContaining(["RESERVED", "SIGNED"]));
  });

  it("sin el permiso de consulta responde 403; sin sesión, 401; otra empresa, 404", async () => {
    for (const path of [
      "/withholding-receipts",
      `/withholding-receipts/${signed.id}`,
      `/withholding-receipts/${signed.id}/transmission`,
    ]) {
      expect((await get(path, a.cookies.operator, denied)).status, path).toBe(403);
      expect((await request(api.app).get(`/api/v1${path}`)).status, path).toBe(401);
    }
    for (const path of [
      `/withholding-receipts/${signed.id}`,
      `/withholding-receipts/${signed.id}/transmission`,
    ]) {
      const res = await get(path, b.cookies.admin);
      expect([res.status, bodyOf(res).error.code], path).toEqual([
        404,
        "WITHHOLDING_RECEIPT_NOT_FOUND",
      ]);
    }
    expect(bodyOf(await get("/withholding-receipts", b.cookies.admin)).data).toEqual([]);
  });
});
