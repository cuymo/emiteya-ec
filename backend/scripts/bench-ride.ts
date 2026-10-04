// Benchmark del RIDE (add-document-archive, design D15; S-4 con la implementación real). Es un gate
// dedicado: no forma parte de `verify` ni de la suite de pruebas. Ejecútalo sobre una PostgreSQL 17
// sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:ride
//
// Construye 60 facturas autorizadas con el builder real, validadas contra el XSD y firmadas con la
// firma sintética, y las guarda como comprobantes `AUTHORIZED` en un esquema aislado de la base de
// pruebas. Las genera con el código real: el runner del RIDE con `RIDE_WORKERS` lazos, el handler, la
// lectura de la fuente y el render en `RideWorkerPool`, y la persistencia del `RIDE_PDF`. 10 de
// calentamiento y 50 medidas, encoladas de una vez. Informa por separado la duración del render en
// su worker, la espera de cola y el job completo, el retraso máximo del event loop del hilo
// principal y el SHA-256 de cada PDF (para comparar entornos). Termina con error si el P95 del
// render supera 1 s. El objetivo no se sube para hacerlo pasar.
//
// Variables opcionales: `RIDE_BENCH_P12_DIR` (P12 sintéticos ya generados, por ejemplo en un
// contenedor sin OpenSSL) y `RIDE_BENCH_LABEL` (sufijo del informe, por ejemplo `container`).
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem, type } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createRideHandler } from "../src/modules/fiscal/application/archive/ride-handler.ts";
import {
  RIDE_BACKOFF,
  RIDE_JOB_TYPE,
  rideJob,
} from "../src/modules/fiscal/application/archive/ride-jobs.ts";
import type { RideObserver } from "../src/modules/fiscal/application/archive/ride-ports.ts";
import { createRideUnitOfWork } from "../src/modules/fiscal/infrastructure/archive/ride-unit-of-work.ts";
import { createArtifactStore } from "../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../src/modules/fiscal/infrastructure/prisma-documents.ts";
import {
  createPooledRideRenderer,
  rideTasksEntry,
} from "../src/modules/sri-engine/infrastructure/ride/pooled-ride-renderer.ts";
import { defaultRideFontsDirectory } from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { RIDE_VERSIONS } from "../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { createConfigurationLogoReader } from "../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import { createPrismaJobStore } from "../src/platform/jobs/prisma-job-store.ts";
import { createJobRunner } from "../src/platform/jobs/runner.ts";
import { createRideWorkerPool } from "../src/platform/workers/ride-worker-pool.ts";
import {
  insertArchiveDocument,
  type ArchiveDocument,
} from "../test/integration/archive-harness.ts";
import { createMigratedSchema } from "../test/integration/database.ts";
import { insertFiscalCompany } from "../test/integration/fiscal-harness.ts";
import { generateP12Fixtures } from "../test/support/p12-fixtures.ts";
import {
  COMPANY_BUYER,
  LONG_ADDRESS,
  LONG_NAME,
  authorizedInvoice,
  line,
  type InvoiceCase,
} from "../test/support/ride-invoices.ts";

// Recolección explícita para medir la memoria estable; `--expose-gc` no se admite en los workers.
setFlagsFromString("--expose_gc");
const gc = runInNewContext("gc") as () => void;

const WARMUP = 10;
const SAMPLES = 50;
const BUDGET_MS = 1000;
const WORKERS = Number(process.env.RIDE_WORKERS ?? 2);
const LABEL = process.env.RIDE_BENCH_LABEL ? `-${process.env.RIDE_BENCH_LABEL}` : "";
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));
/** Resultados de S-4 con el prototipo (ride-2026-10-04.md), para la comparación. */
const S4 = {
  host: { p50: 100.6, p95: 200.3, max: 224 },
  container: { p50: 102.4, p95: 191.7, max: 211.8 },
};

