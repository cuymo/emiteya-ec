// Prueba end-to-end de add-debit-notes (tarea 12.2) contra el backend real: main.ts como proceso, con
// la custodia habilitada, la transmisión hacia un SRI SIMULADO (respuestas sintéticas) y una política
// de tamaño SINTÉTICA. Una factura con dos tarifas autorizada; una nota de débito de dos conceptos en
// tratamientos distintos que se autoriza, con su RIDE en la bandeja y su única forma de pago; otra
// nota que el SRI no autoriza; y la capacidad acreditable y el inventario de la factura sin cambios.
// La auditoría de las notas es solo la de su emisión.
import { randomBytes, randomUUID } from "node:crypto";
import type {
  DebitNoteDraftView,
  DebitNoteView,
  DocumentListItem,
  DraftView,
  InvoiceCreditView,
  InvoiceView,
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

const ADMIN = { email: "admin@e2e-debito.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-debito.ec", password: "contrasena-operador-e2e-1" };
const DECLARATIONS = { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] };
const dir = inject("p12FixturesDir");
const compact = (xml: string) => xml.replace(/>\s+</g, "><");

describe("flujo completo de las notas de débito", () => {
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
    db = await createMigratedSchema("end_to_end_debit_notes");
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

  it("autoriza una nota de dos tratamientos con su RIDE, no autoriza otra y deja la factura intacta", async () => {
    backend = await startE2eBackend({
      label: "end_to_end_debit_notes",
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
    const customer = await api<{ id: string }>("POST", "/parties", admin, {
      identificationType: "04",
      identification: "0992877878001",
      legalName: "FERRETERÍA EL PERNO CÍA. LTDA.",
      address: "Guayaquil",
      roles: ["CUSTOMER"],
    });
    const cement = await api<{ id: string }>("POST", "/products", admin, {
      kind: "GOOD",
      mainCode: "CEM-50",
      name: "Cemento 50 kg",
      unitPrice: "8.75",
      stockTracked: true,
      taxes: { iva: "4" },
    });
    const freight = await api<{ id: string }>("POST", "/products", admin, {
      kind: "SERVICE",
      mainCode: "TRA-01",
      name: "Transporte",
      unitPrice: "12.00",
      taxes: { iva: "0" },
    });
    await api("POST", `/inventory/items/${cement.data.id}/initialization`, admin, {
      quantity: "20",
    });
    const operator = await signIn(OPERATOR.email, OPERATOR.password);

    // Factura con dos tarifas: cemento 5 con IVA 15 % (sale del inventario) y transporte con IVA 0 %.
    const invoiceDraft = await api<DraftView>("POST", "/invoices/drafts", operator, {
      emissionPointId: point.data.id,
      buyerPartyId: customer.data.id,
      lines: [
        { productId: cement.data.id, quantity: "5", discount: "0" },
        { productId: freight.data.id, quantity: "1", discount: "0" },
      ],
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
          where: { documentId: invoice.data.id, movementType: "SALIDA_FACTURA" },
        })) === 1,
      "salida de la factura",
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
    const stockOf = async () =>
      (
        await db.database.prisma.stockBalance.findUniqueOrThrow({
          where: { companyId_productId: { companyId, productId: cement.data.id } },
        })
      ).balance.toFixed();
    const creditBefore = await creditOf();
    const stockBefore = await stockOf();
    const movementsBefore = await db.database.prisma.stockMovement.count();
    expect(stockBefore).toBe("15");

    const emitNote = async (paymentMethod: string, concepts: unknown[]) => {
      const draft = await api<DebitNoteDraftView>("POST", "/debit-notes/drafts", operator, {
        invoiceId: invoice.data.id,
        emissionPointId: point.data.id,
        paymentMethod,
        concepts,
      });
      expect([draft.status, draft.data.preview.issues]).toEqual([201, []]);
      // Los tratamientos ofrecidos son los de la factura: IVA 0 % e IVA 15 %.
      expect(draft.data.preview.taxTreatments.map((t) => t.key)).toEqual(["2:0", "2:4"]);
      return api<DebitNoteView>(
        "POST",
        "/debit-notes",
        operator,
        {
          draftId: draft.data.id,
          expectedVersion: draft.data.version,
          declarations: DECLARATIONS,
        },
        randomUUID(),
      );
    };

    // Nota 1: intereses con IVA 15 % y flete con IVA 0 %; el SRI simulado la autoriza.
    const authorized = await emitNote("20", [
      {
        cause: "LATE_PAYMENT_INTEREST",
        description: "Intereses por 30 días de mora",
        amount: "20.00",
        taxTreatment: "2:4",
      },
      {
        cause: "POST_INVOICE_COST_EXPENSE",
        description: "Flete posterior a la venta",
        amount: "5.50",
        taxTreatment: "2:0",
      },
    ]);
    expect([authorized.status, authorized.data.state]).toEqual([201, "SIGNED"]);
    // 20,00 × 15 % = 3,00 una vez por tratamiento; valor total 28,50 y la única forma de pago igual.
    expect(authorized.data.totals).toMatchObject({ withoutTaxes: "25.50", total: "28.50" });
    expect(authorized.data.totals.taxes.map((t) => [t.key, t.base, t.amount])).toEqual([
      ["2:0", "5.50", "0.00"],
      ["2:4", "20.00", "3.00"],
    ]);
    expect([authorized.data.payment.code, authorized.data.payment.amount]).toEqual(["20", "28.50"]);
    await until(
      async () => (await stateOf(authorized.data.id)) === "AUTHORIZED",
      "nota 1 autorizada",
    );
    // Su RIDE nace con la autorización y se entrega por la bandeja.
    await until(async () => (await rideCount(authorized.data.id)) === 1, "RIDE de la nota 1");
    const inbox = await api<DocumentListItem[]>("GET", "/documents?documentType=05", operator);
    expect(inbox.data.map((d) => [d.id, d.documentType, d.state, d.documents.ride])).toEqual([
      [authorized.data.id, "05", "AUTHORIZED", "AVAILABLE"],
    ]);
    const ride = await fetch(`${backend.base}/api/v1/documents/${authorized.data.id}/ride`, {
      headers: { cookie: operator, origin: E2E_ORIGIN },
    });
    expect(ride.status).toBe(200);
    const text = (await pageTexts(Buffer.from(await ride.arrayBuffer()))).join(" ");
    expect(text).toContain("NOTA DE DÉBITO");
    expect(text).toContain(`FACTURA ${invoice.data.documentNumber}`);
    expect(text).toContain("20 - OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO 28.50");
    expect(text).toContain("VALOR TOTAL 28.50");
    // Sus XML llevan la única forma de pago, con el total exacto del valor total.
    for (const kind of ["authorized-xml", "signed-xml"]) {
      const xml = await fetch(`${backend.base}/api/v1/documents/${authorized.data.id}/${kind}`, {
        headers: { cookie: operator, origin: E2E_ORIGIN },
      });
      expect([kind, xml.status]).toEqual([kind, 200]);
      const body = compact(await xml.text());
      expect(body).toContain(authorized.data.accessKey);
      expect(body).toContain(
        "<pagos><pago><formaPago>20</formaPago><total>28.50</total></pago></pagos>",
      );
    }

    // Nota 2: el SRI simulado no la autoriza; no tiene RIDE.
    sri.notAuthorized.add("05:2");
    const rejected = await emitNote("01", [
      {
        cause: "LATE_PAYMENT_INTEREST",
        description: "Intereses de septiembre",
        amount: "4.10",
        taxTreatment: "2:4",
      },
    ]);
    expect(rejected.status).toBe(201);
    await until(
      async () => (await stateOf(rejected.data.id)) === "NOT_AUTHORIZED",
      "nota 2 no autorizada",
    );
    expect(await rideCount(rejected.data.id)).toBe(0);

    // La factura queda intacta: su crédito, su inventario y sus reconciliaciones.
    expect(await creditOf()).toEqual(creditBefore);
    expect(await stockOf()).toBe(stockBefore);
    expect(await db.database.prisma.stockMovement.count()).toBe(movementsBefore);
    expect(
      await db.database.prisma.stockMovement.count({
        where: { documentId: { in: [authorized.data.id, rejected.data.id] } },
      }),
    ).toBe(0);
    expect(await reconcileCreditCapacity(db.database.prisma, companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(db.database.prisma, companyId)).toEqual([]);
    expect(await reconcileStock(db.database.prisma, companyId)).toEqual([]);
    expect(new Set(proxy.destinations)).toEqual(new Set([`${SRI_HOST}:80`]));
    // La auditoría de las notas es la de su emisión: la transmisión, la autorización, el RIDE y las
    // descargas no la duplican.
    const audit = await db.database.prisma.auditEvent.findMany({ orderBy: { occurredAt: "asc" } });
    const aboutNotes = audit.filter((event) =>
      [authorized.data.id, rejected.data.id].some((id) =>
        JSON.stringify(event.changes).includes(id),
      ),
    );
    expect(aboutNotes.map((event) => event.action)).toEqual([
      "debit_note.reserved",
      "debit_note.signed",
      "debit_note.reserved",
      "debit_note.signed",
    ]);
  }, 240_000);
});
