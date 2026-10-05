// Atomicidad de la reserva de una nota de débito (add-debit-notes, tarea 6.2, design D14): se fuerza
// un fallo después de cada paso de la transacción de `RESERVED` y, en todos los casos, no queda
// secuencial consumido, clave, comprobante, relación con la factura, snapshot, borrador emitido,
// registro de idempotencia ni auditoría. Sin fallo, la misma emisión se confirma entera.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDebitNoteEmission } from "../../src/modules/debit-notes/application/emission.ts";
import type {
  DebitNoteEmissionScope,
  DebitNoteEmissionUnitOfWork,
} from "../../src/modules/debit-notes/application/ports.ts";
import { createDebitNoteDraftRepository } from "../../src/modules/debit-notes/infrastructure/prisma-drafts.ts";
import { createDebitNotesReads } from "../../src/modules/debit-notes/infrastructure/reads.ts";
import { createDebitNoteEmissionUnitOfWork } from "../../src/modules/debit-notes/infrastructure/units-of-work.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/index.ts";
import { invoiceCreditSource } from "../../src/modules/invoices/infrastructure/index.ts";
import {
  certificateTasksEntry,
  signingModule,
} from "../../src/modules/signing/infrastructure/index.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createIdempotencyStore } from "../../src/platform/idempotency/prisma-idempotency-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { insertAuthorizedInvoice } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp, testXsdValidator } from "./taxpayer-harness.ts";

/** Pasos de la transacción de `RESERVED`, en su orden (design D14). */
const STEPS = [
  "lockDraft",
  "lockConfiguration",
  "invoices.find",
  "reserveSequential",
  "lockTaxIdentity",
  "documents.insertReserved",
  "documents.recordTransition",
  "recordSupport",
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
function failingAfter(uow: DebitNoteEmissionUnitOfWork, step: Step | null, seen: Set<Step>) {
  return {
    run: <T>(work: (scope: DebitNoteEmissionScope) => Promise<T>) =>
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
          recordSupport: wrap("recordSupport", (...args: Parameters<typeof scope.recordSupport>) =>
            scope.recordSupport(...args),
          ),
          markDraftEmitted: wrap(
            "markDraftEmitted",
            (...args: Parameters<typeof scope.markDraftEmitted>) => scope.markDraftEmitted(...args),
          ),
          invoices: nested("invoices", scope.invoices),
          documents: nested("documents", scope.documents),
          idempotency: nested("idempotency", scope.idempotency),
          audit: nested("audit", scope.audit),
        });
      }),
  } satisfies DebitNoteEmissionUnitOfWork;
}

describe("atomicidad de la reserva de una nota de débito", () => {
  let db: MigratedSchema;
  let a: ReadyCompany;
  let good: string;
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
    return createDebitNoteEmission({
      uow: failingAfter(
        createDebitNoteEmissionUnitOfWork(prisma, {
          signingReads: signing.reads,
          invoices: invoiceCreditSource,
        }),
        step,
        seen,
      ),
      context: {
        reads: createDebitNotesReads(prisma, signing.reads),
        invoices: invoiceCreditSource(prisma),
      },
      drafts: createDebitNoteDraftRepository(prisma),
      idempotency: createIdempotencyStore(prisma),
      documents: createDocumentRepository(prisma),
      accessKeys: createAccessKeys(),
      xsd: testXsdValidator(),
      builderVersion: "1",
      authorizer: allow,
      today: () => "2026-10-09",
    });
  };
  const trace = async (draftId: string) => {
    const prisma = db.database.prisma;
    return {
      notes: await prisma.electronicDocument.count({ where: { documentType: "05" } }),
      sequences: await prisma.fiscalSequenceReservation.count({ where: { documentType: "05" } }),
      counters: (await prisma.fiscalSequence.findMany({ where: { documentType: "05" } })).map(
        (counter) => counter.nextNumber,
      ),
      supports: await prisma.debitNoteSupport.count(),
      transitions: await prisma.documentStateTransition.count(),
      idempotency: await prisma.idempotencyRecord.count({
        where: { operation: "debit_note.emit" },
      }),
      audit: await prisma.auditEvent.count({ where: { action: { startsWith: "debit_note." } } }),
      draft: (await prisma.debitNoteDraft.findUniqueOrThrow({ where: { id: draftId } })).status,
    };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_atomicity");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    a = await readyCompany(api, db, {
      slug: "atomica-nd",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    good = await insertProduct(db.database.prisma, {
      companyId: a.companyId,
      adminId: a.adminId,
      points: [],
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("un fallo después de cada paso no deja nada; sin fallo, la nota se confirma entera", async () => {
    const invoice = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: good, quantity: "10", unitPrice: "10.00" }],
    );
    const draft = await createDebitNoteDraftRepository(db.database.prisma).create(
      a.companyId,
      invoice.id,
      {
        emissionPointId: a.emissionPointId,
        paymentMethod: "20",
        concepts: [
          {
            cause: "LATE_PAYMENT_INTEREST",
            description: "Intereses por 30 días de mora",
            amount: "20.00",
            taxTreatment: "2:4",
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
    const body = {
      draftId: draft.id,
      expectedVersion: draft.version,
      declarations: { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] },
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
    // Sin fallo, la misma emisión deja la nota, su número, su factura, su registro y su auditoría.
    const seen = new Set<Step>();
    const result = await emission(null, seen).emit(ctx, "atomica-completa", body);
    expect(result.document.state).toBe("RESERVED");
    expect([...seen]).toEqual([...STEPS]);
    const after = await trace(draft.id);
    expect([
      after.notes - before.notes,
      after.sequences - before.sequences,
      after.supports - before.supports,
      after.idempotency - before.idempotency,
      after.audit - before.audit,
    ]).toEqual([1, 1, 1, 1, 1]);
    expect(after.draft).toBe("EMITTED");
  });
});
