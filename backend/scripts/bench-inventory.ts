// Benchmark del inventario (add-minimal-inventory, design D15). Es un gate dedicado: no forma parte
// de `verify` ni de la suite de pruebas, para que el tiempo de un runner compartido no la vuelva
// inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:inventory
//
// Arranca main.ts sobre un esquema aislado de la base de pruebas, siembra por SQL 10 000 productos
// inicializados con saldos iniciales variados (más 1 000 marcados sin inicializar y 1 000 sin marca)
// y el kárdex de 100 000 facturas (con entradas y ajustes intercalados), y mide por
// separado, desde el cliente HTTP, la lista con y sin filtro, el detalle, la primera página del
// kárdex del producto con más movimientos, el kárdex filtrado por fechas y una entrada manual. La
// salida automática de una factura de varias líneas se mide en proceso, con el seguidor real dentro
// de su transacción. Termina con la reconciliación diagnóstica sin diferencias y escribe el entorno y
// los resultados en docs/quality/benchmarks/. Sale con error si algún P95 supera el objetivo de ERS
// RNF-005 o si la reconciliación encuentra diferencias. El objetivo no se sube para hacerlo pasar.
//
// Las facturas sembradas quedan en RESERVED: solo son el destino de la clave foránea de sus salidas
// y del número que muestra el kárdex. Su estado no participa en ninguna consulta medida.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem, type } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Prisma } from "../src/generated/prisma/client.ts";
import {
  createStockRepository,
  inventoryOutflowFollower,
  reconcileStock,
} from "../src/modules/inventory/infrastructure/index.ts";
import { invoiceStockLines } from "../src/modules/invoices/infrastructure/index.ts";
import { searchKey } from "../src/platform/search/search-key.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";

const PRODUCTS = 10_000;
/** Además de los inicializados: marcados sin inicializar y sin marca, fuera de la lista. */
const TRACKED_NOT_INITIALIZED = 1_000;
const UNTRACKED = 1_000;
const INVOICES = 100_000;
const ENTRIES = 20_000;
const ADJUSTMENTS = 2_000;
/** Producto con más movimientos: aparece en una de cada cinco facturas. */
const HOT = 1;
const WARMUP = 20;
const SAMPLES = 200;
const OUTFLOW_SAMPLES = 100;
const OUTFLOW_LINES = 5;
/** ERS RNF-005: P95 menor que 2 s. */
const BUDGET_MS = 2_000;
const BATCH = 10_000;
const ADMIN = { email: "admin@benchmark.ec", password: "contrasena-benchmark-1" };
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));

const productId = (n: number) => `bench-product-${n}`;

