// Inicialización y control del inventario sobre HTTP (add-minimal-inventory, tareas 6.1 a 6.3,
// design D7, D11 y D12): el INICIAL una sola vez, el control fail-closed y no retroactivo (las
// facturas ya emitidas descuentan aunque el control se desactive antes de autorizarlas), y la marca
// de un producto con inventario fuera de la corrección del producto. Las autorizaciones usan un SRI
// simulado con respuestas SINTÉTICAS.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createAuthorizeHandler } from "../../src/modules/fiscal/application/authorize-handler.ts";
import { createTransmitHandler } from "../../src/modules/fiscal/application/transmit-handler.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  createStockRepository,
  inventoryOutflowFollower,
} from "../../src/modules/inventory/infrastructure/index.ts";
import type { InvoiceSnapshot } from "../../src/modules/invoices/domain/snapshot.ts";
import { invoiceStockLines } from "../../src/modules/invoices/infrastructure/index.ts";
import { createProductRepository } from "../../src/modules/products/infrastructure/prisma-products.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import type {
  PreparedReception,
  SriExchange,
  TransportOutcome,
} from "../../src/modules/sri-engine/application/transport.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import {
  authorizationEnvelope,
  prepareReception,
} from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import type { Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  authorizationResponse,
  failure,
  receptionResponse,
  response,
} from "../support/sri-responses.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, createProduct, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { balanceOf, expectReconciled } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = { data: Record<string, unknown>; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("inicialización y control del inventario sobre HTTP", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let store: JobStore;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const p12Dir = inject("p12FixturesDir");
  const replies: TransportOutcome[] = [];

  const call = (
    company: ReadyCompany,
    who: "admin" | "operator",
    method: "get" | "post" | "put",
    path: string,
  ) => request(api.app)[method](`/api/v1${path}`).set("Cookie", company.cookies[who]);
  const initialize = (
    company: ReadyCompany,
    productId: string,
    quantity: string,
    who: "admin" | "operator" = "admin",
  ) =>
    call(company, who, "post", `/inventory/items/${productId}/initialization`).send({ quantity });
  const tracking = (
    company: ReadyCompany,
    productId: string,
    tracked: boolean,
    who: "admin" | "operator" = "admin",
  ) => call(company, who, "put", `/inventory/items/${productId}/tracking`).send({ tracked });
  const auditsOf = (companyId: string, action: string) =>
    prisma.auditEvent.findMany({ where: { companyId, action }, orderBy: { occurredAt: "asc" } });

  /** Bien marcado como controlado. */
  async function trackedProduct(company: ReadyCompany, name = `Bien ${randomUUID().slice(0, 6)}`) {
    const id = await createProduct(db, company, { unitPrice: "2.5", name });
    await prisma.product.update({ where: { id }, data: { stockTracked: true } });
    return id;
  }
  /** Ajuste de prueba que deja el saldo en `balance` con un movimiento real. */
  async function adjustTo(company: ReadyCompany, productId: string, delta: string) {
    const stock = createStockRepository(prisma);
    await prisma.$transaction((tx) =>
      createStockRepository(tx).append({
        companyId: company.companyId,
        productId,
        type: "AJUSTE",
        delta,
        origin: "USER",
        actorUserId: company.adminId,
        reason: "Preparación de la prueba",
        idempotency: {
          operation: "inventory.adjust",
          key: randomUUID(),
          requestHash: "e".repeat(64),
        },
        occurredAt: new Date(),
      }),
    );
    void stock;
  }

  // Autorización con el SRI simulado: el envío recibido y la autorización con el XML firmado.
  const gateway = {
    prepareReception,
    submit: (environment: "TEST" | "PRODUCTION", prepared: PreparedReception) =>
      Promise.resolve<SriExchange>({
        service: "RECEPTION",
        environment,
        endpoint: "simulado:RECEPTION",
        envelope: prepared.envelope,
        outcome: replies.shift() ?? failure("CONNECTION_LOST"),
      }),
    queryAuthorization: (environment: "TEST" | "PRODUCTION", key: string) =>
      Promise.resolve<SriExchange>({
        service: "AUTHORIZATION",
        environment,
        endpoint: "simulado:AUTHORIZATION",
        envelope: authorizationEnvelope(key),
        outcome: replies.shift() ?? failure("CONNECTION_LOST"),
      }),
  };
  const handlerBase = () => ({
    db: prisma,
    evidence: createSriEvidenceRepository(prisma),
    uow: createTransmissionUnitOfWork(prisma),
    jobs: store,
    logger: { info: () => {}, warn: () => {} },
    followers: [
      inventoryOutflowFollower({ invoices: invoiceStockLines, stock: createStockRepository }),
    ],
    documents: createDocumentRepository(prisma),
    gateway,
    classifiers: sriClassifiers,
    settings: DEFAULT_TRANSMISSION_SETTINGS,
  });
  const context = () => ({ signal: new AbortController().signal, now: () => new Date() });
  async function leaseActive(dedupeKey: string): Promise<Job> {
    const row = await prisma.job.update({
      where: { activeDedupeKey: dedupeKey },
      data: {
        status: "LEASED",
        leaseOwner: "worker-de-prueba",
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attemptCount: { increment: 1 },
      },
    });
    return row as unknown as Job;
  }
  async function authorizeInvoice(documentId: string) {
    const document = await prisma.electronicDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    replies.push(response(receptionResponse("RECIBIDA")));
    await createTransmitHandler({
      ...handlerBase(),
      artifacts: createArtifactStore(prisma),
      // Límite SINTÉTICO amplio: el XML firmado real supera el de las pruebas unitarias.
      sizePolicy: () => Promise.resolve({ maxSignedDocumentBytes: 1_000_000 }),
      today: () => "2026-10-07",
      alert: () => {},
    }).run(await leaseActive(`sri.transmit:${documentId}`), context());
    const signed = await prisma.documentArtifact.findFirstOrThrow({
      where: { documentId, kind: "SIGNED_XML" },
    });
    replies.push(
      response(
        authorizationResponse(document.accessKey, [
          {
            estado: "AUTORIZADO",
            numeroAutorizacion: document.accessKey,
            fechaAutorizacion: "2026-10-07T10:15:30-05:00",
            ambiente: "PRUEBAS",
            comprobante: `<![CDATA[${Buffer.from(signed.content).toString("utf8")}]]>`,
          },
        ]),
      ),
    );
    await createAuthorizeHandler({ ...handlerBase(), random: () => 0.5 }).run(
      await leaseActive(`sri.authorize:${documentId}`),
      context(),
    );
    expect(
      (await prisma.electronicDocument.findUniqueOrThrow({ where: { id: documentId } })).state,
    ).toBe("AUTHORIZED");
  }
  async function emit(company: ReadyCompany, productId: string, quantity: string) {
    const draft = await call(company, "admin", "post", "/invoices/drafts").send({
      emissionPointId: company.emissionPointId,
      buyerPartyId: company.customerId,
      lines: [{ productId, quantity, discount: "0" }],
      payments: [{ paymentMethod: "01" }],
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const { id, version } = bodyOf(draft).data as { id: string; version: number };
    const res = await call(company, "admin", "post", "/invoices")
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: id, expectedVersion: version });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (bodyOf(res).data as { id: string }).id;
  }
  const decisionOf = async (documentId: string) =>
    (
      (await prisma.electronicDocument.findUniqueOrThrow({ where: { id: documentId } }))
        .snapshot as unknown as InvoiceSnapshot
    ).lines.map((line) => line.inventoryAffectsStock);
  const outflowsOf = (documentId: string) =>
    prisma.stockMovement.findMany({ where: { documentId, movementType: "SALIDA_FACTURA" } });

  beforeAll(async () => {
    db = await createMigratedSchema("inventory_configuration_api");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, invoices: { jobs: store } });
    a = await readyCompany(api, db, { slug: "inva", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "invb" });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  describe("inicialización", () => {
    it("un administrador inicializa con 12.5 y con 0, con su evento de auditoría", async () => {
      const product = await trackedProduct(a);
      const res = await initialize(a, product, "12.5");
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(bodyOf(res).data).toMatchObject({
        productId: product,
        state: "TRACKED_INITIALIZED",
        balance: "12.5",
        negative: false,
        initializedByName: "Admin inva",
      });
      const [initial] = await prisma.stockMovement.findMany({ where: { productId: product } });
      expect(initial).toMatchObject({
        movementType: "INICIAL",
        position: 1,
        actorUserId: a.adminId,
      });
      const zero = await trackedProduct(a);
      expect(bodyOf(await initialize(a, zero, "0")).data).toMatchObject({ balance: "0" });
      const audits = await auditsOf(a.companyId, "inventory.initialized");
      expect(audits.map((event) => event.changes)).toEqual(
        expect.arrayContaining([{ productId: product }, { productId: zero }]),
      );
    });

    it("rechaza un producto sin marca, un servicio, una segunda inicialización y una cantidad negativa", async () => {
      const untracked = await createProduct(db, a, { unitPrice: "1", name: "Sin marca" });
      expect(bodyOf(await initialize(a, untracked, "1")).error.code).toBe(
        "STOCK_TRACKING_REQUIRED",
      );
      const service = await prisma.$transaction((tx) =>
        createProductRepository(tx).create(
          a.companyId,
          {
            kind: "SERVICE",
            mainCode: null,
            auxiliaryCode: null,
            name: "Transporte",
            description: null,
            unitPrice: "5",
            stockTracked: false,
            taxes: { iva: "4", ice: null, irbpnr: null },
          },
          a.adminId,
        ),
      );
      expect(bodyOf(await initialize(a, service.id, "1")).error.code).toBe(
        "STOCK_TRACKING_REQUIRED",
      );
      const product = await trackedProduct(a);
      expect((await initialize(a, product, "-1")).status).toBe(400);
      expect((await initialize(a, product, "2")).status).toBe(201);
      const again = await initialize(a, product, "3");
      expect([again.status, bodyOf(again).error.code]).toEqual([
        409,
        "INVENTORY_ALREADY_INITIALIZED",
      ]);
      expect(await balanceOf(prisma, a.companyId, product)).toBe("2");
    });

    it("dos inicializaciones simultáneas dejan una sola", async () => {
      const product = await trackedProduct(a);
      const results = await Promise.all([initialize(a, product, "1"), initialize(a, product, "2")]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(
        await prisma.stockMovement.count({
          where: { productId: product, movementType: "INICIAL" },
        }),
      ).toBe(1);
    });

    it("sin sesión 401, el operador 403 y otra empresa 404, sin eventos de auditoría", async () => {
      const product = await trackedProduct(a);
      const before = (await auditsOf(a.companyId, "inventory.initialized")).length;
      expect(
        (
          await request(api.app)
            .post(`/api/v1/inventory/items/${product}/initialization`)
            .send({ quantity: "1" })
        ).status,
      ).toBe(401);
      expect((await initialize(a, product, "1", "operator")).status).toBe(403);
      expect((await initialize(b, product, "1")).status).toBe(404);
      expect((await auditsOf(a.companyId, "inventory.initialized")).length).toBe(before);
      expect(await auditsOf(b.companyId, "inventory.initialized")).toEqual([]);
      expect(await balanceOf(prisma, a.companyId, product)).toBeNull();
    });
  });

  describe("control de stock", () => {
    it("desactiva con saldo cero y reactiva sin otro INICIAL, conservando el kárdex", async () => {
      const product = await trackedProduct(a);
      await initialize(a, product, "0");
      const off = await tracking(a, product, false);
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      expect(bodyOf(off).data).toMatchObject({ state: "DISABLED_INITIALIZED", balance: "0" });
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: product } })).stockTracked,
      ).toBe(false);
      const on = await tracking(a, product, true);
      expect(bodyOf(on).data).toMatchObject({ state: "TRACKED_INITIALIZED", balance: "0" });
      expect(await prisma.stockMovement.count({ where: { productId: product } })).toBe(1);
      const events = [
        ...(await auditsOf(a.companyId, "inventory.tracking_disabled")),
        ...(await auditsOf(a.companyId, "inventory.tracking_enabled")),
      ].filter((event) => (event.changes as { productId: string }).productId === product);
      expect(events.map((event) => [event.action, event.changes])).toEqual([
        [
          "inventory.tracking_disabled",
          { productId: product, "stockTracked.from": true, "stockTracked.to": false },
        ],
        [
          "inventory.tracking_enabled",
          { productId: product, "stockTracked.from": false, "stockTracked.to": true },
        ],
      ]);
    });

    it("no desactiva con saldo positivo ni negativo, y repetir el estado no cambia nada", async () => {
      const positive = await trackedProduct(a);
      await initialize(a, positive, "5");
      const refused = await tracking(a, positive, false);
      expect([refused.status, bodyOf(refused).error.code]).toEqual([
        409,
        "STOCK_TRACKING_HAS_BALANCE",
      ]);
      expect(bodyOf(refused).error.message).toContain("5");
      const negative = await trackedProduct(a);
      await initialize(a, negative, "0");
      await adjustTo(a, negative, "-2");
      expect(bodyOf(await tracking(a, negative, false)).error.code).toBe(
        "STOCK_TRACKING_HAS_BALANCE",
      );
      const before = (await auditsOf(a.companyId, "inventory.tracking_enabled")).length;
      expect((await tracking(a, positive, true)).status).toBe(200);
      expect((await auditsOf(a.companyId, "inventory.tracking_enabled")).length).toBe(before);
    });

    it("un producto sin inicializar se configura en Productos, y el operador no cambia el control", async () => {
      const product = await trackedProduct(a);
      expect(bodyOf(await tracking(a, product, false)).error.code).toBe(
        "INVENTORY_NOT_INITIALIZED",
      );
      await initialize(a, product, "0");
      expect((await tracking(a, product, false, "operator")).status).toBe(403);
      expect((await tracking(b, product, false)).status).toBe(404);
    });

    it("A: emitida con el control activo y autorizada después de desactivarlo, descuenta y el saldo queda negativo", async () => {
      const product = await trackedProduct(a);
      await initialize(a, product, "0");
      const invoice = await emit(a, product, "3");
      expect(await decisionOf(invoice)).toEqual([true]);
      expect((await tracking(a, product, false)).status).toBe(200);
      await authorizeInvoice(invoice);
      expect(await outflowsOf(invoice)).toHaveLength(1);
      expect(await balanceOf(prisma, a.companyId, product)).toBe("-3");
      await expectReconciled(prisma, a.companyId);
    });

    it("B: emitida con el control desactivado, no descuenta aunque se reactive antes de autorizar", async () => {
      const product = await trackedProduct(a);
      await initialize(a, product, "0");
      expect((await tracking(a, product, false)).status).toBe(200);
      const invoice = await emit(a, product, "2");
      expect(await decisionOf(invoice)).toEqual([false]);
      expect((await tracking(a, product, true)).status).toBe(200);
      await authorizeInvoice(invoice);
      expect(await outflowsOf(invoice)).toEqual([]);
      expect(await balanceOf(prisma, a.companyId, product)).toBe("0");
    });

    it("C: emitida con el control activo, desactivado y reactivado antes de autorizar, descuenta exactamente una vez", async () => {
      const product = await trackedProduct(a);
      await initialize(a, product, "0");
      const invoice = await emit(a, product, "4");
      expect((await tracking(a, product, false)).status).toBe(200);
      expect((await tracking(a, product, true)).status).toBe(200);
      await authorizeInvoice(invoice);
      expect(await outflowsOf(invoice)).toHaveLength(1);
      expect(await balanceOf(prisma, a.companyId, product)).toBe("-4");
    });
  });

  describe("marca del producto", () => {
    const productBody = async (
      company: ReadyCompany,
      productId: string,
      overrides: Record<string, unknown>,
    ) => {
      const view = bodyOf(await call(company, "admin", "get", `/products/${productId}`)).data as {
        kind: string;
        mainCode: string | null;
        auxiliaryCode: string | null;
        name: string;
        description: string | null;
        unitPrice: string;
        stockTracked: boolean;
        version: number;
        taxes: { slot: string; entryKey: string }[];
      };
      const tax = (slot: string) =>
        view.taxes.find((entry) => entry.slot === slot)?.entryKey ?? null;
      return {
        kind: view.kind,
        mainCode: view.mainCode,
        auxiliaryCode: view.auxiliaryCode,
        name: view.name,
        description: view.description,
        unitPrice: view.unitPrice,
        stockTracked: view.stockTracked,
        taxes: { iva: tax("iva"), ice: tax("ice"), irbpnr: tax("irbpnr") },
        expectedVersion: view.version,
        ...overrides,
      };
    };
    const correct = async (
      company: ReadyCompany,
      who: "admin" | "operator",
      productId: string,
      overrides: Record<string, unknown>,
    ) =>
      call(company, who, "put", `/products/${productId}`).send(
        await productBody(company, productId, overrides),
      );

    it("el operador marca un producto sin inventario y queda auditado con la marca anterior y la nueva", async () => {
      const product = await createProduct(db, a, { unitPrice: "1", name: "Por marcar" });
      const res = await correct(a, "operator", product, { stockTracked: true });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const [event] = (await auditsOf(a.companyId, "product.updated")).filter(
        (row) => (row.changes as { productId: string }).productId === product,
      );
      expect(event!.changes).toMatchObject({ "stockTracked.from": false, "stockTracked.to": true });
    });

    it("con el inventario inicializado, la corrección no cambia la marca pero sí el nombre y el precio", async () => {
      const product = await trackedProduct(a);
      await initialize(a, product, "3");
      const refused = await correct(a, "admin", product, { stockTracked: false });
      expect([refused.status, bodyOf(refused).error.code]).toEqual([
        409,
        "STOCK_TRACKING_MANAGED_BY_INVENTORY",
      ]);
      const renamed = await correct(a, "operator", product, {
        name: "Cemento renombrado",
        unitPrice: "3",
      });
      expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
      expect(await balanceOf(prisma, a.companyId, product)).toBe("3");
      const toService = await correct(a, "admin", product, {
        kind: "SERVICE",
        stockTracked: false,
      });
      expect(bodyOf(toService).error.code).toBe("STOCK_TRACKING_MANAGED_BY_INVENTORY");
      expect((await correct(a, "admin", product, { kind: "SERVICE" })).status).toBe(400);
    });

    it("una corrección de la marca y una inicialización simultáneas no se cruzan", async () => {
      for (let round = 0; round < 3; round++) {
        const product = await trackedProduct(a);
        const body = await productBody(a, product, { stockTracked: false });
        const [corrected, initialized] = await Promise.all([
          call(a, "admin", "put", `/products/${product}`).send(body),
          initialize(a, product, "1"),
        ]);
        const tracked = (await prisma.product.findUniqueOrThrow({ where: { id: product } }))
          .stockTracked;
        const inventory = await balanceOf(prisma, a.companyId, product);
        // O se corrigió primero y la inicialización encontró el producto sin marca, o se inicializó
        // primero y la corrección encontró el inventario: nunca un inventario de un producto sin marca.
        if (initialized.status === 201) {
          expect([corrected.status, bodyOf(corrected).error.code, tracked]).toEqual([
            409,
            "STOCK_TRACKING_MANAGED_BY_INVENTORY",
            true,
          ]);
          expect(inventory).toBe("1");
        } else {
          expect([corrected.status, bodyOf(initialized).error.code, tracked, inventory]).toEqual([
            200,
            "STOCK_TRACKING_REQUIRED",
            false,
            null,
          ]);
        }
      }
    });
  });
});
