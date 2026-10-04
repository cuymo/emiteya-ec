// Runner propio del RIDE (add-document-archive, design D6): toma los jobs `document.*` aunque la
// transmisión esté pausada, no comparte tipos con el runner de la transmisión, no toma nada sin las
// fuentes verificadas y, al apagarse, espera el render en curso o libera su arriendo.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  DOCUMENT_JOB_PREFIX,
  RIDE_BACKOFF,
  RIDE_JOB_TYPE,
  rideJob,
} from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createRideHandler } from "../../src/modules/fiscal/application/archive/ride-handler.ts";
import { createRideUnitOfWork } from "../../src/modules/fiscal/infrastructure/archive/ride-unit-of-work.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import type { RideRenderer } from "../../src/modules/sri-engine/application/ride.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { createInProcessRideRenderer } from "../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { createConfigurationLogoReader } from "../../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createJobRunner, type JobRunner } from "../../src/platform/jobs/runner.ts";
import { insertArchiveDocument, nextInvoice } from "./archive-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { deferred, insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";

const p12Dir = inject("p12FixturesDir");
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const realRenderer = createInProcessRideRenderer(assets.fonts);
const SETTINGS = { maxAttempts: 5, backoff: RIDE_BACKOFF };
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => Promise<boolean>, timeoutMs = 10_000) {
  const limit = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > limit) throw new Error("la condición no se cumplió a tiempo");
    await pause(25);
  }
}

describe("runner del RIDE", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  const runners: JobRunner[] = [];

  const rideHandler = (renderer: RideRenderer = realRenderer) =>
    createRideHandler({
      db: prisma,
      documents: createDocumentRepository(prisma),
      artifacts: createArtifactStore(prisma),
      logos: createConfigurationLogoReader(prisma),
      renderer,
      uow: createRideUnitOfWork(prisma),
      jobs: store,
      settings: SETTINGS,
      logger: silent,
    });
  const runner = (
    handlers: Parameters<typeof createJobRunner>[0]["handlers"],
    options: { paused?: () => string[]; graceMs?: number } = {},
  ) => {
    const created = createJobRunner({
      store,
      db: prisma,
      handlers,
      workers: 2,
      pollIntervalMs: 50,
      leaseMs: 60_000,
      pausedPrefixes: options.paused ?? (() => []),
      logger: silent,
      ...(options.graceMs !== undefined ? { graceMs: options.graceMs } : {}),
    });
    runners.push(created);
    created.start();
    return created;
  };
  const queued = async () => {
    const document = await insertArchiveDocument(prisma, company, await nextInvoice(p12Dir));
    await store.enqueueIn(prisma, rideJob(document, SETTINGS, new Date()));
    return document;
  };
  const rideJobOf = (documentId: string) =>
    prisma.job.findFirstOrThrow({ where: { documentId, type: RIDE_JOB_TYPE } });

  beforeAll(async () => {
    db = await createMigratedSchema("ride_runner");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Empresa Runner", 1);
  });

  afterAll(async () => {
    await Promise.all(runners.map((r) => r.close()));
    await db.drop();
  });

  it("con la transmisión pausada, el RIDE se genera; cada runner toma solo sus tipos", async () => {
    // El runner de la transmisión, pausado como con SRI_TRANSMISSION_ENABLED=0, y con su propio
    // tipo: nunca toma un job del RIDE.
    let transmissionRuns = 0;
    const transmission = runner(
      {
        "sri.transmit": {
          backoff: RIDE_BACKOFF,
          run: () => {
            transmissionRuns++;
            return Promise.resolve();
          },
        },
      },
      { paused: () => ["sri."] },
    );
    const document = await queued();
    await pause(300);
    expect((await rideJobOf(document.id)).status).toBe("PENDING");
    expect(transmissionRuns).toBe(0);
    const ride = runner({ [RIDE_JOB_TYPE]: rideHandler() });
    await until(async () => (await rideJobOf(document.id)).status === "DONE");
    expect(
      await prisma.documentArtifact.count({ where: { documentId: document.id, kind: "RIDE_PDF" } }),
    ).toBe(1);
    expect(ride.activeTypes()).toEqual([RIDE_JOB_TYPE]);
    expect(transmission.activeTypes()).toEqual([]);
    await Promise.all([ride.close(), transmission.close()]);
  });

  it("sin las fuentes verificadas no toma ningún job del RIDE", async () => {
    const document = await queued();
    const ride = runner(
      { [RIDE_JOB_TYPE]: rideHandler() },
      { paused: () => [DOCUMENT_JOB_PREFIX] },
    );
    await pause(300);
    expect(await rideJobOf(document.id)).toMatchObject({ status: "PENDING", attemptCount: 0 });
    await ride.close();
  });

  it("al apagarse espera el render en curso, que termina y guarda el RIDE", async () => {
    const document = await queued();
    const started = deferred();
    const release = deferred();
    // Solo frena el render de este comprobante: otro pendiente se dibuja sin esperar.
    const slow: RideRenderer = {
      async render(input) {
        if (input.accessKey === document.accessKey) {
          started.resolve();
          await release.promise;
        }
        return realRenderer.render(input);
      },
    };
    const ride = runner({ [RIDE_JOB_TYPE]: rideHandler(slow) }, { graceMs: 10_000 });
    await started.promise;
    const closing = ride.close();
    release.resolve();
    await closing;
    expect((await rideJobOf(document.id)).status).toBe("DONE");
  });

  it("si el render no termina dentro del plazo de gracia, libera el arriendo para otra instancia", async () => {
    const document = await queued();
    const started = deferred();
    const never: RideRenderer = {
      async render(input) {
        if (input.accessKey !== document.accessKey) return realRenderer.render(input);
        started.resolve();
        await new Promise(() => {});
        throw new Error("inalcanzable");
      },
    };
    const ride = runner({ [RIDE_JOB_TYPE]: rideHandler(never) }, { graceMs: 200 });
    await started.promise;
    await ride.close();
    const job = await rideJobOf(document.id);
    expect(job.status).toBe("LEASED");
    expect(job.leaseExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now());
    // Otra instancia la retoma y la termina.
    runner({ [RIDE_JOB_TYPE]: rideHandler() });
    await until(async () => (await rideJobOf(document.id)).status === "DONE");
  });
});
