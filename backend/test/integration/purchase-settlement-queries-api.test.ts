// Consulta de las liquidaciones de compra por HTTP (add-purchase-settlements, tarea 8.1, design D11,
// D18 y D21): el detalle desde el snapshot con el proveedor, las líneas, el IVA por tarifa, los pagos
// con su plazo, las cuatro declaraciones "declaradas por" el usuario y el aviso de la retención; la
// lista con el proveedor, la fecha, el importe y el estado; la búsqueda por número o por la
// identificación o el nombre del proveedor, el filtro de estado y la paginación; el historial de la
// transmisión; y `403`, `401` y otra empresa `404`.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  PURCHASE_SETTLEMENT_STATEMENTS,
  type PurchaseSettlementSummaryView,
  type PurchaseSettlementTransmissionView,
  type PurchaseSettlementView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: PurchaseSettlementView &
    PurchaseSettlementSummaryView[] &
    PurchaseSettlementTransmissionView;
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const NOW = () => new Date("2026-10-07T15:00:00Z");

describe("consulta de las liquidaciones de compra", () => {
  let db: MigratedSchema;
  let api: App;
  let reserving: App;
  let denied: App;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let mariaId: string;
  let juanId: string;
  let maria: PurchaseSettlementView;
  let juan: PurchaseSettlementView;
  let reserved: PurchaseSettlementView;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const emit = async (app: App, supplierPartyId: string) => {
    const draft = await request(api.app)
      .post("/api/v1/purchase-settlements/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        supplierPartyId,
        lines: [
          {
            description: "Saco de cacao en grano, 45 kg",
            unit: "saco",
            quantity: "10",
            unitPrice: "4.50",
            discount: "5.00",
            ivaRate: "4",
          },
          {
            mainCode: "JOR-01",
            description: "Jornal de cosecha",
            quantity: "2",
            unitPrice: "30.00",
            ivaRate: "0",
          },
        ],
        payments: [
          { paymentMethod: "01", total: "50.00", term: "0", timeUnit: "días" },
          { paymentMethod: "20", total: "56.00", term: "30", timeUnit: "días" },
        ],
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
  const get = (path: string, cookie = a.cookies.operator, app = api) =>
    request(app.app).get(`/api/v1${path}`).set("Cookie", cookie);

  beforeAll(async () => {
    db = await createMigratedSchema("purchase_settlement_queries_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now: NOW });
    reserving = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: NOW,
      purchaseSettlements: { signAfterReserve: false },
    });
    denied = buildTaxpayerApp(db, {
      now: NOW,
      purchaseSettlements: { deny: ["purchaseSettlements.read"] },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "consulta-liquidacion-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "consulta-liquidacion-b", pool, p12Dir });
    mariaId = await insertPurchaseSupplier(db.database.prisma, a, "0102030405", {
      legalName: "María Quishpe",
    });
    juanId = await insertPurchaseSupplier(db.database.prisma, a, "AB1234567", {
      identificationType: "06",
      legalName: "Juan Pérez",
    });
    maria = await emit(api, mariaId);
    juan = await emit(api, juanId);
    reserved = await emit(reserving, mariaId);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("el detalle sale del snapshot con el proveedor, las líneas, el IVA, los pagos, las declaraciones y el aviso", async () => {
    // El tercero cambia después de emitir: el detalle conserva lo congelado.
    await db.database.prisma.party.update({
      where: { id: mariaId },
      data: { legalName: "Nombre corregido después" },
    });
    const res = await get(`/purchase-settlements/${maria.id}`);
    expect(res.status).toBe(200);
    const detail = bodyOf(res).data;
    expect(detail).toMatchObject({
      id: maria.id,
      documentType: "03",
      state: "SIGNED",
      supplier: {
        identificationType: "05",
        identification: "0102030405",
        legalName: "María Quishpe",
        address: "Comunidad San Pablo, Cayambe",
      },
      totals: { withoutTaxes: "100.00", discount: "5.00", total: "106.00" },
      withholdingNotice:
        "Esta operación requiere la retención correspondiente conforme a la normativa aplicable.",
    });
    expect(detail.lines.map((line) => [line.position, line.description, line.taxableBase])).toEqual(
      [
        [1, "Saco de cacao en grano, 45 kg", "40.00"],
        [2, "Jornal de cosecha", "60.00"],
      ],
    );
    expect(
      detail.totals.taxes.map((tax) => [tax.rateCode, tax.label, tax.base, tax.amount]),
    ).toEqual([
      ["0", "0%", "60.00", "0.00"],
      ["4", "15%", "40.00", "6.00"],
    ]);
    expect(detail.payments.map((paid) => [paid.label, paid.term, paid.timeUnit])).toEqual([
      ["SIN UTILIZACION DEL SISTEMA FINANCIERO", "0", "días"],
      ["OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO", "30", "días"],
    ]);
    expect(detail.eligibility.declarations.map((item) => [item.statementId, item.basis])).toEqual(
      PURCHASE_SETTLEMENT_STATEMENTS.map((id) => [id, "USER_DECLARED"]),
    );
    expect(detail.eligibility.declarations[0]).toMatchObject({
      text: "El proveedor es una persona natural no obligada a llevar contabilidad.",
      declaredByName: "Operador consulta-liquidacion-a",
    });
    expect(JSON.stringify(detail)).not.toMatch(/SYSTEM_VERIFIED|verificad/i);
    await db.database.prisma.party.update({
      where: { id: mariaId },
      data: { legalName: "María Quishpe" },
    });
  });

  it("lista con el proveedor, la fecha, el importe y el estado; busca por número, identificación o nombre; filtra por estado", async () => {
    const all = await get("/purchase-settlements");
    expect(all.status).toBe(200);
    expect(bodyOf(all).meta?.total).toBe(3);
    const summary = bodyOf(all).data.find((item) => item.id === maria.id)!;
    expect(summary).toMatchObject({
      documentNumber: maria.documentNumber,
      supplierIdentification: "0102030405",
      supplierName: "María Quishpe",
      issueDate: "2026-10-07",
      total: "106.00",
      state: "SIGNED",
    });
    const byIdentification = await get("/purchase-settlements?search=AB1234567");
    expect(bodyOf(byIdentification).data.map((item) => item.id)).toEqual([juan.id]);
    const byName = await get("/purchase-settlements?search=pérez");
    expect(bodyOf(byName).data.map((item) => item.id)).toEqual([juan.id]);
    const byNumber = await get(`/purchase-settlements?search=${maria.documentNumber}`);
    expect(bodyOf(byNumber).data.map((item) => item.id)).toEqual([maria.id]);
    const byState = await get("/purchase-settlements?state=RESERVED");
    expect(bodyOf(byState).data.map((item) => item.id)).toEqual([reserved.id]);
    const paged = await get("/purchase-settlements?page=2&pageSize=2");
    expect([bodyOf(paged).data.length, bodyOf(paged).meta]).toEqual([
      1,
      { page: 2, pageSize: 2, total: 3 },
    ]);
  });

  it("el historial de la transmisión se consulta sin respuestas originales ni XML", async () => {
    const res = await get(`/purchase-settlements/${maria.id}/transmission`);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({ purchaseSettlementId: maria.id, state: "SIGNED" });
    expect(bodyOf(res).data.events.map((event) => event.kind)).toContain("TRANSITION");
    expect(JSON.stringify(bodyOf(res).data)).not.toMatch(/<\?xml|soap/i);
  });

  it("otra empresa recibe 404 sin revelar que existe; sin permiso, 403; sin sesión, 401", async () => {
    for (const path of [
      `/purchase-settlements/${maria.id}`,
      `/purchase-settlements/${maria.id}/transmission`,
    ]) {
      const foreign = await get(path, b.cookies.admin);
      expect([path, foreign.status, bodyOf(foreign).error.code]).toEqual([
        path,
        404,
        "PURCHASE_SETTLEMENT_NOT_FOUND",
      ]);
      expect((await get(path, a.cookies.operator, denied)).status).toBe(403);
      expect((await request(api.app).get(`/api/v1${path}`)).status).toBe(401);
    }
    const foreignList = await get("/purchase-settlements", b.cookies.admin);
    expect(bodyOf(foreignList).meta?.total).toBe(0);
    expect((await get("/purchase-settlements", a.cookies.operator, denied)).status).toBe(403);
  });
});