async function seed(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;

  const establishment = await prisma.establishment.create({
    data: { companyId: company, code: "001", address: "Av. Amazonas, Quito" },
  });
  const point = await prisma.emissionPoint.create({
    data: { companyId: company, establishmentId: establishment.id, code: "001" },
  });
  await prisma.fiscalSequence.create({
    data: {
      companyId: company,
      environment: "TEST",
      establishmentId: establishment.id,
      emissionPointId: point.id,
      documentType: "01",
      nextNumber: INVOICES + OUTFLOW_SAMPLES + 1,
      lastReserved: INVOICES,
    },
  });

  const catalog = PRODUCTS + TRACKED_NOT_INITIALIZED + UNTRACKED;
  for (let start = 1; start <= catalog; start += BATCH) {
    const products: Prisma.ProductCreateManyInput[] = [];
    const taxes: Prisma.ProductTaxCreateManyInput[] = [];
    for (let i = start; i < Math.min(catalog + 1, start + BATCH); i += 1) {
      const name = `Producto de inventario ${String(i).padStart(5, "0")}`;
      const mainCode = `INV${String(i).padStart(6, "0")}`;
      products.push({
        id: productId(i),
        companyId: company,
        kind: "GOOD",
        mainCode,
        name,
        unitPrice: "1.50",
        stockTracked: i <= PRODUCTS + TRACKED_NOT_INITIALIZED,
        searchName: searchKey(name),
        searchMainCode: searchKey(mainCode),
        createdBy: user,
        updatedBy: user,
      });
      taxes.push({
        productId: productId(i),
        companyId: company,
        catalogType: "iva-rate",
        entryKey: "4",
      });
    }
    // Producto e IVA en la misma transacción: el trigger diferido exige el IVA al confirmar.
    await prisma.$transaction(async (tx) => {
      await tx.product.createMany({ data: products });
      await tx.productTax.createMany({ data: taxes });
    });
  }

  // Facturas: una reserva y un comprobante RESERVED por secuencial, cada cinco minutos.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
         SELECT 'bench-res-' || g, $1, 'TEST', $2, $3, '01', g, now() - ((${INVOICES} - g + 1) * interval '5 minutes'), $4, 'bench-seed'
         FROM generate_series(1, ${INVOICES}) g`,
        company,
        establishment.id,
        point.id,
        user,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, attempt_count)
         SELECT 'bench-doc-' || r.sequential, r.company_id, '01', 'TEST', r.establishment_id, r.emission_point_id,
                '001-001-' || lpad(r.sequential::text, 9, '0'), r.sequential, r.id,
                '00' || lpad(r.sequential::text, 47, '0'), '12345678', r.reserved_at::date, 'RESERVED',
                '{"snapshotVersion": 2, "lines": []}'::jsonb, '1.1.0', '9999999999999', 'CONSUMIDOR FINAL', 10,
                r.reserved_at, $1, 0
         FROM ${t("fiscal_sequence_reservation")} r WHERE r.company_id = $2`,
        user,
        company,
      );
    },
    { timeout: 600_000, maxWait: 10_000 },
  );

  // Kárdex: el INICIAL de cada producto y, después, sus eventos en orden de tiempo, encadenados con
  // la suma acumulada. Un solo lote: los triggers diferidos comprueban cada saldo al confirmar.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE bench_event ON COMMIT DROP AS
         WITH outflow AS (
           SELECT DISTINCT ON (d.sequential, p.n) d.sequential, p.n,
                  -(1 + (d.sequential + p.k) % 5) AS delta, d.reserved_at AS at
           FROM ${t("fiscal_sequence_reservation")} d
           CROSS JOIN LATERAL (
             SELECT k, ((d.sequential * 7919 + k * 104729) % ${PRODUCTS}) + 1 AS n
             FROM generate_series(0, d.sequential % 3) k
             UNION ALL SELECT 99, ${HOT} WHERE d.sequential % 5 = 0
           ) p
           WHERE d.company_id = $1
           ORDER BY d.sequential, p.n, p.k
         )
         SELECT n, 'SALIDA_FACTURA' AS type, delta::numeric AS delta, at,
                'bench-doc-' || sequential AS document_id, '001-001-' || lpad(sequential::text, 9, '0') AS document_number,
                NULL::text AS operation, NULL::text AS key, NULL::text AS reason, sequential AS ord
         FROM outflow
         UNION ALL
         SELECT ((e * 31) % ${PRODUCTS}) + 1, 'ENTRADA_MANUAL', (10 + e % 50)::numeric,
                now() - ((${ENTRIES} - e + 1) * interval '25 minutes') + interval '1 second',
                NULL, NULL, 'inventory.entry', 'bench-entry-' || e, 'Compra ' || e, ${INVOICES} + e
         FROM generate_series(1, ${ENTRIES}) e
         UNION ALL
         SELECT ((a * 97) % ${PRODUCTS}) + 1, 'AJUSTE', (CASE WHEN a % 2 = 0 THEN -1 ELSE 1 END * (1 + a % 3))::numeric,
                now() - ((${ADJUSTMENTS} - a + 1) * interval '4 hours') + interval '2 seconds',
                NULL, NULL, 'inventory.adjust', 'bench-adjust-' || a, 'Conteo físico ' || a, ${INVOICES + ENTRIES} + a
         FROM generate_series(1, ${ADJUSTMENTS}) a`,
        company,
      );
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE bench_ledger ON COMMIT DROP AS
         SELECT n, type, delta, at, document_id, document_number, operation, key, reason,
                1 + row_number() OVER (PARTITION BY n ORDER BY at, ord) AS position,
                (n % 10) * 10 + sum(delta) OVER (PARTITION BY n ORDER BY at, ord) AS balance_after
         FROM bench_event`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("stock_balance")} (company_id, product_id, balance, last_position, initialized_at, initialized_by, updated_at)
         SELECT $1, 'bench-product-' || g.n, coalesce(l.balance_after, (g.n % 10) * 10), coalesce(l.position, 1),
                now() - interval '400 days', $2, now()
         FROM generate_series(1, ${PRODUCTS}) AS g(n)
         LEFT JOIN (
           SELECT DISTINCT ON (n) n, balance_after, position FROM bench_ledger ORDER BY n, position DESC
         ) l ON l.n = g.n`,
        company,
        user,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("stock_movement")} (id, company_id, product_id, position, movement_type, delta, balance_after, origin, actor_user_id, reason, occurred_at)
         SELECT 'bench-ini-' || n, $1, 'bench-product-' || n, 1, 'INICIAL', (n % 10) * 10, (n % 10) * 10, 'USER', $2, 'Conteo de apertura',
                now() - interval '400 days'
         FROM generate_series(1, ${PRODUCTS}) n`,
        company,
        user,
      );
      // En orden de producto y posición: la cadena exige que exista el movimiento anterior.
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("stock_movement")} (id, company_id, product_id, position, movement_type, delta, balance_after, document_id, document_number, origin, actor_user_id, reason, idempotency_operation, idempotency_key, request_hash, occurred_at)
         SELECT 'bench-mov-' || n || '-' || position, $1, 'bench-product-' || n, position, type, delta, balance_after,
                document_id, document_number,
                CASE WHEN type = 'SALIDA_FACTURA' THEN 'SYSTEM' ELSE 'USER' END,
                CASE WHEN type = 'SALIDA_FACTURA' THEN NULL ELSE $2 END,
                reason, operation, key,
                CASE WHEN key IS NULL THEN NULL ELSE encode(sha256(convert_to(key, 'UTF8')), 'hex') END,
                at
         FROM bench_ledger ORDER BY n, position`,
        company,
        user,
      );
    },
    { timeout: 1_800_000, maxWait: 10_000 },
  );
  for (const table of [
    "product",
    "product_tax",
    "electronic_document",
    "fiscal_sequence_reservation",
    "stock_balance",
    "stock_movement",
  ]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${t(table)}`);
  }
  return { company, user, establishment: establishment.id, point: point.id };
}

