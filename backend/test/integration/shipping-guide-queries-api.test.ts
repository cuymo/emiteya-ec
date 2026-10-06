// Consulta de las guías de remisión por HTTP (add-shipping-guides, tarea 8.1, design D11, D18, D21 y
// D22): el detalle desde el snapshot con el transportista, la placa, las fechas, la partida y todos
// los destinatarios con su sustento (la excepción como declarada por el usuario) y su detalle; la
// lista con "N destinatarios" o el nombre, sin importes; la búsqueda por número, transportista o
// identificación de cualquier destinatario, el filtro de estado y la paginación; el historial de la
// transmisión; y `403`, `401` y otra empresa `404`.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  ShippingGuideSummaryView,
  ShippingGuideTransmissionView,
  ShippingGuideView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { insertAuthorizedInvoice, type AuthorizedInvoiceDocument } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertGuideParty } from "./shipping-guide-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: ShippingGuideView & ShippingGuideSummaryView[] & ShippingGuideTransmissionView;
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const NOW = () => new Date("2026-10-06T15:00:00Z");

describe("consulta de las guías de remisión", () => {
  let db: MigratedSchema;
  let api: App;
  let reserving: App;
  let denied: App;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let carrierId: string;
  let secondId: string;
  let destinationId: string;
  let invoice: AuthorizedInvoiceDocument;
  let single: ShippingGuideView;
  let several: ShippingGuideView;
  let reserved: ShippingGuideView;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const invoiceRecipient = () => ({
    recipient: { kind: "PARTY", partyId: a.customerId },
    address: "Av. Simón Bolívar S/N",
    motive: "Venta",
    support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.id },
    details: [{ productId: a.productId, description: "Cemento 50 kg", quantity: "10" }],
  });
  const emit = async (app: App, overrides: Record<string, unknown> = {}, declared = false) => {
    const draft = await request(api.app)
      .post("/api/v1/shipping-guides/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        transporter: { source: "SELF" },
        plate: "PAA-1234",
        transportStart: "2026-10-06",
        transportEnd: "2026-10-07",
        recipients: [invoiceRecipient()],
        ...overrides,
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const res = await request(app.app)
      .post("/api/v1/shipping-guides")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: bodyOf(draft).data.id,
        expectedVersion: 1,
        exceptionDeclaration: declared ? { policyVersion: 1 } : null,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const get = (path: string, cookie = a.cookies.operator, app = api) =>
    request(app.app).get(`/api/v1${path}`).set("Cookie", cookie);

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_queries_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now: NOW });
    reserving = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: NOW,
      shippingGuides: { signAfterReserve: false },
    });
    denied = buildTaxpayerApp(db, { now: NOW, shippingGuides: { deny: ["shippingGuides.read"] } });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "consulta-guia-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "consulta-guia-b", pool, p12Dir });
    const prisma = db.database.prisma;
    const company = { companyId: a.companyId, adminId: a.adminId, points: [] };
    carrierId = await insertGuideParty(prisma, company, "1791111111001", {
      roles: ["CARRIER"],
      legalName: "TRANSPORTES ANDINOS S.A.",
    });
    secondId = await insertGuideParty(prisma, company, "1710034065", {
      legalName: "Ana Cédula Destinataria",
    });
    destinationId = (
      await prisma.establishment.create({
        data: { companyId: a.companyId, code: "002", address: "Bodega sur, Quito" },
      })
    ).id;
    invoice = await insertAuthorizedInvoice(
      prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: a.productId, quantity: "10", unitPrice: "8.75" }],
    );
    single = await emit(api);
    several = await emit(
      api,
      {
        originEstablishmentId: a.establishmentId,
        transporter: { source: "PARTY", partyId: carrierId },
        plate: "PBB-5678",
        recipients: [
          invoiceRecipient(),
          {
            recipient: { kind: "PARTY", partyId: secondId },
            address: "Calle Sucre 12",
            motive: "Consignación",
            support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
            details: [{ productId: null, description: "Varilla 12 mm", quantity: "2.5" }],
          },
          {
            recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: destinationId },
            motive: "Reposición",
            support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
            details: [{ productId: null, description: "Arena", quantity: "3" }],
          },
        ],
      },
      true,
    );
    reserved = await emit(reserving);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("el detalle trae el transportista, la placa, las fechas, la partida y cada destinatario con su sustento y su detalle", async () => {
    const res = await get(`/shipping-guides/${several.id}`);
    expect(res.status).toBe(200);
    const guide = bodyOf(res).data;
    expect(guide).toMatchObject({
      id: several.id,
      documentType: "06",
      state: "SIGNED",
      transporter: {
        source: "PARTY",
        partyId: carrierId,
        identificationType: "04",
        identification: "1791111111001",
        legalName: "TRANSPORTES ANDINOS S.A.",
      },
      plate: "PBB-5678",
      transportStart: "2026-10-06",
      transportEnd: "2026-10-07",
      departure: {
        source: "ESTABLISHMENT",
        establishment: { id: a.establishmentId, code: "001" },
        address: "Av. 6 de Diciembre, Quito",
      },
      counts: { recipients: 3, details: 3 },
      diagnostic: null,
    });
    expect(guide.artifact?.sizeBytes).toBeGreaterThan(0);
    expect(
      guide.recipients.map((r) => [r.position, r.kind, r.identification, r.support.kind]),
    ).toEqual([
      [1, "PARTY", "0992877878001", "INTERNAL_INVOICE"],
      [2, "PARTY", "1710034065", "DECLARED_EXCEPTION"],
      [3, "OWN_COMPANY", "1790012345001", "DECLARED_EXCEPTION"],
    ]);
    expect(guide.recipients[1]!.support).toMatchObject({
      kind: "DECLARED_EXCEPTION",
      declaration: {
        case: "CONSIGNMENT",
        basis: "USER_DECLARED",
        declaredBy: a.operatorId,
        declaredByName: "Operador consulta-guia-a",
      },
    });
    expect(guide.recipients[2]).toMatchObject({
      destinationEstablishment: { code: "002", address: "Bodega sur, Quito" },
      destinationEstablishmentCode: "002",
      details: [{ position: 1, productId: null, description: "Arena", quantity: "3" }],
    });
    expect(JSON.stringify(guide)).not.toMatch(/total|precio|price|verified|verificad/i);
  });

  it('lista las guías con el transportista y "N destinatarios" o el nombre, sin importes, las más recientes primero', async () => {
    const res = await get("/shipping-guides");
    expect(res.status).toBe(200);
    expect(bodyOf(res).meta).toEqual({ page: 1, pageSize: 25, total: 3 });
    expect(
      bodyOf(res).data.map((r) => [r.id, r.state, r.carrierName, r.recipients, r.transportStart]),
    ).toEqual([
      [
        reserved.id,
        "RESERVED",
        "COMERCIAL ANDINA S.A.",
        { count: 1, name: "EL PERNO CIA. LTDA." },
        "2026-10-06",
      ],
      [several.id, "SIGNED", "TRANSPORTES ANDINOS S.A.", { count: 3, name: null }, "2026-10-06"],
      [
        single.id,
        "SIGNED",
        "COMERCIAL ANDINA S.A.",
        { count: 1, name: "EL PERNO CIA. LTDA." },
        "2026-10-06",
      ],
    ]);
    for (const row of bodyOf(res).data) expect(Object.keys(row)).not.toContain("total");
  });

  it("busca por número, transportista o identificación de cualquier destinatario y filtra por estado, con paginación", async () => {
    const ids = async (query: string) =>
      bodyOf(await get(`/shipping-guides${query}`)).data.map((r) => r.id);
    expect(await ids(`?search=${single.documentNumber}`)).toEqual([single.id]);
    expect(await ids("?search=1791111111001")).toEqual([several.id]);
    expect(await ids(`?search=${encodeURIComponent("andinos")}`)).toEqual([several.id]);
    // La identificación y el nombre del segundo destinatario encuentran la guía.
    expect(await ids("?search=1710034065")).toEqual([several.id]);
    expect(await ids(`?search=${encodeURIComponent("ana cédula")}`)).toEqual([several.id]);
    expect(await ids("?search=0992877878001")).toEqual([reserved.id, several.id, single.id]);
    expect(await ids("?state=RESERVED")).toEqual([reserved.id]);
    expect(await ids("?state=SIGNED&search=0992877878001")).toEqual([several.id, single.id]);
    const page = bodyOf(await get("/shipping-guides?pageSize=1&page=2"));
    expect([page.data.map((r) => r.id), page.meta]).toEqual([
      [several.id],
      { page: 2, pageSize: 1, total: 3 },
    ]);
    expect((await get("/shipping-guides?state=OTRO")).status).toBe(400);
  });

  it("una guía reservada no tiene artefacto; el historial lista sus transiciones", async () => {
    const pending = bodyOf(await get(`/shipping-guides/${reserved.id}`)).data;
    expect(pending).toMatchObject({ state: "RESERVED", artifact: null });
    const history = await get(`/shipping-guides/${single.id}/transmission`);
    expect(history.status).toBe(200);
    expect(bodyOf(history).data).toMatchObject({ shippingGuideId: single.id, state: "SIGNED" });
    expect(
      bodyOf(history)
        .data.events.filter((e) => e.kind === "TRANSITION")
        .map((e) => (e.kind === "TRANSITION" ? e.toState : null)),
    ).toEqual(expect.arrayContaining(["RESERVED", "SIGNED"]));
  });

  it("sin el permiso de consulta responde 403; sin sesión, 401; otra empresa, 404", async () => {
    for (const path of [
      "/shipping-guides",
      `/shipping-guides/${single.id}`,
      `/shipping-guides/${single.id}/transmission`,
    ]) {
      expect((await get(path, a.cookies.operator, denied)).status, path).toBe(403);
      expect((await request(api.app).get(`/api/v1${path}`)).status, path).toBe(401);
    }
    for (const path of [
      `/shipping-guides/${single.id}`,
      `/shipping-guides/${single.id}/transmission`,
    ]) {
      const res = await get(path, b.cookies.admin);
      expect([res.status, bodyOf(res).error.code], path).toEqual([404, "SHIPPING_GUIDE_NOT_FOUND"]);
    }
    expect(bodyOf(await get("/shipping-guides", b.cookies.admin)).data).toEqual([]);
    // Un comprobante de otro tipo tampoco es una guía.
    const notAGuide = await get(`/shipping-guides/${invoice.id}`);
    expect([notAGuide.status, bodyOf(notAGuide).error.code]).toEqual([
      404,
      "SHIPPING_GUIDE_NOT_FOUND",
    ]);
  });
});
