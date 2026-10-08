// Prueba end-to-end de add-purchase-settlements (tarea 14.2) contra el backend real: main.ts como
// proceso, con la custodia habilitada, la transmisión hacia un SRI SIMULADO (respuestas sintéticas,
// detrás de un proxy que solo admite su host) y una política de tamaño SINTÉTICA. Una liquidación a
// un proveedor con cédula, con una línea con producto (un bien con control de existencias) y otra
// libre, dos pagos con plazo y las cuatro declaraciones, que se autoriza con su RIDE en la bandeja con
// el proveedor como contraparte; otra que el SRI no autoriza y queda sin RIDE; y el inventario, los
// terceros y la ausencia de comprobantes de retención sin cambios. Las declaraciones no van al XML y
// la auditoría de las liquidaciones es solo la de su emisión.
import { randomBytes, randomUUID } from "node:crypto";
import {
  PURCHASE_SETTLEMENT_STATEMENTS,
  type DocumentListItem,
  type PurchaseSettlementDraftView,
  type PurchaseSettlementView,
} from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { reconcileStock } from "../../src/modules/inventory/infrastructure/index.ts";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { pageTexts } from "../support/pdf-inspection.ts";
import { SRI_HOST, listen, outboundProxy, simulatedSri } from "../support/simulated-sri.ts";
import {
  installSyntheticSizePolicy,
  syntheticSizePolicy,
} from "../support/synthetic-size-policy.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-liquidacion.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-liquidacion.ec", password: "contrasena-operador-e2e-1" };
const SUPPLIER_ID = "1710034065";
const dir = inject("p12FixturesDir");
const compact = (xml: string) => xml.replace(/>\s+</g, "><");
const count = (text: string, part: string) => text.split(part).length - 1;

