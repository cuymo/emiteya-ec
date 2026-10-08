// Atomicidad de la reserva de una liquidación de compra (add-purchase-settlements, tarea 7.2, design
// D13): se fuerza un fallo después de cada paso de la transacción de `RESERVED` y, en todos los casos,
// no queda secuencial consumido, clave, comprobante, registro, declaraciones, borrador emitido,
// registro de idempotencia ni auditoría. Sin fallo, la misma emisión se confirma entera.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PURCHASE_SETTLEMENT_STATEMENTS } from "@facturador/contracts";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/index.ts";
import { purchaseSupplierReader } from "../../src/modules/parties/infrastructure/index.ts";
import { productReader } from "../../src/modules/products/infrastructure/index.ts";
import { createPurchaseSettlementEmission } from "../../src/modules/purchase-settlements/application/emission.ts";
import type {
  PurchaseSettlementEmissionScope,
  PurchaseSettlementEmissionUnitOfWork,
} from "../../src/modules/purchase-settlements/application/ports.ts";
import { createPurchaseSettlementDraftRepository } from "../../src/modules/purchase-settlements/infrastructure/prisma-drafts.ts";
import { createPurchaseSettlementReads } from "../../src/modules/purchase-settlements/infrastructure/reads.ts";
import { createPurchaseSettlementEmissionUnitOfWork } from "../../src/modules/purchase-settlements/infrastructure/units-of-work.ts";
import {
  certificateTasksEntry,
  signingModule,
} from "../../src/modules/signing/infrastructure/index.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createIdempotencyStore } from "../../src/platform/idempotency/prisma-idempotency-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp, testXsdValidator } from "./taxpayer-harness.ts";

/** Pasos de la transacción de `RESERVED` (design D13). */
const STEPS = [
  "lockDraft",
  "lockConfiguration",
  "suppliers.find",
  "products.find",
  "reads.availability",
  "reserveSequential",
  "lockTaxIdentity",
  "documents.insertReserved",
  "documents.recordTransition",
  "recordSettlement",
  "markDraftEmitted",
  "idempotency.insert",
  "audit.append",
] as const;
type Step = (typeof STEPS)[number];

class ForcedFailure extends Error {
  readonly step: Step;
  constructor(step: Step) {
    super(`fallo forzado después de ${step}`);
    this.step = step;
  }
}

/** La unidad de trabajo real, con un fallo forzado después del paso elegido. */
function failingAfter(
  uow: PurchaseSettlementEmissionUnitOfWork,
  step: Step | null,
  seen: Set<Step>,
) {
  return {
    run: <T>(work: (scope: PurchaseSettlementEmissionScope) => Promise<T>) =>
      uow.run((scope) => {
        const wrap = <F extends (...args: never[]) => Promise<unknown>>(name: Step, fn: F): F =>
          (async (...args: Parameters<F>) => {
            const result = await fn(...args);
            seen.add(name);
            if (name === step) throw new ForcedFailure(name);
            return result;
          }) as F;
        const nested = <O extends object>(prefix: string, target: O): O =>
          new Proxy(target, {
            get: (object, key) => {
              const value = Reflect.get(object, key) as unknown;
              const name = `${prefix}.${String(key)}` as Step;
              return typeof value === "function" && (STEPS as readonly string[]).includes(name)
                ? wrap(name, (value as (...args: never[]) => Promise<unknown>).bind(object))
                : value;
            },
          });
        return work({
          ...scope,
          lockDraft: wrap("lockDraft", (...args: Parameters<typeof scope.lockDraft>) =>
            scope.lockDraft(...args),
          ),
          lockConfiguration: wrap(
            "lockConfiguration",
            (...args: Parameters<typeof scope.lockConfiguration>) =>
              scope.lockConfiguration(...args),
          ),
          reserveSequential: wrap(
            "reserveSequential",
            (...args: Parameters<typeof scope.reserveSequential>) =>
              scope.reserveSequential(...args),
          ),
          lockTaxIdentity: wrap(
            "lockTaxIdentity",
            (...args: Parameters<typeof scope.lockTaxIdentity>) => scope.lockTaxIdentity(...args),
          ),
          recordSettlement: wrap(
            "recordSettlement",
            (...args: Parameters<typeof scope.recordSettlement>) => scope.recordSettlement(...args),
          ),
          markDraftEmitted: wrap(
            "markDraftEmitted",
            (...args: Parameters<typeof scope.markDraftEmitted>) => scope.markDraftEmitted(...args),
          ),
          reads: nested("reads", scope.reads),
          suppliers: nested("suppliers", scope.suppliers),
          products: nested("products", scope.products),
          documents: nested("documents", scope.documents),
          idempotency: nested("idempotency", scope.idempotency),
          audit: nested("audit", scope.audit),
        });
      }),
  } satisfies PurchaseSettlementEmissionUnitOfWork;
}