/** 60 facturas representativas: una página (1 a 5 líneas) y varias (40, 80 y 120 líneas). */
function cases(): InvoiceCase[] {
  const sizes = [1, 2, 3, 4, 5, 3, 2, 4, 1, 3, 40, 80, 120];
  return Array.from({ length: WARMUP + SAMPLES }, (_, index) => {
    const lines = sizes[index % sizes.length]!;
    const rimpe = index % 4 === 0;
    return {
      name: `bench-${index + 1}`,
      issueDate: "2026-10-04",
      sequential: String(index + 1).padStart(9, "0"),
      environment: "1",
      ...(rimpe
        ? {
            issuer: {
              legalName: LONG_NAME,
              tradeName: "FERRETERÍA NÚÑEZ — PEÑA & CÍA. «EL MAÑANERO»",
              headOfficeAddress: LONG_ADDRESS,
              rimpe: true,
              withholdingAgentResolution: "1",
            },
            buyer: { ...COMPANY_BUYER, legalName: "JOSÉ ÁNGEL MUÑOZ IBÁÑEZ Ñ Ü ü ç" },
          }
        : { buyer: COMPANY_BUYER }),
      lines: Array.from({ length: lines }, (_, i) =>
        line(i + 1, {
          description:
            i % 9 === 0
              ? `Producto ${i + 1} con una descripción larga que ocupa varias líneas de la tabla del detalle fin${i + 1}`
              : `Producto ${i + 1} de prueba fin${i + 1}`,
        }),
      ),
    } satisfies InvoiceCase;
  });
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
const round = (n: number) => Math.round(n * 10) / 10;
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1)!),
  };
}