describe("flujo completo de las liquidaciones de compra", () => {
  let db: MigratedSchema;
  let backend: E2eBackend;
  let sri: ReturnType<typeof simulatedSri>;
  let proxy: ReturnType<typeof outboundProxy>;
  let proxyUrl: string;
  const masterKey = randomBytes(32).toString("base64");

  beforeAll(async () => {
    sri = simulatedSri();
    proxy = outboundProxy(await listen(sri.server));
    proxyUrl = `http://127.0.0.1:${await listen(proxy.server)}`;
    db = await createMigratedSchema("end_to_end_purchase_settlements");
    await installSyntheticSizePolicy(db.database.prisma, [
      syntheticSizePolicy({ maxSignedDocumentBytes: 1_000_000 }),
    ]);
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
    await db?.drop();
    sri?.server.close();
    proxy?.server.close();
  });

  async function signIn(email: string, password: string) {
    const { status, cookie } = await backend.signIn(email, password);
    expect(status).toBe(200);
    return cookie;
  }
  async function api<T>(
    method: string,
    path: string,
    cookie: string,
    body?: unknown,
    idempotencyKey?: string,
  ) {
    const res = await fetch(`${backend.base}/api/v1${path}`, {
      method,
      headers: {
        cookie,
        origin: E2E_ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as {
      data: T;
      error?: { code: string; message: string };
    };
    return { status: res.status, data: json.data, error: json.error };
  }
  async function until(condition: () => Promise<boolean>, what: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`no se cumplió: ${what}\n${backend.output()}`);
  }
  const stateOf = async (id: string) =>
    (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const rideCount = (documentId: string) =>
    db.database.prisma.documentArtifact.count({ where: { documentId, kind: "RIDE_PDF" } });

  it("autoriza una liquidación con cédula, producto, línea libre y dos pagos con su RIDE, no autoriza otra y deja el inventario, los terceros y las retenciones intactos", async () => {
    backend = await startE2eBackend({
      label: "end_to_end_purchase_settlements",
      admin: ADMIN,
      db,
      env: {
        CERTIFICATE_CUSTODY: "enabled",
        CERTIFICATE_MASTER_KEY: masterKey,
        NODE_USE_ENV_PROXY: "1",
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        SRI_TRANSMISSION_ENABLED: "1",
        SRI_JOB_POLL_INTERVAL_MS: "200",
        SRI_JOB_LEASE_SECONDS: "30",
        SRI_REQUEST_TIMEOUT_MS: "5000",
        SRI_BODY_TIMEOUT_MS: "1000",
        SRI_AUTHORIZATION_FIRST_DELAY_SECONDS: "0",
        SRI_POLL_BACKOFF_BASE_SECONDS: "1",
        SRI_POLL_BACKOFF_CAP_SECONDS: "2",
        SRI_ENDPOINT_TEST_RECEPTION: `http://${SRI_HOST}/comprobantes-electronicos-ws/RecepcionComprobantesOffline`,
        SRI_ENDPOINT_TEST_AUTHORIZATION: `http://${SRI_HOST}/comprobantes-electronicos-ws/AutorizacionComprobantesOffline`,
        SRI_ENDPOINT_TEST_VALIDITY: `http://${SRI_HOST}/comprobantes-electronicos-ws/ConsultaComprobante`,
        RIDE_SWEEP_INTERVAL_SECONDS: "86400",
      },
    });
    const admin = await signIn(ADMIN.email, ADMIN.password);
    await api("PUT", "/taxpayer", admin, {
      ruc: FIXTURE_RUC,
      legalName: "COMERCIAL ANDINA S.A.",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    const establishment = await api<{ id: string }>("POST", "/establishments", admin, {
      code: "001",
      address: "Av. 6 de Diciembre, Quito",
    });
    const point = await api<{ id: string }>(
      "POST",
      `/establishments/${establishment.data.id}/emission-points`,
      admin,
      { code: "001" },
    );
    expect(
      (
        await api("PUT", "/signing-certificate", admin, {
          file: readFixture(dir, "sd-utf8.modern.p12").toString("base64"),
          password: FIXTURE_PASSWORD,
          expectedCurrentId: null,
        })
      ).status,
    ).toBe(200);
    await api("POST", "/users", admin, {
      name: "Olga Operadora",
      email: OPERATOR.email,
      password: OPERATOR.password,
      role: "OPERATOR",
    });
    const maria = await api<{ id: string }>("POST", "/parties", admin, {
      identificationType: "05",
      identification: SUPPLIER_ID,
      legalName: "María Quishpe",
      address: "Comunidad San Pablo, Cayambe",
      roles: ["SUPPLIER"],
    });
    const juan = await api<{ id: string }>("POST", "/parties", admin, {
      identificationType: "06",
      identification: "AB1234567",
      legalName: "Juan Pérez",
      address: "Sector La Esperanza, Tulcán",
      roles: ["SUPPLIER"],
    });
    // Un bien con control de existencias inicializado: la liquidación nunca mueve su inventario.
    const cacao = await api<{ id: string }>("POST", "/products", admin, {
      kind: "GOOD",
      mainCode: "CAC-01",
      name: "Cacao en grano",
      unitPrice: "3.10",
      stockTracked: true,
      taxes: { iva: "4" },
    });
    expect(
      (
        await api("POST", `/inventory/items/${cacao.data.id}/initialization`, admin, {
          quantity: "20",
        })
      ).status,
    ).toBe(201);
    const operator = await signIn(OPERATOR.email, OPERATOR.password);
    const companyId = (await db.database.prisma.organization.findFirstOrThrow()).id;
    const parties = () =>
      db.database.prisma.party.findMany({
        orderBy: { id: "asc" },
        select: { id: true, roles: true, version: true, status: true, legalName: true },
      });
    const partiesBefore = await parties();
    const movementsBefore = await db.database.prisma.stockMovement.count();
    const balancesBefore = await db.database.prisma.stockBalance.findMany();

    const emit = async (supplierPartyId: string) => {
      const draft = await api<PurchaseSettlementDraftView>(
        "POST",
        "/purchase-settlements/drafts",
        operator,
        {
          emissionPointId: point.data.id,
          supplierPartyId,
          lines: [
            {
              productId: cacao.data.id,
              mainCode: "CAC-01",
              description: "Saco de cacao en grano, 45 kg",
              unit: "saco",
              quantity: "10",
              unitPrice: "4.50",
              discount: "5.00",
              ivaRate: "4",
            },
            { description: "Jornal de cosecha", quantity: "2", unitPrice: "30.00", ivaRate: "0" },
          ],
          payments: [
            { paymentMethod: "01", total: "50.00", term: "0", timeUnit: "días" },
            { paymentMethod: "20", total: "56.00", term: "30", timeUnit: "días" },
          ],
        },
      );
      expect([draft.status, draft.data.preview.issues]).toEqual([201, []]);
      return api<PurchaseSettlementView>(
        "POST",
        "/purchase-settlements",
        operator,
        {
          draftId: draft.data.id,
          expectedVersion: draft.data.version,
          declarations: { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS] },
        },
        randomUUID(),
      );
    };

    // Liquidación 1: a María Quishpe (cédula), autorizada con su RIDE.
    const authorized = await emit(maria.data.id);
    expect([authorized.status, authorized.data.state]).toEqual([201, "SIGNED"]);
    expect(authorized.data.supplier).toMatchObject({
      identificationType: "05",
      identification: SUPPLIER_ID,
      legalName: "María Quishpe",
      address: "Comunidad San Pablo, Cayambe",
    });
    expect(authorized.data.totals.total).toBe("106.00");
    expect(authorized.data.eligibility.declarations.map((item) => item.basis)).toEqual([
      "USER_DECLARED",
      "USER_DECLARED",
      "USER_DECLARED",
      "USER_DECLARED",
    ]);
    await until(
      async () => (await stateOf(authorized.data.id)) === "AUTHORIZED",
      "liquidación 1 autorizada",
    );
    await until(async () => (await rideCount(authorized.data.id)) === 1, "RIDE de la liquidación");
    // La bandeja la lista con el proveedor como contraparte, su importe y su RIDE.
    const inbox = await api<DocumentListItem[]>("GET", "/documents?documentType=03", operator);
    expect(
      inbox.data.map((d) => [
        d.id,
        d.documentType,
        d.state,
        d.documents.ride,
        Number(d.total),
        d.buyer,
      ]),
    ).toEqual([
      [
        authorized.data.id,
        "03",
        "AUTHORIZED",
        "AVAILABLE",
        106,
        { identification: SUPPLIER_ID, name: "María Quishpe" },
      ],
    ]);
    const bySupplier = await api<DocumentListItem[]>(
      "GET",
      `/documents?identification=${SUPPLIER_ID}`,
      operator,
    );
    expect(bySupplier.data.map((d) => d.id)).toEqual([authorized.data.id]);
    const ride = await fetch(`${backend.base}/api/v1/documents/${authorized.data.id}/ride`, {
      headers: { cookie: operator, origin: E2E_ORIGIN },
    });
    expect(ride.status).toBe(200);
    expect(ride.headers.get("content-disposition")).toContain("liquidacion-de-compra");
    const text = (await pageTexts(Buffer.from(await ride.arrayBuffer()))).join(" ");
    expect(text).toContain("LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS");
    expect(text).toContain("Razón Social / Nombres y Apellidos: María Quishpe");
    expect(text).toContain(`Identificación: ${SUPPLIER_ID}`);
    expect(text).toContain("Dirección: Comunidad San Pablo, Cayambe");
    expect(text).toContain("CAC-01 10 Saco de cacao en grano, 45 kg saco 4.5 5.00 40.00");
    expect(text).toContain("20 - OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO 30 días 56.00");
    expect(text).toContain("VALOR TOTAL 106.00");
    // Sus XML llevan el proveedor, las líneas y los pagos con su plazo, sin las declaraciones.
    for (const kind of ["authorized-xml", "signed-xml"]) {
      const xml = await fetch(`${backend.base}/api/v1/documents/${authorized.data.id}/${kind}`, {
        headers: { cookie: operator, origin: E2E_ORIGIN },
      });
      expect([kind, xml.status]).toEqual([kind, 200]);
      const body = compact(await xml.text());
      expect(body).toContain(authorized.data.accessKey);
      expect(body).toContain("<codDoc>03</codDoc>");
      expect(body).toContain("<tipoIdentificacionProveedor>05</tipoIdentificacionProveedor>");
      expect(body).toContain(`<identificacionProveedor>${SUPPLIER_ID}</identificacionProveedor>`);
      expect(body).toContain(
        "<direccionProveedor>Comunidad San Pablo, Cayambe</direccionProveedor>",
      );
      expect(count(body, "<detalle>")).toBe(2);
      expect(count(body, "<pago>")).toBe(2);
      expect(body).toContain("<plazo>30</plazo><unidadTiempo>días</unidadTiempo>");
      expect(body).toContain("<importeTotal>106.00</importeTotal>");
      expect(body).toContain("<moneda>DOLAR</moneda>");
      expect(body).not.toMatch(/NATURAL_PERSON|USER_DECLARED|RUSTICITY|declar/i);
    }

    // Liquidación 2: el SRI simulado no la autoriza; no tiene RIDE.
    sri.notAuthorized.add("03:2");
    const rejected = await emit(juan.data.id);
    expect([rejected.status, rejected.data.state]).toEqual([201, "SIGNED"]);
    await until(
      async () => (await stateOf(rejected.data.id)) === "NOT_AUTHORIZED",
      "liquidación 2 no autorizada",
    );
    expect(await rideCount(rejected.data.id)).toBe(0);

    // El inventario, los terceros y las retenciones quedan intactos.
    expect(await db.database.prisma.stockMovement.count()).toBe(movementsBefore);
    expect(await db.database.prisma.stockBalance.findMany()).toEqual(balancesBefore);
    expect(await reconcileStock(db.database.prisma, companyId)).toEqual([]);
    expect(await parties()).toEqual(partiesBefore);
    expect(
      await db.database.prisma.electronicDocument.count({ where: { documentType: "07" } }),
    ).toBe(0);
    expect(new Set(proxy.destinations)).toEqual(new Set([`${SRI_HOST}:80`]));
    // La auditoría de las liquidaciones es la de su emisión: la transmisión, la autorización, el RIDE
    // y las descargas no la duplican.
    const audit = await db.database.prisma.auditEvent.findMany({ orderBy: { occurredAt: "asc" } });
    const aboutSettlements = audit.filter((event) =>
      [authorized.data.id, rejected.data.id].some((id) =>
        JSON.stringify(event.changes).includes(id),
      ),
    );
    expect(aboutSettlements.map((event) => event.action)).toEqual([
      "purchase_settlement.reserved",
      "purchase_settlement.signed",
      "purchase_settlement.reserved",
      "purchase_settlement.signed",
    ]);
  }, 240_000);
});