describe("atomicidad de la reserva de una liquidación de compra", () => {
  let db: MigratedSchema;
  let a: ReadyCompany;
  let supplierId: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const allow = { requirePermission: () => undefined } as unknown as Authorizer;

  const emission = (step: Step | null, seen: Set<Step>) => {
    const prisma = db.database.prisma;
    const signing = signingModule({
      prisma,
      authorizer: allow,
      custody: CUSTODY,
      maxBytes: 64 * 1024,
      pool,
    });
    return createPurchaseSettlementEmission({
      uow: failingAfter(
        createPurchaseSettlementEmissionUnitOfWork(prisma, {
          signingReads: signing.reads,
          suppliers: purchaseSupplierReader,
          products: productReader,
        }),
        step,
        seen,
      ),
      context: {
        reads: createPurchaseSettlementReads(prisma, signing.reads),
        suppliers: purchaseSupplierReader(prisma),
        products: productReader(prisma),
      },
      drafts: createPurchaseSettlementDraftRepository(prisma),
      idempotency: createIdempotencyStore(prisma),
      documents: createDocumentRepository(prisma),
      accessKeys: createAccessKeys(),
      xsd: testXsdValidator(),
      builderVersion: "1",
      authorizer: allow,
      limits: { lines: 100, payments: 10 },
      today: () => "2026-10-07",
    });
  };
  const trace = async (draftId: string) => {
    const prisma = db.database.prisma;
    return {
      documents: await prisma.electronicDocument.count({ where: { documentType: "03" } }),
      sequences: await prisma.fiscalSequenceReservation.count({ where: { documentType: "03" } }),
      counters: (await prisma.fiscalSequence.findMany({ where: { documentType: "03" } })).map(
        (counter) => counter.nextNumber,
      ),
      settlements: await prisma.purchaseSettlement.count(),
      declarations: await prisma.purchaseSettlementDeclaration.count(),
      transitions: await prisma.documentStateTransition.count(),
      idempotency: await prisma.idempotencyRecord.count({
        where: { operation: "purchase_settlement.emit" },
      }),
      audit: await prisma.auditEvent.count({
        where: { action: { startsWith: "purchase_settlement." } },
      }),
      draft: await prisma.purchaseSettlementDraft.findUniqueOrThrow({
        where: { id: draftId },
        select: { status: true, documentId: true },
      }),
    };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("purchase_settlement_atomicity");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    a = await readyCompany(api, db, {
      slug: "atomica-liquidacion",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    supplierId = await insertPurchaseSupplier(db.database.prisma, a);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("un fallo después de cada paso no deja nada; sin fallo, la liquidación se confirma entera", async () => {
    const draft = await createPurchaseSettlementDraftRepository(db.database.prisma).create(
      a.companyId,
      {
        emissionPointId: a.emissionPointId,
        supplierPartyId: supplierId,
        supplierAddress: "Comunidad San Pablo, Cayambe",
        lines: [
          {
            productId: a.productId,
            mainCode: "CEM-50",
            auxiliaryCode: null,
            description: "Saco de cacao en grano, 45 kg",
            unit: "saco",
            quantity: "10",
            unitPrice: "4.50",
            discount: "5.00",
            ivaRate: "4",
          },
        ],
        payments: [{ paymentMethod: "01", total: "46.00", term: "0", timeUnit: "días" }],
      },
      a.operatorId,
    );
    const ctx = {
      userId: a.operatorId,
      companyId: a.companyId,
      role: "OPERATOR" as const,
      requestId: randomUUID(),
    };
    const body = {
      draftId: draft.id,
      expectedVersion: draft.version,
      declarations: { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS] },
    };
    const before = await trace(draft.id);
    for (const step of STEPS) {
      const seen = new Set<Step>();
      const error = await emission(step, seen)
        .emit(ctx, `atomica-${step}`, body)
        .then(
          () => null,
          (rejection: unknown) => rejection,
        );
      expect(error, step).toBeInstanceOf(ForcedFailure);
      expect(seen.has(step), step).toBe(true);
      expect(await trace(draft.id), step).toEqual(before);
    }
    // Sin fallo, la misma emisión deja la liquidación, su número, su registro con sus cuatro
    // declaraciones, su idempotencia y su auditoría.
    const seen = new Set<Step>();
    const result = await emission(null, seen).emit(ctx, "atomica-completa", body);
    expect(result.document.state).toBe("RESERVED");
    expect([...seen].sort()).toEqual([...STEPS].sort());
    const after = await trace(draft.id);
    expect([
      after.documents - before.documents,
      after.sequences - before.sequences,
      after.settlements - before.settlements,
      after.declarations - before.declarations,
      after.idempotency - before.idempotency,
      after.audit - before.audit,
    ]).toEqual([1, 1, 1, 4, 1, 1]);
    expect(after.draft).toEqual({ status: "EMITTED", documentId: result.document.id });
  });
});
