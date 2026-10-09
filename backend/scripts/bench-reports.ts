// Benchmark de los reportes (add-reports-export, design D18). Es un gate dedicado: no forma parte de
// `verify` ni de la suite de pruebas, para que el tiempo de un runner compartido no lo vuelva
// inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:reports
//
// Arranca main.ts sobre un esquema aislado de la base de pruebas, con la empresa en Producción, el
// barrido del RIDE apagado y la transmisión deshabilitada, y siembra por SQL el volumen de Q-26:
// 100 000 comprobantes de los seis tipos en Producción a lo largo de un año (más 2 000 facturas de
// Pruebas), con los snapshots reales de la factura y sus importes por fila, los destinatarios de las
// guías y las tres líneas de cada retención; 10 000 terceros, 10 000 productos y un kárdex de
// 300 000 movimientos. La siembra apaga los triggers de su sesión (`session_replication_role =
// replica`) para no construir los registros auxiliares de cada tipo que los reportes no leen
// (capacidades, reservas, registros de la guía y declaraciones); escribe las tablas que sí leen.
// Después, `VACUUM (ANALYZE)` y un `CHECKPOINT`.
//
// Mide desde el cliente HTTP:
//   - el P95 de cada lista (primera página, mes, año e identificación) y, en el proceso, de su conteo;
//   - la exportación mensual y la del máximo de filas (100 000), con el tiempo, la memoria residente
//     máxima y la CPU de main.ts, el tamaño y la duración de la transacción en la base;
//   - 10 exportaciones simultáneas con 10 lugares, y las mismas con el valor por defecto de 2;
//   - el rechazo por el máximo de filas.
// Escribe el entorno y los resultados en docs/quality/benchmarks/. Sale con error si alguna lista
// supera ERS RNF-005 (P95 menor que 2 s). El objetivo no se sube para hacerlo pasar.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem, type } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createIssuedDocumentsReportSource } from "../src/modules/fiscal/infrastructure/index.ts";
import { createInventoryMovementsReportSource } from "../src/modules/inventory/infrastructure/index.ts";
import { createPartiesReportSource } from "../src/modules/parties/infrastructure/index.ts";
import { createWithholdingsReportSource } from "../src/modules/withholding-receipts/infrastructure/index.ts";
import { createMigratedSchema } from "../test/integration/database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";
import { REPORT_PROJECTIONS } from "../test/integration/reports-harness.ts";
import {
  DOCUMENTS,
  FIRST_DAY,
  LAST_DAY,
  MOVEMENTS_PER_PRODUCT,
  PARTIES,
  PRODUCTS,
  TEST_INVOICES,
  seedQ26Volume,
} from "./support/q26-volume.ts";

const MONTH = { from: "2026-09-01", to: "2026-09-30" };
const MAX_ROWS = 100_000;
const WARMUP = 5;
const SAMPLES = 60;
const COUNT_SAMPLES = 20;
const MONTHLY_EXPORTS = 5;
const MAX_EXPORTS = 3;
const CONCURRENT = 10;
/** ERS RNF-005: P95 menor que 2 s. */
const BUDGET_MS = 2_000;
const ADMIN = { email: "admin@benchmark.ec", password: "contrasena-benchmark-1" };
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));

const round = (n: number) => Math.round(n * 10) / 10;
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1)!),
  };
};

/** Memoria residente máxima de main.ts desde el último reinicio del pico, en MiB. */
function peakRssMiB(pid: number): number {
  const line = readFileSync(`/proc/${pid}/status`, "utf8")
    .split("\n")
    .find((l) => l.startsWith("VmHWM:"))!;
  return round(Number(line.split(/\s+/)[1]) / 1024);
}
/** Memoria residente actual de main.ts, en MiB. */
function rssMiB(pid: number): number {
  const line = readFileSync(`/proc/${pid}/status`, "utf8")
    .split("\n")
    .find((l) => l.startsWith("VmRSS:"))!;
  return round(Number(line.split(/\s+/)[1]) / 1024);
}
/** Reinicia el pico de memoria residente del proceso (Linux, `clear_refs` con 5). */
const resetPeak = (pid: number) => writeFileSync(`/proc/${pid}/clear_refs`, "5");
/** CPU de usuario y de sistema de main.ts, en milisegundos. */
function cpuMs(pid: number): number {
  const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]!.split(" ");
  return ((Number(fields[11]) + Number(fields[12])) * 1000) / 100;
}

