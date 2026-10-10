// Prueba end-to-end de add-shipping-guides (tarea 13.2) contra el backend real: main.ts como proceso,
// con la custodia habilitada, la transmisión hacia un SRI SIMULADO (respuestas sintéticas, detrás de
// un proxy que solo admite su host) y una política de tamaño SINTÉTICA. Una guía con transporte
// propio que sale del establecimiento 001 hacia dos destinatarios (el cliente de una factura
// autorizada, con las mercancías sugeridas de la factura, y un traslado al establecimiento propio
// 002) que se autoriza, con su RIDE en la bandeja y en la búsqueda por cualquiera de sus
// destinatarios; otra guía que el SRI no autoriza; y la factura, el inventario y los roles del cliente
// sin cambios. La auditoría de las guías es solo la de su emisión.
import { randomBytes, randomUUID } from "node:crypto";
import type {
  DocumentListItem,
  DraftView,
  InvoiceView,
  ShippingGuideDraftView,
  ShippingGuideView,
  ShippingInvoiceGoodsView,
} from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { reconcileCreditCapacity } from "../../src/modules/credit-notes/infrastructure/index.ts";
import {
  reconcileStock,
  reconcileStockReturnCapacity,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { pageTexts } from "../support/pdf-inspection.ts";
import { SRI_HOST, listen, outboundProxy, simulatedSri } from "../support/simulated-sri.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-guia.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-guia.ec", password: "contrasena-operador-e2e-1" };
const LEGAL_NAME = "COMERCIAL ANDINA S.A.";
const CUSTOMER_RUC = "0992877878001";
const dir = inject("p12FixturesDir");
const compact = (xml: string) => xml.replace(/>\s+</g, "><");
const count = (text: string, part: string) => text.split(part).length - 1;
/** La fecha de hoy en Ecuador: la guía se emite con ella y el transporte no empieza antes. */
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(
  new Date(),
);
const SHOWN_TODAY = TODAY.split("-").reverse().join("/");