async function volume(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const result: Record<string, { rows: number; totalSize: string }> = {};
  for (const table of ["product", "electronic_document", "stock_balance", "stock_movement"]) {
    const [row] = await prisma.$queryRawUnsafe<{ rows: bigint; size: string }[]>(
      `SELECT count(*) AS rows, pg_size_pretty(pg_total_relation_size('"${s}"."${table}"')) AS size FROM "${s}"."${table}"`,
    );
    result[table] = { rows: Number(row!.rows), totalSize: row!.size };
  }
  const [hot] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) FROM "${s}"."stock_movement" WHERE product_id = $1`,
    productId(HOT),
  );
  const [negative] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) FROM "${s}"."stock_balance" WHERE balance < 0`,
  );
  return {
    tables: result,
    hotProductMovements: Number(hot!.count),
    negativeBalances: Number(negative!.count),
  };
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

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
const round = (n: number) => Math.round(n * 10) / 10;

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1)!),
  };
}

async function measureGet(backend: E2eBackend, cookie: string, path: string) {
  const once = async () => {
    const started = performance.now();
    const res = await backend.fetchApi("GET", path, cookie);
    await res.arrayBuffer();
    if (res.status !== 200) throw new Error(`${path} respondió ${res.status}`);
    return performance.now() - started;
  };
  const first = (await (await backend.fetchApi("GET", path, cookie)).json()) as {
    meta?: { total: number };
  };
  for (let i = 0; i < WARMUP; i += 1) await once();
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) samples.push(await once());
  return { results: first.meta?.total ?? null, ...summarize(samples) };
}

/** Entradas manuales secuenciales por HTTP, cada una con su clave. */
async function measureEntries(backend: E2eBackend, cookie: string) {
  const once = async () => {
    const started = performance.now();
    const res = await fetch(`${backend.base}/api/v1/inventory/items/${productId(HOT)}/entries`, {
      method: "POST",
      headers: {
        cookie,
        origin: E2E_ORIGIN,
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({ quantity: "3", note: "Entrada del benchmark" }),
    });
    await res.arrayBuffer();
    if (res.status !== 201) throw new Error(`la entrada respondió ${res.status}`);
    return performance.now() - started;
  };
  for (let i = 0; i < WARMUP; i += 1) await once();
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) samples.push(await once());
  return { results: null, ...summarize(samples) };
}

/**
 * Salida automática de facturas de varias líneas: el seguidor real dentro de su transacción, como en
 * la transacción de la autorización, sobre facturas nuevas con el snapshot versión 2.
 */
