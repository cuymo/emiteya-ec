// Benchmark de las liquidaciones de compra (add-purchase-settlements, design D22 y D27). Es un gate
// dedicado: no forma parte de `verify` ni de la suite de pruebas, para que el tiempo de un runner
// compartido no la vuelva inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:purchase-settlements
//
// Arranca main.ts con EMISSION_STAGE_TIMINGS=1, la custodia habilitada y los límites de recursos en
// sus máximos absolutos (500 líneas y 20 pagos) sobre un esquema aislado de la base de pruebas, con
// la transmisión apagada (las liquidaciones quedan SIGNED) y el barrido del RIDE apagado. Prepara por
// la API la empresa, su establecimiento y su punto, la firma sintética, un proveedor de nombre y
// dirección máximos y 10 operadores. Siembra por SQL 10 000 terceros (la mitad con el rol SUPPLIER,
// con cédula o pasaporte), 10 000 productos, emite una liquidación de plantilla y siembra 100 000
// liquidaciones AUTHORIZED (volumen de Q-26) con el snapshot real de la plantilla, su proveedor, su
// registro y sus cuatro declaraciones; después, VACUUM (ANALYZE) y un CHECKPOINT, para que las
// escrituras diferidas de la siembra masiva no caigan sobre las mediciones. Mide por separado, desde
// el cliente HTTP:
//
// - la búsqueda de proveedores y de productos, y las opciones del borrador;
// - la creación y la vista previa de un borrador con el peor caso de los límites por defecto (100
//   líneas y 10 pagos) y con los máximos absolutos (500 líneas y 20 pagos), con textos multibyte de
//   longitud máxima;
// - el cálculo versionado de 100 y de 500 líneas, en el proceso;
// - la emisión con su reserva en serie, con las etapas de `Server-Timing` (`reservation_tx` aparte
//   del XML, el XSD y la firma), y la del peor caso por defecto y la del máximo absoluto;
// - 10 rondas de 10 emisiones simultáneas a proveedores distintos y al mismo proveedor;
// - la lista y la búsqueda de liquidaciones (por número, por la identificación y por el nombre del
//   proveedor y por estado) y la bandeja filtrada por la identificación del proveedor;
// - el render del RIDE de una liquidación y el del máximo de líneas en `RideWorkerPool`;
// - el CPU y la memoria del proceso del backend en el peor caso.
//
// Registra el tamaño del XML firmado del peor caso SOLO como medición de recursos: no se relaciona
// con Q-47 ni con ningún límite del SRI. Termina comprobando que las liquidaciones no crearon
// movimientos de inventario ni comprobantes de retención y no cambiaron los terceros, escribe el
// entorno y los resultados en docs/quality/benchmarks/ y sale con error si algún P95 supera ERS
// RNF-005 (2 s), si el P95 del render del RIDE supera 1 s o si las liquidaciones tocaron el
// inventario, las retenciones o los terceros. Los objetivos no se suben para hacerlo pasar: un fallo
// se analiza y se propone con /opsx:update.
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem, type } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Prisma } from "../src/generated/prisma/client.ts";
import { calculatePurchaseSettlementAmounts } from "../src/modules/purchase-settlements/domain/amounts.ts";
import {
  createPooledRideRenderer,
  rideTasksEntry,
} from "../src/modules/sri-engine/infrastructure/ride/pooled-ride-renderer.ts";
import { defaultRideFontsDirectory } from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { searchKey } from "../src/platform/search/search-key.ts";
import { createRideWorkerPool } from "../src/platform/workers/ride-worker-pool.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";
import {
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  generateP12Fixtures,
  readFixture,
} from "../test/support/p12-fixtures.ts";

const PARTIES = 10_000;
/** Uno de cada dos terceros sembrados es proveedor; de ellos, uno de cada cuatro con pasaporte. */
const SUPPLIER_EVERY = 2;
const PASSPORT_EVERY = 4;
const PRODUCTS = 10_000;
const SERVICE_EVERY = 20;
const SETTLEMENTS = 100_000;
const USERS = 10;
const WARMUP = 10;
const SAMPLES = 100;
const HEAVY_SAMPLES = 20;
const CALCULATION_SAMPLES = 200;
/** Emisiones simultáneas por ronda y rondas. */
const CONTENDERS = 10;
const ROUNDS = 10;
const RIDE_WARMUP = 5;
const RIDE_SAMPLES = 30;
/** ERS RNF-005: P95 menor que 2 s. */
const BUDGET_MS = 2_000;
/** Como el RIDE de la factura: P95 del render menor que 1 s. */
const RIDE_BUDGET_MS = 1_000;
const BATCH = 10_000;
/** Los valores por defecto de design D22 y los máximos absolutos del contrato. */
const DEFAULT_LIMITS = { lines: 100, payments: 10 };
const MAX_LIMITS = { lines: 500, payments: 20 };
/** Cuerpo del borrador admitido por la ruta (design D22): defensa de recursos HTTP del proyecto. */
const DRAFT_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
/** La liquidación de plantilla tiene el secuencial 1 de su contador: lo sembrado sigue. */
const FIRST = 2;
const LAST_SETTLEMENT = SETTLEMENTS + FIRST - 1;
const ADMIN = { email: "admin@benchmark-lc.ec", password: "contrasena-benchmark-1" };
const OPERATOR_PASSWORD = "contrasena-operador-1";
const LEGAL_NAME = "COMERCIAL ANDINA S.A.";
const STAGES = ["reservation_tx", "xml", "xsd", "sign", "persist", "total"] as const;
type Stage = (typeof STAGES)[number];
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(
  new Date(),
);
const STATEMENTS = [
  "NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING",
  "NO_RUC_OR_SUSPENDED_RUC",
  "UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY",
  "MOVABLE_GOODS_OR_SERVICES_TRANSACTION",
] as const;
const DECLARATIONS = { policyVersion: 1, statements: STATEMENTS };
/**
 * Texto multibyte de exactamente `length` caracteres (de 2 y 3 bytes en UTF-8) con glifo en Noto
 * Sans, para que el RIDE del peor caso también se dibuje.
 */
const TEXT = (prefix: string, length: number) =>
  `${prefix} ${"€ñÁüÉ".repeat(length)}`.slice(0, length);

