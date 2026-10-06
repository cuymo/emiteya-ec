// Prueba end-to-end de add-withholding-receipts (tarea 13.2) contra el backend real: main.ts como
// proceso, con la custodia habilitada, la transmisión hacia un SRI SIMULADO (respuestas sintéticas,
// detrás de un proxy que solo admite su host) y una política de tamaño SINTÉTICA. Una retención de
// renta e IVA sobre dos facturas de un proveedor que se autoriza, con su RIDE en la bandeja y sus
// documentos sustento en los XML; otra retención que el SRI no autoriza; y la factura propia de la
// empresa, su crédito y el inventario sin cambios. La auditoría de las retenciones es solo la de su
// emisión.
import { randomBytes, randomUUID } from "node:crypto";
import type {
  DocumentListItem,
  DraftView,
  InvoiceCreditView,
  InvoiceView,
  WithholdingDraftView,
  WithholdingReceiptView,
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
import {
  installSyntheticSizePolicy,
  syntheticSizePolicy,
} from "../support/synthetic-size-policy.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-retencion.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-retencion.ec", password: "contrasena-operador-e2e-1" };
const dir = inject("p12FixturesDir");
const compact = (xml: string) => xml.replace(/>\s+</g, "><");
/** La fecha de hoy en Ecuador: el período fiscal del mes de emisión y documentos de ese día. */
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(
  new Date(),
);
const MONTH = `${TODAY.slice(5, 7)}/${TODAY.slice(0, 4)}`;

