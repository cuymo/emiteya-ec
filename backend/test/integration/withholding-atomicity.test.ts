// Atomicidad de la reserva de un comprobante de retención (add-withholding-receipts, tarea 7.2, design
// D15): se fuerza un fallo después de cada paso de la transacción de `RESERVED` y, en todos los casos,
// no queda secuencial consumido, clave, comprobante, registro, líneas, snapshot, borrador emitido,
// registro de idempotencia ni auditoría. Sin fallo, la misma emisión se confirma entera.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/index.ts";
import { supplierReader } from "../../src/modules/parties/infrastructure/index.ts";
import { createWithholdingEmission } from "../../src/modules/withholding-receipts/application/emission.ts";
import type {
  WithholdingEmissionScope,
  WithholdingEmissionUnitOfWork,
} from "../../src/modules/withholding-receipts/application/ports.ts";
import { createWithholdingDraftRepository } from "../../src/modules/withholding-receipts/infrastructure/prisma-drafts.ts";
import { createWithholdingReads } from "../../src/modules/withholding-receipts/infrastructure/reads.ts";
import { createWithholdingEmissionUnitOfWork } from "../../src/modules/withholding-receipts/infrastructure/units-of-work.ts";
import {
  certificateTasksEntry,
  signingModule,
} from "../../src/modules/signing/infrastructure/index.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createIdempotencyStore } from "../../src/platform/idempotency/prisma-idempotency-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp, testXsdValidator } from "./taxpayer-harness.ts";

/** Pasos de la transacción de `RESERVED`, en su orden (design D15). */
const STEPS = [
  "lockDraft",
  "lockConfiguration",
  "parties.find",
  "reserveSequential",
  "lockTaxIdentity",
  "documents.insertReserved",
  "documents.recordTransition",
  "recordReceipt",
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
function failingAfter(uow: WithholdingEmissionUnitOfWork, step: Step | null, seen: Set<Step>) {
  return {
    run: <T>(work: (scope: WithholdingEmissionScope) => Promise<T>) =>
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
          recordReceipt: wrap("recordReceipt", (...args: Parameters<typeof scope.recordReceipt>) =>
            scope.recordReceipt(...args),
          ),
          markDraftEmitted: wrap(
            "markDraftEmitted",
            (...args: Parameters<typeof scope.markDraftEmitted>) => scope.markDraftEmitted(...args),
          ),
          parties: nested("parties", scope.parties),
          documents: nested("documents", scope.documents),
          idempotency: nested("idempotency", scope.idempotency),
          audit: nested("audit", scope.audit),
        });
      }),
  } satisfies WithholdingEmissionUnitOfWork;
}

describe("atomicidad de la reserva de un comprobante de retención", () => {
  let db: MigratedSchema;
  let a: ReadyCompany;
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
    return createWithholdingEmission({
      uow: failingAfter(
        createWithholdingEmissionUnitOfWork(prisma, {
          signingReads: signing.reads,
          parties: supplierReader,
        }),
        step,
        seen,
      ),
      context: {
        reads: createWithholdingReads(prisma, signing.reads),
        parties: supplierReader(prisma),
      },
      drafts: createWithholdingDraftRepository(prisma),
      idempotency: createIdempotencyStore(prisma),
      documents: createDocumentRepository(prisma),
      accessKeys: createAccessKeys(),
      xsd: testXsdValidator(),
      builderVersion: "1",
      authorizer: allow,
      limits: { supports: 10, itemsPerSupport: 5, taxesPerSupport: 5, paymentsPerSupport: 5 },
      today: () => "2026-10-06",
    });
  };
  const trace = async (draftId: string) => {
    const prisma = db.database.prisma;
    return {
      documents: await prisma.electronicDocument.count({ where: { documentType: "07" } }),
      sequences: await prisma.fiscalSequenceReservation.count({ where: { documentType: "07" } }),
      counters: (await prisma.fiscalSequence.findMany({ where: { documentType: "07" } })).map(
        (counter) => counter.nextNumber,
      ),
      receipts: await prisma.withholdingReceipt.count(),
      lines: await prisma.withholdingReceiptLine.count(),
      transitions: await prisma.documentStateTransition.count(),
      idempotency: await prisma.idempotencyRecord.count({
        where: { operation: "withholding_receipt.emit" },
      }),
      audit: await prisma.auditEvent.count({
        where: { action: { startsWith: "withholding_receipt." } },
      }),
      draft: await prisma.withholdingReceiptDraft.findUniqueOrThrow({
        where: { id: draftId },
        select: { status: true, documentId: true },
      }),
    };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_atomicity");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    a = await readyCompany(api, db, {
      slug: "atomica-ret",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("un fallo después de cada paso no deja nada; sin fallo, la retención se confirma entera", async () => {
    const draft = await createWithholdingDraftRepository(db.database.prisma).create(
      a.companyId,
      {
        partyId: a.supplierId,
        relatedParty: "NO",
        fiscalPeriod: "10/2026",
        emissionPointId: a.emissionPointId,
        supports: [
          {
            documentType: "01",
            supportCode: "01",
            number: "001001000000123",
            issueDate: "2026-10-01",
            authorizationNumber: null,
            totalWithoutTaxes: "100.29",
            importTotal: "115.33",
            taxes: [{ tax: "2", rateEntryKey: "4", rate: null, base: "100.29", amount: "15.04" }],
            payments: [{ paymentMethod: "20", total: "115.33" }],
            withholdings: [
              { tax: "1", entryKey: "312C", base: "100.29" },
              { tax: "2", entryKey: "1", base: "15.04" },
            ],
          },
        ],
      },
      a.operatorId,
    );
    const ctx = {
      userId: a.operatorId,
      companyId: a.companyId,
      role: "OPERATOR" as const,
      requestId: randomUUID(),
    };
    const body = { draftId: draft.id, expectedVersion: draft.version };
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
    // Sin fallo, la misma emisión deja la retención, su número, su registro, sus líneas, su
    // idempotencia y su auditoría.
    const seen = new Set<Step>();
    const result = await emission(null, seen).emit(ctx, "atomica-completa", body);
    expect(result.document.state).toBe("RESERVED");
    expect([...seen]).toEqual([...STEPS]);
    const after = await trace(draft.id);
    expect([
      after.documents - before.documents,
      after.sequences - before.sequences,
      after.receipts - before.receipts,
      after.lines - before.lines,
      after.idempotency - before.idempotency,
      after.audit - before.audit,
    ]).toEqual([1, 1, 1, 2, 1, 1]);
    expect(after.draft).toEqual({ status: "EMITTED", documentId: result.document.id });
  });
});