async function environment(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const setting = async (name: string) =>
    (await prisma.$queryRawUnsafe<Record<string, string>[]>(`SHOW ${name}`))[0]![name]!;
  const version = (await prisma.$queryRaw<{ version: string }[]>`SELECT version()`)[0]!.version;
  return {
    postgres: version,
    shared_buffers: await setting("shared_buffers"),
    work_mem: await setting("work_mem"),
    effective_cache_size: await setting("effective_cache_size"),
    jit: await setting("jit"),
    node: process.version,
    os: `${type()} ${release()}`,
    cpu: `${cpus()[0]?.model ?? "?"} (${cpus().length} núcleos)`,
    memory: `${Math.round(totalmem() / 2 ** 30)} GiB`,
    commit: execSync("git rev-parse --short HEAD").toString().trim(),
  };
}

async function seed(backend: E2eBackend, cookie: string) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;

  // La empresa configurada y en Producción, por la API real.
  const configured = await backend.fetchApi("PUT", "/taxpayer", cookie, {
    ruc: "1790012345001",
    legalName: "COMERCIAL ANDINA S.A.",
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    accountingRequired: true,
    expectedVersion: null,
  });
  if (configured.status !== 200) throw new Error(`taxpayer: ${configured.status}`);
  const environmentChange = await backend.fetchApi("PUT", "/taxpayer/environment", cookie, {
    environment: "PRODUCTION",
    expectedVersion: 1,
  });
  if (environmentChange.status !== 200) throw new Error(`ambiente: ${environmentChange.status}`);

  const points: { establishment: string; point: string }[] = [];
  for (const code of ["001", "002"]) {
    const establishment = await prisma.establishment.create({
      data: { companyId: company, code, address: `Establecimiento ${code}` },
    });
    const point = await prisma.emissionPoint.create({
      data: { companyId: company, establishmentId: establishment.id, code: "001" },
    });
    points.push({ establishment: establishment.id, point: point.id });
  }

  await seedQ26Volume(prisma, s, { company, user, points });
}

async function volume(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const result: Record<string, { rows: number; totalSize: string }> = {};
  for (const table of [
    "electronic_document",
    "electronic_document_recipient",
    "withholding_receipt_line",
    "party",
    "product",
    "stock_movement",
    "stock_balance",
  ]) {
    const [row] = await prisma.$queryRawUnsafe<{ rows: bigint; size: string }[]>(
      `SELECT count(*) AS rows, pg_size_pretty(pg_total_relation_size('"${s}"."${table}"')) AS size FROM "${s}"."${table}"`,
    );
    result[table] = { rows: Number(row!.rows), totalSize: row!.size };
  }
  return result;
}

async function measureList(backend: E2eBackend, cookie: string, path: string) {
  const once = async () => {
    const started = performance.now();
    const res = await backend.fetchApi("GET", path, cookie);
    await res.arrayBuffer();
    if (res.status !== 200) throw new Error(`${path} respondió ${res.status}`);
    return performance.now() - started;
  };
  const first = (await (await backend.fetchApi("GET", path, cookie)).json()) as {
    meta: { total: number };
  };
  for (let i = 0; i < WARMUP; i += 1) await once();
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) samples.push(await once());
  return { results: first.meta.total, ...summarize(samples) };
}

