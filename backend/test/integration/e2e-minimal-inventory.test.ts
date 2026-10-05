// Prueba end-to-end de add-minimal-inventory (tarea 11.2) contra el backend real: main.ts como
// proceso, con la custodia habilitada, la transmisión hacia un SRI SIMULADO (respuestas sintéticas)
// y una política de tamaño SINTÉTICA. Marca e inicializa un producto, registra una entrada, emite
// una factura con dos líneas del producto (con el aviso en el borrador), la autoriza y comprueba una
// sola salida, el saldo negativo y el kárdex; con la transmisión apagada, otra factura no descuenta.
import { randomBytes, randomUUID } from "node:crypto";
import type {
  DraftView,
  InvoiceView,
  StockItemDetailView,
  StockMovementView,
} from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { SRI_HOST, listen, outboundProxy, simulatedSri } from "../support/simulated-sri.ts";
import {
  installSyntheticSizePolicy,
  syntheticSizePolicy,
} from "../support/synthetic-size-policy.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";
import { expectReconciled } from "./inventory-harness.ts";

const ADMIN = { email: "admin@e2e-inventario.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-inventario.ec", password: "contrasena-operador-e2e-1" };
const dir = inject("p12FixturesDir");

describe("flujo completo del inventario mínimo", () => {
  let db: MigratedSchema;
  let backend: E2eBackend;
  let sri: ReturnType<typeof simulatedSri>;
  let proxy: ReturnType<typeof outboundProxy>;
  let proxyUrl: string;
  const masterKey = randomBytes(32).toString("base64");
  const env = (transmission: boolean) => ({
    CERTIFICATE_CUSTODY: "enabled",
    CERTIFICATE_MASTER_KEY: masterKey,
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    SRI_TRANSMISSION_ENABLED: transmission ? "1" : "0",
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
  });
  const start = (transmission: boolean) =>
    startE2eBackend({ label: "end_to_end_inventory", admin: ADMIN, db, env: env(transmission) });

  beforeAll(async () => {
    sri = simulatedSri();
    proxy = outboundProxy(await listen(sri.server));
    proxyUrl = `http://127.0.0.1:${await listen(proxy.server)}`;
    db = await createMigratedSchema("end_to_end_inventory");
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
    const json = (await res.json()) as { data: T; error?: { code: string; message: string } };
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
  const outflowsOf = (documentId: string) =>
    db.database.prisma.stockMovement.findMany({
      where: { documentId, movementType: "SALIDA_FACTURA" },
    });

  it("descuenta una sola vez al autorizar, con el aviso en el borrador; sin transmisión no descuenta", async () => {
    backend = await start(true);
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
    // Marcado al registrarlo, e inicializado por el inventario.
    const product = await api<{ id: string }>("POST", "/products", admin, {
      kind: "GOOD",
      mainCode: "CEM-50",
      name: "Cemento 50 kg",
      unitPrice: "8.75",
      stockTracked: true,
      taxes: { iva: "4" },
    });
    expect(product.status).toBe(201);
    const productId = product.data.id;
    const initialized = await api<StockItemDetailView>(
      "POST",
      `/inventory/items/${productId}/initialization`,
      admin,
      { quantity: "10", note: "Conteo de apertura" },
    );
    expect([initialized.status, initialized.data.state, initialized.data.balance]).toEqual([
      201,
      "TRACKED_INITIALIZED",
      "10",
    ]);
    const operator = await signIn(OPERATOR.email, OPERATOR.password);
    const entry = await api<StockMovementView>(
      "POST",
      `/inventory/items/${productId}/entries`,
      operator,
      { quantity: "5" },
      randomUUID(),
    );
    expect([entry.status, entry.data.balanceAfter]).toEqual([201, "15"]);

    // Dos líneas del producto, 9 + 8 sobre 15: el borrador avisa, sin bloquear la emisión.
    const draft = await api<DraftView>("POST", "/invoices/drafts", operator, {
      emissionPointId: point.data.id,
      buyerPartyId: customer.data.id,
      lines: [
        { productId, quantity: "9", discount: "0" },
        { productId, quantity: "8", discount: "0" },
      ],
      payments: [{ paymentMethod: "01" }],
    });
    expect(draft.status).toBe(201);
    expect(draft.data.preview.issues).toEqual([]);
    expect(draft.data.preview.stockWarnings).toEqual([
      { code: "STOCK_BELOW_REQUESTED", productId, requested: "17", balance: "15" },
    ]);
    const emitted = await api<InvoiceView>(
      "POST",
      "/invoices",
      operator,
      { draftId: draft.data.id, expectedVersion: draft.data.version },
      randomUUID(),
    );
    expect(emitted.status).toBe(201);
    const invoice = emitted.data;
    await until(async () => (await stateOf(invoice.id)) === "AUTHORIZED", "factura autorizada");

    // Una sola salida por la suma de sus líneas, en la transacción de la autorización.
    const outflows = await outflowsOf(invoice.id);
    expect(outflows.map((movement) => movement.delta.toFixed())).toEqual(["-17"]);
    const detail = await api<StockItemDetailView>("GET", `/inventory/items/${productId}`, operator);
    expect([detail.data.balance, detail.data.negative]).toEqual(["-2", true]);
    const kardex = await api<StockMovementView[]>(
      "GET",
      `/inventory/items/${productId}/movements`,
      operator,
    );
    expect(
      kardex.data.map(({ type, delta, balanceAfter, origin, documentNumber }) => ({
        type,
        delta,
        balanceAfter,
        origin,
        documentNumber,
      })),
    ).toEqual([
      {
        type: "SALIDA_FACTURA",
        delta: "-17",
        balanceAfter: "-2",
        origin: "SYSTEM",
        documentNumber: invoice.documentNumber,
      },
      {
        type: "ENTRADA_MANUAL",
        delta: "5",
        balanceAfter: "15",
        origin: "USER",
        documentNumber: null,
      },
      { type: "INICIAL", delta: "10", balanceAfter: "10", origin: "USER", documentNumber: null },
    ]);
    const metrics = await (await fetch(`${backend.base}/metrics`)).text();
    expect(metrics).toMatch(/^inventory_movements_total\{type="SALIDA_FACTURA"\} 1$/m);
    expect(metrics).toMatch(/^inventory_movements_total\{type="ENTRADA_MANUAL"\} 1$/m);
    expect(metrics).toMatch(/^inventory_negative_balances 1$/m);

    // Con la transmisión apagada, otra factura queda firmada y no descuenta.
    await backend.stop();
    backend = await start(false);
    const operatorAgain = await signIn(OPERATOR.email, OPERATOR.password);
    const second = await api<DraftView>("POST", "/invoices/drafts", operatorAgain, {
      emissionPointId: point.data.id,
      buyerPartyId: customer.data.id,
      lines: [{ productId, quantity: "1", discount: "0" }],
      payments: [{ paymentMethod: "01" }],
    });
    const signed = await api<InvoiceView>(
      "POST",
      "/invoices",
      operatorAgain,
      { draftId: second.data.id, expectedVersion: second.data.version },
      randomUUID(),
    );
    expect(signed.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await stateOf(signed.data.id)).toBe("SIGNED");
    expect(await outflowsOf(signed.data.id)).toEqual([]);
    const after = await api<StockItemDetailView>(
      "GET",
      `/inventory/items/${productId}`,
      operatorAgain,
    );
    expect(after.data.balance).toBe("-2");
    await expectReconciled(db.database.prisma);
  }, 180_000);
});
