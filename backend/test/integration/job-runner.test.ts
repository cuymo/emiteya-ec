// Runner de la cola durable contra PostgreSQL (design D5): workers, interruptor por prefijo de tipo,
// apagado ordenado y ausencia de bucles calientes.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/platform/db/database.ts";
import type { Job, NewJob } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import {
  createJobRunner,
  type JobHandler,
  type JobRunner,
  type JobRunnerOptions,
} from "../../src/platform/jobs/runner.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { deferred } from "./fiscal-harness.ts";
import { insertCompany } from "./fixtures.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const backoff = { baseMs: 1_000, capMs: 5_000, minMs: 200 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => Promise<boolean>, timeoutMs = 5_000) {
  const limit = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > limit) throw new Error("la condición no se cumplió a tiempo");
    await pause(20);
  }
}

describe("runner de la cola de jobs", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let store: JobStore;
  let companyId: string;
  const runners: JobRunner[] = [];

  const newJob = (overrides: Partial<NewJob> = {}): NewJob => ({
    companyId,
    type: "demo.run",
    dedupeKey: `demo.run:${randomUUID()}`,
    runAt: new Date(),
    maxAttempts: 3,
    ...overrides,
  });
  const completing = (onRun: (job: Job) => void | Promise<void> = () => {}): JobHandler => ({
    backoff,
    run: async (job, { now }) => {
      await onRun(job);
      await store.complete(prisma, job, now());
    },
  });
  const runner = (options: Partial<JobRunnerOptions> & Pick<JobRunnerOptions, "handlers">) => {
    const created = createJobRunner({
      store,
      db: prisma,
      workers: 2,
      pollIntervalMs: 50,
      leaseMs: 60_000,
      pausedPrefixes: () => [],
      logger: silent,
      ...options,
    });
    runners.push(created);
    created.start();
    return created;
  };
  const statusOf = async (dedupeKey: string) =>
    (await prisma.job.findFirstOrThrow({ where: { dedupeKey } })).status;

  beforeAll(async () => {
    db = await createMigratedSchema("job_runner");
    prisma = db.database.prisma;
    store = createPrismaJobStore(db.database.prisma, db.name);
    companyId = await insertCompany(prisma, "Empresa A");
  });

  beforeEach(async () => {
    await Promise.all(runners.splice(0).map((created) => created.close()));
    await prisma.job.deleteMany();
  });

  afterAll(async () => {
    await Promise.all(runners.splice(0).map((created) => created.close()));
    await db.drop();
  });

  it("varios workers ejecutan cada job una sola vez", async () => {
    const jobs = Array.from({ length: 12 }, () => newJob());
    for (const job of jobs) await store.enqueueIn(prisma, job);
    const seen: string[] = [];
    runner({
      workers: 4,
      handlers: { "demo.run": completing((job) => void seen.push(job.id)) },
    });
    await until(async () => (await prisma.job.count({ where: { status: "DONE" } })) === 12);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  describe("apagado ordenado", () => {
    it("deja de tomar trabajo y espera al job en curso que termina dentro del plazo", async () => {
      const job = newJob();
      const other = newJob({ runAt: new Date(Date.now() + 300) });
      await store.enqueueIn(prisma, job);
      await store.enqueueIn(prisma, other);
      const started = deferred();
      const release = deferred();
      const created = runner({
        workers: 1,
        graceMs: 5_000,
        handlers: {
          "demo.run": completing(async () => {
            started.resolve();
            await release.promise;
          }),
        },
      });
      await started.promise;
      const closing = created.close();
      expect(created.isRunning()).toBe(false);
      await pause(400);
      release.resolve();
      await closing;
      expect(await statusOf(job.dedupeKey)).toBe("DONE");
      expect(await statusOf(other.dedupeKey)).toBe("PENDING");
    });

    it("al agotar el plazo libera el arriendo y otro runner retoma el job", async () => {
      const job = newJob();
      await store.enqueueIn(prisma, job);
      const started = deferred();
      const never = deferred();
      const stuck = runner({
        workers: 1,
        graceMs: 150,
        handlers: {
          "demo.run": completing(async () => {
            started.resolve();
            await never.promise;
          }),
        },
      });
      await started.promise;
      await stuck.close();
      const leased = await prisma.job.findFirstOrThrow({ where: { dedupeKey: job.dedupeKey } });
      expect(leased.status).toBe("LEASED");
      expect(leased.leaseExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now());

      runner({ workers: 1, handlers: { "demo.run": completing() } });
      await until(async () => (await statusOf(job.dedupeKey)) === "DONE");
      const done = await prisma.job.findFirstOrThrow({ where: { dedupeKey: job.dedupeKey } });
      expect(done.attemptCount).toBe(2);
      // La decisión tardía del primer worker ya no tiene efecto.
      never.resolve();
      await pause(50);
      expect(await statusOf(job.dedupeKey)).toBe("DONE");
    });

    it("el handler recibe la señal del apagado para no empezar una llamada nueva", async () => {
      await store.enqueueIn(prisma, newJob());
      const started = deferred();
      let abortedDuringRun = false;
      const created = runner({
        workers: 1,
        handlers: {
          "demo.run": {
            backoff,
            run: async (job, { signal, now }) => {
              started.resolve();
              await new Promise((resolve) => signal.addEventListener("abort", resolve));
              abortedDuringRun = signal.aborted;
              await store.reschedule(prisma, job, { at: now(), now: now(), consumeAttempt: false });
            },
          },
        },
      });
      await started.promise;
      await created.close();
      expect(abortedDuringRun).toBe(true);
      expect(await prisma.job.findFirstOrThrow()).toMatchObject({
        status: "PENDING",
        attemptCount: 0,
      });
    });
  });

  describe("interruptor por prefijo de tipo", () => {
    it("pausado, ningún job `sri.*` se toma ni consume intentos; al reanudar, avanzan", async () => {
      const documentId = randomUUID();
      const job = newJob({
        type: "sri.transmit",
        dedupeKey: `sri.transmit:${documentId}`,
        documentId,
      });
      // Sin comprobante real: este archivo prueba el runner, no la FK.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        await store.enqueueIn(tx, job);
      });
      await store.enqueueIn(prisma, newJob());
      let paused = true;
      const calls: string[] = [];
      let claims = 0;
      const counting: JobStore = {
        ...store,
        claim: (request) => {
          claims++;
          expect(request.types).not.toContain("sri.transmit");
          return store.claim(request);
        },
      };
      const created = runner({
        store: counting,
        pausedPrefixes: () => (paused ? ["sri."] : []),
        handlers: {
          "sri.transmit": completing((running) => void calls.push(running.type)),
          "demo.run": completing((running) => void calls.push(running.type)),
        },
      });
      expect(created.activeTypes()).toEqual(["demo.run"]);
      await pause(400);
      expect(calls).toEqual(["demo.run"]);
      expect(claims).toBeGreaterThan(0);
      expect(await prisma.job.findFirstOrThrow({ where: { type: "sri.transmit" } })).toMatchObject({
        status: "PENDING",
        attemptCount: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      });

      paused = false;
      counting.claim = (request) => store.claim(request);
      await until(async () => (await statusOf(job.dedupeKey)) === "DONE");
      expect(calls).toEqual(["demo.run", "sri.transmit"]);
    });
  });

  describe("sin bucles calientes", () => {
    it("con la cola vacía, o todo pausado, duerme entre sondeos", async () => {
      let claims = 0;
      runner({
        store: { ...store, claim: (request) => (claims++, store.claim(request)) },
        handlers: { "demo.run": completing() },
      });
      await pause(500);
      // Dos workers, sondeo de 50 ms con jitter de ±50 %: como mucho unas veinte consultas.
      expect(claims).toBeGreaterThan(0);
      expect(claims).toBeLessThanOrEqual(24);

      let pausedClaims = 0;
      runner({
        store: { ...store, claim: (request) => (pausedClaims++, store.claim(request)) },
        pausedPrefixes: () => ["demo."],
        handlers: { "demo.run": completing() },
      });
      await pause(300);
      expect(pausedClaims).toBe(0);
    });

    it("con la base inaccesible, duerme entre sondeos", async () => {
      let claims = 0;
      runner({
        store: {
          ...store,
          claim: () => {
            claims++;
            return Promise.reject(new Error("sin conexión"));
          },
        },
        handlers: { "demo.run": completing() },
      });
      await pause(500);
      expect(claims).toBeLessThanOrEqual(24);
    });

    it("un handler que siempre falla espera el backoff y termina detenido", async () => {
      const job = newJob({ maxAttempts: 3 });
      await store.enqueueIn(prisma, job);
      const runs: number[] = [];
      runner({
        workers: 2,
        random: () => 0.5,
        handlers: {
          "demo.run": {
            backoff: { baseMs: 200, capMs: 1_000, minMs: 100 },
            run: () => {
              runs.push(Date.now());
              return Promise.reject(new Error("siempre falla"));
            },
          },
        },
      });
      await until(async () => (await statusOf(job.dedupeKey)) === "STOPPED");
      expect(runs).toHaveLength(3);
      // Con jitter fijo en la mitad: 100 ms tras el primer fallo y 200 ms tras el segundo.
      expect(runs[1]! - runs[0]!).toBeGreaterThanOrEqual(90);
      expect(runs[2]! - runs[1]!).toBeGreaterThanOrEqual(190);
      expect(await prisma.job.findFirstOrThrow()).toMatchObject({
        lastErrorCode: "HANDLER_ERROR",
        lastErrorDetail: { exhaustedLimit: "ATTEMPTS" },
      });
    });
  });
});
