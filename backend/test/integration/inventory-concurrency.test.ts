// Concurrencia de las salidas de inventario con PostgreSQL real (add-minimal-inventory, tarea 5.3,
// design D5): autorizaciones simultáneas del mismo producto, facturas con productos en orden
// inverso y la repetición de una autorización. Ninguna actualización se pierde, ninguna factura se
// bloquea con otra y cada saldo termina igual a la suma de su kárdex. Respuestas del SRI SINTÉTICAS:
// el SRI simulado autoriza la clave que se le consulta.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createAuthorizeHandler } from "../../src/modules/fiscal/application/authorize-handler.ts";
import type { DocumentTransitionFollower } from "../../src/modules/fiscal/application/document-transitions.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  createInventoryUnitOfWork,
  createStockRepository,
  inventoryOutflowFollower,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { invoiceStockLines } from "../../src/modules/invoices/infrastructure/index.ts";
import type { SriExchange } from "../../src/modules/sri-engine/application/transport.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import { authorizationEnvelope } from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { authorizationResponse, response } from "../support/sri-responses.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { balanceOf, expectReconciled, insertProduct } from "./inventory-harness.ts";
import {
  insertDocument,
  leasedJob,
  signedXmlOf,
  type TestDocument,
} from "./transmission-harness.ts";

const ROUNDS = 3;

describe("concurrencia de las salidas de inventario", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;

  const inventory: DocumentTransitionFollower = (client, event) =>
    inventoryOutflowFollower({ invoices: invoiceStockLines, stock: createStockRepository })(
      client,
      event,
    );
  /** El SRI simulado autoriza la clave consultada. */
  const gateway = {
    submit: () => Promise.reject(new Error("no se usa")),
    queryAuthorization: (environment: "TEST" | "PRODUCTION", key: string) => {
      const result: SriExchange = {
        service: "AUTHORIZATION",
        environment,
        endpoint: "simulado:AUTHORIZATION",
        envelope: authorizationEnvelope(key),
        outcome: response(
          authorizationResponse(key, [
            {
              estado: "AUTORIZADO",
              numeroAutorizacion: key,
              fechaAutorizacion: "2026-10-04T10:15:30-05:00",
              ambiente: "PRUEBAS",
              comprobante: `<![CDATA[${signedXmlOf(key).toString("utf8")}]]>`,
            },
          ]),
        ),
      };
      return Promise.resolve(result);
    },
  };
  const authorize = () =>
    createAuthorizeHandler({
      db: prisma,
      evidence: createSriEvidenceRepository(prisma),
      uow: createTransmissionUnitOfWork(prisma),
      jobs: store,
      logger: { info: () => {}, warn: () => {} },
      followers: [inventory],
      documents: createDocumentRepository(prisma),
      gateway,
      classifiers: sriClassifiers,
      settings: DEFAULT_TRANSMISSION_SETTINGS,
      random: () => 0.5,
    });
  const context = () => ({ signal: new AbortController().signal, now: () => new Date() });
  const invoiceWith = (lines: { productId: string; quantity: string }[]) =>
    insertDocument(prisma, company, "RECEIVED", {
      snapshot: {
        snapshotVersion: 2,
        lines: lines.map((line) => ({ ...line, inventoryAffectsStock: true })),
      },
    });
  const authorizeAll = async (documents: TestDocument[]) => {
    const jobs = await Promise.all(
      documents.map((document) =>
        leasedJob(store, prisma, {
          companyId: company.companyId,
          type: "sri.authorize",
          dedupeKey: `sri.authorize:${document.id}`,
          documentId: document.id,
          runAt: new Date(),
          maxAttempts: 1_000,
          deadlineAt: new Date(Date.now() + 24 * 3_600_000),
        }),
      ),
    );
    await Promise.all(jobs.map((job) => authorize().run(job, context())));
  };
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const stockedProduct = async (quantity: string) => {
    const product = await insertProduct(prisma, company);
    await createInventoryUnitOfWork(prisma).run(({ stock }) =>
      stock.initialize({
        companyId: company.companyId,
        productId: product,
        quantity,
        note: null,
        actorUserId: company.adminId,
        at: new Date(),
      }),
    );
    return product;
  };

  beforeAll(async () => {
    db = await createMigratedSchema("inventory_concurrency");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Inventario concurrente", 1);
  });

  afterAll(async () => {
    await db.drop();
  });

  for (let round = 1; round <= ROUNDS; round++) {
    describe(`ronda ${round}`, () => {
      it("dos autorizaciones simultáneas del mismo producto dejan las dos salidas y el saldo exacto, cruzando cero", async () => {
        const product = await stockedProduct("1");
        const first = await invoiceWith([{ productId: product, quantity: "2" }]);
        const second = await invoiceWith([{ productId: product, quantity: "3" }]);
        await authorizeAll([first, second]);
        expect([await stateOf(first.id), await stateOf(second.id)]).toEqual([
          "AUTHORIZED",
          "AUTHORIZED",
        ]);
        expect(await prisma.stockMovement.count({ where: { productId: product } })).toBe(3);
        expect(await balanceOf(prisma, company.companyId, product)).toBe("-4");
        await expectReconciled(prisma, company.companyId);
      });

      it("facturas concurrentes con productos en orden inverso se autorizan todas, sin bloquearse", async () => {
        const a = await stockedProduct("10");
        const b = await stockedProduct("10");
        const invoices = await Promise.all(
          Array.from({ length: 6 }, (_, index) =>
            invoiceWith(
              index % 2 === 0
                ? [
                    { productId: a, quantity: "1" },
                    { productId: b, quantity: "1" },
                  ]
                : [
                    { productId: b, quantity: "1" },
                    { productId: a, quantity: "1" },
                  ],
            ),
          ),
        );
        await authorizeAll(invoices);
        for (const invoice of invoices) expect(await stateOf(invoice.id)).toBe("AUTHORIZED");
        expect(await balanceOf(prisma, company.companyId, a)).toBe("4");
        expect(await balanceOf(prisma, company.companyId, b)).toBe("4");
        await expectReconciled(prisma, company.companyId);
      });

      it("una repetición simultánea de la autorización no duplica la salida", async () => {
        const product = await stockedProduct("5");
        const invoice = await invoiceWith([{ productId: product, quantity: "2" }]);
        const replay = () =>
          prisma.$transaction((tx) =>
            inventory(tx, {
              companyId: company.companyId,
              documentId: invoice.id,
              from: "RECEIVED",
              to: "AUTHORIZED",
              cause: "AUTHORIZATION",
              at: new Date(),
            }),
          );
        // La repetición puede chocar con la unicidad de la salida: la base es la última defensa.
        const results = await Promise.allSettled([authorizeAll([invoice]), replay(), replay()]);
        expect(results[0].status).toBe("fulfilled");
        expect(await stateOf(invoice.id)).toBe("AUTHORIZED");
        expect(await prisma.stockMovement.count({ where: { documentId: invoice.id } })).toBe(1);
        expect(await balanceOf(prisma, company.companyId, product)).toBe("3");
        await expectReconciled(prisma, company.companyId);
      });
    });
  }
});
