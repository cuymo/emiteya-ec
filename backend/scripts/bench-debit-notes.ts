// Benchmark de las notas de débito (add-debit-notes, design D25). Es un gate dedicado: no forma parte
// de `verify` ni de la suite de pruebas, para que el tiempo de un runner compartido no la vuelva
// inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:debit-notes
//
// Arranca main.ts con EMISSION_STAGE_TIMINGS=1 y la custodia habilitada sobre un esquema aislado de
// la base de pruebas, con la transmisión apagada (las notas quedan SIGNED). Prepara por la API la
// empresa, su punto, la firma sintética, 100 productos y 10 operadores. Siembra por SQL 100 000
// facturas AUTHORIZED de 5 líneas en dos tratamientos de IVA (15 % y 0 %), con su snapshot real, su
// clave, su autorización y sus XML firmado y autorizado sintéticos (con su huella); después,
// ANALYZE. Mide por separado, desde el cliente HTTP:
//
// - la búsqueda de facturas elegibles (sin filtro, por número y por comprador);
// - la vista previa de un borrador de 1 concepto y de uno de 100 conceptos en dos tratamientos;
// - el cálculo de 100 conceptos de un tratamiento y de 100 de varios, en proceso con el algoritmo
//   único;
// - la emisión con su reserva, con las etapas de `Server-Timing` (`reservation_tx` aparte del XML,
//   el XSD y la firma);
// - reservas simultáneas de una misma factura y de facturas distintas, con el rendimiento (reservas
//   por segundo) y la espera por bloqueos;
// - el render del RIDE de la nota en `RideWorkerPool`.
//
// Termina comprobando que las notas no tocaron la capacidad acreditable ni el inventario de las
// facturas, escribe el entorno y los resultados en docs/quality/benchmarks/ y sale con error si algún
// P95 supera ERS RNF-005 (2 s), si el P95 del render del RIDE supera 1 s o si las notas tocaron la
// capacidad o el inventario. Los objetivos no se suben para hacerlo pasar: un fallo se analiza y se
// propone con /opsx:update.
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem, type } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { calculateDebitNoteAmounts } from "../src/modules/debit-notes/domain/amounts.ts";
import type { InvoiceTaxTreatment } from "../src/modules/debit-notes/domain/treatments.ts";
import {
  createPooledRideRenderer,
  rideTasksEntry,
} from "../src/modules/sri-engine/infrastructure/ride/pooled-ride-renderer.ts";
import { defaultRideFontsDirectory } from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { createRideWorkerPool } from "../src/platform/workers/ride-worker-pool.ts";
import {
  insertAuthorizedInvoice,
  invoiceSnapshot,
  type InvoiceLineSpec,
} from "../test/integration/credit-notes-harness.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";
import {
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  generateP12Fixtures,
  readFixture,
} from "../test/support/p12-fixtures.ts";

const INVOICES = 100_000;
const PRODUCTS = 100;
const USERS = 10;
const LINES = 5;
const MANY_CONCEPTS = 100;
const WARMUP = 10;
const SAMPLES = 100;
const CALC_SAMPLES = 1_000;
/** Reservas simultáneas por ronda y rondas, en la misma factura y en facturas distintas. */
const CONTENDERS = 10;
const ROUNDS = 10;
const RIDE_WARMUP = 10;
const RIDE_SAMPLES = 50;
/** ERS RNF-005: P95 menor que 2 s. */
const BUDGET_MS = 2_000;
/** Como el RIDE de la factura: P95 del render menor que 1 s. */
const RIDE_BUDGET_MS = 1_000;
const BATCH = 10_000;
/** La factura de plantilla tiene el secuencial 1 de su contador: lo sembrado sigue. */
const FIRST = 2;
const LAST_INVOICE = INVOICES + FIRST - 1;
const seededInvoice = (sequential: number) => `bench-inv-${sequential}`;
const ADMIN = { email: "admin@benchmark.ec", password: "contrasena-benchmark-1" };
const OPERATOR_PASSWORD = "contrasena-operador-1";
const DECLARATIONS = { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] };
const PAYMENT_METHOD = "20";
const STAGES = ["reservation_tx", "xml", "xsd", "sign", "persist", "total"] as const;
type Stage = (typeof STAGES)[number];
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));

