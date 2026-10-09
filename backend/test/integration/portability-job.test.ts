// Job `portability.export` (add-data-portability, design D10, D11, D14 y D15; tarea 4.5) contra
// PostgreSQL y la cola real: publicación con fencing en una sola transacción, renovación del lease,
// worker obsoleto, fallas deterministas e inesperadas, y archivos por intento.
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "@prometheus-io/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuditLog } from "../../src/modules/audit/application/audit-log.ts";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import type { GeneratorDeps } from "../../src/modules/data-portability/application/generate.ts";
import {
  EXPORT_JOB_TYPE,
  createExportJobHandler,
} from "../../src/modules/data-portability/infrastructure/export-job.ts";
import { registerPortabilityMetrics } from "../../src/modules/data-portability/infrastructure/metrics.ts";
import { createDataExportStore } from "../../src/modules/data-portability/infrastructure/prisma-data-exports.ts";
import { createPortabilityDatabase } from "../../src/modules/data-portability/infrastructure/prisma-portability-database.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import type { Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { completeAuthorizedArtifacts, generatorDeps } from "./portability-harness.ts";
import { insertDocument } from "./transmission-harness.ts";
import { extractZip } from "../support/zip-inspect.ts";

const TTL_MS = 24 * 3_600_000;
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("job de la portabilidad", () => {
  let db: MigratedSchema;
  let root: string;
  const store = createDataExportStore();
  let jobs: ReturnType<typeof createPrismaJobStore>;

  /** Una empresa pequeña: dos comprobantes firmados y uno autorizado con su XML autorizado. */
  async function company(name: string): Promise<FiscalCompany> {
    const prisma = db.database.prisma;
    const created = await insertFiscalCompany(prisma, name, 1);
    await insertDocument(prisma, created, "SIGNED");
    await insertDocument(prisma, created, "SIGNED");
    await insertDocument(prisma, created, "AUTHORIZED");
    await completeAuthorizedArtifacts(prisma, created.companyId);
    return created;
  }

  async function request(target: FiscalCompany, requestedAt?: Date, maxAttempts = 3) {
    const prisma = db.database.prisma;
    return prisma.$transaction(async (tx) => {
      const row = await tx.dataExport.create({
        data: {
          companyId: target.companyId,
          requestedBy: target.adminId,
          status: "QUEUED",
          activeCompanyId: target.companyId,
          ...(requestedAt ? { requestedAt } : {}),
        },
      });
      await jobs.enqueueIn(tx, {
        companyId: target.companyId,
        type: EXPORT_JOB_TYPE,
        dedupeKey: `${EXPORT_JOB_TYPE}:${row.id}`,
        payload: { exportId: row.id },
        runAt: new Date(Date.now() - 1_000),
        maxAttempts,
      });
      return row;
    });
  }

  const claim = async (owner: string, leaseMs: number, now = new Date()) =>
    (await jobs.claim({ owner, types: [EXPORT_JOB_TYPE], limit: 1, leaseMs, now }))[0];

  function handler(
    overrides: {
      generator?: Partial<GeneratorDeps>;
      audit?: (db: DbClient) => AuditLog;
      leaseMs?: number;
      heartbeatMs?: number;
    } = {},
  ) {
    const deps = generatorDeps(db, root, overrides.generator);
    return {
      packages: deps.packages,
      run: (job: Job) =>
        createExportJobHandler({
          generator: deps,
          database: createPortabilityDatabase(db.database.prisma),
          store,
          jobs,
          files: deps.packages,
          audit: overrides.audit ?? createAuditLog,
          metrics: registerPortabilityMetrics(new Registry()),
          ttlMs: TTL_MS,
          logger: silent,
          now: () => new Date(),
          leaseMs: overrides.leaseMs ?? 60_000,
          heartbeatMs: overrides.heartbeatMs ?? 20_000,
        }).run(job, { signal: new AbortController().signal, now: () => new Date() }),
    };
  }

  const exportRow = (id: string) =>
    db.database.prisma.dataExport.findUniqueOrThrow({ where: { id } });
  const events = (companyId: string, action: string) =>
    db.database.prisma.auditEvent.findMany({ where: { companyId, action } });

  beforeAll(async () => {
    db = await createMigratedSchema("portability_job");
    jobs = createPrismaJobStore(db.database.prisma, db.name);
    root = await mkdtemp(join(tmpdir(), "portabilidad-job-"));
    await createPackageInit();
  }, 300_000);
  async function createPackageInit() {
    await generatorDeps(db, root).packages.init();
  }

  // Cada prueba toma solo su job: los que una prueba fallida deje pendientes o arrendados se
  // detienen, para que la siguiente no los tome en lugar del suyo.
  afterEach(async () => {
    const later = new Date(Date.now() + 3_600_000);
    const leftovers = await jobs.claim({
      owner: "limpieza",
      types: [EXPORT_JOB_TYPE],
      limit: 100,
      leaseMs: 60_000,
      now: later,
    });
    for (const leftover of leftovers)
      await jobs.stop(
        db.database.prisma,
        leftover,
        { code: "TEST_CLEANUP", errorClass: "DETERMINISTIC" },
        later,
      );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await db?.drop();
  });

  it("publica en una transacción, con la caducidad contada desde READY y un solo evento", async () => {
    const a = await company("Empresa A");
    const queued = await request(a, new Date(Date.now() - 2 * 3_600_000));
    const job = (await claim("worker-a", 60_000))!;
    await handler().run(job);
    const row = await exportRow(queued.id);
    expect(row).toMatchObject({ status: "READY", attempt: 1, fileName: `${queued.id}-1.zip` });
    expect(row.expiresAt!.getTime() - row.generatedAt!.getTime()).toBe(TTL_MS);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(row.requestedAt.getTime() + TTL_MS);
    const file = join(root, row.fileName!);
    expect((await stat(file)).mode & 0o777).toBe(0o400);
    expect(sha256(await readFile(file))).toBe(row.sha256);
    expect(BigInt((await stat(file)).size)).toBe(row.sizeBytes);
    const completed = await events(a.companyId, "data_export.completed");
    expect(completed).toHaveLength(1);
    expect(JSON.stringify(completed[0]!.changes)).not.toMatch(/\/|\.zip|partial|work/);
    expect((await db.database.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "DONE",
    );
    expect((await readdir(join(root, "work"))).length).toBe(0);
    // Una empresa que solo emitió en Pruebas: solo su carpeta, y cero de Producción declarados.
    const out = join(root, "extraido-solo-pruebas");
    const entries = await extractZip(file, out);
    expect(entries.some((name) => name.startsWith("documents/pruebas/"))).toBe(true);
    expect(entries.some((name) => name.startsWith("documents/produccion/"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8")) as {
      counts: { documents: { TEST: number; PRODUCTION: number } };
    };
    expect(manifest.counts.documents).toMatchObject({ TEST: 3, PRODUCTION: 0 });
    await rm(out, { recursive: true, force: true });
  });

  it("renueva el lease en una generación más larga que el lease base", async () => {
    const b = await company("Empresa B");
    const queued = await request(b);
    // Seis libros de 1 s cada uno superan el lease base de 5 s. El heartbeat de 500 ms deja 4.5 s
    // de margen a cada renovación, también con la base cargada por el resto de la suite.
    const leaseMs = 5_000;
    const job = (await claim("worker-b", leaseMs))!;
    let stolen: unknown;
    const slow = handler({
      leaseMs,
      heartbeatMs: 500,
      generator: {
        writeXlsx: async (path, sheets) => {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          // Otro worker intenta tomar el job con el lease base ya vencido: no puede.
          stolen ??= await claim("ladron", leaseMs);
          const { writeXlsx } = await import("../../src/platform/xlsx/xlsx-writer.ts");
          return writeXlsx(path, sheets);
        },
      },
    });
    await slow.run(job);
    expect(stolen).toBeUndefined();
    expect(await exportRow(queued.id)).toMatchObject({ status: "READY", attempt: 1 });
  });

  it("un worker obsoleto nunca publica: A pausado, B completa, A vuelve y no cambia nada", async () => {
    const c = await company("Empresa C");
    const queued = await request(c);
    const leaseMs = 1_000;
    const a = (await claim("worker-a", leaseMs))!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let paused!: () => void;
    const pausedAt = new Promise<void>((resolve) => (paused = resolve));
    const stale = handler({
      leaseMs,
      heartbeatMs: 3_600_000,
      generator: {
        writeXlsx: async (path, sheets) => {
          paused();
          await gate;
          const { writeXlsx } = await import("../../src/platform/xlsx/xlsx-writer.ts");
          return writeXlsx(path, sheets);
        },
      },
    });
    const runA = stale.run(a);
    await pausedAt;
    await new Promise((resolve) => setTimeout(resolve, leaseMs + 200));
    const b = (await claim("worker-b", 60_000))!;
    expect(b).toMatchObject({ id: a.id, attemptCount: 2 });
    await handler().run(b);
    const ready = await exportRow(queued.id);
    expect(ready).toMatchObject({ status: "READY", attempt: 2, fileName: `${queued.id}-2.zip` });
    release();
    await runA;
    // A no publicó, no completó, no registró nada ni reemplazó el paquete vigente.
    expect(await exportRow(queued.id)).toEqual(ready);
    expect(await events(c.companyId, "data_export.completed")).toHaveLength(1);
    expect(await exists(join(root, `${queued.id}-1.zip`))).toBe(false);
    expect(await exists(join(root, `${queued.id}-1.partial`))).toBe(false);
    expect((await db.database.prisma.job.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "DONE",
    );
  });

  it("una generación nueva fallida conserva el paquete vigente anterior", async () => {
    const d = await company("Empresa D");
    const first = await request(d);
    await handler().run((await claim("worker", 60_000))!);
    const second = await request(d);
    const job = (await claim("worker", 60_000))!;
    let calls = 0;
    await handler({
      generator: {
        files: {
          ...generatorDeps(db, root).files,
          freeBytes: () => Promise.resolve((calls += 1) === 1 ? 10 * 2 ** 30 : 1),
        },
      },
    }).run(job);
    expect(await exportRow(second.id)).toMatchObject({
      status: "FAILED",
      errorCode: "DATA_EXPORT_INSUFFICIENT_SPACE",
    });
    expect(await exportRow(first.id)).toMatchObject({ status: "READY" });
    const failed = await events(d.companyId, "data_export.failed");
    expect(failed.map((event) => event.changes)).toEqual([
      { exportId: second.id, code: "DATA_EXPORT_INSUFFICIENT_SPACE" },
    ]);
    expect((await db.database.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "STOPPED",
    );
  });

  it("un ENOSPC inesperado a mitad del ZIP falla, borra el parcial y no publica", async () => {
    const e = await company("Empresa E");
    const queued = await request(e);
    const job = (await claim("worker", 60_000))!;
    const { openZip64 } =
      await import("../../src/modules/data-portability/infrastructure/zip64.ts");
    await handler({
      generator: {
        openZip: async (path, work) => {
          const zip = await openZip64(path, work);
          let added = 0;
          return {
            ...zip,
            addBuffer: async (name, data, method) => {
              if ((added += 1) === 4) {
                throw Object.assign(new Error("no queda espacio"), { code: "ENOSPC" });
              }
              return zip.addBuffer(name, data, method);
            },
          };
        },
      },
    }).run(job);
    expect(await exportRow(queued.id)).toMatchObject({
      status: "FAILED",
      errorCode: "DATA_EXPORT_INSUFFICIENT_SPACE",
    });
    expect(await exists(join(root, `${queued.id}-1.partial`))).toBe(false);
    expect(await exists(join(root, `${queued.id}-1.zip`))).toBe(false);
  });

  it("si la transacción final falla, nada queda listo, no hay completed y el archivo se borra", async () => {
    const f = await company("Empresa F");
    const queued = await request(f);
    const job = (await claim("worker", 60_000))!;
    const failing = (client: DbClient): AuditLog => ({
      async append(event) {
        if (event.action === "data_export.completed") throw new Error("auditoría caída");
        return createAuditLog(client).append(event);
      },
    });
    await expect(handler({ audit: failing }).run(job)).rejects.toThrow("auditoría caída");
    expect(await exportRow(queued.id)).toMatchObject({ status: "GENERATING" });
    expect(await events(f.companyId, "data_export.completed")).toEqual([]);
    expect(await exists(join(root, `${queued.id}-1.zip`))).toBe(false);
  });

  it("una falla inesperada con los intentos agotados queda DATA_EXPORT_FAILED", async () => {
    const g = await company("Empresa G");
    const queued = await request(g, undefined, 1);
    const job = (await claim("worker", 60_000))!;
    await handler({
      generator: {
        writeXlsx: () => Promise.reject(new Error("falla inesperada")),
      },
    }).run(job);
    expect(await exportRow(queued.id)).toMatchObject({
      status: "FAILED",
      errorCode: "DATA_EXPORT_FAILED",
    });
  });
});