const p12Dir = process.env.RIDE_BENCH_P12_DIR ?? mkdtempSync(join(tmpdir(), "bench-ride-p12-"));
if (!process.env.RIDE_BENCH_P12_DIR) generateP12Fixtures(p12Dir);
const db = await createMigratedSchema("bench_ride");
const prisma = db.database.prisma;
const pool = createRideWorkerPool({
  entry: rideTasksEntry(),
  size: WORKERS,
  maxQueue: 4,
  timeoutMs: 30_000,
  fontsDirectory: defaultRideFontsDirectory(),
});
try {
  console.log(`Construyendo ${WARMUP + SAMPLES} facturas autorizadas…`);
  const company = await insertFiscalCompany(prisma, "Empresa benchmark RIDE", 1);
  const documents: (ArchiveDocument & { lines: number })[] = [];
  for (const invoiceCase of cases()) {
    const invoice = await authorizedInvoice(invoiceCase, p12Dir);
    documents.push({
      lines: invoiceCase.lines.length,
      ...(await insertArchiveDocument(prisma, company, invoice)),
    });
  }

  const store = createPrismaJobStore(prisma, db.name);
  const samples = new Map<string, { renderMs: number; waitMs: number }>();
  // Cada job tiene su observador: la espera antes del render y la duración del worker después.
  const pending = new Map<string, { waitMs?: number; renderMs?: number }>();
  const observerFor = (jobId: string): RideObserver => ({
    waited: (seconds) => void pending.set(jobId, { ...pending.get(jobId), waitMs: seconds * 1000 }),
    rendered: (seconds) =>
      void pending.set(jobId, { ...pending.get(jobId), renderMs: seconds * 1000 }),
    failed: (code) => console.error(`fallo ${code} en ${jobId}`),
  });
  const base = {
    db: prisma,
    documents: createDocumentRepository(prisma),
    artifacts: createArtifactStore(prisma),
    logos: createConfigurationLogoReader(prisma),
    renderer: createPooledRideRenderer(pool),
    uow: createRideUnitOfWork(prisma),
    jobs: store,
    settings: { maxAttempts: 3, backoff: RIDE_BACKOFF },
    logger: {
      info: () => {},
      warn: (details: object, message: string) => console.warn(message, details),
    },
  };
  const jobTimes = new Map<string, number>();
  const handler = {
    backoff: RIDE_BACKOFF,
    async run(
      job: Parameters<ReturnType<typeof createRideHandler>["run"]>[0],
      context: Parameters<ReturnType<typeof createRideHandler>["run"]>[1],
    ) {
      const started = performance.now();
      await createRideHandler({ ...base, observer: observerFor(job.id) }).run(job, context);
      jobTimes.set(job.id, performance.now() - started);
      const recorded = pending.get(job.id);
      if (recorded?.renderMs !== undefined && recorded.waitMs !== undefined) {
        samples.set(job.id, { renderMs: recorded.renderMs, waitMs: recorded.waitMs });
      }
    },
  };
  const runner = createJobRunner({
    store,
    db: prisma,
    handlers: { [RIDE_JOB_TYPE]: handler },
    workers: WORKERS,
    pollIntervalMs: 20,
    leaseMs: 180_000,
    pausedPrefixes: () => [],
    logger: { info: () => {}, warn: () => {}, error: (details: object) => console.error(details) },
  });

  const enqueue = async (batch: typeof documents) => {
    const ids = [];
    for (const document of batch) {
      const job = rideJob(document, base.settings, new Date());
      await store.enqueueIn(prisma, job);
      ids.push(document.id);
    }
    return ids;
  };
  const waitDone = async (ids: string[]) => {
    for (;;) {
      const done = await prisma.documentArtifact.count({
        where: { documentId: { in: ids }, kind: "RIDE_PDF" },
      });
      if (done === ids.length) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  runner.start();
  console.log(`Calentamiento: ${WARMUP} RIDE…`);
  await waitDone(await enqueue(documents.slice(0, WARMUP)));
  samples.clear();
  jobTimes.clear();
  console.log(`Medición: ${SAMPLES} RIDE encolados de una vez con ${WORKERS} workers…`);
  const mib = (bytes: number) => round(bytes / 2 ** 20);
  gc();
  const before = process.memoryUsage();
  const delay = monitorEventLoopDelay({ resolution: 5 });
  delay.enable();
  const measuredStart = performance.now();
  const measuredIds = await enqueue(documents.slice(WARMUP));
  await waitDone(measuredIds);
  const elapsedS = (performance.now() - measuredStart) / 1000;
  delay.disable();
  await runner.close();
  gc();
  const after = process.memoryUsage();

  const rides = await prisma.documentArtifact.findMany({
    where: { documentId: { in: measuredIds }, kind: "RIDE_PDF" },
    select: { documentId: true, sha256: true, sizeBytes: true, metadata: true },
  });
  const byDocument = new Map(rides.map((ride) => [ride.documentId, ride]));
  const jobs = await prisma.job.findMany({
    where: { documentId: { in: measuredIds }, type: RIDE_JOB_TYPE },
    select: { id: true, documentId: true },
  });
  const jobOf = new Map(jobs.map((job) => [job.documentId!, job.id]));
  const rows = documents.slice(WARMUP).map((document) => {
    const jobId = jobOf.get(document.id)!;
    const ride = byDocument.get(document.id)!;
    return {
      sequential: document.invoice.snapshot.sequential,
      lines: document.lines,
      pages: (ride.metadata as { pages: number }).pages,
      sizeBytes: ride.sizeBytes,
      sha256: ride.sha256,
      renderMs: samples.get(jobId)?.renderMs ?? Number.NaN,
      waitMs: samples.get(jobId)?.waitMs ?? Number.NaN,
      jobMs: jobTimes.get(jobId) ?? Number.NaN,
    };
  });
  const render = summary(rows.map((row) => row.renderMs));
  const report = {
    date: new Date().toISOString().slice(0, 10),
    label: LABEL.slice(1) || "host",
    budgetMs: BUDGET_MS,
    workers: WORKERS,
    warmup: WARMUP,
    samples: SAMPLES,
    environment: {
      node: process.version,
      os: `${type()} ${release()}`,
      cpu: `${cpus()[0]?.model ?? "?"} (${cpus().length} hilos)`,
      memory: `${Math.round(totalmem() / 2 ** 30)} GiB`,
      commit: (() => {
        try {
          return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
        } catch {
          return "desconocido";
        }
      })(),
      versions: RIDE_VERSIONS,
    },
    render,
    renderOnePage: summary(rows.filter((row) => row.pages === 1).map((row) => row.renderMs)),
    renderMultiPage: summary(rows.filter((row) => row.pages > 1).map((row) => row.renderMs)),
    queueWait: summary(rows.map((row) => row.waitMs)),
    job: summary(rows.map((row) => row.jobMs)),
    pdfBytes: summary(rows.map((row) => row.sizeBytes)),
    throughputPerSecond: round(SAMPLES / elapsedS),
    eventLoopMaxDelayMs: round(delay.max / 1e6),
    // RSS del proceso, con los dos workers; el heap es solo el del hilo principal.
    memoryMiB: {
      rssBefore: mib(before.rss),
      rssAfter: mib(after.rss),
      heapBefore: mib(before.heapUsed),
      heapAfter: mib(after.heapUsed),
    },
    s4: S4,
    rows,
    passed: render.p95 <= BUDGET_MS && rows.every((row) => Number.isFinite(row.renderMs)),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}ride-render-${report.date}${LABEL}.json`;
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Render P50/P95/máx: ${render.p50}/${render.p95}/${render.max} ms · espera P95 ${report.queueWait.p95} ms · event loop máx. ${report.eventLoopMaxDelayMs} ms · ${file}`,
  );
  if (!report.passed) {
    console.error(`El P95 del render supera ${BUDGET_MS} ms o falta una medida.`);
    process.exitCode = 1;
  }
} finally {
  await pool.close();
  await db.drop();
  if (!process.env.RIDE_BENCH_P12_DIR) rmSync(p12Dir, { recursive: true, force: true });
}
