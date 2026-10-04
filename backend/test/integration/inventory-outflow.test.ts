// Salida de inventario de una factura al autorizar (add-minimal-inventory, tareas 5.1 y 5.2, design
// D5 y D6): el seguidor compuesto en la misma transacción que la autorización, con la decisión
// congelada al reservar, una salida por producto con la suma exacta, sin tocar el saldo en una
// repetición, revertida entera si algo falla y recuperada desde la respuesta guardada del SRI, sin
// otra llamada. Respuestas del SRI SINTÉTICAS con la estructura oficial.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  RIDE_BACKOFF,
  RIDE_JOB_TYPE,
  rideFollower,
} from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createAuthorizeHandler } from "../../src/modules/fiscal/application/authorize-handler.ts";
import type { DocumentTransitionFollower } from "../../src/modules/fiscal/application/document-transitions.ts";
import { createTransmitHandler } from "../../src/modules/fiscal/application/transmit-handler.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { StockRepository } from "../../src/modules/inventory/application/ports.ts";
import {
  createInventoryUnitOfWork,
  createStockRepository,
  inventoryOutflowFollower,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { invoiceStockLines } from "../../src/modules/invoices/infrastructure/index.ts";
import type {
  SriExchange,
  TransportOutcome,
} from "../../src/modules/sri-engine/application/transport.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import {
  authorizationEnvelope,
  receptionEnvelope,
} from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import type { Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { SYNTHETIC_POLICY_BYTES } from "../support/synthetic-size-policy.ts";
import {
  authorizationResponse,
  failure,
  receptionResponse,
  response,
  type SyntheticAuthorization,
} from "../support/sri-responses.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { balanceOf, expectReconciled, insertProduct } from "./inventory-harness.ts";
import {
  insertDocument,
  leasedJob,
  signedXmlOf,
  type TestDocument,
} from "./transmission-harness.ts";

type Line = { productId: string; quantity: string; inventoryAffectsStock: boolean };

describe("salida de inventario al autorizar", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let calls: string[];
  const replies: TransportOutcome[] = [];

  const gateway = () => {
    const exchange = (
      service: "RECEPTION" | "AUTHORIZATION",
      environment: "TEST" | "PRODUCTION",
      envelope: Buffer,
    ) => {
      calls.push(service);
      const result: SriExchange = {
        service,
        environment,
        endpoint: `simulado:${service}`,
        envelope,
        outcome: replies.shift() ?? failure("CONNECTION_LOST"),
      };
      return Promise.resolve(result);
    };
    return {
      submit: (environment: "TEST" | "PRODUCTION", xml: Buffer) =>
        exchange("RECEPTION", environment, receptionEnvelope(xml)),
      queryAuthorization: (environment: "TEST" | "PRODUCTION", key: string) =>
        exchange("AUTHORIZATION", environment, authorizationEnvelope(key)),
    };
  };
  // El repositorio de jobs se crea en beforeAll: los seguidores se componen al usarlos.
  const inventory: DocumentTransitionFollower = (client, event) =>
    inventoryOutflowFollower({ invoices: invoiceStockLines, stock: createStockRepository })(
      client,
      event,
    );
  const ride: DocumentTransitionFollower = (client, event) =>
    rideFollower({ jobs: store, settings: { maxAttempts: 5, backoff: RIDE_BACKOFF } })(
      client,
      event,
    );
  const base = (followers: DocumentTransitionFollower[]) => ({
    db: prisma,
    evidence: createSriEvidenceRepository(prisma),
    uow: createTransmissionUnitOfWork(prisma),
    jobs: store,
    logger: { info: () => {}, warn: () => {} },
    followers,
    documents: createDocumentRepository(prisma),
    gateway: gateway(),
    classifiers: sriClassifiers,
    settings: DEFAULT_TRANSMISSION_SETTINGS,
  });
  const authorize = (followers: DocumentTransitionFollower[] = [inventory]) =>
    createAuthorizeHandler({ ...base(followers), random: () => 0.5 });
  const transmit = (followers: DocumentTransitionFollower[] = [inventory]) =>
    createTransmitHandler({
      ...base(followers),
      artifacts: createArtifactStore(prisma),
      sizePolicy: () => Promise.resolve({ maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES }),
      today: () => "2026-10-04",
      alert: () => {},
    });
  const context = () => ({ signal: new AbortController().signal, now: () => new Date() });

  /** Factura con snapshot de la versión 2 y sus líneas, en `state`. */
  const invoiceWith = (state: string, lines: Line[]) =>
    insertDocument(prisma, company, state, { snapshot: { snapshotVersion: 2, lines } });
  const jobFor = (document: TestDocument, type: "sri.authorize" | "sri.transmit"): Promise<Job> =>
    leasedJob(store, prisma, {
      companyId: company.companyId,
      type,
      dedupeKey: `${type}:${document.id}`,
      documentId: document.id,
      runAt: new Date(),
      maxAttempts: 1_000,
      deadlineAt: new Date(Date.now() + 24 * 3_600_000),
    });
  const authorized = (
    document: TestDocument,
    overrides: Partial<SyntheticAuthorization> = {},
  ): SyntheticAuthorization => ({
    estado: "AUTORIZADO",
    numeroAutorizacion: document.accessKey,
    fechaAutorizacion: "2026-10-04T10:15:30-05:00",
    ambiente: "PRUEBAS",
    comprobante: `<![CDATA[${signedXmlOf(document.accessKey).toString("utf8")}]]>`,
    ...overrides,
  });
  const reply = (document: TestDocument, authorizations: SyntheticAuthorization[]) =>
    replies.push(response(authorizationResponse(document.accessKey, authorizations)));
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const movementsOf = (documentId: string) =>
    prisma.stockMovement.findMany({ where: { documentId }, orderBy: { productId: "asc" } });
  const initialize = (productId: string, quantity: string) =>
    createInventoryUnitOfWork(prisma).run(({ stock }) =>
      stock.initialize({
        companyId: company.companyId,
        productId,
        quantity,
        note: null,
        actorUserId: company.adminId,
        at: new Date(),
      }),
    );
  const stockedProduct = async (quantity: string) => {
    const product = await insertProduct(prisma, company);
    await initialize(product, quantity);
    return product;
  };
  const line = (productId: string, quantity: string, inventoryAffectsStock = true): Line => ({
    productId,
    quantity,
    inventoryAffectsStock,
  });

  beforeAll(async () => {
    db = await createMigratedSchema("inventory_outflow");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Inventario A", 1);
  });

  beforeEach(() => {
    calls = [];
    replies.length = 0;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("autorizar registra una salida por producto con la suma exacta, que referencia la factura", async () => {
    const a = await stockedProduct("10");
    const b = await stockedProduct("4");
    const invoice = await invoiceWith("RECEIVED", [line(a, "3"), line(b, "2"), line(a, "1.5")]);
    reply(invoice, [authorized(invoice)]);
    await authorize().run(await jobFor(invoice, "sri.authorize"), context());
    expect(await stateOf(invoice.id)).toBe("AUTHORIZED");
    const movements = await movementsOf(invoice.id);
    expect(
      movements.map((row) => ({
        productId: row.productId,
        type: row.movementType,
        delta: row.delta.toFixed(),
        origin: row.origin,
        actorUserId: row.actorUserId,
        documentNumber: row.documentNumber,
      })),
    ).toEqual(
      [
        { productId: a, delta: "-4.5" },
        { productId: b, delta: "-2" },
      ]
        .sort((x, y) => (x.productId < y.productId ? -1 : 1))
        .map((expected) => ({
          ...expected,
          type: "SALIDA_FACTURA",
          origin: "SYSTEM",
          actorUserId: null,
          documentNumber: invoice.documentNumber,
        })),
    );
    expect(await balanceOf(prisma, company.companyId, a)).toBe("5.5");
    expect(await balanceOf(prisma, company.companyId, b)).toBe("2");
    await expectReconciled(prisma, company.companyId);
  });

  it("la suma cero, una línea sin inventario y un snapshot de la versión 1 no generan movimientos", async () => {
    const a = await stockedProduct("1");
    const untracked = await insertProduct(prisma, company, { stockTracked: false });
    const invoice = await invoiceWith("RECEIVED", [
      line(a, "0"),
      line(a, "0.00"),
      line(untracked, "2", false),
    ]);
    reply(invoice, [authorized(invoice)]);
    await authorize().run(await jobFor(invoice, "sri.authorize"), context());
    expect(await stateOf(invoice.id)).toBe("AUTHORIZED");
    expect(await movementsOf(invoice.id)).toEqual([]);
    const legacy = await insertDocument(prisma, company, "RECEIVED", {
      snapshot: { lines: [line(a, "1")] },
    });
    reply(legacy, [authorized(legacy)]);
    await authorize().run(await jobFor(legacy, "sri.authorize"), context());
    expect(await stateOf(legacy.id)).toBe("AUTHORIZED");
    expect(await movementsOf(legacy.id)).toEqual([]);
    expect(await balanceOf(prisma, company.companyId, a)).toBe("1");
  });

  it("ningún otro estado genera movimientos", async () => {
    const a = await stockedProduct("5");
    const notAuthorized = await invoiceWith("RECEIVED", [line(a, "1")]);
    reply(notAuthorized, [
      authorized(notAuthorized, { estado: "NO AUTORIZADO", comprobante: undefined }),
    ]);
    await authorize().run(await jobFor(notAuthorized, "sri.authorize"), context());
    const review = await invoiceWith("RECEIVED", [line(a, "1")]);
    reply(review, [authorized(review), authorized(review)]);
    await authorize().run(await jobFor(review, "sri.authorize"), context());
    const received = await invoiceWith("SIGNED", [line(a, "1")]);
    replies.push(response(receptionResponse("RECIBIDA")));
    await transmit().run(await jobFor(received, "sri.transmit"), context());
    const returned = await invoiceWith("SIGNED", [line(a, "1")]);
    replies.push(
      response(
        receptionResponse("DEVUELTA", [
          {
            accessKey: returned.accessKey,
            messages: [
              { identifier: "35", message: "ARCHIVO NO CUMPLE ESTRUCTURA XML", type: "ERROR" },
            ],
          },
        ]),
      ),
    );
    await transmit().run(await jobFor(returned, "sri.transmit"), context());
    expect(
      await Promise.all([notAuthorized, review, received, returned].map((d) => stateOf(d.id))),
    ).toEqual(["NOT_AUTHORIZED", "MANUAL_REVIEW", "RECEIVED", "RETURNED"]);
    for (const document of [notAuthorized, review, received, returned]) {
      expect(await movementsOf(document.id)).toEqual([]);
    }
    expect(await balanceOf(prisma, company.companyId, a)).toBe("5");
  });

  it("el saldo cruza cero y la factura queda autorizada", async () => {
    const a = await stockedProduct("2");
    const invoice = await invoiceWith("RECEIVED", [line(a, "5")]);
    reply(invoice, [authorized(invoice)]);
    await authorize().run(await jobFor(invoice, "sri.authorize"), context());
    expect(await stateOf(invoice.id)).toBe("AUTHORIZED");
    expect(await balanceOf(prisma, company.companyId, a)).toBe("-3");
  });

  it("repetir la decisión no crea otra salida ni cambia el saldo", async () => {
    const a = await stockedProduct("6");
    const invoice = await invoiceWith("RECEIVED", [line(a, "2")]);
    reply(invoice, [authorized(invoice)]);
    await authorize().run(await jobFor(invoice, "sri.authorize"), context());
    await prisma.$transaction((tx) =>
      inventory(tx, {
        companyId: company.companyId,
        documentId: invoice.id,
        from: "RECEIVED",
        to: "AUTHORIZED",
        cause: "AUTHORIZATION",
        at: new Date(),
      }),
    );
    expect(await movementsOf(invoice.id)).toHaveLength(1);
    expect(await balanceOf(prisma, company.companyId, a)).toBe("4");
  });

  it("un seguidor que falla revierte la autorización, el XML autorizado, el job del RIDE y todas las salidas", async () => {
    const a = await stockedProduct("3");
    const b = await stockedProduct("3");
    const invoice = await invoiceWith("RECEIVED", [line(a, "1"), line(b, "1")]);
    reply(invoice, [authorized(invoice)]);
    const failing: DocumentTransitionFollower = () => Promise.reject(new Error("seguidor caído"));
    await expect(
      authorize([ride, inventory, failing]).run(await jobFor(invoice, "sri.authorize"), context()),
    ).rejects.toThrow("seguidor caído");
    expect(await stateOf(invoice.id)).toBe("RECEIVED");
    expect(
      await prisma.documentArtifact.count({
        where: { documentId: invoice.id, kind: "AUTHORIZED_XML" },
      }),
    ).toBe(0);
    expect(await prisma.job.count({ where: { documentId: invoice.id, type: RIDE_JOB_TYPE } })).toBe(
      0,
    );
    expect(await movementsOf(invoice.id)).toEqual([]);
    expect(await balanceOf(prisma, company.companyId, a)).toBe("3");
  });

  it("un fallo después de insertar la salida de un producto y antes del commit no deja movimientos ni saldos cambiados", async () => {
    const a = await stockedProduct("3");
    const b = await stockedProduct("3");
    const invoice = await invoiceWith("RECEIVED", [line(a, "1"), line(b, "1")]);
    reply(invoice, [authorized(invoice)]);
    const failAfterFirst = (client: DbClient): StockRepository => {
      const real = createStockRepository(client);
      return {
        ...real,
        append: async (movement) => {
          await real.append(movement);
          throw new Error("fallo después de la primera salida");
        },
      };
    };
    const interrupted: DocumentTransitionFollower = (client, event) =>
      inventoryOutflowFollower({ invoices: invoiceStockLines, stock: failAfterFirst })(
        client,
        event,
      );
    await expect(
      authorize([interrupted]).run(await jobFor(invoice, "sri.authorize"), context()),
    ).rejects.toThrow("fallo después de la primera salida");
    expect(await stateOf(invoice.id)).toBe("RECEIVED");
    expect(await movementsOf(invoice.id)).toEqual([]);
    expect(await balanceOf(prisma, company.companyId, a)).toBe("3");
    expect(await balanceOf(prisma, company.companyId, b)).toBe("3");
    await expectReconciled(prisma, company.companyId);
  });

  it("el seguidor nunca lee el producto: quitar la marca después de emitir no altera la salida", async () => {
    const a = await stockedProduct("4");
    const invoice = await invoiceWith("RECEIVED", [line(a, "1")]);
    await prisma.product.update({ where: { id: a }, data: { stockTracked: false } });
    reply(invoice, [authorized(invoice)]);
    await authorize().run(await jobFor(invoice, "sri.authorize"), context());
    expect(await movementsOf(invoice.id)).toHaveLength(1);
    expect(await balanceOf(prisma, company.companyId, a)).toBe("3");
  });

  it("recuperación: el SRI autorizó, la salida falla una vez y el reintento la aplica sin otra llamada al SRI", async () => {
    const a = await stockedProduct("8");
    const b = await stockedProduct("8");
    const invoice = await invoiceWith("RECEIVED", [line(a, "2"), line(b, "3")]);
    reply(invoice, [authorized(invoice)]);
    let failed = false;
    const flaky: DocumentTransitionFollower = async (client, event) => {
      if (!failed) {
        failed = true;
        throw new Error("fallo local al registrar la salida");
      }
      await inventory(client, event);
    };
    const job = await jobFor(invoice, "sri.authorize");
    await expect(authorize([flaky]).run(job, context())).rejects.toThrow("fallo local");
    expect(await stateOf(invoice.id)).toBe("RECEIVED");
    expect(calls).toEqual(["AUTHORIZATION"]);
    // La respuesta del SRI quedó guardada, sin clasificar.
    const [attempt] = await prisma.sriAttempt.findMany({ where: { documentId: invoice.id } });
    expect(attempt).toBeDefined();
    expect(await prisma.sriResponse.count({ where: { attemptId: attempt!.id } })).toBe(1);
    expect(await prisma.sriAttemptResult.count({ where: { attemptId: attempt!.id } })).toBe(0);
    await authorize([flaky]).run(job, context());
    expect(calls).toEqual(["AUTHORIZATION"]);
    expect(await stateOf(invoice.id)).toBe("AUTHORIZED");
    expect(
      (await movementsOf(invoice.id)).map((row) => [row.productId, row.delta.toFixed()]),
    ).toEqual(
      [
        [a, "-2"],
        [b, "-3"],
      ].sort((x, y) => (x[0]! < y[0]! ? -1 : 1)),
    );
    expect(await balanceOf(prisma, company.companyId, a)).toBe("6");
    await expectReconciled(prisma, company.companyId);
  });
});
