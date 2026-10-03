// Benchmark de búsqueda de terceros y productos (add-parties-and-products, design D16; Q-26). Es un
// gate dedicado: no forma parte de `verify` ni de la suite de pruebas, para que el tiempo de un
// runner compartido no la vuelva inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:search
//
// Arranca main.ts sobre un esquema aislado de la base de pruebas (DATABASE_URL_TEST o la de
// compose.yaml), siembra un dataset determinista de 10 000 terceros y 10 000 productos en una sola
// empresa, calienta cada consulta y mide peticiones secuenciales desde el cliente HTTP. Escribe el
// entorno y los resultados en docs/quality/benchmarks/ y termina con error si algún P95 supera el
// objetivo. El objetivo no se sube para hacerlo pasar: un fallo se analiza con los planes de
// consulta y se propone el cambio con /opsx:update.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem, type } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Prisma } from "../src/generated/prisma/client.ts";
import { searchKey } from "../src/platform/search/search-key.ts";
import { startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";

const VOLUME = 10_000;
const WARMUP = 30;
const SAMPLES = 300;
const BUDGET_MS = 300;
const BATCH = 1000;
const ADMIN = { email: "admin@benchmark.ec", password: "contrasena-benchmark-1" };
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));

/** Generador determinista (mulberry32): el mismo dataset en cada ejecución. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = [
  "García",
  "Pérez",
  "Núñez",
  "Muñoz",
  "Álvarez",
  "Gómez",
  "Rodríguez",
  "López",
  "Martínez",
  "Sánchez",
  "Ramírez",
  "Torres",
  "Flores",
  "Jiménez",
  "Vásquez",
  "Castillo",
  "Ortiz",
  "Mendoza",
  "Chávez",
  "Andrade",
];
const GIVEN = [
  "José",
  "María",
  "Ángel",
  "Lucía",
  "Andrés",
  "Sofía",
  "Martín",
  "Valentina",
  "Íñigo",
  "Camila",
];
const SUFFIXES = ["S.A.", "Cía. Ltda.", "S.A.S.", "", "", ""];
const GOODS = [
  "Café",
  "Azúcar",
  "Té",
  "Jamón",
  "Pan",
  "Leche",
  "Cemento",
  "Tornillo",
  "Pintura",
  "Cuaderno",
  "Lápiz",
  "Batería",
  "Cable",
  "Tubería",
  "Válvula",
];
const ADJECTIVES = [
  "molido",
  "integral",
  "clásico",
  "eléctrico",
  "galvanizado",
  "premium",
  "económico",
  "orgánico",
];

async function seed(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const next = random(20261003);
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;

  for (let start = 1; start <= VOLUME; start += BATCH) {
    const parties: Prisma.PartyCreateManyInput[] = [];
    for (let i = start; i < start + BATCH; i += 1) {
      const kind = next();
      const [identificationType, identification] =
        kind < 0.7
          ? ["04", `17${String(i).padStart(8, "0")}001`]
          : kind < 0.9
            ? ["05", `09${String(i).padStart(8, "0")}`]
            : ["06", `PA${i.toString(36).toUpperCase().padStart(6, "0")}`];
      const legalName =
        next() < 0.5
          ? `${pick(GIVEN)} ${pick(SURNAMES)} ${pick(SURNAMES)}`
          : `${pick(SURNAMES)} ${pick(["Distribuciones", "Comercial", "Importadora", "Servicios"])} ${pick(SUFFIXES)}`.trim();
      parties.push({
        companyId: company,
        identificationType,
        identification,
        legalName,
        roles: ["CUSTOMER", "SUPPLIER", "CARRIER"].filter(() => next() < 0.4),
        status: next() < 0.1 ? "INACTIVE" : "ACTIVE",
        searchName: searchKey(legalName),
        searchIdentification: searchKey(identification),
        createdBy: user,
        updatedBy: user,
      });
    }
    await prisma.party.createMany({ data: parties });

    const products: Prisma.ProductCreateManyInput[] = [];
    const taxes: Prisma.ProductTaxCreateManyInput[] = [];
    for (let i = start; i < start + BATCH; i += 1) {
      const id = `bench-${i}`;
      const name = `${pick(GOODS)} ${pick(ADJECTIVES)} ${Math.floor(next() * 50) + 1}`;
      const mainCode = `P${String(i).padStart(6, "0")}`;
      const auxiliaryCode = `A-${(i * 7919) % 100000}`;
      const iva = next();
      products.push({
        id,
        companyId: company,
        kind: next() < 0.85 ? "GOOD" : "SERVICE",
        mainCode,
        auxiliaryCode,
        name,
        unitPrice: `${Math.floor(next() * 1000)}.${String(Math.floor(next() * 1e6)).padStart(6, "0")}`,
        status: next() < 0.1 ? "INACTIVE" : "ACTIVE",
        searchName: searchKey(name),
        searchMainCode: searchKey(mainCode),
        searchAuxiliaryCode: searchKey(auxiliaryCode),
        createdBy: user,
        updatedBy: user,
      });
      taxes.push({
        productId: id,
        companyId: company,
        catalogType: "iva-rate",
        entryKey: iva < 0.8 ? "4" : iva < 0.9 ? "2" : iva < 0.95 ? "0" : "8",
      });
    }
    // Producto e IVA en la misma transacción: el trigger diferido exige el IVA al confirmar.
    await prisma.$transaction(async (tx) => {
      await tx.product.createMany({ data: products });
      await tx.productTax.createMany({ data: taxes });
    });
  }
  for (const table of ["party", "product", "product_tax"]) {
    await prisma.$executeRawUnsafe(`ANALYZE "${backend.db.name}"."${table}"`);
  }
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

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  "Relation Name"?: string;
  Plans?: PlanNode[];
};

/** Plan real (EXPLAIN ANALYZE) de las formas de consulta que genera el repositorio. */
async function plans(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const statements: [string, string][] = [
    [
      "Terceros: prefijo de identificación o fragmento de nombre",
      `SELECT id FROM "${s}"."party" WHERE company_id = '${company}' AND status = 'ACTIVE' AND (search_identification LIKE '17000012%' OR search_name LIKE '%17000012%') ORDER BY search_name, id LIMIT 25`,
    ],
    [
      "Terceros: solo el prefijo de identificación",
      `SELECT id FROM "${s}"."party" WHERE company_id = '${company}' AND search_identification LIKE '17000012%'`,
    ],
    [
      "Terceros: primera página por nombre",
      `SELECT id FROM "${s}"."party" WHERE company_id = '${company}' AND status = 'ACTIVE' ORDER BY search_name, id LIMIT 25`,
    ],
    [
      "Productos: estado REVIEW_REQUIRED (EXISTS sobre referencias)",
      `SELECT p.id FROM "${s}"."product" p WHERE p.company_id = '${company}' AND p.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM "${s}"."product_tax" t WHERE t.product_id = p.id AND t.catalog_type = 'iva-rate' AND t.entry_key IN ('2')) ORDER BY p.search_name, p.id LIMIT 25`,
    ],
  ];
  const nodes = (plan: PlanNode): PlanNode[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
  const result = [];
  for (const [name, sql] of statements) {
    const rows = await prisma.$queryRawUnsafe<
      { "QUERY PLAN": [{ Plan: PlanNode; "Execution Time": number }] }[]
    >(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
    const plan = rows[0]!["QUERY PLAN"][0];
    result.push({
      name,
      executionMs: Math.round(plan["Execution Time"] * 100) / 100,
      nodes: nodes(plan.Plan).map((n) =>
        n["Index Name"]
          ? `${n["Node Type"]} (${n["Index Name"]})`
          : n["Relation Name"]
            ? `${n["Node Type"]} (${n["Relation Name"]})`
            : n["Node Type"],
      ),
    });
  }
  return result;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

async function measure(backend: E2eBackend, cookie: string, path: string) {
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
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    results: first.meta?.total ?? null,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1)!),
  };
}

