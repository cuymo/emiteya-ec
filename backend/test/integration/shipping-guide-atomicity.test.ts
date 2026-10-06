// Atomicidad de la reserva de una guía de remisión (add-shipping-guides, tarea 7.2, design D13): se
// fuerza un fallo después de cada paso de la transacción de `RESERVED` y, en todos los casos, no queda
// secuencial consumido, clave, comprobante, destinatarios (en la cabecera común y en la guía),
// registro, snapshot, borrador emitido, registro de idempotencia ni auditoría. Sin fallo, la misma
// emisión se confirma entera.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/index.ts";
import { invoiceCreditSource } from "../../src/modules/invoices/infrastructure/index.ts";
import { shippingPartyReader } from "../../src/modules/parties/infrastructure/index.ts";
import { productReader } from "../../src/modules/products/infrastructure/index.ts";
import { createShippingGuideEmission } from "../../src/modules/shipping-guides/application/emission.ts";
import type {
  ShippingGuideEmissionScope,
  ShippingGuideEmissionUnitOfWork,
} from "../../src/modules/shipping-guides/application/ports.ts";
import { createShippingGuideDraftRepository } from "../../src/modules/shipping-guides/infrastructure/prisma-drafts.ts";
import { createShippingGuideReads } from "../../src/modules/shipping-guides/infrastructure/reads.ts";
import { createShippingGuideEmissionUnitOfWork } from "../../src/modules/shipping-guides/infrastructure/units-of-work.ts";
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
import { buildTaxpayerApp, testXsdValidator } from "./taxpayer-harness.ts";

/** Pasos de la transacción de `RESERVED` (design D13); las lecturas van en paralelo. */
const STEPS = [
  "lockDraft",
  "lockConfiguration",
  "parties.find",
  "reads.establishment",
  "products.find",
  "invoices.find",
  "reserveSequential",
  "lockTaxIdentity",
  "documents.insertReserved",
  "documents.recordTransition",
  "recordGuide",
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
function failingAfter(uow: ShippingGuideEmissionUnitOfWork, step: Step | null, seen: Set<Step>) {
  return {
    run: <T>(work: (scope: ShippingGuideEmissionScope) => Promise<T>) =>
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
          recordGuide: wrap("recordGuide", (...args: Parameters<typeof scope.recordGuide>) =>
            scope.recordGuide(...args),
          ),
          markDraftEmitted: wrap(
            "markDraftEmitted",
            (...args: Parameters<typeof scope.markDraftEmitted>) => scope.markDraftEmitted(...args),
          ),
          reads: nested("reads", scope.reads),
          parties: nested("parties", scope.parties),
          products: nested("products", scope.products),
          invoices: nested("invoices", scope.invoices),
          documents: nested("documents", scope.documents),
          idempotency: nested("idempotency", scope.idempotency),
          audit: nested("audit", scope.audit),
        });
      }),
  } satisfies ShippingGuideEmissionUnitOfWork;
}