describe("flujo completo de los comprobantes de retención", () => {
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
    db = await createMigratedSchema("end_to_end_withholdings");
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

  it("autoriza una retención de renta e IVA sobre dos facturas con su RIDE, no autoriza otra y deja la factura propia intacta", async () => {
    backend = await startE2eBackend({
      label: "end_to_end_withholdings",
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
    // Un cliente y un proveedor; el proveedor es el sujeto retenido.
    const customer = await api<{ id: string }>("POST", "/parties", admin, {
      identificationType: "04",
      identification: "0992877878001",
      legalName: "FERRETERÍA EL PERNO CÍA. LTDA.",
      address: "Guayaquil",
      roles: ["CUSTOMER"],
    });
    const supplier = await api<{ id: string }>("POST", "/parties", admin, {
      identificationType: "05",
      identification: "1710034065",
      legalName: "MARÍA JOSÉ CEVALLOS, SERVICIOS PROFESIONALES",
      roles: ["SUPPLIER"],
    });
    expect(supplier.status).toBe(201);
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

    // La factura propia de la empresa, autorizada, con su salida de inventario.
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
    const companyId = (await db.database.prisma.organization.findFirstOrThrow()).id;
    const creditOf = async () =>
      (
        await api<InvoiceCreditView>(
          "GET",
          `/credit-notes/invoices/${invoice.data.id}/credit`,
          operator,
        )
      ).data;
    const invoiceRow = async () =>
      db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id: invoice.data.id } });
    await until(
      async () =>
        (await db.database.prisma.stockMovement.count({
          where: { documentId: invoice.data.id },
        })) === 1,
      "salida de la factura",
    );
    const creditBefore = await creditOf();
    const invoiceBefore = await invoiceRow();
    const movementsBefore = await db.database.prisma.stockMovement.count();
    const balancesBefore = await db.database.prisma.stockBalance.findMany();

    const invoiceSupport = (number: string, withholdings: unknown[], base = "100.00") => ({
      documentType: "01",
      supportCode: "01",
      number,
      issueDate: TODAY,
      authorizationNumber: null,
      totalWithoutTaxes: base,
      importTotal: base === "100.00" ? "115.00" : "57.50",
      taxes: [
        {
          tax: "2",
          rateEntryKey: "4",
          base,
          amount: base === "100.00" ? "15.00" : "7.50",
        },
      ],
      payments: [{ paymentMethod: "20", total: base === "100.00" ? "115.00" : "57.50" }],
      withholdings,
    });
    const emitWithholding = async (supports: unknown[]) => {
      const draft = await api<WithholdingDraftView>(
        "POST",
        "/withholding-receipts/drafts",
        operator,
        {
          partyId: supplier.data.id,
          relatedParty: "NO",
          fiscalPeriod: MONTH,
          emissionPointId: point.data.id,
          supports,
        },
      );
      expect([draft.status, draft.data.preview.issues]).toEqual([201, []]);
      return api<WithholdingReceiptView>(
        "POST",
        "/withholding-receipts",
        operator,
        { draftId: draft.data.id, expectedVersion: draft.data.version },
        randomUUID(),
      );
    };

    // Retención 1: renta 312 e IVA código 1 sobre una factura, renta 303 sobre otra.
    const authorized = await emitWithholding([
      invoiceSupport("001001000000123", [
        { tax: "1", entryKey: "312", base: "100.00" },
        { tax: "2", entryKey: "1", base: "15.00" },
      ]),
      invoiceSupport("001001000000456", [{ tax: "1", entryKey: "303", base: "50.00" }], "50.00"),
    ]);
    expect([authorized.status, authorized.data.state]).toEqual([201, "SIGNED"]);
    // 100,00 × 2 % = 2,00; 15,00 × 30 % = 4,50; 50,00 × 10 % = 5,00: 11,50 retenidos.
    expect(authorized.data.totals).toEqual({ withheld: "11.50" });
    expect(
      authorized.data.supports.flatMap((s) =>
        s.withholdings.map((w) => [s.number, w.code, w.percentage, w.amount]),
      ),
    ).toEqual([
      ["001001000000123", "312", "2", "2.00"],
      ["001001000000123", "1", "30", "4.50"],
      ["001001000000456", "303", "10", "5.00"],
    ]);
    await until(
      async () => (await stateOf(authorized.data.id)) === "AUTHORIZED",
      "retención 1 autorizada",
    );
    // Su RIDE nace con la autorización y se entrega por la bandeja, que muestra como total el total
    // retenido (en la forma canónica de los importes de la bandeja, como los demás tipos).
    await until(async () => (await rideCount(authorized.data.id)) === 1, "RIDE de la retención 1");
    const inbox = await api<DocumentListItem[]>("GET", "/documents?documentType=07", operator);
    expect(
      inbox.data.map((d) => [d.id, d.documentType, d.state, d.documents.ride, d.total]),
    ).toEqual([[authorized.data.id, "07", "AUTHORIZED", "AVAILABLE", "11.5"]]);
    const ride = await fetch(`${backend.base}/api/v1/documents/${authorized.data.id}/ride`, {
      headers: { cookie: operator, origin: E2E_ORIGIN },
    });
    expect(ride.status).toBe(200);
    const text = (await pageTexts(Buffer.from(await ride.arrayBuffer()))).join(" ");
    expect(text).toContain("COMPROBANTE DE RETENCIÓN");
    expect(text).toContain(
      `Factura 001-001-000000123 ${TODAY.split("-").reverse().join("/")} ${MONTH} 100.00 RENTA 2 2.00`,
    );
    expect(text).toContain("Factura 001-001-000000456");
    expect(text).toContain("2 - IVA 4 100.00 15 15.00");
    // Sus XML llevan los documentos sustento con su código literal y sus retenciones anidadas.
    for (const kind of ["authorized-xml", "signed-xml"]) {
      const xml = await fetch(`${backend.base}/api/v1/documents/${authorized.data.id}/${kind}`, {
        headers: { cookie: operator, origin: E2E_ORIGIN },
      });
      expect([kind, xml.status]).toEqual([kind, 200]);
      const body = compact(await xml.text());
      expect(body).toContain(authorized.data.accessKey);
      expect(body).toContain(`<parteRel>NO</parteRel>`);
      expect(body).toContain(`<periodoFiscal>${MONTH}</periodoFiscal>`);
      expect(body.match(/<codDocSustento>01<\/codDocSustento>/g)).toHaveLength(2);
      expect(body).toContain(
        "<retencion><codigo>1</codigo><codigoRetencion>312</codigoRetencion><baseImponible>100.00</baseImponible><porcentajeRetener>2</porcentajeRetener><valorRetenido>2.00</valorRetenido></retencion>",
      );
    }

    // Retención 2: el SRI simulado no la autoriza; no tiene RIDE.
    sri.notAuthorized.add("07:2");
    const rejected = await emitWithholding([
      invoiceSupport("001001000000789", [{ tax: "1", entryKey: "312", base: "100.00" }]),
    ]);
    expect(rejected.status).toBe(201);
    await until(
      async () => (await stateOf(rejected.data.id)) === "NOT_AUTHORIZED",
      "retención 2 no autorizada",
    );
    expect(await rideCount(rejected.data.id)).toBe(0);

    // La factura propia queda intacta: su estado, su crédito, su inventario y las reconciliaciones.
    expect(await creditOf()).toEqual(creditBefore);
    const invoiceAfter = await invoiceRow();
    expect([invoiceAfter.state, invoiceAfter.total?.toFixed(), invoiceAfter.snapshot]).toEqual([
      invoiceBefore.state,
      invoiceBefore.total?.toFixed(),
      invoiceBefore.snapshot,
    ]);
    expect(await db.database.prisma.stockMovement.count()).toBe(movementsBefore);
    expect(await db.database.prisma.stockBalance.findMany()).toEqual(balancesBefore);
    expect(await reconcileCreditCapacity(db.database.prisma, companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(db.database.prisma, companyId)).toEqual([]);
    expect(await reconcileStock(db.database.prisma, companyId)).toEqual([]);
    expect(new Set(proxy.destinations)).toEqual(new Set([`${SRI_HOST}:80`]));
    // La auditoría de las retenciones es la de su emisión: la transmisión, la autorización, el RIDE y
    // las descargas no la duplican.
    const audit = await db.database.prisma.auditEvent.findMany({ orderBy: { occurredAt: "asc" } });
    const aboutReceipts = audit.filter((event) =>
      [authorized.data.id, rejected.data.id].some((id) =>
        JSON.stringify(event.changes).includes(id),
      ),
    );
    expect(aboutReceipts.map((event) => event.action)).toEqual([
      "withholding_receipt.reserved",
      "withholding_receipt.signed",
      "withholding_receipt.reserved",
      "withholding_receipt.signed",
    ]);
  }, 240_000);
});