const backend = await startE2eBackend({ label: "bench_search", admin: ADMIN });
try {
  console.log("Sembrando 10 000 terceros y 10 000 productos…");
  await seed(backend);
  const { cookie } = await backend.signIn(ADMIN.email, ADMIN.password);
  // Una tarifa deshabilitada deja productos en revisión, para el filtro y los recuentos.
  const disabled = await backend.fetchApi(
    "PUT",
    "/fiscal-catalogs/iva-rate/entries/2/enablement",
    cookie,
    {
      enabled: false,
    },
  );
  if (disabled.status !== 200)
    throw new Error(`No se pudo deshabilitar el IVA 2: ${disabled.status}`);
  const total = async (path: string) =>
    ((await (await backend.fetchApi("GET", path, cookie)).json()) as { meta: { total: number } })
      .meta.total;
  const lastParties = Math.ceil((await total("/parties")) / 25);
  const lastProducts = Math.ceil((await total("/products")) / 25);
  const queries: [string, string][] = [
    ["Terceros: prefijo de identificación", "/parties?search=17000012"],
    ["Terceros: fragmento de nombre", "/parties?search=garcia"],
    ["Terceros: primera página", "/parties"],
    ["Terceros: última página", `/parties?page=${lastParties}`],
    ["Terceros: filtro por rol", "/parties?role=CARRIER"],
    ["Productos: prefijo de código principal", "/products?search=p0012"],
    ["Productos: prefijo de código auxiliar", "/products?search=a-123"],
    ["Productos: fragmento de nombre", "/products?search=cafe"],
    ["Productos: última página", `/products?page=${lastProducts}`],
    ["Productos: estado REVIEW_REQUIRED", "/products?taxStatus=REVIEW_REQUIRED"],
    ["Productos: recuentos tributarios", "/products/tax-summary"],
  ];
  const results = [];
  for (const [name, path] of queries) {
    const timing = await measure(backend, cookie, path);
    results.push({ name, path, ...timing, withinBudget: timing.p95 <= BUDGET_MS });
    console.log(`${name}: P50 ${timing.p50} ms, P95 ${timing.p95} ms, máx. ${timing.max} ms`);
  }
  const env = await environment(backend);
  const queryPlans = await plans(backend);
  const date = new Date().toISOString().slice(0, 10);
  const report = {
    date,
    volume: { parties: VOLUME, products: VOLUME },
    warmup: WARMUP,
    samples: SAMPLES,
    budgetMs: BUDGET_MS,
    environment: env,
    results,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}search-${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const passed = results.every((r) => r.withinBudget);
  writeFileSync(
    `${OUT_DIR}search-${date}.md`,
    [
      `# Benchmark de búsqueda (${date})`,
      "",
      `Volumen: ${VOLUME} terceros y ${VOLUME} productos en una empresa. Calentamiento de ${WARMUP} peticiones y ${SAMPLES} mediciones secuenciales por consulta, desde el cliente HTTP contra \`main.ts\`. Objetivo: P95 de ${BUDGET_MS} ms o menos en este entorno (design D16 de \`add-parties-and-products\`; Q-26). Generado por \`bench:search\`; datos en \`search-${date}.json\`.`,
      "",
      "## Entorno",
      "",
      "| Clave | Valor |",
      "| --- | --- |",
      ...Object.entries(env).map(([key, value]) => `| ${key} | ${value} |`),
      "",
      "## Resultados",
      "",
      "| Consulta | Ruta | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Dentro del objetivo |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...results.map(
        (r) =>
          `| ${r.name} | \`${r.path}\` | ${r.results ?? "—"} | ${r.p50} | ${r.p95} | ${r.max} | ${r.withinBudget ? "Sí" : "No"} |`,
      ),
      "",
      "## Planes de consulta",
      "",
      "| Forma de consulta | Ejecución (ms) | Nodos |",
      "| --- | --- | --- |",
      ...queryPlans.map((p) => `| ${p.name} | ${p.executionMs} | ${p.nodes.join(" → ")} |`),
      "",
      passed
        ? "Todas las consultas cumplen el objetivo en este entorno."
        : "Al menos una consulta supera el objetivo: analizar sus planes de consulta antes de cambiar índices o estrategia (`/opsx:update`).",
      "",
    ].join("\n"),
  );
  console.log(passed ? "Benchmark dentro del objetivo." : "Benchmark fuera del objetivo.");
  process.exitCode = passed ? 0 : 1;
} finally {
  await backend.stop();
}