type Json = Record<string, unknown>;
type Concept = { cause: string; description: string; amount: string; taxTreatment: string };

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
    legalName: "COMERCIAL ANDINA S.A.",
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
  const products: string[] = [];
  for (let i = 1; i <= PRODUCTS; i += 1) {
    const product = await call(backend, cookie, "POST", "/products", {
      kind: "GOOD",
      mainCode: `P${String(i).padStart(4, "0")}`,
      name: `Producto de la nota ${i}`,
      unitPrice: "10.00",
      taxes: { iva: i % 5 === 0 ? "0" : "4" },
    });
    products.push(String(product.id));
  }
  const operators: string[] = [];
  for (let i = 1; i <= USERS; i += 1) {
    const email = `operador${i}@benchmark.ec`;
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
    products,
    operators,
  };
}

type Prepared = Awaited<ReturnType<typeof prepare>>;

/** Cinco líneas: cuatro con IVA 15 % y la quinta con IVA 0 %, dos tratamientos. */
const fiveLines = (products: readonly string[]): InvoiceLineSpec[] =>
  Array.from({ length: LINES }, (_, k) => ({
    productId: products[k]!,
    quantity: "10",
    unitPrice: `${12 + k}.35`,
    discount: k === 1 ? "1.10" : "0",
    rate: k === 4 ? { taxCode: "2", rateCode: "0", percentage: "0" } : undefined,
  }));

/** 100 000 facturas AUTHORIZED por SQL con el snapshot real de 5 líneas y su autorización. */
async function seed(backend: E2eBackend, data: Prepared) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const draft = invoiceSnapshot(fiveLines(data.products));
  const total = draft.totals.total;

  for (let from = FIRST; from <= LAST_INVOICE; from += BATCH) {
    const to = Math.min(LAST_INVOICE, from + BATCH - 1);
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
           SELECT 'bench-res-01-' || g, $1, 'TEST', $2, $3, '01', g, now() - ((${LAST_INVOICE} - g + 2) * interval '5 minutes'), $4, 'bench-seed'
           FROM generate_series(${from}, ${to}) g`,
          company,
          data.establishmentId,
          data.pointId,
          user,
        );
        // La clave del snapshot es la del comprobante: '01' y el secuencial, única por factura.
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, authorization_number, authorization_date, authorization_environment, attempt_count)
           SELECT 'bench-inv-' || r.sequential, r.company_id, '01', 'TEST', r.establishment_id, r.emission_point_id,
                  '001-001-' || lpad(r.sequential::text, 9, '0'), r.sequential, r.id,
                  '01' || lpad(r.sequential::text, 47, '0'), '12345678', r.reserved_at::date, 'AUTHORIZED',
                  $1::jsonb || jsonb_build_object('key', jsonb_build_object(
                    'documentNumber', '001-001-' || lpad(r.sequential::text, 9, '0'),
                    'sequential', lpad(r.sequential::text, 9, '0'), 'numericCode', '12345678',
                    'emissionType', '1', 'accessKey', '01' || lpad(r.sequential::text, 47, '0'))),
                  '1.1.0', $2, $3, $4::numeric, r.reserved_at, $5, r.reserved_at + interval '1 second',
                  '01' || lpad(r.sequential::text, 47, '0'), r.reserved_at + interval '1 minute', 'TEST', 1
           FROM ${t("fiscal_sequence_reservation")} r
           WHERE r.company_id = $6 AND r.document_type = '01' AND r.sequential BETWEEN ${from} AND ${to}`,
          JSON.stringify(draft),
          draft.buyer.identification,
          draft.buyer.legalName,
          total,
          user,
          company,
        );
        // XML firmado y autorizado sintéticos con la clave del comprobante y su huella.
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_artifact")} (id, company_id, document_id, kind, media_type, content, size_bytes, sha256, metadata, created_at)
           SELECT gen_random_uuid()::text, d.company_id, d.id, k.kind, 'application/xml', c.content, octet_length(c.content),
                  encode(sha256(c.content), 'hex'), '{"documentType": "01", "schemaVersion": "1.1.0"}'::jsonb, d.signed_at
           FROM ${t("electronic_document")} d
           CROSS JOIN (VALUES ('SIGNED_XML'), ('AUTHORIZED_XML')) k(kind)
           CROSS JOIN LATERAL (SELECT convert_to('<factura id="comprobante" version="1.1.0"><infoTributaria><claveAcceso>' || d.access_key || '</claveAcceso></infoTributaria></factura>', 'UTF8') AS content) c
           WHERE d.company_id = $1 AND d.document_type = '01' AND d.sequential BETWEEN ${from} AND ${to}`,
          company,
        );
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  }
  // El contador de facturas sigue después de lo sembrado.
  await prisma.$executeRawUnsafe(
    `UPDATE ${t("fiscal_sequence")} SET next_number = ${LAST_INVOICE + 1}, last_reserved = ${LAST_INVOICE}
     WHERE company_id = $1 AND document_type = '01'`,
    company,
  );
  for (const table of [
    "fiscal_sequence",
    "fiscal_sequence_reservation",
    "electronic_document",
    "document_artifact",
    "debit_note_support",
  ]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${t(table)}`);
  }
  return { company, user, total };
}