describe("flujo completo de las guías de remisión", () => {
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
    db = await createMigratedSchema("end_to_end_shipping_guides");
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
      meta?: unknown;
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

  it("autoriza una guía con transporte propio hacia un cliente y otro establecimiento propio con su RIDE, no autoriza otra y deja la factura, el inventario y los roles intactos", async () => {
    backend = await startE2eBackend({
      label: "end_to_end_shipping_guides",
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
      legalName: LEGAL_NAME,
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    const origin = await api<{ id: string }>("POST", "/establishments", admin, {
      code: "001",
      address: "Av. 6 de Diciembre, Quito",
    });
    const point = await api<{ id: string }>(
      "POST",
      `/establishments/${origin.data.id}/emission-points`,
      admin,
      { code: "001" },
    );
    // El otro establecimiento propio: el destino del traslado.
    const destination = await api<{ id: string }>("POST", "/establishments", admin, {
      code: "002",
      address: "Bodega sur, Av. Maldonado S34, Quito",
    });
    expect(destination.status).toBe(201);
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
    const customer = await api<{ id: string; roles: string[] }>("POST", "/parties", admin, {
      identificationType: "04",
      identification: CUSTOMER_RUC,
      legalName: "FERRETERÍA EL PERNO CÍA. LTDA.",
      address: "Av. Quito y Guayaquil, Guayaquil",
      roles: ["CUSTOMER"],
    });
    expect(customer.status).toBe(201);
    const cement = await api<{ id: string }>("POST", "/products", admin, {
      kind: "GOOD",
      mainCode: "CEM-50",
      name: "Cemento 50 kg",
      unitPrice: "8.75",
      stockTracked: true,
      taxes: { iva: "4" },
    });
    await api("POST", `/inventory/items/${cement.data.id}/initialization`, admin, {
      quantity: "20",
    });
    const operator = await signIn(OPERATOR.email, OPERATOR.password);

    // La factura autorizada de la empresa al cliente, con su salida de inventario.
    const invoiceDraft = await api<DraftView>("POST", "/invoices/drafts", operator, {
      emissionPointId: point.data.id,
      buyerPartyId: customer.data.id,
      lines: [{ productId: cement.data.id, quantity: "5", discount: "0" }],
      payments: [{ paymentMethod: "01" }],
    });
    const invoice = await api<InvoiceView>(
      "POST",
      "/invoices",
      operator,
      { draftId: invoiceDraft.data.id, expectedVersion: invoiceDraft.data.version },
      randomUUID(),
    );
    expect(invoice.status).toBe(201);
    await until(
      async () => (await stateOf(invoice.data.id)) === "AUTHORIZED",
      "factura autorizada",
    );
    await until(
      async () =>
        (await db.database.prisma.stockMovement.count({
          where: { documentId: invoice.data.id },
        })) === 1,
      "salida de la factura",
    );
    const companyId = (await db.database.prisma.organization.findFirstOrThrow()).id;
    const invoiceRow = async () =>
      db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id: invoice.data.id } });
    const customerRow = async () =>
      db.database.prisma.party.findUniqueOrThrow({ where: { id: customer.data.id } });
    const invoiceBefore = await invoiceRow();
    const customerBefore = await customerRow();
    const movementsBefore = await db.database.prisma.stockMovement.count();
    const balancesBefore = await db.database.prisma.stockBalance.findMany();

    // Las mercancías sugeridas de la factura: el producto, hoy un bien activo, con lo facturado.
    const goods = await api<ShippingInvoiceGoodsView>(
      "GET",
      `/shipping-guides/eligible-invoices/${invoice.data.id}/goods`,
      operator,
    );
    expect(
      goods.data.lines.map((line) => [line.suggestion, line.productId, line.quantity]),
    ).toEqual([["PRODUCT", cement.data.id, "5"]]);
    const emitGuide = async (recipients: unknown[], declares: boolean) => {
      const draft = await api<ShippingGuideDraftView>("POST", "/shipping-guides/drafts", operator, {
        emissionPointId: point.data.id,
        originEstablishmentId: origin.data.id,
        transporter: { source: "SELF" },
        plate: "PAA-1234",
        transportStart: TODAY,
        transportEnd: TODAY,
        recipients,
      });
      expect([draft.status, draft.data.preview.issues]).toEqual([201, []]);
      return api<ShippingGuideView>(
        "POST",
        "/shipping-guides",
        operator,
        {
          draftId: draft.data.id,
          expectedVersion: draft.data.version,
          exceptionDeclaration: declares ? { policyVersion: 1 } : null,
        },
        randomUUID(),
      );
    };
    const toCustomer = {
      recipient: { kind: "PARTY", partyId: customer.data.id },
      address: "Av. Quito y Guayaquil, Guayaquil",
      motive: "Venta",
      route: "Quito - Guayaquil",
      support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.data.id },
      details: goods.data.lines.map((line) => ({
        productId: line.productId,
        description: "Cemento 50 kg en sacos",
        quantity: line.quantity,
      })),
    };

    // Guía 1: transporte propio desde el 001, al cliente de la factura y al establecimiento 002.
    const authorized = await emitGuide(
      [
        toCustomer,
        {
          recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: destination.data.id },
          motive: "Reposición de bodega",
          support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
          details: [
            {
              productId: null,
              mainCode: "VAR-12",
              description: "Varilla corrugada 12 mm",
              quantity: "100",
            },
          ],
        },
      ],
      true,
    );
    expect([authorized.status, authorized.data.state]).toEqual([201, "SIGNED"]);
    expect(authorized.data.transporter).toMatchObject({
      source: "SELF",
      identificationType: "04",
      identification: FIXTURE_RUC,
      legalName: LEGAL_NAME,
    });
    expect(authorized.data.departure).toMatchObject({
      source: "ESTABLISHMENT",
      address: "Av. 6 de Diciembre, Quito",
    });
    expect(
      authorized.data.recipients.map((r) => [r.kind, r.identification, r.support.kind]),
    ).toEqual([
      ["PARTY", CUSTOMER_RUC, "INTERNAL_INVOICE"],
      ["OWN_COMPANY", FIXTURE_RUC, "DECLARED_EXCEPTION"],
    ]);
    await until(
      async () => (await stateOf(authorized.data.id)) === "AUTHORIZED",
      "guía 1 autorizada",
    );
    // Su RIDE nace con la autorización y se entrega por la bandeja, sin total ni comprador único.
    await until(async () => (await rideCount(authorized.data.id)) === 1, "RIDE de la guía 1");
    const inbox = await api<DocumentListItem[]>("GET", "/documents?documentType=06", operator);
    expect(
      inbox.data.map((d) => [
        d.id,
        d.documentType,
        d.state,
        d.documents.ride,
        d.total,
        d.buyer,
        d.recipients,
      ]),
    ).toEqual([
      [authorized.data.id, "06", "AUTHORIZED", "AVAILABLE", null, null, { count: 2, name: null }],
    ]);
    // La bandeja encuentra la guía por cualquiera de sus destinatarios: el cliente (con su factura)
    // y la propia empresa.
    const byCustomer = await api<DocumentListItem[]>(
      "GET",
      `/documents?identification=${CUSTOMER_RUC}`,
      operator,
    );
    expect(new Set(byCustomer.data.map((d) => d.id))).toEqual(
      new Set([invoice.data.id, authorized.data.id]),
    );
    const byCompany = await api<DocumentListItem[]>(
      "GET",
      `/documents?identification=${FIXTURE_RUC}`,
      operator,
    );
    expect(byCompany.data.map((d) => d.id)).toEqual([authorized.data.id]);
    const ride = await fetch(`${backend.base}/api/v1/documents/${authorized.data.id}/ride`, {
      headers: { cookie: operator, origin: E2E_ORIGIN },
    });
    expect(ride.status).toBe(200);
    const text = (await pageTexts(Buffer.from(await ride.arrayBuffer()))).join(" ");
    expect(text).toContain("GUÍA DE REMISIÓN");
    expect(text).toContain(`Identificación (Transportista): ${FIXTURE_RUC}`);
    expect(text).toContain("Punto de Partida: Av. 6 de Diciembre, Quito");
    expect(text).toContain(
      `Comprobante de Venta: FACTURA ${invoice.data.documentNumber} Fecha de Emisión: ${SHOWN_TODAY}`,
    );
    expect(text).toContain(`Identificación (Destinatario): ${CUSTOMER_RUC}`);
    expect(text).toContain("5 Cemento 50 kg en sacos CEM-50");
    expect(text).toContain(
      `Identificación (Destinatario): ${FIXTURE_RUC} Razón Social / Nombres y Apellidos: ${LEGAL_NAME}`,
    );
    expect(text).toContain("Código Establecimiento Destino: 002");
    // Sus XML llevan el transporte propio, la partida del origen y los dos destinatarios: el sustento
    // solo en el de la factura.
    for (const kind of ["authorized-xml", "signed-xml"]) {
      const xml = await fetch(`${backend.base}/api/v1/documents/${authorized.data.id}/${kind}`, {
        headers: { cookie: operator, origin: E2E_ORIGIN },
      });
      expect([kind, xml.status]).toEqual([kind, 200]);
      const body = compact(await xml.text());
      expect(body).toContain(authorized.data.accessKey);
      expect(body).toContain("<codDoc>06</codDoc>");
      expect(body).toContain("<dirPartida>Av. 6 de Diciembre, Quito</dirPartida>");
      expect(body).toContain(`<razonSocialTransportista>${LEGAL_NAME}</razonSocialTransportista>`);
      expect(body).toContain(
        "<tipoIdentificacionTransportista>04</tipoIdentificacionTransportista>",
      );
      expect(body).toContain(`<rucTransportista>${FIXTURE_RUC}</rucTransportista>`);
      expect(body).toContain("<placa>PAA-1234</placa>");
      expect(count(body, "<destinatario>")).toBe(2);
      expect(count(body, "<codDocSustento>01</codDocSustento>")).toBe(1);
      expect(body).toContain(`<numDocSustento>${invoice.data.documentNumber}</numDocSustento>`);
      expect(body).toContain(
        `<identificacionDestinatario>${FIXTURE_RUC}</identificacionDestinatario>`,
      );
      expect(body).toContain(
        "<dirDestinatario>Bodega sur, Av. Maldonado S34, Quito</dirDestinatario>",
      );
      expect(body).toContain("<codEstabDestino>002</codEstabDestino>");
    }

    // Guía 2: el SRI simulado no la autoriza; no tiene RIDE. Varias guías pueden citar la misma
    // factura.
    sri.notAuthorized.add("06:2");
    const rejected = await emitGuide([toCustomer], false);
    expect([rejected.status, rejected.data.state]).toEqual([201, "SIGNED"]);
    await until(
      async () => (await stateOf(rejected.data.id)) === "NOT_AUTHORIZED",
      "guía 2 no autorizada",
    );
    expect(await rideCount(rejected.data.id)).toBe(0);

    // La factura, el inventario y los roles del cliente quedan intactos, y las reconciliaciones sin
    // diferencias.
    const invoiceAfter = await invoiceRow();
    expect([invoiceAfter.state, invoiceAfter.total?.toFixed(), invoiceAfter.snapshot]).toEqual([
      invoiceBefore.state,
      invoiceBefore.total?.toFixed(),
      invoiceBefore.snapshot,
    ]);
    const customerAfter = await customerRow();
    expect([customerAfter.roles, customerAfter.version, customerAfter.status]).toEqual([
      customerBefore.roles,
      customerBefore.version,
      customerBefore.status,
    ]);
    expect(customerAfter.roles).toEqual(["CUSTOMER"]);
    expect(await db.database.prisma.stockMovement.count()).toBe(movementsBefore);
    expect(await db.database.prisma.stockBalance.findMany()).toEqual(balancesBefore);
    expect(await reconcileCreditCapacity(db.database.prisma, companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(db.database.prisma, companyId)).toEqual([]);
    expect(await reconcileStock(db.database.prisma, companyId)).toEqual([]);
    expect(new Set(proxy.destinations)).toEqual(new Set([`${SRI_HOST}:80`]));
    // La auditoría de las guías es la de su emisión: la transmisión, la autorización, el RIDE y las
    // descargas no la duplican.
    const audit = await db.database.prisma.auditEvent.findMany({ orderBy: { occurredAt: "asc" } });
    const aboutGuides = audit.filter((event) =>
      [authorized.data.id, rejected.data.id].some((id) =>
        JSON.stringify(event.changes).includes(id),
      ),
    );
    expect(aboutGuides.map((event) => event.action)).toEqual([
      "shipping_guide.reserved",
      "shipping_guide.signed",
      "shipping_guide.reserved",
      "shipping_guide.signed",
    ]);
  }, 240_000);
});