describe("atomicidad de la reserva de una guía de remisión", () => {
  let db: MigratedSchema;
  let a: ReadyCompany;
  let destinationId: string;
  let invoiceId: string;
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
    return createShippingGuideEmission({
      uow: failingAfter(
        createShippingGuideEmissionUnitOfWork(prisma, {
          signingReads: signing.reads,
          parties: shippingPartyReader,
          products: productReader,
          invoices: invoiceCreditSource,
        }),
        step,
        seen,
      ),
      context: {
        reads: createShippingGuideReads(prisma, signing.reads),
        parties: shippingPartyReader(prisma),
        products: productReader(prisma),
        invoices: invoiceCreditSource(prisma),
      },
      drafts: createShippingGuideDraftRepository(prisma),
      idempotency: createIdempotencyStore(prisma),
      documents: createDocumentRepository(prisma),
      accessKeys: createAccessKeys(),
      xsd: testXsdValidator(),
      builderVersion: "1",
      authorizer: allow,
      limits: { recipients: 10, detailsPerRecipient: 50, details: 100 },
      today: () => "2026-10-06",
    });
  };
  const trace = async (draftId: string) => {
    const prisma = db.database.prisma;
    return {
      documents: await prisma.electronicDocument.count({ where: { documentType: "06" } }),
      sequences: await prisma.fiscalSequenceReservation.count({ where: { documentType: "06" } }),
      counters: (await prisma.fiscalSequence.findMany({ where: { documentType: "06" } })).map(
        (counter) => counter.nextNumber,
      ),
      documentRecipients: await prisma.electronicDocumentRecipient.count(),
      guides: await prisma.shippingGuide.count(),
      recipients: await prisma.shippingGuideRecipient.count(),
      transitions: await prisma.documentStateTransition.count(),
      idempotency: await prisma.idempotencyRecord.count({
        where: { operation: "shipping_guide.emit" },
      }),
      audit: await prisma.auditEvent.count({
        where: { action: { startsWith: "shipping_guide." } },
      }),
      draft: await prisma.shippingGuideDraft.findUniqueOrThrow({
        where: { id: draftId },
        select: { status: true, documentId: true },
      }),
    };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_atomicity");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    a = await readyCompany(api, db, {
      slug: "atomica-guia",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    destinationId = (
      await db.database.prisma.establishment.create({
        data: { companyId: a.companyId, code: "002", address: "Bodega sur, Quito" },
      })
    ).id;
    invoiceId = (
      await insertAuthorizedInvoice(
        db.database.prisma,
        {
          companyId: a.companyId,
          adminId: a.adminId,
          establishmentId: a.establishmentId,
          emissionPointId: a.emissionPointId,
        },
        [{ productId: a.productId, quantity: "10", unitPrice: "8.75" }],
      )
    ).id;
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("un fallo después de cada paso no deja nada; sin fallo, la guía se confirma entera", async () => {
    const draft = await createShippingGuideDraftRepository(db.database.prisma).create(
      a.companyId,
      {
        emissionPointId: a.emissionPointId,
        originEstablishmentId: a.establishmentId,
        departureAddress: null,
        transporter: { source: "SELF" },
        plate: "PAA-1234",
        transportStart: "2026-10-06",
        transportEnd: "2026-10-07",
        recipients: [
          {
            recipient: { kind: "PARTY", partyId: a.customerId },
            address: "Av. Simón Bolívar S/N",
            motive: "Venta",
            route: null,
            destinationEstablishmentCode: null,
            support: { kind: "INTERNAL_INVOICE", invoiceId },
            details: [
              {
                productId: a.productId,
                mainCode: null,
                auxiliaryCode: null,
                description: "Cemento 50 kg",
                quantity: "10",
              },
            ],
          },
          {
            recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: destinationId },
            address: null,
            motive: "Reposición",
            route: null,
            destinationEstablishmentCode: null,
            support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
            details: [
              {
                productId: null,
                mainCode: null,
                auxiliaryCode: null,
                description: "Varilla",
                quantity: "100",
              },
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
    const body = {
      draftId: draft.id,
      expectedVersion: draft.version,
      exceptionDeclaration: { policyVersion: 1 },
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
    // Sin fallo, la misma emisión deja la guía, su número, sus destinatarios, su registro, su
    // idempotencia y su auditoría.
    const seen = new Set<Step>();
    const result = await emission(null, seen).emit(ctx, "atomica-completa", body);
    expect(result.document.state).toBe("RESERVED");
    expect([...seen].sort()).toEqual([...STEPS].sort());
    const after = await trace(draft.id);
    expect([
      after.documents - before.documents,
      after.sequences - before.sequences,
      after.documentRecipients - before.documentRecipients,
      after.guides - before.guides,
      after.recipients - before.recipients,
      after.idempotency - before.idempotency,
      after.audit - before.audit,
    ]).toEqual([1, 1, 2, 1, 2, 1, 1]);
    expect(after.draft).toEqual({ status: "EMITTED", documentId: result.document.id });
  });
});