/** Transacciones de exportación vivas en la base: su duración máxima y cuántas a la vez. */
function watchTransactions(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const longest = new Map<number, number>();
  let concurrent = 0;
  let connections = 0;
  let running = true;
  const loop = (async () => {
    while (running) {
      const rows = await prisma.$queryRaw<{ pid: number; seconds: number }[]>`
        SELECT pid, extract(epoch FROM now() - xact_start)::float8 AS seconds
        FROM pg_stat_activity
        WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid()
          AND (query LIKE 'FETCH FORWARD%' OR query LIKE 'DECLARE report_%')`;
      const [total] = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database()`;
      concurrent = Math.max(concurrent, rows.length);
      connections = Math.max(connections, Number(total!.count));
      for (const row of rows)
        longest.set(row.pid, Math.max(longest.get(row.pid) ?? 0, row.seconds));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  return async () => {
    running = false;
    await loop;
    const durations = [...longest.values()];
    return {
      transactionSecondsMax: round(Math.max(0, ...durations)),
      concurrentTransactions: concurrent,
      connectionsMax: connections,
    };
  };
}

async function exportOnce(backend: E2eBackend, cookie: string, path: string) {
  const started = performance.now();
  const res = await fetch(`${backend.base}/api/v1${path}`, {
    headers: { cookie, origin: E2E_ORIGIN },
  });
  const body = await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - started, bytes: body.byteLength };
}

async function measureExport(backend: E2eBackend, cookie: string, path: string, samples: number) {
  type ExportRun = {
    ms: number;
    rssBeforeMiB: number;
    cpuMs: number;
    peakRssMiB: number;
    sizeMiB: number;
    transactionSecondsMax: number;
    concurrentTransactions: number;
    connectionsMax: number;
  };
  const runs: ExportRun[] = [];
  for (let i = 0; i < samples; i += 1) {
    resetPeak(backend.pid);
    const rssBeforeMiB = rssMiB(backend.pid);
    const cpuBefore = cpuMs(backend.pid);
    const stop = watchTransactions(backend);
    const run = await exportOnce(backend, cookie, path);
    const database = await stop();
    if (run.status !== 200) throw new Error(`${path} respondió ${run.status}`);
    runs.push({
      ms: round(run.ms),
      rssBeforeMiB,
      cpuMs: round(cpuMs(backend.pid) - cpuBefore),
      peakRssMiB: peakRssMiB(backend.pid),
      sizeMiB: round(run.bytes / 2 ** 20),
      ...database,
    });
  }
  const worst = (key: keyof (typeof runs)[number]) => Math.max(...runs.map((run) => run[key]));
  return {
    path,
    samples,
    ...summarize(runs.map((run) => run.ms)),
    cpuMsMax: worst("cpuMs"),
    peakRssMiBMax: worst("peakRssMiB"),
    rssBeforeMiB: runs[0]!.rssBeforeMiB,
    rssGrowthMiBMax: round(Math.max(...runs.map((run) => run.peakRssMiB - run.rssBeforeMiB))),
    sizeMiB: runs[0]!.sizeMiB,
    transactionSecondsMax: worst("transactionSecondsMax"),
    connectionsMax: worst("connectionsMax"),
  };
}

async function measureConcurrent(backend: E2eBackend, cookie: string, path: string) {
  resetPeak(backend.pid);
  const rssBeforeMiB = rssMiB(backend.pid);
  const cpuBefore = cpuMs(backend.pid);
  const stop = watchTransactions(backend);
  const started = performance.now();
  const runs = await Promise.all(
    Array.from({ length: CONCURRENT }, () => exportOnce(backend, cookie, path)),
  );
  const wallMs = performance.now() - started;
  const database = await stop();
  const generated = runs.filter((run) => run.status === 200);
  return {
    path,
    requests: CONCURRENT,
    generated: generated.length,
    busy: runs.filter((run) => run.status === 503).length,
    other: runs.filter((run) => run.status !== 200 && run.status !== 503).map((run) => run.status),
    wallMs: round(wallMs),
    slowestMs: round(Math.max(...generated.map((run) => run.ms))),
    cpuMs: round(cpuMs(backend.pid) - cpuBefore),
    rssBeforeMiB,
    peakRssMiB: peakRssMiB(backend.pid),
    ...database,
  };
}

/** Duración del conteo de cada fuente en el proceso, sobre la base sembrada. */
async function measureCounts(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const year = { from: FIRST_DAY, to: LAST_DAY };
  const sources: [string, () => Promise<number>][] = [
    [
      "Documentos emitidos, año",
      () =>
        createIssuedDocumentsReportSource(s, REPORT_PROJECTIONS).count(prisma, company, {
          ...year,
          state: "ALL",
          environment: "PRODUCTION",
        }),
    ],
    [
      "Retenciones, año",
      () =>
        createWithholdingsReportSource(s).count(prisma, company, {
          ...year,
          state: "ALL",
          environment: "PRODUCTION",
        }),
    ],
    [
      "Movimientos, año",
      () => createInventoryMovementsReportSource(s).count(prisma, company, year),
    ],
    [
      "Terceros, todos",
      () => createPartiesReportSource(s).count(prisma, company, { status: "ALL" }),
    ],
  ];
  const results = [];
  for (const [name, count] of sources) {
    const total = await count();
    const samples: number[] = [];
    for (let i = 0; i < COUNT_SAMPLES; i += 1) {
      const started = performance.now();
      await count();
      samples.push(performance.now() - started);
    }
    results.push({ name, total, ...summarize(samples) });
  }
  return results;
}

// El esquema lo crea y lo borra este script: lo usan dos arranques de main.ts.
const db = await createMigratedSchema("bench_reports");
const backend = await startE2eBackend({
  label: "bench_reports",
  admin: ADMIN,
  db,
  env: {
    RIDE_SWEEP_INTERVAL_SECONDS: "86400",
    REPORT_EXPORT_MAX_ROWS: String(MAX_ROWS),
    REPORT_EXPORT_MAX_CONCURRENT: String(CONCURRENT),
  },
});
let defaults: E2eBackend | undefined;
try {
  const { cookie } = await backend.signIn(ADMIN.email, ADMIN.password);
  console.log("Sembrando el volumen de Q-26…");
  const seedStarted = performance.now();
  await seed(backend, cookie);
  const seedSeconds = Math.round((performance.now() - seedStarted) / 1000);
  const month = `from=${MONTH.from}&to=${MONTH.to}`;
  const year = `from=${FIRST_DAY}&to=${LAST_DAY}`;
  const lists: [string, string][] = [
    ["Documentos emitidos: primera página", "/reports/issued-documents"],
    ["Documentos emitidos: mes", `/reports/issued-documents?${month}`],
    ["Documentos emitidos: año", `/reports/issued-documents?${year}`],
    [
      "Documentos emitidos: año, los dos ambientes",
      `/reports/issued-documents?${year}&environment=ALL`,
    ],
    ["Facturas: primera página", "/reports/invoices"],
    ["Facturas: mes", `/reports/invoices?${month}`],
    ["Facturas: año", `/reports/invoices?${year}&state=ALL`],
    [
      "Facturas: identificación del cliente",
      "/reports/invoices?customerIdentification=1700000123001",
    ],
    ["Retenciones: primera página", "/reports/withholdings"],
    ["Retenciones: mes", `/reports/withholdings?${month}`],
    ["Retenciones: año", `/reports/withholdings?${year}&state=ALL`],
    ["Retenciones: período fiscal", "/reports/withholdings?fiscalPeriod=2026-08"],
    [
      "Retenciones: identificación del sujeto",
      "/reports/withholdings?supplierIdentification=1700000123001",
    ],
    ["Existencias: primera página", "/reports/inventory-balances"],
    ["Existencias: un producto", "/reports/inventory-balances?productId=bench-prod-123"],
    ["Movimientos: primera página", "/reports/inventory-movements"],
    ["Movimientos: mes", `/reports/inventory-movements?${month}`],
    ["Movimientos: año", `/reports/inventory-movements?${year}`],
    ["Movimientos: un producto", "/reports/inventory-movements?productId=bench-prod-123"],
    ["Terceros: primera página", "/reports/parties"],
    ["Terceros: todos", "/reports/parties?status=ALL"],
    ["Terceros: identificación", "/reports/parties?identification=1700000123001"],
  ];
  const listResults = [];
  for (const [name, path] of lists) {
    const timing = await measureList(backend, cookie, path);
    listResults.push({ name, path, ...timing, withinBudget: timing.p95 < BUDGET_MS });
    console.log(`${name}: ${timing.results} filas, P95 ${timing.p95} ms`);
  }
  const counts = await measureCounts(backend);
  for (const count of counts) console.log(`Conteo ${count.name}: P95 ${count.p95} ms`);

  const monthly = await measureExport(
    backend,
    cookie,
    `/reports/issued-documents/export?${month}`,
    MONTHLY_EXPORTS,
  );
  console.log(`Exportación mensual: P95 ${monthly.p95} ms, ${monthly.peakRssMiBMax} MiB`);
  const maximum = await measureExport(
    backend,
    cookie,
    `/reports/issued-documents/export?${year}`,
    MAX_EXPORTS,
  );
  console.log(
    `Exportación de ${MAX_ROWS} filas: P95 ${maximum.p95} ms, ${maximum.peakRssMiBMax} MiB`,
  );
  const otherMaximums = [];
  for (const path of [
    `/reports/withholdings/export?${year}&state=ALL`,
    "/reports/parties/export?status=ALL",
    "/reports/inventory-balances/export",
    `/reports/inventory-movements/export?from=2026-07-01&to=${LAST_DAY}`,
  ]) {
    otherMaximums.push(await measureExport(backend, cookie, path, 1));
  }
  const rejections: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const run = await exportOnce(
      backend,
      cookie,
      `/reports/issued-documents/export?${year}&environment=ALL`,
    );
    if (run.status !== 409) throw new Error(`se esperaba 409 y respondió ${run.status}`);
    rejections.push(run.ms);
  }
  const rowLimit = {
    path: `/reports/issued-documents/export?${year}&environment=ALL`,
    ...summarize(rejections),
  };
  console.log(`Rechazo por máximo de filas: P95 ${rowLimit.p95} ms`);
  const concurrentMonthly = await measureConcurrent(
    backend,
    cookie,
    `/reports/issued-documents/export?${month}`,
  );
  console.log(
    `${CONCURRENT} exportaciones mensuales simultáneas: ${concurrentMonthly.wallMs} ms, ${concurrentMonthly.peakRssMiB} MiB`,
  );
  const concurrentMaximum = await measureConcurrent(
    backend,
    cookie,
    `/reports/issued-documents/export?${year}`,
  );
  console.log(
    `${CONCURRENT} exportaciones de ${MAX_ROWS} filas simultáneas: ${concurrentMaximum.wallMs} ms, ${concurrentMaximum.peakRssMiB} MiB`,
  );

  // Las mismas diez con los valores por defecto del entorno (2 lugares por instancia).
  await backend.stop();
  defaults = await startE2eBackend({
    label: "bench_reports",
    admin: ADMIN,
    db,
    env: { RIDE_SWEEP_INTERVAL_SECONDS: "86400" },
  });
  const defaultsCookie = (await defaults.signIn(ADMIN.email, ADMIN.password)).cookie;
  await exportOnce(defaults, defaultsCookie, `/reports/issued-documents/export?${month}`);
  const concurrentDefault = await measureConcurrent(
    defaults,
    defaultsCookie,
    `/reports/issued-documents/export?${year}`,
  );
  console.log(
    `${CONCURRENT} exportaciones con 2 lugares: ${concurrentDefault.generated} generadas, ${concurrentDefault.busy} rechazadas`,
  );

  const env = await environment(defaults);
  const tables = await volume(defaults);
  const date = new Date().toISOString().slice(0, 10);
  const report = {
    date,
    volume: {
      documents: DOCUMENTS,
      testInvoices: TEST_INVOICES,
      parties: PARTIES,
      products: PRODUCTS,
      movements: PRODUCTS * MOVEMENTS_PER_PRODUCT,
      tables,
    },
    seedSeconds,
    warmup: WARMUP,
    samples: SAMPLES,
    budgetMs: BUDGET_MS,
    environment: env,
    lists: listResults,
    counts,
    exports: {
      monthly,
      maximum,
      otherMaximums,
      rowLimit,
      concurrentMonthly,
      concurrentMaximum,
      concurrentDefault,
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}reports-${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const passed = listResults.every((r) => r.withinBudget);
  const exportRow = (name: string, e: typeof monthly) =>
    `| ${name} | \`${e.path}\` | ${e.p50} | ${e.p95} | ${e.cpuMsMax} | ${e.rssBeforeMiB} → ${e.peakRssMiBMax} (+${e.rssGrowthMiBMax}) | ${e.sizeMiB} | ${e.transactionSecondsMax} |`;
  const concurrentRow = (name: string, c: typeof concurrentMonthly) =>
    `| ${name} | ${c.generated} | ${c.busy} | ${c.wallMs} | ${c.slowestMs} | ${c.cpuMs} | ${c.rssBeforeMiB} → ${c.peakRssMiB} | ${c.concurrentTransactions} | ${c.connectionsMax} | ${c.transactionSecondsMax} |`;
  writeFileSync(
    `${OUT_DIR}reports-${date}.md`,
    [
      `# Benchmark de los reportes (${date})`,
      "",
      `Volumen: ${Object.values(DOCUMENTS).reduce((a, b) => a + b, 0)} comprobantes en Producción a lo largo de un año (${Object.entries(
        DOCUMENTS,
      )
        .map(([k, v]) => `${v} del tipo ${k}`)
        .join(
          ", ",
        )}) y ${TEST_INVOICES} facturas de Pruebas; ${PARTIES} terceros, ${PRODUCTS} productos y ${PRODUCTS * MOVEMENTS_PER_PRODUCT} movimientos de inventario (volumen de Q-26). Siembra por SQL en ${seedSeconds} s, con los triggers de su sesión apagados (los reportes no leen los registros auxiliares que exigen) y seguida de \`VACUUM (ANALYZE)\` y un \`CHECKPOINT\`. Las listas: ${WARMUP} de calentamiento y ${SAMPLES} mediciones secuenciales desde el cliente HTTP contra \`main.ts\`, con la empresa en Producción, la transmisión deshabilitada y el barrido del RIDE apagado. Objetivo: ERS RNF-005, P95 menor que ${BUDGET_MS} ms. Las exportaciones miden la memoria residente máxima y la CPU del proceso de \`main.ts\` y la duración de su transacción \`REPEATABLE READ\` en la base (muestreada cada 50 ms en \`pg_stat_activity\`). Generado por \`bench:reports\`; datos en \`reports-${date}.json\`.`,
      "",
      "## Entorno",
      "",
      "| Clave | Valor |",
      "| --- | --- |",
      ...Object.entries(env).map(([key, value]) => `| ${key} | ${value} |`),
      "",
      "## Listas",
      "",
      "| Consulta | Ruta | Filas | P50 (ms) | P95 (ms) | Máx. (ms) | Dentro del objetivo |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...listResults.map(
        (r) =>
          `| ${r.name} | \`${r.path}\` | ${r.results} | ${r.p50} | ${r.p95} | ${r.max} | ${r.withinBudget ? "Sí" : "No"} |`,
      ),
      "",
      "## Conteos en el proceso",
      "",
      "| Conteo | Filas | P50 (ms) | P95 (ms) | Máx. (ms) |",
      "| --- | --- | --- | --- | --- |",
      ...counts.map((c) => `| ${c.name} | ${c.total} | ${c.p50} | ${c.p95} | ${c.max} |`),
      "",
      "## Exportaciones",
      "",
      "| Exportación | Ruta | P50 (ms) | P95 (ms) | CPU máx. (ms) | RSS antes → máx. (MiB) | Tamaño (MiB) | Transacción máx. (s) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      exportRow(`Mensual (${MONTHLY_EXPORTS} muestras)`, monthly),
      exportRow(`Máximo de ${MAX_ROWS} filas (${MAX_EXPORTS} muestras)`, maximum),
      ...otherMaximums.map((e) => exportRow("Otro reporte completo", e)),
      "",
      `Rechazo por el máximo de filas (\`409\`): P50 ${rowLimit.p50} ms, P95 ${rowLimit.p95} ms, sin archivo.`,
      "",
      "## Exportaciones simultáneas",
      "",
      "| Escenario | Generadas | 503 | Reloj (ms) | La más lenta (ms) | CPU (ms) | RSS antes → máx. (MiB) | Transacciones a la vez | Conexiones máx. | Transacción máx. (s) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      concurrentRow(`${CONCURRENT} mensuales, ${CONCURRENT} lugares`, concurrentMonthly),
      concurrentRow(`${CONCURRENT} de ${MAX_ROWS} filas, ${CONCURRENT} lugares`, concurrentMaximum),
      concurrentRow(
        `${CONCURRENT} de ${MAX_ROWS} filas, 2 lugares (por defecto)`,
        concurrentDefault,
      ),
      "",
      passed
        ? "Todas las listas cumplen ERS RNF-005 en este entorno."
        : "Al menos una lista supera el objetivo: analizar sus planes antes de cambiar índices o estrategia (`/opsx:update`).",
      "",
    ].join("\n"),
  );
  console.log(passed ? "Listas dentro del objetivo." : "Listas fuera del objetivo.");
  process.exitCode = passed ? 0 : 1;
} finally {
  await defaults?.stop();
  await backend.stop();
  await db.drop();
}
