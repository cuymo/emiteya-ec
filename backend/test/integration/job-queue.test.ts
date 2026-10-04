// Repositorio de la cola durable contra PostgreSQL (design D5), en un esquema distinto de `public`:
// el SQL crudo de la selección califica la tabla con el esquema configurado.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/platform/db/database.ts";
import { LeaseLostError, type Job, type NewJob } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";

const T0 = new Date("2026-10-05T12:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1_000);
const backoff = { baseMs: 1_000, capMs: 30_000, minMs: 200 };

describe("cola durable de jobs", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let store: JobStore;
  let companyId: string;

  const newJob = (overrides: Partial<NewJob> = {}): NewJob => ({
    companyId,
    type: "demo.run",
    dedupeKey: `demo.run:${randomUUID()}`,
    runAt: T0,
    maxAttempts: 3,
    ...overrides,
  });
  const claimOne = async (owner: string, now = T0) =>
    (await store.claim({ owner, types: ["demo.run"], limit: 1, leaseMs: 60_000, now }))[0];
  const row = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    db = await createMigratedSchema("job_queue");
    prisma = db.database.prisma;
    expect(db.name).not.toBe("public");
    store = createPrismaJobStore(db.database.prisma, db.name);
    companyId = await insertCompany(prisma, "Empresa A");
  });

  beforeEach(async () => {
    await prisma.job.deleteMany();
  });

  afterAll(async () => {
    await db.drop();
  });

  it("rechaza un nombre de esquema que no es un identificador", () => {
    expect(() => createPrismaJobStore(db.database.prisma, 'x"; DROP TABLE job; --')).toThrow(
      /esquema/,
    );
  });

  describe("encolado", () => {
    it("deduplica por clave entre los jobs activos y admite uno nuevo tras terminar", async () => {
      const job = newJob();
      expect(await store.enqueueIn(prisma, job)).toBe(true);
      expect(await store.enqueueIn(prisma, job)).toBe(false);
      const claimed = (await claimOne("w1"))!;
      await store.complete(prisma, claimed, T0);
      expect(await store.enqueueIn(prisma, job)).toBe(true);
      expect(await prisma.job.count({ where: { dedupeKey: job.dedupeKey } })).toBe(2);
    });

    it("un tipo `sri.*` no tiene dos jobs activos del mismo comprobante", async () => {
      const documentId = randomUUID();
      // Sin comprobante real basta la unicidad: la FK se comprueba en el esquema.
      const inserted = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        return [
          await store.enqueueIn(
            tx,
            newJob({ type: "sri.transmit", dedupeKey: `sri.transmit:${documentId}`, documentId }),
          ),
          await store.enqueueIn(
            tx,
            newJob({ type: "sri.reconcile", dedupeKey: `sri.reconcile:${documentId}`, documentId }),
          ),
        ];
      });
      expect(inserted).toEqual([true, false]);
    });
  });

  describe("selección", () => {
    it("toma solo los vencidos de los tipos pedidos y fija el arriendo", async () => {
      await store.enqueueIn(prisma, newJob());
      await store.enqueueIn(prisma, newJob({ runAt: at(60) }));
      await store.enqueueIn(prisma, newJob({ type: "otro.run", dedupeKey: "otro.run:1" }));
      const claimed = await store.claim({
        owner: "w1",
        types: ["demo.run"],
        limit: 10,
        leaseMs: 30_000,
        now: T0,
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        status: "LEASED",
        leaseOwner: "w1",
        leaseExpiresAt: at(30),
        attemptCount: 1,
      });
    });

    it("varios workers a la vez nunca toman el mismo job", async () => {
      for (let index = 0; index < 40; index++) await store.enqueueIn(prisma, newJob());
      const workers = Array.from({ length: 8 }, (_, index) => `w${index}`);
      const taken: string[] = [];
      await Promise.all(
        workers.map(async (owner) => {
          for (;;) {
            const batch = await store.claim({
              owner,
              types: ["demo.run"],
              limit: 3,
              leaseMs: 60_000,
              now: T0,
            });
            if (batch.length === 0) return;
            taken.push(...batch.map((job) => job.id));
          }
        }),
      );
      expect(taken).toHaveLength(40);
      expect(new Set(taken).size).toBe(40);
      expect(await prisma.job.count({ where: { attemptCount: 1, status: "LEASED" } })).toBe(40);
    });

    it("otro worker retoma un arriendo vencido, y la decisión del dueño anterior no tiene efecto", async () => {
      await store.enqueueIn(prisma, newJob());
      const first = (await claimOne("w1"))!;
      expect(await claimOne("w2", at(59))).toBeUndefined();
      const second = (await claimOne("w2", at(61)))!;
      expect(second).toMatchObject({ id: first.id, leaseOwner: "w2", attemptCount: 2 });
      await expect(store.complete(prisma, first, at(62))).rejects.toBeInstanceOf(LeaseLostError);
      expect((await row(first.id)).status).toBe("LEASED");
      await store.complete(prisma, second, at(62));
      expect(await row(first.id)).toMatchObject({
        status: "DONE",
        activeDedupeKey: null,
        leaseOwner: null,
        completedAt: at(62),
      });
    });

    it("una decisión con el arriendo perdido revierte toda su transacción", async () => {
      await store.enqueueIn(prisma, newJob());
      const first = (await claimOne("w1"))!;
      await claimOne("w2", at(61));
      const next = newJob();
      await expect(
        prisma.$transaction(async (tx) => {
          await store.enqueueIn(tx, next);
          await store.complete(tx, first, at(62));
        }),
      ).rejects.toBeInstanceOf(LeaseLostError);
      expect(await prisma.job.count({ where: { dedupeKey: next.dedupeKey } })).toBe(0);
    });
  });

  describe("fallos y detención", () => {
    const failOnce = async (job: Job, now: Date, random = () => 0.5) =>
      store.fail(
        prisma,
        job,
        { code: "TRANSPORT", errorClass: "RETRYABLE" },
        {
          backoff,
          now,
          random,
        },
      );

    it("un fallo reintentable vuelve a PENDING con backoff dentro de los límites", async () => {
      await store.enqueueIn(prisma, newJob());
      const job = (await claimOne("w1"))!;
      expect(await failOnce(job, T0)).toBe("PENDING");
      const after = await row(job.id);
      expect(after).toMatchObject({
        status: "PENDING",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: "TRANSPORT",
        lastErrorClass: "RETRYABLE",
        attemptCount: 1,
      });
      const delay = after.nextAttemptAt.getTime() - T0.getTime();
      expect(delay).toBeGreaterThanOrEqual(backoff.minMs);
      expect(delay).toBeLessThanOrEqual(backoff.baseMs);
      expect(await claimOne("w1", new Date(after.nextAttemptAt.getTime() - 1))).toBeUndefined();
    });

    it("al agotar los intentos se detiene y conserva el último error", async () => {
      await store.enqueueIn(prisma, newJob({ maxAttempts: 2 }));
      let now = T0;
      const statuses = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const job = (await claimOne("w1", now))!;
        statuses.push(await failOnce(job, now));
        now = at(3_600 * (attempt + 1));
      }
      expect(statuses).toEqual(["PENDING", "STOPPED"]);
      const stopped = await prisma.job.findFirstOrThrow();
      expect(stopped).toMatchObject({
        status: "STOPPED",
        attemptCount: 2,
        lastErrorCode: "TRANSPORT",
        lastErrorDetail: { exhaustedLimit: "ATTEMPTS" },
        activeDedupeKey: null,
      });
      expect(await claimOne("w1", at(86_400))).toBeUndefined();
    });

    it("se detiene si el siguiente intento cae fuera del plazo", async () => {
      await store.enqueueIn(prisma, newJob({ maxAttempts: 10, deadlineAt: at(0.5) }));
      const job = (await claimOne("w1"))!;
      expect(await failOnce(job, T0, () => 0.999)).toBe("STOPPED");
      expect(await row(job.id)).toMatchObject({
        status: "STOPPED",
        lastErrorDetail: { exhaustedLimit: "DEADLINE" },
      });
    });

    it("un error determinista o de integridad lo detiene enseguida", async () => {
      for (const errorClass of ["DETERMINISTIC", "INTEGRITY"] as const) {
        await store.enqueueIn(prisma, newJob());
        const job = (await claimOne("w1"))!;
        const status = await store.fail(
          prisma,
          job,
          { code: "INTEGRITY_FAILED", errorClass, detail: { check: "sha256" } },
          { backoff, now: T0 },
        );
        expect(status).toBe("STOPPED");
        expect(await row(job.id)).toMatchObject({
          status: "STOPPED",
          attemptCount: 1,
          lastErrorClass: errorClass,
          lastErrorDetail: { check: "sha256" },
        });
      }
    });

    it("reprogramar sin consumir devuelve el intento tomado", async () => {
      await store.enqueueIn(prisma, newJob());
      const job = (await claimOne("w1"))!;
      await store.reschedule(prisma, job, { at: at(30), now: T0, consumeAttempt: false });
      expect(await row(job.id)).toMatchObject({
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: at(30),
      });
    });

    it("liberar vence los arriendos del worker para que otro los retome", async () => {
      await store.enqueueIn(prisma, newJob());
      await store.enqueueIn(prisma, newJob());
      await claimOne("w1");
      await claimOne("w2");
      expect(await store.release("w1", at(1))).toBe(1);
      const retaken = (await claimOne("w3", at(1)))!;
      expect(retaken).toMatchObject({ leaseOwner: "w3", attemptCount: 2 });
    });
  });
});