async function volume(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const result: Record<string, { rows: number; totalSize: string }> = {};
  for (const table of [
    "electronic_document",
    "document_artifact",
    "debit_note_support",
    "debit_note_draft",
    "debit_note_draft_concept",
  ]) {
    const [row] = await prisma.$queryRawUnsafe<{ rows: bigint; size: string }[]>(
      `SELECT count(*) AS rows, pg_size_pretty(pg_total_relation_size('"${s}"."${table}"')) AS size FROM "${s}"."${table}"`,
    );
    result[table] = { rows: Number(row!.rows), totalSize: row!.size };
  }
  return result;
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

/** Un concepto de intereses de mora en el tratamiento dado. */
const concept = (amount: string, taxTreatment: string): Concept => ({
  cause: "LATE_PAYMENT_INTEREST",
  description: "Intereses de mora del benchmark",
  amount,
  taxTreatment,
});

async function draftFor(
  backend: E2eBackend,
  cookie: string,
  pointId: string,
  invoiceId: string,
  concepts: readonly Concept[],
) {
  const draft = await call(backend, cookie, "POST", "/debit-notes/drafts", {
    invoiceId,
    emissionPointId: pointId,
    paymentMethod: PAYMENT_METHOD,
    concepts,
  });
  const issues = (draft.preview as { issues: unknown[] }).issues;
  if (issues.length > 0) throw new Error(`borrador con problemas: ${JSON.stringify(issues)}`);
  return { id: String(draft.id), version: Number(draft.version) };
}

type Emission = {
  status: number;
  id: string | null;
  clientMs: number;
  stages: Partial<Record<Stage, number>>;
};

async function emit(
  backend: E2eBackend,
  cookie: string,
  draft: { id: string; version: number },
): Promise<Emission> {
  const started = performance.now();
  const res = await fetch(`${backend.base}/api/v1/debit-notes`, {
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
  return { status: res.status, id: body.data.id, clientMs, stages };
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

/** Emisiones en serie de una nota de 2 conceptos en tratamientos distintos sobre facturas distintas. */
async function measureSerialEmissions(
  backend: E2eBackend,
  data: Prepared,
  invoices: readonly string[],
) {
  const emissions: Emission[] = [];
  for (const [index, invoiceId] of invoices.entries()) {
    const cookie = data.operators[index % data.operators.length]!;
    const draft = await draftFor(backend, cookie, data.pointId, invoiceId, [
      concept("20.00", "2:4"),
      concept("5.50", "2:0"),
    ]);
    const emission = await emit(backend, cookie, draft);
    if (index >= WARMUP) emissions.push(emission);
  }
  return emissionSummary(emissions);
}

/**
 * Rondas de `CONTENDERS` emisiones simultáneas, cada una de un operador con su borrador ya guardado.
 * Rendimiento: reservas confirmadas por segundo de reloj de cada ronda. Espera por bloqueos: lo que
 * `reservation_tx` supera a la de la emisión en serie, que no espera a nadie.
 */
async function measureConcurrentEmissions(
  backend: E2eBackend,
  data: Prepared,
  rounds: readonly (readonly string[])[],
) {
  const emissions: Emission[] = [];
  const throughput: number[] = [];
  for (const invoiceIds of rounds) {
    const drafts = [];
    for (const [index, invoiceId] of invoiceIds.entries()) {
      drafts.push(
        await draftFor(
          backend,
          data.operators[index % data.operators.length]!,
          data.pointId,
          invoiceId,
          [concept("3.10", "2:4")],
        ),
      );
    }
    const started = performance.now();
    const results = await Promise.all(
      drafts.map((draft, index) =>
        emit(backend, data.operators[index % data.operators.length]!, draft),
      ),
    );
    const seconds = (performance.now() - started) / 1000;
    throughput.push(results.length / seconds);
    emissions.push(...results);
  }
  return {
    ...emissionSummary(emissions),
    reservationsPerSecond: round(
      throughput.reduce((sum, value) => sum + value, 0) / throughput.length,
    ),
  };
}

const treatment = (rateCode: string, percentage: string): InvoiceTaxTreatment => ({
  key: `2:${rateCode}`,
  taxCode: "2",
  rateCode,
  percentage,
  catalogType: "iva-rate",
  entryKey: rateCode,
  versionId: `iva-${rateCode}`,
  officialLabel: `${percentage}%`,
});

/** El cálculo único de 100 conceptos, en un tratamiento o repartidos en varios. */
function measureCalculation(treatments: readonly InvoiceTaxTreatment[]) {
  const concepts = Array.from({ length: MANY_CONCEPTS }, (_, k) => ({
    position: k + 1,
    amount: `${(k % 97) + 1}.${String((k * 37) % 100).padStart(2, "0")}`,
    taxTreatment: treatments[k % treatments.length]!.key,
  }));
  const input = { concepts, treatments };
  for (let i = 0; i < WARMUP * 10; i += 1) calculateDebitNoteAmounts(input);
  const samples: number[] = [];
  for (let i = 0; i < CALC_SAMPLES; i += 1) {
    const started = performance.now();
    const result = calculateDebitNoteAmounts(input);
    samples.push(performance.now() - started);
    if (result.taxes.length !== treatments.length) throw new Error("cálculo inesperado");
  }
  return { results: MANY_CONCEPTS, ...summarize(samples) };
}

/** Render del RIDE de una nota firmada en `RideWorkerPool`, con su duración en el worker. */
async function measureRide(backend: E2eBackend, company: string, noteId: string) {
  const prisma = backend.db.database.prisma;
  const note = await prisma.electronicDocument.findUniqueOrThrow({ where: { id: noteId } });
  const signed = await prisma.documentArtifact.findFirstOrThrow({
    where: { companyId: company, documentId: noteId, kind: "SIGNED_XML" },
  });
  // La denominación de la forma de pago sale del snapshot, como en el handler del RIDE.
  const payments = (note.snapshot as { payments: { code: string; officialLabel: string }[] })
    .payments;
  const pool = createRideWorkerPool({
    entry: rideTasksEntry(),
    size: 2,
    maxQueue: 4,
    timeoutMs: 30_000,
    fontsDirectory: defaultRideFontsDirectory(),
  });
  try {
    const renderer = createPooledRideRenderer(pool);
    const input = {
      xml: new Uint8Array(signed.content),
      accessKey: note.accessKey,
      authorization: {
        number: note.accessKey,
        authorizedAt: new Date(),
        environment: "TEST" as const,
      },
      paymentLabels: Object.fromEntries(payments.map((p) => [p.code, p.officialLabel])),
      logo: null,
    };
    const samples: number[] = [];
    let pages = 0;
    for (let i = 0; i < RIDE_WARMUP + RIDE_SAMPLES; i += 1) {
      const outcome = await renderer.render(input);
      if (outcome.status !== "RENDERED") {
        throw new Error(`el RIDE de la nota se rechazó: ${outcome.code}`);
      }
      pages = outcome.pages;
      if (i >= RIDE_WARMUP) samples.push(outcome.renderMs);
    }
    return { results: RIDE_SAMPLES, pages, ...summarize(samples) };
  } finally {
    await pool.close();
  }
}

const p12Dir = mkdtempSync(join(tmpdir(), "bench-debit-notes-p12-"));
generateP12Fixtures(p12Dir);
const backend = await startE2eBackend({
  label: "bench_debit_notes",
  admin: ADMIN,
  env: {
    CERTIFICATE_CUSTODY: "enabled",
    // Clave de custodia efímera de esta ejecución; nunca se imprime ni se guarda.
    CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
    EMISSION_STAGE_TIMINGS: "1",
    LOGIN_IP_MAX_REQUESTS: "100",
    // Sin el barrido del RIDE: encolaría el RIDE de las 100 000 facturas sembradas durante la
    // medición y retrasaría el apagado. El RIDE de la nota se mide aparte en su pool.
    RIDE_SWEEP_INTERVAL_SECONDS: "86400",
  },
});
try {
  console.log("Preparando la empresa por la API…");
  const data = await prepare(backend, p12Dir);
  const prisma = backend.db.database.prisma;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const admin = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const harnessCompany = {
    companyId: company,
    adminId: admin,
    establishmentId: data.establishmentId,
    emissionPointId: data.pointId,
  };
  // Los contadores del punto existen antes de sembrar: la factura y la nota de plantilla los crean.
  console.log("Emitiendo la nota de plantilla…");
  const templateInvoice = await insertAuthorizedInvoice(
    prisma,
    harnessCompany,
    fiveLines(data.products),
  );
  const template = await draftFor(backend, data.cookie, data.pointId, templateInvoice.id, [
    concept("20.00", "2:4"),
    concept("5.50", "2:0"),
  ]);
  const templateNote = await emit(backend, data.cookie, template);

  console.log(`Sembrando ${INVOICES} facturas autorizadas de ${LINES} líneas…`);
  const seedStarted = performance.now();
  const seeded = await seed(backend, data);
  const seedSeconds = Math.round((performance.now() - seedStarted) / 100) / 10;
  const volumeBefore = await volume(backend);
  const creditCapacityBefore = await prisma.creditCapacity.count();
  const stockMovementsBefore = await prisma.stockMovement.count();

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

  for (const [name, path] of [
    ["Facturas elegibles: primera página, sin filtro", "/debit-notes/eligible-invoices"],
    ["Facturas elegibles: búsqueda por número", "/debit-notes/eligible-invoices?search=000054321"],
    [
      "Facturas elegibles: búsqueda por comprador (todas coinciden)",
      "/debit-notes/eligible-invoices?search=perno",
    ],
  ] as const) {
    record(name, path, await measureGet(backend, cookie, path));
  }

  const oneConcept = await draftFor(backend, cookie, data.pointId, seededInvoice(LAST_INVOICE), [
    concept("12.40", "2:4"),
  ]);
  const manyConcepts = await draftFor(
    backend,
    cookie,
    data.pointId,
    seededInvoice(LAST_INVOICE - 1),
    Array.from({ length: MANY_CONCEPTS }, (_, k) =>
      concept(`${(k % 50) + 1}.${String(k % 100).padStart(2, "0")}`, k % 2 === 0 ? "2:4" : "2:0"),
    ),
  );
  for (const [name, id] of [
    ["Vista previa del borrador de 1 concepto", oneConcept.id],
    [
      `Vista previa del borrador de ${MANY_CONCEPTS} conceptos en dos tratamientos`,
      manyConcepts.id,
    ],
  ] as const) {
    record(
      name,
      "/debit-notes/drafts/{id}",
      await measureGet(backend, cookie, `/debit-notes/drafts/${id}`),
    );
  }

  record(
    `Cálculo de ${MANY_CONCEPTS} conceptos de un tratamiento (en proceso)`,
    "calculateDebitNoteAmounts",
    measureCalculation([treatment("4", "15")]),
  );
  record(
    `Cálculo de ${MANY_CONCEPTS} conceptos en cinco tratamientos (en proceso)`,
    "calculateDebitNoteAmounts",
    measureCalculation([
      treatment("0", "0"),
      treatment("2", "12"),
      treatment("4", "15"),
      treatment("5", "5"),
      treatment("10", "13"),
    ]),
  );

  // Emisión en serie sobre facturas distintas.
  const serialInvoices = Array.from({ length: WARMUP + SAMPLES }, (_, k) =>
    seededInvoice(LAST_INVOICE - 2 - k),
  );
  console.log("Emitiendo en serie…");
  const serial = await measureSerialEmissions(backend, data, serialInvoices);
  record("Emisión con reserva: total del servidor", "POST /debit-notes", {
    results: SAMPLES,
    ...serial.stages.total,
  });
  record("Emisión con reserva: transacción de la reserva", "reservation_tx", {
    results: SAMPLES,
    ...serial.stages.reservation_tx,
  });

  // Contención: la misma factura (válidas, sin bloquear la factura) y facturas distintas.
  console.log("Reservas simultáneas de una misma factura…");
  const sameInvoice = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) =>
      Array.from({ length: CONTENDERS }, () => seededInvoice(FIRST + r)),
    ),
  );
  console.log("Reservas simultáneas de facturas distintas…");
  const distinctInvoices = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) =>
      Array.from({ length: CONTENDERS }, (_, c) =>
        seededInvoice(FIRST + 1_000 + r * CONTENDERS + c),
      ),
    ),
  );
  const baseline = serial.stages.reservation_tx.p50;
  const contention = [
    ["La misma factura", sameInvoice],
    ["Facturas distintas", distinctInvoices],
  ] as const;
  for (const [name, summary] of contention) {
    record(`${name}, ${CONTENDERS} simultáneas: total del servidor`, "POST /debit-notes", {
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

  console.log("Renderizando el RIDE de la nota…");
  const ride = await measureRide(backend, company, templateNote.id!);
  record("Render del RIDE de la nota (worker)", "RideWorkerPool", ride, RIDE_BUDGET_MS);

  // Las notas de débito no tocan la capacidad acreditable ni el inventario de las facturas.
  const creditCapacityAfter = await prisma.creditCapacity.count();
  const stockMovementsAfter = await prisma.stockMovement.count();
  const independent =
    creditCapacityAfter === creditCapacityBefore && stockMovementsAfter === stockMovementsBefore;
  const emittedNotes = await prisma.electronicDocument.count({
    where: { companyId: company, documentType: "05" },
  });
  console.log(
    `Independencia: ${emittedNotes} notas, capacidad acreditable ${creditCapacityBefore} → ${creditCapacityAfter}, movimientos de inventario ${stockMovementsBefore} → ${stockMovementsAfter}`,
  );
  const env = await environment(backend);
  const volumeAfter = await volume(backend);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(
    new Date(),
  );
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
  const report = {
    date,
    volume: {
      invoices: INVOICES,
      linesPerInvoice: LINES,
      invoiceTotal: seeded.total,
      seedSeconds,
      before: volumeBefore,
      after: volumeAfter,
    },
    warmup: WARMUP,
    samples: SAMPLES,
    budgetMs: BUDGET_MS,
    rideBudgetMs: RIDE_BUDGET_MS,
    environment: env,
    results,
    serialEmissions: serial,
    contention: contentionReport,
    independence: {
      emittedNotes,
      creditCapacity: { before: creditCapacityBefore, after: creditCapacityAfter },
      stockMovements: { before: stockMovementsBefore, after: stockMovementsAfter },
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}debit-notes-${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const passed = results.every((r) => r.withinBudget) && independent;
  writeFileSync(
    `${OUT_DIR}debit-notes-${date}.md`,
    [
      `# Benchmark de las notas de débito (${date})`,
      "",
      `Volumen: ${INVOICES} facturas AUTHORIZED de ${LINES} líneas en dos tratamientos de IVA (15 % y 0 %), en una empresa. Siembra por SQL en ${seedSeconds} s. Calentamiento de ${WARMUP} y ${SAMPLES} mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra \`main.ts\`, con la custodia habilitada y la transmisión apagada; la contención son ${ROUNDS} rondas de ${CONTENDERS} emisiones simultáneas. El cálculo se mide en proceso (${CALC_SAMPLES} veces) y el RIDE en \`RideWorkerPool\` con 2 workers. Objetivos: ERS RNF-005, P95 menor que ${BUDGET_MS} ms, y el P95 del render del RIDE menor que ${RIDE_BUDGET_MS} ms (design D25 de \`add-debit-notes\`). Las respuestas del SRI no participan. Generado por \`bench:debit-notes\`; datos en \`debit-notes-${date}.json\`.`,
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
      "## Contención",
      "",
      "| Escenario | Simultáneas | Reservas por segundo | `reservation_tx` P50 | `reservation_tx` P95 | Espera por bloqueos P95 (ms) | Total P95 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...contention.map(
        ([name, summary]) =>
          `| ${name} | ${CONTENDERS} | ${summary.reservationsPerSecond} | ${summary.stages.reservation_tx.p50} | ${summary.stages.reservation_tx.p95} | ${round(Math.max(0, summary.stages.reservation_tx.p95 - baseline))} | ${summary.stages.total.p95} |`,
      ),
      "",
      `- La espera por bloqueos es lo que el P95 de \`reservation_tx\` supera a su mediana en serie (${baseline} ms), que no espera a nadie. Una nota de débito no bloquea su factura (design D14): las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como la factura y la nota de crédito.`,
      "- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva.",
      "",
      `Independencia al terminar: ${emittedNotes} notas emitidas; filas de capacidad acreditable ${creditCapacityBefore} → ${creditCapacityAfter} y movimientos de inventario ${stockMovementsBefore} → ${stockMovementsAfter}.`,
      "",
      passed
        ? "Todas las operaciones cumplen su objetivo en este entorno y las notas no tocan la capacidad acreditable ni el inventario."
        : "Al menos una operación supera su objetivo o las notas tocaron la capacidad o el inventario: analizar antes de cambiar índices o estrategia (`/opsx:update`).",
      "",
    ].join("\n"),
  );
  console.log(passed ? "Benchmark dentro del objetivo." : "Benchmark fuera del objetivo.");
  process.exitCode = passed ? 0 : 1;
} finally {
  await backend.stop();
  rmSync(p12Dir, { recursive: true, force: true });
}