type Json = Record<string, unknown>;
const party = (n: number) => `bench-party-${n}`;
/** Un tercero sembrado que es proveedor seleccionable (cédula o pasaporte). */
const supplier = (n: number) => party(SUPPLIER_EVERY * (1 + (n % (PARTIES / SUPPLIER_EVERY))));
const cedulaOf = (n: number) => `17${String(n).padStart(8, "0")}`;

async function call(
  backend: E2eBackend,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
  expected = [200, 201],
): Promise<Json> {
  const res = await backend.fetchApi(method, path, cookie, body);
  const json = (await res.json()) as { data: Json };
  if (!expected.includes(res.status)) {
    throw new Error(`${method} ${path} respondió ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

/** Empresa preparada por la API, como la prepararía un administrador. */
async function prepare(backend: E2eBackend, p12Dir: string) {
  const { cookie } = await backend.signIn(ADMIN.email, ADMIN.password);
  await call(backend, cookie, "PUT", "/taxpayer", {
    ruc: FIXTURE_RUC,
    legalName: LEGAL_NAME,
    tradeName: "ANDINA",
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    accountingRequired: true,
    expectedVersion: null,
  });
  const establishment = await call(backend, cookie, "POST", "/establishments", {
    code: "001",
    address: "Av. 6 de Diciembre, Quito",
  });
  const point = await call(
    backend,
    cookie,
    "POST",
    `/establishments/${String(establishment.id)}/emission-points`,
    { code: "001" },
  );
  await call(backend, cookie, "PUT", "/signing-certificate", {
    file: readFixture(p12Dir, "sd-utf8.modern.p12").toString("base64"),
    password: FIXTURE_PASSWORD,
    expectedCurrentId: null,
  });
  // El proveedor del peor caso, con nombre y dirección de 300 caracteres.
  const longest = await call(backend, cookie, "POST", "/parties", {
    identificationType: "06",
    identification: "PAS1234567890",
    legalName: TEXT("PROVEEDOR DE NOMBRE MUY LARGO", 300),
    address: TEXT("Dirección del proveedor", 300),
    roles: ["SUPPLIER"],
  });
  const operators: string[] = [];
  for (let i = 1; i <= USERS; i += 1) {
    const email = `operador${i}@benchmark-lc.ec`;
    await call(backend, cookie, "POST", "/users", {
      name: `Operador ${i}`,
      email,
      password: OPERATOR_PASSWORD,
      role: "OPERATOR",
    });
    const session = await backend.signIn(email, OPERATOR_PASSWORD);
    if (session.status !== 200) throw new Error(`No se pudo iniciar sesión como ${email}`);
    operators.push(session.cookie);
  }
  return {
    cookie,
    establishmentId: String(establishment.id),
    pointId: String(point.id),
    longestSupplier: String(longest.id),
    operators,
  };
}

type Prepared = Awaited<ReturnType<typeof prepare>>;

/** Terceros (la mitad proveedores con cédula o pasaporte) y productos por SQL. */
async function seedCatalog(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${t("party")} (id, company_id, identification_type, identification, legal_name, address, roles, status, version, search_name, search_identification, created_at, created_by, updated_at, updated_by)
     SELECT 'bench-party-' || g, $1, k.type, k.identification, n.name,
            'Comunidad ' || lpad(g::text, 5, '0') || ', Cayambe',
            CASE WHEN g % ${SUPPLIER_EVERY} = 0 THEN ARRAY['SUPPLIER'] ELSE ARRAY['CUSTOMER'] END, 'ACTIVE', 1,
            lower(n.name), k.identification, now(), $2, now(), $2
     FROM generate_series(1, ${PARTIES}) g
     CROSS JOIN LATERAL (SELECT CASE WHEN g % ${SUPPLIER_EVERY} = 0
       THEN 'PROVEEDOR DEL BENCHMARK ' || lpad(g::text, 5, '0')
       ELSE 'CLIENTE DEL BENCHMARK ' || lpad(g::text, 5, '0') || ' S.A.' END AS name) n
     CROSS JOIN LATERAL (SELECT
       CASE WHEN g % ${SUPPLIER_EVERY} <> 0 THEN '04'
            WHEN g % ${PASSPORT_EVERY * SUPPLIER_EVERY} = 0 THEN '06' ELSE '05' END AS type,
       CASE WHEN g % ${SUPPLIER_EVERY} <> 0 THEN '17' || lpad(g::text, 8, '0') || '001'
            WHEN g % ${PASSPORT_EVERY * SUPPLIER_EVERY} = 0 THEN 'PA' || lpad(g::text, 7, '0')
            ELSE '17' || lpad(g::text, 8, '0') END AS identification) k`,
    company,
    user,
  );
  for (let start = 1; start <= PRODUCTS; start += BATCH) {
    const products: Prisma.ProductCreateManyInput[] = [];
    const taxes: Prisma.ProductTaxCreateManyInput[] = [];
    for (let i = start; i < Math.min(PRODUCTS + 1, start + BATCH); i += 1) {
      const id = `bench-prod-${i}`;
      const name = `Producto del benchmark ${i}`;
      const mainCode = `P${String(i).padStart(6, "0")}`;
      const auxiliaryCode = `A-${(i * 7919) % 100000}`;
      products.push({
        id,
        companyId: company,
        kind: i % SERVICE_EVERY === 0 ? "SERVICE" : "GOOD",
        mainCode,
        auxiliaryCode,
        name,
        unitPrice: "10.00",
        status: "ACTIVE",
        searchName: searchKey(name),
        searchMainCode: searchKey(mainCode),
        searchAuxiliaryCode: searchKey(auxiliaryCode),
        createdBy: user,
        updatedBy: user,
      });
      taxes.push({ productId: id, companyId: company, catalogType: "iva-rate", entryKey: "4" });
    }
    // Producto e IVA en la misma transacción: el trigger diferido exige el IVA al confirmar.
    await prisma.$transaction(async (tx) => {
      await tx.product.createMany({ data: products });
      await tx.productTax.createMany({ data: taxes });
    });
  }
  for (const table of ["party", "product", "product_tax"]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${t(table)}`);
  }
}

/**
 * 100 000 liquidaciones AUTHORIZED por SQL con el snapshot real de la plantilla, su clave propia y
 * su proveedor (un tercero sembrado con el rol), con su registro y sus cuatro declaraciones en la
 * misma transacción: el trigger diferido los exige al confirmar.
 */
async function seedSettlements(backend: E2eBackend, data: Prepared, templateId: string) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const template = await prisma.electronicDocument.findUniqueOrThrow({ where: { id: templateId } });
  const suppliers = PARTIES / SUPPLIER_EVERY;
  for (let from = FIRST; from <= LAST_SETTLEMENT; from += BATCH) {
    const to = Math.min(LAST_SETTLEMENT, from + BATCH - 1);
    const batch = `d.company_id = $1 AND d.document_type = '03' AND d.sequential BETWEEN ${from} AND ${to}`;
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
           SELECT 'bench-res-03-' || g, $1, 'TEST', $2, $3, '03', g, now() - ((${LAST_SETTLEMENT} - g + 2) * interval '1 minute'), $4, 'bench-seed'
           FROM generate_series(${from}, ${to}) g`,
          company,
          data.establishmentId,
          data.pointId,
          user,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, authorization_number, authorization_date, authorization_environment, attempt_count)
           SELECT 'bench-lc-' || r.sequential, r.company_id, '03', 'TEST', r.establishment_id, r.emission_point_id,
                  '001-001-' || lpad(r.sequential::text, 9, '0'), r.sequential, r.id,
                  '03' || lpad(r.sequential::text, 47, '0'), '12345678', r.reserved_at::date, 'AUTHORIZED',
                  $1::jsonb || jsonb_build_object(
                    'key', jsonb_build_object(
                      'documentNumber', '001-001-' || lpad(r.sequential::text, 9, '0'),
                      'sequential', lpad(r.sequential::text, 9, '0'), 'numericCode', '12345678',
                      'emissionType', '1', 'accessKey', '03' || lpad(r.sequential::text, 47, '0')),
                    'supplier', ($1::jsonb -> 'supplier') || jsonb_build_object(
                      'partyId', p.id, 'identificationType', p.identification_type,
                      'identification', p.identification, 'legalName', p.legal_name)),
                  $2, p.identification, p.legal_name, $3::numeric, r.reserved_at, $4, r.reserved_at + interval '1 second',
                  '03' || lpad(r.sequential::text, 47, '0'), r.reserved_at + interval '1 minute', 'TEST', 1
           FROM ${t("fiscal_sequence_reservation")} r
           JOIN ${t("party")} p ON p.id = 'bench-party-' || (${SUPPLIER_EVERY} * (1 + r.sequential % ${suppliers}))
           WHERE r.company_id = $5 AND r.document_type = '03' AND r.sequential BETWEEN ${from} AND ${to}`,
          JSON.stringify(template.snapshot),
          template.schemaVersion,
          String(template.total),
          user,
          company,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_artifact")} (id, company_id, document_id, kind, media_type, content, size_bytes, sha256, metadata, created_at)
           SELECT gen_random_uuid()::text, d.company_id, d.id, k.kind, 'application/xml', c.content, octet_length(c.content),
                  encode(sha256(c.content), 'hex'), jsonb_build_object('documentType', '03', 'schemaVersion', $2::text), d.signed_at
           FROM ${t("electronic_document")} d
           CROSS JOIN (VALUES ('SIGNED_XML'), ('AUTHORIZED_XML')) k(kind)
           CROSS JOIN LATERAL (SELECT convert_to('<liquidacionCompra id="comprobante" version="' || $2 || '"><infoTributaria><claveAcceso>' || d.access_key || '</claveAcceso></infoTributaria></liquidacionCompra>', 'UTF8') AS content) c
           WHERE ${batch}`,
          company,
          template.schemaVersion,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("purchase_settlement")} (company_id, document_id, supplier_party_id, eligibility_case, eligibility_policy, policy_version, line_count, payment_count, created_at)
           SELECT d.company_id, d.id, 'bench-party-' || (${SUPPLIER_EVERY} * (1 + d.sequential % ${suppliers})),
                  'ART_13_C', 'PURCHASE_SETTLEMENT_ELIGIBILITY_V1', 1, 2, 2, d.created_at
           FROM ${t("electronic_document")} d WHERE ${batch}`,
          company,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("purchase_settlement_declaration")} (company_id, document_id, statement_id, policy_version, basis, declared_by, declared_at)
           SELECT d.company_id, d.id, k.statement, 1, 'USER_DECLARED', $2, d.created_at
           FROM ${t("electronic_document")} d
           CROSS JOIN unnest($3::text[]) k(statement)
           WHERE ${batch}`,
          company,
          user,
          STATEMENTS,
        );
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  }
  // El contador de liquidaciones sigue después de lo sembrado.
  await prisma.$executeRawUnsafe(
    `UPDATE ${t("fiscal_sequence")} SET next_number = ${LAST_SETTLEMENT + 1}, last_reserved = ${LAST_SETTLEMENT}
     WHERE company_id = $1 AND document_type = '03'`,
    company,
  );
  // La base asentada antes de medir: sin el vacío ni el checkpoint pendientes de la siembra.
  for (const table of [
    "party",
    "product",
    "product_tax",
    "fiscal_sequence",
    "fiscal_sequence_reservation",
    "electronic_document",
    "document_artifact",
    "purchase_settlement",
    "purchase_settlement_declaration",
  ]) {
    await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) ${t(table)}`);
  }
  await prisma.$executeRawUnsafe("CHECKPOINT");
}

async function volume(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const result: Record<string, { rows: number; totalSize: string }> = {};
  for (const table of [
    "party",
    "product",
    "electronic_document",
    "document_artifact",
    "purchase_settlement",
    "purchase_settlement_declaration",
    "purchase_settlement_draft",
  ]) {
    const [row] = await prisma.$queryRawUnsafe<{ rows: bigint; size: string }[]>(
      `SELECT count(*) AS rows, pg_size_pretty(pg_total_relation_size('"${s}"."${table}"')) AS size FROM "${s}"."${table}"`,
    );
    result[table] = { rows: Number(row!.rows), totalSize: row!.size };
  }
  return result;
}

/** Huellas de lo que una liquidación nunca toca: el inventario, las retenciones y los terceros. */
async function untouched(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const digest = async (sql: string) =>
    (await prisma.$queryRawUnsafe<{ digest: string | null }[]>(sql))[0]!.digest ?? "";
  return {
    stockMovements: await prisma.stockMovement.count(),
    stockBalances: await digest(
      `SELECT md5(string_agg(product_id || ':' || balance::text || ':' || last_position, '|' ORDER BY product_id)) AS digest FROM "${s}"."stock_balance"`,
    ),
    withholdings: await prisma.electronicDocument.count({ where: { documentType: "07" } }),
    parties: await digest(
      `SELECT md5(string_agg(id || ':' || array_to_string(roles, ',') || ':' || status || ':' || version || ':' || legal_name || ':' || coalesce(address, ''), '|' ORDER BY id)) AS digest FROM "${s}"."party"`,
    ),
    products: await digest(
      `SELECT md5(string_agg(id || ':' || unit_price::text || ':' || version, '|' ORDER BY id)) AS digest FROM "${s}"."product"`,
    ),
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
const round2 = (n: number) => Math.round(n * 100) / 100;

function summarize(samples: number[], digits = round) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: digits(percentile(sorted, 50)),
    p95: digits(percentile(sorted, 95)),
    max: digits(sorted.at(-1)!),
  };
}

async function measureGet(backend: E2eBackend, cookie: string, path: string, samples = SAMPLES) {
  const once = async () => {
    const started = performance.now();
    const res = await backend.fetchApi("GET", path, cookie);
    await res.arrayBuffer();
    if (res.status !== 200) throw new Error(`${path} respondió ${res.status}`);
    return performance.now() - started;
  };
  const first = (await (await backend.fetchApi("GET", path, cookie)).json()) as {
    data?: { lines?: unknown[] };
    meta?: { total: number };
  };
  for (let i = 0; i < WARMUP; i += 1) await once();
  const timings: number[] = [];
  for (let i = 0; i < samples; i += 1) timings.push(await once());
  return {
    results: first.meta?.total ?? first.data?.lines?.length ?? null,
    ...summarize(timings),
  };
}

/** Proceso de `main.ts` de este benchmark, por su puerto, para medir su CPU y su memoria. */
function backendPid(backend: E2eBackend): number {
  const port = new URL(backend.base).port;
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      if (!cmdline.includes("src/main.ts")) continue;
      const environ = readFileSync(`/proc/${entry}/environ`, "utf8").split("\0");
      if (environ.includes(`PORT=${port}`)) return Number(entry);
    } catch {
      // Un proceso ajeno o que ya terminó.
    }
  }
  throw new Error("no se encontró el proceso del backend");
}

/** CPU acumulado (ms, usuario y sistema) y memoria residente actual y máxima (MiB). */
function processUsage(pid: number) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = Number(fields[11]) + Number(fields[12]);
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const kib = (name: string) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
  return {
    cpuMs: ticks * 10,
    rssMiB: round(kib("VmRSS") / 1024),
    peakMiB: round(kib("VmHWM") / 1024),
  };
}

type Limits = typeof DEFAULT_LIMITS;

/**
 * El peor caso de unos límites: líneas con un producto en la primera, códigos de 25, descripción de
 * 300, unidad de 50, cantidad y precio con 6 decimales, la mitad al 15 % y la otra al 0 %; pagos con
 * la unidad de tiempo de 10 y el plazo más largo, que suman exactamente el importe total.
 */
function worstBody(limits: Limits, data: Prepared) {
  const lines = Array.from({ length: limits.lines }, (_, k) => ({
    productId: k === 0 ? "bench-prod-1" : null,
    mainCode: TEXT(`M${k}`, 25),
    auxiliaryCode: TEXT(`A${k}`, 25),
    description: TEXT(`Línea ${k + 1}`, 300),
    unit: TEXT(`U${k}`, 50),
    quantity: "1.000000",
    unitPrice: "1.000000",
    discount: "0.00",
    ivaRate: k % 2 === 0 ? "4" : "0",
  }));
  // Cada línea vale 1.00 de base; las del 15 % suman 0.15 de IVA.
  const totalCents = limits.lines * 100 + Math.ceil(limits.lines / 2) * 15;
  const share = Math.floor(totalCents / limits.payments);
  const payments = Array.from({ length: limits.payments }, (_, k) => {
    const cents = k === limits.payments - 1 ? totalCents - share * (limits.payments - 1) : share;
    return {
      paymentMethod: k % 2 === 0 ? "01" : "20",
      total: (cents / 100).toFixed(2),
      term: "99999999999999",
      timeUnit: TEXT(`${k}`, 10),
    };
  });
  return {
    emissionPointId: data.pointId,
    supplierPartyId: data.longestSupplier,
    supplierAddress: TEXT("Dirección del proveedor", 300),
    lines,
    payments,
  };
}

/** Una liquidación simple de dos líneas y dos pagos al proveedor sembrado `n`. */
const simpleBody = (data: Prepared, n: number) => ({
  emissionPointId: data.pointId,
  supplierPartyId: supplier(n),
  lines: [
    {
      productId: `bench-prod-${1 + (n % 50)}`,
      mainCode: `P${String(1 + (n % 50)).padStart(6, "0")}`,
      description: "Saco de cacao en grano, 45 kg",
      unit: "saco",
      quantity: "10",
      unitPrice: "4.50",
      discount: "5.00",
      ivaRate: "4",
    },
    { description: "Jornal de cosecha", quantity: "2", unitPrice: "30.00", ivaRate: "0" },
  ],
  payments: [
    { paymentMethod: "01", total: "50.00", term: "0", timeUnit: "días" },
    { paymentMethod: "20", total: "56.00", term: "30", timeUnit: "días" },
  ],
});
const bodyBytes = (body: unknown) => Buffer.byteLength(JSON.stringify(body));

type Draft = { id: string; version: number };

async function draftFor(backend: E2eBackend, cookie: string, body: unknown): Promise<Draft> {
  const draft = await call(backend, cookie, "POST", "/purchase-settlements/drafts", body);
  const issues = (draft.preview as { issues: unknown[] }).issues;
  if (issues.length > 0) throw new Error(`borrador con problemas: ${JSON.stringify(issues)}`);
  return { id: String(draft.id), version: Number(draft.version) };
}

type Emission = { id: string; clientMs: number; stages: Partial<Record<Stage, number>> };

async function emit(backend: E2eBackend, cookie: string, draft: Draft): Promise<Emission> {
  const started = performance.now();
  const res = await fetch(`${backend.base}/api/v1/purchase-settlements`, {
    method: "POST",
    headers: {
      cookie,
      origin: E2E_ORIGIN,
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      draftId: draft.id,
      expectedVersion: draft.version,
      declarations: DECLARATIONS,
    }),
  });
  const body = (await res.json()) as { data?: { id: string; state: string } };
  const clientMs = performance.now() - started;
  if (res.status !== 201 || body.data?.state !== "SIGNED") {
    throw new Error(`la emisión respondió ${res.status}: ${JSON.stringify(body)}`);
  }
  const stages: Partial<Record<Stage, number>> = {};
  for (const entry of (res.headers.get("server-timing") ?? "").split(",")) {
    const [stage, duration] = entry.trim().split(";dur=");
    if (stage && duration && (STAGES as readonly string[]).includes(stage))
      stages[stage as Stage] = Number(duration);
  }
  return { id: body.data.id, clientMs, stages };
}

function emissionSummary(emissions: readonly Emission[]) {
  const stages = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      summarize(emissions.map((emission) => emission.stages[stage] ?? 0)),
    ]),
  ) as Record<Stage, ReturnType<typeof summarize>>;
  return { client: summarize(emissions.map((emission) => emission.clientMs)), stages };
}

async function measureSerialEmissions(backend: E2eBackend, data: Prepared) {
  const emissions: Emission[] = [];
  for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
    const cookie = data.operators[index % data.operators.length]!;
    const draft = await draftFor(backend, cookie, simpleBody(data, 2_000 + index));
    const emission = await emit(backend, cookie, draft);
    if (index >= WARMUP) emissions.push(emission);
  }
  return emissionSummary(emissions);
}

/**
 * Rondas de `CONTENDERS` emisiones simultáneas, cada una de un operador con su borrador ya guardado.
 * Rendimiento: reservas confirmadas por segundo de reloj de cada ronda.
 */
async function measureConcurrentEmissions(
  backend: E2eBackend,
  data: Prepared,
  rounds: readonly (readonly number[])[],
) {
  const emissions: Emission[] = [];
  const throughput: number[] = [];
  for (const suppliers of rounds) {
    const drafts: Draft[] = [];
    for (const [index, n] of suppliers.entries()) {
      drafts.push(
        await draftFor(
          backend,
          data.operators[index % data.operators.length]!,
          simpleBody(data, n),
        ),
      );
    }
    const started = performance.now();
    const results = await Promise.all(
      drafts.map((draft, index) =>
        emit(backend, data.operators[index % data.operators.length]!, draft),
      ),
    );
    throughput.push(results.length / ((performance.now() - started) / 1000));
    emissions.push(...results);
  }
  return {
    ...emissionSummary(emissions),
    reservationsPerSecond: round(
      throughput.reduce((sum, value) => sum + value, 0) / throughput.length,
    ),
  };
}

/** El cálculo versionado de `count` líneas en el proceso, sin red ni base. */
function measureCalculation(count: number) {
  const lines = Array.from({ length: count }, (_, k) => ({
    position: k + 1,
    quantity: "1.123456",
    unitPrice: "0.987654",
    discount: "0.10",
    rate: k % 2 === 0 ? { rateCode: "4", percentage: "15" } : { rateCode: "0", percentage: "0" },
  }));
  for (let i = 0; i < WARMUP; i += 1) calculatePurchaseSettlementAmounts(lines);
  const samples: number[] = [];
  for (let i = 0; i < CALCULATION_SAMPLES; i += 1) {
    const started = performance.now();
    calculatePurchaseSettlementAmounts(lines);
    samples.push(performance.now() - started);
  }
  return { results: count, ...summarize(samples, round2) };
}

/** Render del RIDE de liquidaciones firmadas en `RideWorkerPool`, con su duración en el worker. */
async function measureRide(backend: E2eBackend, ids: readonly string[]) {
  const prisma = backend.db.database.prisma;
  const pool = createRideWorkerPool({
    entry: rideTasksEntry(),
    size: 2,
    maxQueue: 4,
    timeoutMs: 30_000,
    fontsDirectory: defaultRideFontsDirectory(),
  });
  try {
    const renderer = createPooledRideRenderer(pool);
    const results = [];
    for (const id of ids) {
      const settlement = await prisma.electronicDocument.findUniqueOrThrow({ where: { id } });
      const signed = await prisma.documentArtifact.findFirstOrThrow({
        where: { documentId: id, kind: "SIGNED_XML" },
      });
      // Las denominaciones de las formas de pago salen del snapshot, como en el handler del RIDE.
      const paymentLabels = Object.fromEntries(
        (
          (settlement.snapshot as { payments: { code: string; officialLabel: string }[] })
            .payments ?? []
        ).map((payment) => [payment.code, payment.officialLabel]),
      );
      const input = {
        xml: new Uint8Array(signed.content),
        accessKey: settlement.accessKey,
        authorization: {
          number: settlement.accessKey,
          authorizedAt: new Date(),
          environment: "TEST" as const,
        },
        paymentLabels,
        logo: null,
      };
      const samples: number[] = [];
      let pages = 0;
      for (let i = 0; i < RIDE_WARMUP + RIDE_SAMPLES; i += 1) {
        const outcome = await renderer.render(input);
        if (outcome.status !== "RENDERED") {
          throw new Error(`el RIDE de la liquidación se rechazó: ${outcome.code}`);
        }
        pages = outcome.pages;
        if (i >= RIDE_WARMUP) samples.push(outcome.renderMs);
      }
      results.push({ results: RIDE_SAMPLES, pages, ...summarize(samples) });
    }
    return results;
  } finally {
    await pool.close();
  }
}

/** Tamaño del XML firmado de una liquidación emitida: medición de recursos, sin relación con Q-47. */
async function signedSize(backend: E2eBackend, id: string) {
  const signed = await backend.db.database.prisma.documentArtifact.findFirstOrThrow({
    where: { documentId: id, kind: "SIGNED_XML" },
  });
  return signed.sizeBytes;
}

const p12Dir = mkdtempSync(join(tmpdir(), "bench-purchase-settlements-p12-"));
generateP12Fixtures(p12Dir);
const backend = await startE2eBackend({
  label: "bench_purchase_settlements",
  admin: ADMIN,
  env: {
    CERTIFICATE_CUSTODY: "enabled",
    // Clave de custodia efímera de esta ejecución; nunca se imprime ni se guarda.
    CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
    EMISSION_STAGE_TIMINGS: "1",
    LOGIN_IP_MAX_REQUESTS: "100",
    // Los máximos absolutos, para medir también el peor caso que admite el contrato.
    PURCHASE_SETTLEMENT_MAX_LINES: String(MAX_LIMITS.lines),
    PURCHASE_SETTLEMENT_MAX_PAYMENTS: String(MAX_LIMITS.payments),
    // Sin el barrido del RIDE: el RIDE se mide aparte en su pool.
    RIDE_SWEEP_INTERVAL_SECONDS: "86400",
  },
});
try {
  console.log("Preparando la empresa por la API…");
  const data = await prepare(backend, p12Dir);
  const prisma = backend.db.database.prisma;
  const pid = backendPid(backend);

  console.log(`Sembrando ${PARTIES} terceros y ${PRODUCTS} productos…`);
  const seedStarted = performance.now();
  await seedCatalog(backend);

  console.log("Emitiendo la liquidación de plantilla…");
  const template = await emit(
    backend,
    data.cookie,
    await draftFor(backend, data.cookie, simpleBody(data, 0)),
  );

  console.log(`Sembrando ${SETTLEMENTS} liquidaciones autorizadas…`);
  await seedSettlements(backend, data, template.id);
  const seedSeconds = Math.round((performance.now() - seedStarted) / 100) / 10;
  const volumeBefore = await volume(backend);
  const before = await untouched(backend);

  const cookie = data.operators[0]!;
  const results: {
    name: string;
    path: string;
    results: number | null;
    p50: number;
    p95: number;
    max: number;
    budgetMs: number;
    withinBudget: boolean;
  }[] = [];
  const record = (
    name: string,
    path: string,
    timing: { results: number | null; p50: number; p95: number; max: number },
    budgetMs = BUDGET_MS,
  ) => {
    results.push({ name, path, ...timing, budgetMs, withinBudget: timing.p95 < budgetMs });
    console.log(`${name}: P50 ${timing.p50} ms, P95 ${timing.p95} ms, máx. ${timing.max} ms`);
  };

  const someSupplier = cedulaOf(SUPPLIER_EVERY * 617);
  for (const [name, path] of [
    ["Proveedores: primera página, sin filtro", "/purchase-settlements/suppliers"],
    [
      "Proveedores: búsqueda por identificación",
      `/purchase-settlements/suppliers?search=${someSupplier}`,
    ],
    [
      "Proveedores: búsqueda por nombre (todos coinciden)",
      "/purchase-settlements/suppliers?search=proveedor",
    ],
    ["Productos activos: primera página", "/products?status=ACTIVE"],
    ["Productos activos: búsqueda por código", "/products?status=ACTIVE&search=P001234"],
    ["Opciones del borrador", "/purchase-settlements/options"],
  ] as const) {
    record(name, path, await measureGet(backend, cookie, path));
  }

  for (const count of [DEFAULT_LIMITS.lines, MAX_LIMITS.lines]) {
    record(
      `Cálculo versionado de ${count} líneas (en el proceso)`,
      "calculatePurchaseSettlementAmounts",
      measureCalculation(count),
    );
  }

  // Borradores del peor caso: creación (con su vista previa), relectura y emisión.
  const heavy: Record<string, unknown> = {};
  const memoryBaseline = processUsage(pid);
  for (const [label, limits] of [
    ["valores por defecto", DEFAULT_LIMITS],
    ["máximos absolutos", MAX_LIMITS],
  ] as const) {
    const body = worstBody(limits, data);
    const sentBody = bodyBytes(body);
    if (sentBody > DRAFT_BODY_LIMIT_BYTES) {
      throw new Error(`el peor caso (${label}) no cabe en el cuerpo del borrador: ${sentBody} B`);
    }
    const shape = `${limits.lines} líneas y ${limits.payments} pagos, textos multibyte de longitud máxima`;
    const createSamples: number[] = [];
    let draft: Draft = { id: "", version: 0 };
    const usageBefore = processUsage(pid);
    for (let i = 0; i < WARMUP + HEAVY_SAMPLES; i += 1) {
      const started = performance.now();
      draft = await draftFor(backend, cookie, body);
      if (i >= WARMUP) createSamples.push(performance.now() - started);
    }
    record(
      `Creación del borrador del peor caso (${label}: ${shape})`,
      "POST /purchase-settlements/drafts",
      { results: HEAVY_SAMPLES, ...summarize(createSamples) },
    );
    const preview = await measureGet(
      backend,
      cookie,
      `/purchase-settlements/drafts/${draft.id}`,
      HEAVY_SAMPLES * 2,
    );
    record(
      `Vista previa del borrador del peor caso (${label})`,
      "/purchase-settlements/drafts/{id}",
      preview,
    );
    const afterPreview = processUsage(pid);
    const emissions: Emission[] = [];
    let largest = { id: "", bytes: 0 };
    for (let i = 0; i < 1 + HEAVY_SAMPLES / 2; i += 1) {
      const emission = await emit(backend, cookie, await draftFor(backend, cookie, body));
      if (i >= 1) emissions.push(emission);
      const bytes = await signedSize(backend, emission.id);
      if (bytes > largest.bytes) largest = { id: emission.id, bytes };
    }
    const afterEmission = processUsage(pid);
    const summary = emissionSummary(emissions);
    record(`Emisión del peor caso (${label}): total del servidor`, "POST /purchase-settlements", {
      results: emissions.length,
      ...summary.stages.total,
    });
    record(`Emisión del peor caso (${label}): transacción de la reserva`, "reservation_tx", {
      results: emissions.length,
      ...summary.stages.reservation_tx,
    });
    const requests = WARMUP + HEAVY_SAMPLES + WARMUP + HEAVY_SAMPLES * 2 + 1;
    heavy[label] = {
      shape,
      lines: limits.lines,
      payments: limits.payments,
      bodyBytes: sentBody,
      signedXmlBytes: largest.bytes,
      signedXmlKiB: round(largest.bytes / 1024),
      largestId: largest.id,
      stages: summary.stages,
      client: summary.client,
      backend: {
        cpuMsPerDraftRequest: round((afterPreview.cpuMs - usageBefore.cpuMs) / requests),
        cpuMsPerDraftAndEmission: round(
          (afterEmission.cpuMs - afterPreview.cpuMs) / (1 + HEAVY_SAMPLES / 2),
        ),
        rssBeforeMiB: usageBefore.rssMiB,
        rssMiB: afterEmission.rssMiB,
        peakRssMiB: afterEmission.peakMiB,
      },
    };
    console.log(
      `Peor caso (${label}): cuerpo ${round(sentBody / 1024)} KiB; XML firmado ${round(largest.bytes / 1024)} KiB (medición, sin relación con Q-47); memoria máxima del backend ${afterEmission.peakMiB} MiB`,
    );
  }

  console.log("Emitiendo en serie…");
  const serial = await measureSerialEmissions(backend, data);
  record("Emisión con reserva: total del servidor", "POST /purchase-settlements", {
    results: SAMPLES,
    ...serial.stages.total,
  });
  record("Emisión con reserva: transacción de la reserva", "reservation_tx", {
    results: SAMPLES,
    ...serial.stages.reservation_tx,
  });

  console.log("Emisiones simultáneas a proveedores distintos…");
  const distinctSuppliers = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) =>
      Array.from({ length: CONTENDERS }, (_, c) => 4_000 + r * CONTENDERS + c),
    ),
  );
  console.log("Emisiones simultáneas al mismo proveedor…");
  const sameSupplier = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) => Array.from({ length: CONTENDERS }, () => 3_000 + r)),
  );
  const baseline = serial.stages.reservation_tx.p50;
  const contention = [
    ["Proveedores distintos", distinctSuppliers],
    ["El mismo proveedor", sameSupplier],
  ] as const;
  for (const [name, summary] of contention) {
    record(`${name}, ${CONTENDERS} simultáneas: total del servidor`, "POST /purchase-settlements", {
      results: ROUNDS * CONTENDERS,
      ...summary.stages.total,
    });
    record(`${name}, ${CONTENDERS} simultáneas: transacción de la reserva`, "reservation_tx", {
      results: ROUNDS * CONTENDERS,
      ...summary.stages.reservation_tx,
    });
    console.log(
      `${name}: ${summary.reservationsPerSecond} reservas/s; espera por bloqueos P95 ≈ ${round(summary.stages.reservation_tx.p95 - baseline)} ms`,
    );
  }

  for (const [name, path] of [
    ["Liquidaciones: primera página, sin filtro", "/purchase-settlements"],
    ["Liquidaciones: búsqueda por número", "/purchase-settlements?search=000054321"],
    [
      "Liquidaciones: búsqueda por identificación del proveedor",
      `/purchase-settlements?search=${someSupplier}`,
    ],
    [
      "Liquidaciones: búsqueda por nombre del proveedor",
      "/purchase-settlements?search=PROVEEDOR%20DEL%20BENCHMARK%2001234",
    ],
    ["Liquidaciones: filtro por estado", "/purchase-settlements?state=AUTHORIZED"],
    [
      "Bandeja: liquidaciones filtradas por identificación del proveedor",
      `/documents?documentType=03&identification=${someSupplier}`,
    ],
  ] as const) {
    record(name, path, await measureGet(backend, cookie, path));
  }

  console.log("Renderizando el RIDE…");
  const largestId = (heavy["máximos absolutos"] as { largestId: string }).largestId;
  const [rideOne, rideMax] = await measureRide(backend, [template.id, largestId]);
  record("Render del RIDE de una liquidación (worker)", "RideWorkerPool", rideOne!, RIDE_BUDGET_MS);
  record(
    `Render del RIDE del máximo de líneas (${MAX_LIMITS.lines} líneas, ${rideMax!.pages} páginas)`,
    "RideWorkerPool",
    rideMax!,
    RIDE_BUDGET_MS,
  );

  // Las liquidaciones no tocan el inventario, las retenciones, los terceros ni los productos.
  const after = await untouched(backend);
  const independent = (Object.keys(before) as (keyof typeof before)[]).every(
    (key) => before[key] === after[key],
  );
  const emitted = await prisma.electronicDocument.count({ where: { documentType: "03" } });
  const env = await environment(backend);
  const volumeAfter = await volume(backend);
  const date = TODAY;
  const contentionReport = Object.fromEntries(
    contention.map(([name, summary]) => [
      name,
      {
        concurrent: CONTENDERS,
        rounds: ROUNDS,
        reservationsPerSecond: summary.reservationsPerSecond,
        reservationTx: summary.stages.reservation_tx,
        lockWaitP95Ms: round(Math.max(0, summary.stages.reservation_tx.p95 - baseline)),
        stages: summary.stages,
        client: summary.client,
      },
    ]),
  );
  const maxSigned = Math.max(
    ...Object.values(heavy).map((entry) => (entry as { signedXmlBytes: number }).signedXmlBytes),
  );
  const report = {
    date,
    volume: {
      parties: PARTIES,
      suppliers: PARTIES / SUPPLIER_EVERY,
      products: PRODUCTS,
      settlements: SETTLEMENTS,
      seedSeconds,
      before: volumeBefore,
      after: volumeAfter,
    },
    warmup: WARMUP,
    samples: SAMPLES,
    budgetMs: BUDGET_MS,
    rideBudgetMs: RIDE_BUDGET_MS,
    limits: { default: DEFAULT_LIMITS, absolute: MAX_LIMITS },
    draftBodyLimitBytes: DRAFT_BODY_LIMIT_BYTES,
    backendBaseline: { rssMiB: memoryBaseline.rssMiB, peakRssMiB: memoryBaseline.peakMiB },
    environment: env,
    results,
    worstCase: heavy,
    signedXmlMaxBytes: maxSigned,
    signedXmlNote:
      "Medición de recursos del peor caso; sin relación con Q-47 ni con ningún límite del SRI.",
    serialEmissions: serial,
    contention: contentionReport,
    independence: {
      emitted,
      stockMovements: { before: before.stockMovements, after: after.stockMovements },
      stockBalancesUnchanged: before.stockBalances === after.stockBalances,
      withholdings: { before: before.withholdings, after: after.withholdings },
      partiesUnchanged: before.parties === after.parties,
      productsUnchanged: before.products === after.products,
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    `${OUT_DIR}purchase-settlements-${date}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const passed = results.every((r) => r.withinBudget) && independent;
  const worst = Object.entries(heavy) as [
    string,
    {
      shape: string;
      lines: number;
      payments: number;
      bodyBytes: number;
      signedXmlKiB: number;
      stages: Record<Stage, { p95: number }>;
      backend: {
        cpuMsPerDraftRequest: number;
        cpuMsPerDraftAndEmission: number;
        rssBeforeMiB: number;
        rssMiB: number;
        peakRssMiB: number;
      };
    },
  ][];
  const yes = (value: boolean) => (value ? "sin cambios" : "**cambiaron**");
  writeFileSync(
    `${OUT_DIR}purchase-settlements-${date}.md`,
    [
      `# Benchmark de las liquidaciones de compra (${date})`,
      "",
      `Volumen: ${PARTIES} terceros (${PARTIES / SUPPLIER_EVERY} con el rol SUPPLIER, con cédula o pasaporte), ${PRODUCTS} productos y ${SETTLEMENTS} liquidaciones AUTHORIZED con su registro y sus cuatro declaraciones, en una empresa (volumen de Q-26). Siembra por SQL en ${seedSeconds} s, seguida de \`VACUUM (ANALYZE)\` y un \`CHECKPOINT\` para que las escrituras diferidas de la carga masiva no caigan sobre las mediciones. Calentamiento de ${WARMUP} y ${SAMPLES} mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra \`main.ts\`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con ${HEAVY_SAMPLES} muestras; la contención son ${ROUNDS} rondas de ${CONTENDERS} emisiones simultáneas; el cálculo, ${CALCULATION_SAMPLES} ejecuciones en el proceso. El RIDE se mide en \`RideWorkerPool\` con 2 workers. Objetivos: ERS RNF-005, P95 menor que ${BUDGET_MS} ms, y el P95 del render del RIDE menor que ${RIDE_BUDGET_MS} ms (design D27 de \`add-purchase-settlements\`). Las respuestas del SRI no participan. Generado por \`bench:purchase-settlements\`; datos en \`purchase-settlements-${date}.json\`.`,
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
      ...Object.entries(volumeBefore).map(
        ([table, row]) => `| \`${table}\` | ${row.rows} | ${row.totalSize} |`,
      ),
      "",
      "## Resultados",
      "",
      "| Operación | Ruta o etapa | Resultados | P50 (ms) | P95 (ms) | Máx. (ms) | Objetivo (ms) | Dentro del objetivo |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...results.map(
        (r) =>
          `| ${r.name} | \`${r.path}\` | ${r.results ?? "—"} | ${r.p50} | ${r.p95} | ${r.max} | ${r.budgetMs} | ${r.withinBudget ? "Sí" : "No"} |`,
      ),
      "",
      "## Etapas de la emisión en serie (P95, ms)",
      "",
      `| ${STAGES.map((stage) => `\`${stage}\``).join(" | ")} | Cliente |`,
      `| ${STAGES.map(() => "---").join(" | ")} | --- |`,
      `| ${STAGES.map((stage) => serial.stages[stage].p95).join(" | ")} | ${serial.client.p95} |`,
      "",
      "## Peor caso y límites de recursos (design D22)",
      "",
      "| Caso | Forma | Cuerpo del borrador (KiB) | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...worst.map(
        ([label, entry]) =>
          `| ${label} | ${entry.shape} | ${round(entry.bodyBytes / 1024)} | ${entry.stages.reservation_tx.p95} | ${entry.stages.xml.p95} | ${entry.stages.xsd.p95} | ${entry.stages.sign.p95} | ${entry.stages.total.p95} | ${entry.backend.cpuMsPerDraftRequest} | ${entry.backend.cpuMsPerDraftAndEmission} | ${entry.backend.rssBeforeMiB} → ${entry.backend.rssMiB} | ${entry.backend.peakRssMiB} | ${entry.signedXmlKiB} |`,
      ),
      "",
      `- El peor caso usa el proveedor con nombre y dirección de 300 caracteres, y en cada línea códigos de 25, descripción de 300 y unidad de 50 caracteres multibyte (de 2 y 3 bytes en UTF-8, con glifo en las fuentes del RIDE), cantidad y precio con 6 decimales y la mitad de las líneas al 15 %; los pagos llevan la unidad de tiempo de 10 caracteres y el plazo más largo, y suman exactamente el importe total. Todos los cuerpos caben en el límite de ${DRAFT_BODY_LIMIT_BYTES / 1024 / 1024} MiB de la ruta del borrador (design D22).`,
      `- El tamaño del XML firmado del peor caso (${maxSigned} bytes como máximo) es **solo una medición de recursos**: no interpreta ni cumple el "320 Kb" de la ficha y no tiene relación con Q-47, que sigue abierta; la transmisión real sigue cerrada hasta resolverla.`,
      `- Los límites (100 líneas y 10 pagos por defecto; 500 y 20 como máximos absolutos) son una defensa de recursos del sistema, no límites del SRI ni del XSD. La memoria es la residente del proceso del backend (incluye sus pools de firma, de validación y del RIDE); antes del peor caso era de ${memoryBaseline.rssMiB} MiB, y la máxima es la de toda la ejecución hasta ese punto.`,
      "",
      "## Contención",
      "",
      "| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...contention.map(
        ([name, summary]) =>
          `| ${name} | ${CONTENDERS} | ${summary.reservationsPerSecond} | ${summary.stages.reservation_tx.p50} | ${summary.stages.reservation_tx.p95} | ${round(Math.max(0, summary.stages.reservation_tx.p95 - baseline))} | ${summary.stages.total.p95} |`,
      ),
      "",
      `- La espera por bloqueos es lo que el P95 de \`reservation_tx\` supera a su mediana en serie (${baseline} ms), que no espera a nadie. La liquidación no reserva capacidad del proveedor ni de los productos: las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos.`,
      "- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.",
      "",
      `Independencia al terminar: ${emitted} liquidaciones; movimientos de inventario ${before.stockMovements} → ${after.stockMovements}; saldos de inventario ${yes(before.stockBalances === after.stockBalances)}; comprobantes de retención ${before.withholdings} → ${after.withholdings}; terceros ${yes(before.parties === after.parties)}; productos ${yes(before.products === after.products)}.`,
      "",
      passed
        ? "Todas las operaciones cumplen su objetivo en este entorno y las liquidaciones no tocan el inventario, las retenciones, los terceros ni los productos."
        : "Al menos una operación supera su objetivo o las liquidaciones tocaron el inventario, las retenciones, los terceros o los productos: analizar antes de cambiar índices, límites o estrategia (`/opsx:update`).",
      "",
    ].join("\n"),
  );
  console.log(
    `XML firmado del peor caso: ${maxSigned} bytes (medición de recursos, sin relación con Q-47).`,
  );
  console.log(passed ? "Benchmark dentro del objetivo." : "Benchmark fuera del objetivo.");
  process.exitCode = passed ? 0 : 1;
} finally {
  await backend.stop();
  rmSync(p12Dir, { recursive: true, force: true });
}