async function measureOutflows(backend: E2eBackend, seeded: Awaited<ReturnType<typeof seed>>) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const follower = inventoryOutflowFollower({
    invoices: invoiceStockLines,
    stock: createStockRepository,
  });
  const documents: string[] = [];
  for (let i = 1; i <= WARMUP + OUTFLOW_SAMPLES; i += 1) {
    const sequential = INVOICES + i;
    const lines = Array.from({ length: OUTFLOW_LINES }, (_, k) => ({
      productId: productId(((sequential * 7919 + k * 104729) % PRODUCTS) + 1),
      quantity: "2",
      inventoryAffectsStock: true,
    }));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
         VALUES ('bench-res-' || $5::int, $1, 'TEST', $2, $3, '01', $5::int, now(), $4, 'bench-outflow')`,
        seeded.company,
        seeded.establishment,
        seeded.point,
        seeded.user,
        sequential,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, attempt_count)
         VALUES ('bench-doc-' || $5::int, $1, '01', 'TEST', $2, $3, '001-001-' || lpad($5::text, 9, '0'), $5::int,
                 'bench-res-' || $5::int, '00' || lpad($5::text, 47, '0'), '12345678', current_date, 'RESERVED',
                 $6::jsonb, '1.1.0', '9999999999999', 'CONSUMIDOR FINAL', 10, now(), $4, 0)`,
        seeded.company,
        seeded.establishment,
        seeded.point,
        seeded.user,
        sequential,
        JSON.stringify({ snapshotVersion: 2, lines }),
      );
    });
    documents.push(`bench-doc-${sequential}`);
  }
  const once = async (documentId: string) => {
    const started = performance.now();
    await prisma.$transaction((tx) =>
      follower(tx, {
        companyId: seeded.company,
        documentId,
        from: "RECEIVED",
        to: "AUTHORIZED",
        cause: "AUTHORIZATION",
        at: new Date(),
      }),
    );
    return performance.now() - started;
  };
  for (const documentId of documents.slice(0, WARMUP)) await once(documentId);
  const samples: number[] = [];
  for (const documentId of documents.slice(WARMUP)) samples.push(await once(documentId));
  const [written] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) FROM ${t("stock_movement")} WHERE document_id = ANY($1::text[])`,
    documents,
  );
  if (Number(written!.count) !== documents.length * OUTFLOW_LINES) {
    throw new Error(
      `se esperaban ${documents.length * OUTFLOW_LINES} salidas y hay ${written!.count}`,
    );
  }
  return { results: OUTFLOW_SAMPLES, ...summarize(samples) };
}

const backend = await startE2eBackend({ label: "bench_inventory", admin: ADMIN });
try {
  console.log(
    `Sembrando ${PRODUCTS} productos inicializados, ${TRACKED_NOT_INITIALIZED} marcados sin inicializar, ${UNTRACKED} sin marca y el kárdex de ${INVOICES} facturas, ${ENTRIES} entradas y ${ADJUSTMENTS} ajustes…`,
  );
  const seedStarted = performance.now();
  const seeded = await seed(backend);
  const seedSeconds = Math.round((performance.now() - seedStarted) / 100) / 10;
  const { cookie } = await backend.signIn(ADMIN.email, ADMIN.password);
  const volumeBefore = await volume(backend);
  const lastPage = Math.ceil((PRODUCTS + TRACKED_NOT_INITIALIZED) / 25);
  const hotPath = `/inventory/items/${productId(HOT)}`;
  const month = new Date(Date.now() - 60 * 86_400_000);
  const from = month.toISOString().slice(0, 10);
  const to = new Date(month.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const queries: [string, string][] = [
    ["Lista: primera página, sin filtro", "/inventory/items"],
    ["Lista: última página, sin filtro", `/inventory/items?page=${lastPage}`],
    ["Lista: filtro de estado activo", "/inventory/items?state=TRACKED_INITIALIZED"],
    ["Lista: filtro de saldo negativo", "/inventory/items?state=NEGATIVE"],
    ["Lista: filtro sin inicializar", "/inventory/items?state=TRACKED_NOT_INITIALIZED"],
    ["Lista: búsqueda por código", "/inventory/items?search=inv0012"],
    ["Detalle del producto con más movimientos", hotPath],
    ["Kárdex: primera página del producto con más movimientos", `${hotPath}/movements`],
    ["Kárdex: filtrado por un mes", `${hotPath}/movements?from=${from}&to=${to}`],
  ];
  const results = [];
  for (const [name, path] of queries) {
    const timing = await measureGet(backend, cookie, path);
    results.push({ name, path, ...timing, withinBudget: timing.p95 < BUDGET_MS });
    console.log(`${name}: P50 ${timing.p50} ms, P95 ${timing.p95} ms, máx. ${timing.max} ms`);
  }
  const entry = await measureEntries(backend, cookie);
  results.push({
    name: "Entrada manual (HTTP)",
    path: `POST ${hotPath}/entries`,
    ...entry,
    withinBudget: entry.p95 < BUDGET_MS,
  });
  console.log(`Entrada manual: P50 ${entry.p50} ms, P95 ${entry.p95} ms, máx. ${entry.max} ms`);
  const outflow = await measureOutflows(backend, seeded);
  results.push({
    name: `Salida automática de una factura de ${OUTFLOW_LINES} líneas (seguidor en su transacción)`,
    path: "inventoryOutflowFollower",
    ...outflow,
    withinBudget: outflow.p95 < BUDGET_MS,
  });
  console.log(
    `Salida automática: P50 ${outflow.p50} ms, P95 ${outflow.p95} ms, máx. ${outflow.max} ms`,
  );

  const reconcileStarted = performance.now();
  const differences = await reconcileStock(backend.db.database.prisma, seeded.company);
  const reconcileSeconds = Math.round((performance.now() - reconcileStarted) / 100) / 10;
  console.log(`Reconciliación: ${differences.length} diferencias en ${reconcileSeconds} s`);
  const env = await environment(backend);
  const volumeAfter = await volume(backend);
  // Fecha de Ecuador: una ejecución nocturna no queda con la fecha UTC del día siguiente.
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(
    new Date(),
  );
  const report = {
    date,
    volume: {
      products: PRODUCTS,
      trackedNotInitialized: TRACKED_NOT_INITIALIZED,
      untracked: UNTRACKED,
      invoices: INVOICES,
      entries: ENTRIES,
      adjustments: ADJUSTMENTS,
      seedSeconds,
      before: volumeBefore,
      after: volumeAfter,
    },
    warmup: WARMUP,
    samples: SAMPLES,
    budgetMs: BUDGET_MS,
    environment: env,
    results,
    reconciliation: { differences: differences.length, seconds: reconcileSeconds },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}inventory-${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const passed = results.every((r) => r.withinBudget) && differences.length === 0;
  writeFileSync(
    `${OUT_DIR}inventory-${date}.md`,
    [
      `# Benchmark del inventario (${date})`,
      "",
      `Volumen: ${PRODUCTS} productos inicializados (más ${TRACKED_NOT_INITIALIZED} marcados sin inicializar y ${UNTRACKED} sin marca) y el kárdex de ${INVOICES} facturas (${volumeBefore.tables.stock_movement?.rows ?? "?"} movimientos con los INICIAL, ${ENTRIES} entradas y ${ADJUSTMENTS} ajustes), en una empresa. El producto con más movimientos tiene ${volumeBefore.hotProductMovements}; ${volumeBefore.negativeBalances} saldos son negativos. Siembra por SQL en ${seedSeconds} s, con los triggers de integridad activos. Calentamiento de ${WARMUP} y ${SAMPLES} mediciones secuenciales por consulta desde el cliente HTTP contra \`main.ts\`; la salida automática se mide en proceso con el seguidor real en su transacción (${OUTFLOW_SAMPLES} facturas de ${OUTFLOW_LINES} líneas). Objetivo: ERS RNF-005, P95 menor que ${BUDGET_MS} ms (design D15 de \`add-minimal-inventory\`). Las facturas sembradas quedan en RESERVED: solo son el destino de la clave foránea de sus salidas. Generado por \`bench:inventory\`; datos en \`inventory-${date}.json\`.`,
      "",
      "## Entorno",
      "",
      "| Clave | Valor |",
      "| --- | --- |",
      ...Object.entries(env).map(([key, value]) => `| ${key} | ${value} |`),
      "",
      "## Volumen",
      "",
      "| Tabla | Filas al medir | Tamaño total |",
      "| --- | --- | --- |",
      ...Object.entries(volumeBefore.tables).map(
        ([table, row]) => `| \`${table}\` | ${row.rows} | ${row.totalSize} |`,
      ),
      "",
      "## Resultados",
      "",
      "| Operación | Ruta | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Dentro del objetivo |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...results.map(
        (r) =>
          `| ${r.name} | \`${r.path}\` | ${r.results ?? "—"} | ${r.p50} | ${r.p95} | ${r.max} | ${r.withinBudget ? "Sí" : "No"} |`,
      ),
      "",
      `Reconciliación diagnóstica al terminar: ${differences.length} diferencias, en ${reconcileSeconds} s.`,
      "",
      passed
        ? "Todas las operaciones cumplen el objetivo en este entorno y la reconciliación no encuentra diferencias."
        : "Al menos una operación supera el objetivo o la reconciliación encontró diferencias: analizar antes de cambiar índices o estrategia (`/opsx:update`).",
      "",
    ].join("\n"),
  );
  console.log(passed ? "Benchmark dentro del objetivo." : "Benchmark fuera del objetivo.");
  process.exitCode = passed ? 0 : 1;
} finally {
  await backend.stop();
}
