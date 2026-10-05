// Prueba end-to-end de add-credit-notes (tarea 14.2) contra el backend real: main.ts como proceso,
// con la custodia habilitada, la transmisión hacia un SRI SIMULADO (respuestas sintéticas) y una
// política de tamaño SINTÉTICA. Una factura de dos productos autorizada; una devolución parcial con
// retorno físico que se autoriza (crédito aplicado, DEVOLUCION_NC y RIDE en la bandeja); otra nota
// que el SRI no autoriza y libera su capacidad; y la anulación total rechazada por el crédito previo.
import { randomBytes, randomUUID } from "node:crypto";
import type {
  CreditNoteDraftView,
  CreditNoteView,
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

const ADMIN = { email: "admin@e2e-notas.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-notas.ec", password: "contrasena-operador-e2e-1" };
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};
const dir = inject("p12FixturesDir");

describe("flujo completo de las notas de crédito", () => {
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
    db = await createMigratedSchema("end_to_end_credit_notes");
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
  const reservationOf = (creditNoteId: string) =>
    db.database.prisma.creditReservation.findFirstOrThrow({ where: { creditNoteId } });

  it("autoriza una devolución con retorno, libera la no autorizada y rechaza la anulación total", async () => {
    backend = await startE2eBackend({
      label: "end_to_end_credit_notes",
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
    const installation = await api<{ id: string }>("POST", "/products", admin, {
      kind: "SERVICE",
      mainCode: "INS-01",
      name: "Instalación",
      unitPrice: "20.00",
      taxes: { iva: "4" },
    });
    await api("POST", `/inventory/items/${cement.data.id}/initialization`, admin, {
      quantity: "20",
    });
    const operator = await signIn(OPERATOR.email, OPERATOR.password);

    // Factura de dos productos: cemento 5 (sale del inventario) e instalación 1.
    const invoiceDraft = await api<DraftView>("POST", "/invoices/drafts", operator, {
      emissionPointId: point.data.id,
      buyerPartyId: customer.data.id,
      lines: [
        { productId: cement.data.id, quantity: "5", discount: "0" },
        { productId: installation.data.id, quantity: "1", discount: "0" },
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

    const emitNote = async (body: Record<string, unknown>) => {
      const draft = await api<CreditNoteDraftView>("POST", "/credit-notes/drafts", operator, {
        invoiceId: invoice.data.id,
        emissionPointId: point.data.id,
        ...body,
      });
      expect(draft.status).toBe(201);
      return api<CreditNoteView>(
        "POST",
        "/credit-notes",
        operator,
        {
          draftId: draft.data.id,
          expectedVersion: draft.data.version,
          declarations: DECLARATIONS,
        },
        randomUUID(),
      );
    };

    // Nota 1: devolución parcial de 2 sacos con su retorno físico; el SRI simulado la autoriza.
    const returned = await emitNote({
      cause: "RETURN",
      reason: "Devolución de sacos dañados",
      lines: [{ position: 1, quantity: "2", physicalReturn: "2" }],
    });
    expect([returned.status, returned.data.state]).toEqual([201, "SIGNED"]);
    await until(
      async () => (await stateOf(returned.data.id)) === "AUTHORIZED",
      "nota 1 autorizada",
    );
    expect((await reservationOf(returned.data.id)).status).toBe("APPLIED");
    const devolution = await db.database.prisma.stockMovement.findMany({
      where: { documentId: returned.data.id },
    });
    expect(devolution.map((m) => [m.movementType, m.productId, m.delta.toFixed()])).toEqual([
      ["DEVOLUCION_NC", cement.data.id, "2"],
    ]);
    const balance = await db.database.prisma.stockBalance.findUniqueOrThrow({
      where: {
        companyId_productId: { companyId: devolution[0]!.companyId, productId: cement.data.id },
      },
    });
    expect(balance.balance.toFixed()).toBe("17");
    let credit = await api<InvoiceCreditView>(
      "GET",
      `/credit-notes/invoices/${invoice.data.id}/credit`,
      operator,
    );
    expect([credit.data.applied, credit.data.reserved]).toEqual([
      returned.data.totals.total,
      "0.00",
    ]);
    expect(credit.data.totalAnnulmentAvailable).toBe(false);
    // Su RIDE nace con la autorización y se entrega por la bandeja.
    await until(
      async () =>
        (await db.database.prisma.documentArtifact.count({
          where: { documentId: returned.data.id, kind: "RIDE_PDF" },
        })) === 1,
      "RIDE de la nota 1",
    );
    const inbox = await api<DocumentListItem[]>("GET", "/documents?documentType=04", operator);
    expect(inbox.data.map((d) => [d.id, d.documentType, d.state, d.documents.ride])).toEqual([
      [returned.data.id, "04", "AUTHORIZED", "AVAILABLE"],
    ]);
    const ride = await fetch(`${backend.base}/api/v1/documents/${returned.data.id}/ride`, {
      headers: { cookie: operator, origin: E2E_ORIGIN },
    });
    expect(ride.status).toBe(200);
    const text = (await pageTexts(Buffer.from(await ride.arrayBuffer()))).join(" ");
    expect(text).toContain("NOTA DE CRÉDITO");
    expect(text).toContain(`FACTURA ${invoice.data.documentNumber}`);

    // Nota 2: devolución de la instalación; el SRI simulado no la autoriza y su capacidad se libera.
    sri.notAuthorized.add("04:2");
    const rejected = await emitNote({
      cause: "RETURN",
      reason: "Instalación no realizada",
      lines: [{ position: 2, quantity: "1" }],
    });
    expect(rejected.status).toBe(201);
    await until(
      async () => (await stateOf(rejected.data.id)) === "NOT_AUTHORIZED",
      "nota 2 no autorizada",
    );
    expect((await reservationOf(rejected.data.id)).status).toBe("RELEASED");
    credit = await api<InvoiceCreditView>(
      "GET",
      `/credit-notes/invoices/${invoice.data.id}/credit`,
      operator,
    );
    expect([credit.data.applied, credit.data.reserved]).toEqual([
      returned.data.totals.total,
      "0.00",
    ]);
    expect(credit.data.lines.find((line) => line.position === 2)!.credited.available).toBe("1");
    expect(
      await db.database.prisma.stockMovement.count({ where: { documentId: rejected.data.id } }),
    ).toBe(0);

    // Anulación total: la vista previa la explica y la emisión la rechaza sin crear otra nota.
    const annulment = await api<CreditNoteDraftView>("POST", "/credit-notes/drafts", operator, {
      invoiceId: invoice.data.id,
      emissionPointId: point.data.id,
      cause: "TOTAL_ANNULMENT",
      reason: "Anulación solicitada",
      lines: [],
    });
    expect(annulment.data.preview.issues.map((issue) => issue.code)).toContain(
      "CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE",
    );
    const refused = await api<CreditNoteView>(
      "POST",
      "/credit-notes",
      operator,
      {
        draftId: annulment.data.id,
        expectedVersion: annulment.data.version,
        declarations: DECLARATIONS,
      },
      randomUUID(),
    );
    expect([refused.status, refused.error?.code]).toEqual([
      409,
      "CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE",
    ]);
    expect(
      await db.database.prisma.electronicDocument.count({ where: { documentType: "04" } }),
    ).toBe(2);

    // Ninguna capacidad ni saldo queda distinto de sus movimientos y reservas; solo se habló con el SRI.
    const companyId = devolution[0]!.companyId;
    expect(await reconcileCreditCapacity(db.database.prisma, companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(db.database.prisma, companyId)).toEqual([]);
    expect(await reconcileStock(db.database.prisma, companyId)).toEqual([]);
    expect(new Set(proxy.destinations)).toEqual(new Set([`${SRI_HOST}:80`]));
  }, 240_000);
});
