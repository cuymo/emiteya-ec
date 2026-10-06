// Benchmark de los comprobantes de retención (add-withholding-receipts, design D25 y D27). Es un gate
// dedicado: no forma parte de `verify` ni de la suite de pruebas, para que el tiempo de un runner
// compartido no la vuelva inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:withholding-receipts
//
// Arranca main.ts con EMISSION_STAGE_TIMINGS=1, la custodia habilitada y los límites de recursos en
// sus máximos absolutos (30/10/10/10) sobre un esquema aislado de la base de pruebas, con la
// transmisión apagada (las retenciones quedan SIGNED) y el barrido del RIDE apagado. Prepara por la
// API la empresa, su punto, la firma sintética y 10 operadores, y emite una retención de plantilla.
// Siembra por SQL 10 000 proveedores y 100 000 retenciones AUTHORIZED de dos retenciones en doce
// períodos, con el snapshot real de la plantilla, su registro y sus líneas; después, ANALYZE. Mide
// por separado, desde el cliente HTTP:
//
// - la búsqueda de proveedores (sin filtro, por identificación y por razón social);
// - la resolución de los catálogos (`/withholding-receipts/options`);
// - la creación y la vista previa de un borrador con el peor caso de los límites por defecto
//   (10 documentos de 5 impuestos, 5 pagos y 5 retenciones) y con los máximos absolutos
//   (30 documentos de 10, 10 y 10);
// - el cálculo de 50 y de 300 retenciones, en proceso con el algoritmo único;
// - la emisión con su reserva en serie, con las etapas de `Server-Timing` (`reservation_tx` aparte
//   del XML, el XSD y la firma), y la del peor caso por defecto y la del máximo absoluto;
// - reservas simultáneas para un mismo proveedor y para proveedores distintos, con el rendimiento;
// - la lista y la búsqueda de retenciones (por número, por proveedor, por período y por estado);
// - el render del RIDE de una retención y el del máximo de filas en `RideWorkerPool`;
// - el CPU y la memoria del proceso del backend en el peor caso.
//
// Registra el tamaño del XML firmado del peor caso SOLO como medición de recursos: no se relaciona
// con Q-47 ni con ningún límite del SRI. Termina comprobando que las retenciones no tocaron la
// capacidad acreditable ni el inventario, escribe el entorno y los resultados en
// docs/quality/benchmarks/ y sale con error si algún P95 supera ERS RNF-005 (2 s), si el P95 del
// render del RIDE supera 1 s o si las retenciones tocaron la capacidad o el inventario. Los
// objetivos no se suben para hacerlo pasar: un fallo se analiza y se propone con /opsx:update.
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem, type } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { calculateWithholdingAmounts } from "../src/modules/withholding-receipts/domain/amounts.ts";
import {
  createPooledRideRenderer,
  rideTasksEntry,
} from "../src/modules/sri-engine/infrastructure/ride/pooled-ride-renderer.ts";
import { defaultRideFontsDirectory } from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { createRideWorkerPool } from "../src/platform/workers/ride-worker-pool.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";
import {
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  generateP12Fixtures,
  readFixture,
} from "../test/support/p12-fixtures.ts";

const SUPPLIERS = 10_000;
const RECEIPTS = 100_000;
const USERS = 10;
const WARMUP = 10;
const SAMPLES = 100;
const HEAVY_SAMPLES = 20;
const CALC_SAMPLES = 1_000;
/** Reservas simultáneas por ronda y rondas, para un mismo proveedor y para proveedores distintos. */
const CONTENDERS = 10;
const ROUNDS = 10;
const RIDE_WARMUP = 5;
const RIDE_SAMPLES = 30;
/** ERS RNF-005: P95 menor que 2 s. */
const BUDGET_MS = 2_000;
/** Como el RIDE de la factura: P95 del render menor que 1 s. */
const RIDE_BUDGET_MS = 1_000;
const BATCH = 10_000;
/** Los límites por defecto de design D25 y los máximos absolutos del contrato. */
const DEFAULT_LIMITS = {
  supports: 10,
  itemsPerSupport: 5,
  taxesPerSupport: 5,
  paymentsPerSupport: 5,
};
const MAX_LIMITS = {
  supports: 30,
  itemsPerSupport: 10,
  taxesPerSupport: 10,
  paymentsPerSupport: 10,
};
/** La retención de plantilla tiene el secuencial 1 de su contador: lo sembrado sigue. */
const FIRST = 2;
const LAST_RECEIPT = RECEIPTS + FIRST - 1;
const ADMIN = { email: "admin@benchmark-ret.ec", password: "contrasena-benchmark-1" };
const OPERATOR_PASSWORD = "contrasena-operador-1";
const STAGES = ["reservation_tx", "xml", "xsd", "sign", "persist", "total"] as const;
type Stage = (typeof STAGES)[number];
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));
/** La fecha de hoy en Ecuador: la emisión resuelve los catálogos con ella. */
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(
  new Date(),
);
const MONTH = `${TODAY.slice(5, 7)}/${TODAY.slice(0, 4)}`;

type Json = Record<string, unknown>;
type Limits = typeof DEFAULT_LIMITS;

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
  // El proveedor de la plantilla y el del peor caso, con una razón social de 300 caracteres.
  const template = await call(backend, cookie, "POST", "/parties", {
    identificationType: "04",
    identification: "0992877878001",
    legalName: "PROVEEDORA DEL SUR S.A.",
    roles: ["SUPPLIER"],
  });
  const longest = await call(backend, cookie, "POST", "/parties", {
    identificationType: "05",
    identification: "1710034065",
    legalName: `PROVEEDOR DE NOMBRE MUY LARGO ${"X".repeat(270)}`.slice(0, 300),
    roles: ["SUPPLIER"],
  });
  const operators: string[] = [];
  for (let i = 1; i <= USERS; i += 1) {
    const email = `operador${i}@benchmark-ret.ec`;
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
    templateSupplier: String(template.id),
    longestSupplier: String(longest.id),
    operators,
  };
}

type Prepared = Awaited<ReturnType<typeof prepare>>;

/** Un documento sustento con `taxes` impuestos, `payments` pagos y `items` retenciones. */
function support(
  index: number,
  { taxes, payments, items }: { taxes: number; payments: number; items: number },
  amount: string,
) {
  return {
    documentType: "01",
    supportCode: "01",
    number: `001${String(100 + (index % 899)).padStart(3, "0")}${String(index + 1).padStart(9, "0")}`,
    issueDate: TODAY,
    // La autorización más larga que admite el anexo 10: 49 dígitos.
    authorizationNumber: "1".repeat(49),
    totalWithoutTaxes: amount,
    importTotal: amount,
    taxes: Array.from({ length: taxes }, () => ({
      tax: "2",
      rateEntryKey: "4",
      base: amount,
      amount,
    })),
    payments: Array.from({ length: payments }, (_, p) => ({
      paymentMethod: p % 2 === 0 ? "20" : "01",
      total: amount,
    })),
    withholdings: Array.from({ length: items }, (_, k) =>
      k % 2 === 0
        ? { tax: "1", entryKey: "312", base: amount }
        : { tax: "2", entryKey: "1", base: amount },
    ),
  };
}

/** Retención de dos retenciones (renta 312 e IVA código 1) sobre una factura. */
const simpleSupports = (index: number) => [
  {
    ...support(index, { taxes: 1, payments: 1, items: 2 }, "100.00"),
    withholdings: [
      { tax: "1", entryKey: "312", base: "100.00" },
      { tax: "2", entryKey: "1", base: "15.00" },
    ],
  },
];

/** El peor caso de unos límites, con importes largos (11 caracteres) en cada campo. */
const worstSupports = (limits: Limits) =>
  Array.from({ length: limits.supports }, (_, s) =>
    support(
      s,
      {
        taxes: limits.taxesPerSupport,
        payments: limits.paymentsPerSupport,
        items: limits.itemsPerSupport,
      },
      "99999999.99",
    ),
  );

async function draftFor(
  backend: E2eBackend,
  cookie: string,
  pointId: string,
  partyId: string,
  supports: readonly unknown[],
) {
  const draft = await call(backend, cookie, "POST", "/withholding-receipts/drafts", {
    partyId,
    relatedParty: "NO",
    fiscalPeriod: MONTH,
    emissionPointId: pointId,
    supports,
  });
  const issues = (draft.preview as { issues: unknown[] }).issues;
  if (issues.length > 0) throw new Error(`borrador con problemas: ${JSON.stringify(issues)}`);
  return { id: String(draft.id), version: Number(draft.version) };
}

type Emission = {
  id: string;
  clientMs: number;
  stages: Partial<Record<Stage, number>>;
};

async function emit(
  backend: E2eBackend,
  cookie: string,
  draft: { id: string; version: number },
): Promise<Emission> {
  const started = performance.now();
  const res = await fetch(`${backend.base}/api/v1/withholding-receipts`, {
    method: "POST",
    headers: {
      cookie,
      origin: E2E_ORIGIN,
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ draftId: draft.id, expectedVersion: draft.version }),
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

/** Proveedores y retenciones por SQL: el snapshot real de la plantilla con su clave propia. */
async function seed(backend: E2eBackend, data: Prepared, templateId: string) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const template = await prisma.electronicDocument.findUniqueOrThrow({ where: { id: templateId } });

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${t("party")} (id, company_id, identification_type, identification, legal_name, roles, status, version, search_name, search_identification, created_at, created_by, updated_at, updated_by)
     SELECT 'bench-sup-' || g, $1, '04', '17' || lpad(g::text, 8, '0') || '001',
            'PROVEEDOR DEL BENCHMARK ' || lpad(g::text, 5, '0') || ' S.A.', ARRAY['SUPPLIER'], 'ACTIVE', 1,
            'proveedor del benchmark ' || lpad(g::text, 5, '0') || ' s.a.', '17' || lpad(g::text, 8, '0') || '001',
            now(), $2, now(), $2
     FROM generate_series(1, ${SUPPLIERS}) g`,
    company,
    user,
  );

  for (let from = FIRST; from <= LAST_RECEIPT; from += BATCH) {
    const to = Math.min(LAST_RECEIPT, from + BATCH - 1);
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
           SELECT 'bench-res-07-' || g, $1, 'TEST', $2, $3, '07', g, now() - ((${LAST_RECEIPT} - g + 2) * interval '1 minute'), $4, 'bench-seed'
           FROM generate_series(${from}, ${to}) g`,
          company,
          data.establishmentId,
          data.pointId,
          user,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, authorization_number, authorization_date, authorization_environment, attempt_count)
           SELECT 'bench-ret-' || r.sequential, r.company_id, '07', 'TEST', r.establishment_id, r.emission_point_id,
                  '001-001-' || lpad(r.sequential::text, 9, '0'), r.sequential, r.id,
                  '07' || lpad(r.sequential::text, 47, '0'), '12345678', r.reserved_at::date, 'AUTHORIZED',
                  $1::jsonb || jsonb_build_object('key', jsonb_build_object(
                    'documentNumber', '001-001-' || lpad(r.sequential::text, 9, '0'),
                    'sequential', lpad(r.sequential::text, 9, '0'), 'numericCode', '12345678',
                    'emissionType', '1', 'accessKey', '07' || lpad(r.sequential::text, 47, '0'))),
                  '2.0.0', p.identification, p.legal_name, 6.50, r.reserved_at, $2, r.reserved_at + interval '1 second',
                  '07' || lpad(r.sequential::text, 47, '0'), r.reserved_at + interval '1 minute', 'TEST', 1
           FROM ${t("fiscal_sequence_reservation")} r
           JOIN ${t("party")} p ON p.id = 'bench-sup-' || (1 + r.sequential % ${SUPPLIERS})
           WHERE r.company_id = $3 AND r.document_type = '07' AND r.sequential BETWEEN ${from} AND ${to}`,
          JSON.stringify(template.snapshot),
          user,
          company,
        );
        // XML firmado y autorizado sintéticos con la clave del comprobante y su huella.
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_artifact")} (id, company_id, document_id, kind, media_type, content, size_bytes, sha256, metadata, created_at)
           SELECT gen_random_uuid()::text, d.company_id, d.id, k.kind, 'application/xml', c.content, octet_length(c.content),
                  encode(sha256(c.content), 'hex'), '{"documentType": "07", "schemaVersion": "2.0.0"}'::jsonb, d.signed_at
           FROM ${t("electronic_document")} d
           CROSS JOIN (VALUES ('SIGNED_XML'), ('AUTHORIZED_XML')) k(kind)
           CROSS JOIN LATERAL (SELECT convert_to('<comprobanteRetencion id="comprobante" version="2.0.0"><infoTributaria><claveAcceso>' || d.access_key || '</claveAcceso></infoTributaria></comprobanteRetencion>', 'UTF8') AS content) c
           WHERE d.company_id = $1 AND d.document_type = '07' AND d.sequential BETWEEN ${from} AND ${to}`,
          company,
        );
        // Doce períodos: el registro sirve al filtro por período de la lista.
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("withholding_receipt")} (company_id, document_id, party_id, related_party, fiscal_period, created_at)
           SELECT d.company_id, d.id, 'bench-sup-' || (1 + d.sequential % ${SUPPLIERS}), 'NO',
                  lpad((1 + d.sequential % 12)::text, 2, '0') || '/2026', d.created_at
           FROM ${t("electronic_document")} d
           WHERE d.company_id = $1 AND d.document_type = '07' AND d.sequential BETWEEN ${from} AND ${to}`,
          company,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("withholding_receipt_line")} (company_id, document_id, support_position, position, support_document_type, support_code, support_number, support_issue_date, tax, withholding_code, entry_key, base, percentage, amount)
           SELECT d.company_id, d.id, 1, l.position, '01', '01', '001001' || lpad(d.sequential::text, 9, '0'), d.issue_date,
                  l.tax, l.code, l.code, l.base, l.percentage, l.amount
           FROM ${t("electronic_document")} d
           CROSS JOIN (VALUES (1, '1', '312', 100.00, 2, 2.00), (2, '2', '1', 15.00, 30, 4.50))
             l(position, tax, code, base, percentage, amount)
           WHERE d.company_id = $1 AND d.document_type = '07' AND d.sequential BETWEEN ${from} AND ${to}`,
          company,
        );
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  }
  // El contador de retenciones sigue después de lo sembrado.
  await prisma.$executeRawUnsafe(
    `UPDATE ${t("fiscal_sequence")} SET next_number = ${LAST_RECEIPT + 1}, last_reserved = ${LAST_RECEIPT}
     WHERE company_id = $1 AND document_type = '07'`,
    company,
  );
  for (const table of [
    "party",
    "fiscal_sequence",
    "fiscal_sequence_reservation",
    "electronic_document",
    "document_artifact",
    "withholding_receipt",
    "withholding_receipt_line",
  ]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${t(table)}`);
  }
  return { company };
}

async function volume(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const result: Record<string, { rows: number; totalSize: string }> = {};
  for (const table of [
    "party",
    "electronic_document",
    "withholding_receipt",
    "withholding_receipt_line",
    "withholding_receipt_draft",
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

async function measureGet(backend: E2eBackend, cookie: string, path: string, samples = SAMPLES) {
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
  const timings: number[] = [];
  for (let i = 0; i < samples; i += 1) timings.push(await once());
  return { results: first.meta?.total ?? null, ...summarize(timings) };
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

function emissionSummary(emissions: readonly Emission[]) {
  const stages = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      summarize(emissions.map((emission) => emission.stages[stage] ?? 0)),
    ]),
  ) as Record<Stage, ReturnType<typeof summarize>>;
  return { client: summarize(emissions.map((emission) => emission.clientMs)), stages };
}

/** Emisiones en serie de una retención de dos retenciones a proveedores sembrados distintos. */
async function measureSerialEmissions(backend: E2eBackend, data: Prepared) {
  const emissions: Emission[] = [];
  for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
    const cookie = data.operators[index % data.operators.length]!;
    const draft = await draftFor(
      backend,
      cookie,
      data.pointId,
      `bench-sup-${1 + (index % SUPPLIERS)}`,
      simpleSupports(index),
    );
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
  rounds: readonly (readonly string[])[],
) {
  const emissions: Emission[] = [];
  const throughput: number[] = [];
  for (const [r, suppliers] of rounds.entries()) {
    const drafts = [];
    for (const [index, partyId] of suppliers.entries()) {
      drafts.push(
        await draftFor(
          backend,
          data.operators[index % data.operators.length]!,
          data.pointId,
          partyId,
          simpleSupports(r * CONTENDERS + index),
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

/** El cálculo único de `count` retenciones con los porcentajes del catálogo. */
function measureCalculation(count: number) {
  const items = Array.from({ length: count }, (_, k) => ({
    support: Math.floor(k / 10) + 1,
    position: (k % 10) + 1,
    base: `${(k % 997) + 1}.${String((k * 37) % 100).padStart(2, "0")}`,
    percentage: ["1.75", "2", "10", "30", "100", "0"][k % 6]!,
  }));
  for (let i = 0; i < WARMUP * 10; i += 1) calculateWithholdingAmounts({ items });
  const samples: number[] = [];
  for (let i = 0; i < CALC_SAMPLES; i += 1) {
    const started = performance.now();
    const result = calculateWithholdingAmounts({ items });
    samples.push(performance.now() - started);
    if (result.items.length !== count) throw new Error("cálculo inesperado");
  }
  return { results: count, ...summarize(samples) };
}

/** Las denominaciones de la retención desde su snapshot, como en el handler del RIDE. */
function labelsOf(snapshot: unknown) {
  const supports = (
    snapshot as {
      supports: {
        documentType: { code: string; label: string };
        taxes: { taxCode: string; taxLabel: string }[];
        withholdings: { tax: string; taxLabel: string }[];
      }[];
    }
  ).supports;
  return {
    documentTypes: Object.fromEntries(
      supports.map((s) => [s.documentType.code, s.documentType.label]),
    ),
    taxes: Object.fromEntries(
      supports.flatMap((s) => s.withholdings.map((w) => [w.tax, w.taxLabel])),
    ),
    supportTaxes: Object.fromEntries(
      supports.flatMap((s) => s.taxes.map((tax) => [tax.taxCode, tax.taxLabel])),
    ),
  };
}

/** Render del RIDE de retenciones firmadas en `RideWorkerPool`, con su duración en el worker. */
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
      const receipt = await prisma.electronicDocument.findUniqueOrThrow({ where: { id } });
      const signed = await prisma.documentArtifact.findFirstOrThrow({
        where: { documentId: id, kind: "SIGNED_XML" },
      });
      const input = {
        xml: new Uint8Array(signed.content),
        accessKey: receipt.accessKey,
        authorization: {
          number: receipt.accessKey,
          authorizedAt: new Date(),
          environment: "TEST" as const,
        },
        paymentLabels: {},
        withholdingLabels: labelsOf(receipt.snapshot),
        logo: null,
      };
      const samples: number[] = [];
      let pages = 0;
      for (let i = 0; i < RIDE_WARMUP + RIDE_SAMPLES; i += 1) {
        const outcome = await renderer.render(input);
        if (outcome.status !== "RENDERED") {
          throw new Error(`el RIDE de la retención se rechazó: ${outcome.code}`);
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

/** Tamaño del XML firmado de una retención emitida: medición de recursos, sin relación con Q-47. */
async function signedSize(backend: E2eBackend, id: string) {
  const signed = await backend.db.database.prisma.documentArtifact.findFirstOrThrow({
    where: { documentId: id, kind: "SIGNED_XML" },
  });
  return signed.sizeBytes;
}

const p12Dir = mkdtempSync(join(tmpdir(), "bench-withholdings-p12-"));
generateP12Fixtures(p12Dir);
const backend = await startE2eBackend({
  label: "bench_withholding_receipts",
  admin: ADMIN,
  env: {
    CERTIFICATE_CUSTODY: "enabled",
    // Clave de custodia efímera de esta ejecución; nunca se imprime ni se guarda.
    CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
    EMISSION_STAGE_TIMINGS: "1",
    LOGIN_IP_MAX_REQUESTS: "100",
    // Los máximos absolutos, para medir también el peor caso que admite el contrato.
    WITHHOLDING_MAX_SUPPORTS: String(MAX_LIMITS.supports),
    WITHHOLDING_MAX_ITEMS_PER_SUPPORT: String(MAX_LIMITS.itemsPerSupport),
    WITHHOLDING_MAX_TAXES_PER_SUPPORT: String(MAX_LIMITS.taxesPerSupport),
    WITHHOLDING_MAX_PAYMENTS_PER_SUPPORT: String(MAX_LIMITS.paymentsPerSupport),
    // Sin el barrido del RIDE: el RIDE se mide aparte en su pool.
    RIDE_SWEEP_INTERVAL_SECONDS: "86400",
  },
});
try {
  console.log("Preparando la empresa por la API…");
  const data = await prepare(backend, p12Dir);
  const prisma = backend.db.database.prisma;
  const pid = backendPid(backend);

  console.log("Emitiendo la retención de plantilla…");
  const template = await emit(
    backend,
    data.cookie,
    await draftFor(backend, data.cookie, data.pointId, data.templateSupplier, simpleSupports(0)),
  );

  console.log(`Sembrando ${SUPPLIERS} proveedores y ${RECEIPTS} retenciones autorizadas…`);
  const seedStarted = performance.now();
  await seed(backend, data, template.id);
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
    ["Proveedores: primera página, sin filtro", "/withholding-receipts/suppliers"],
    ["Proveedores: búsqueda por identificación", "/withholding-receipts/suppliers?search=1700005"],
    [
      "Proveedores: búsqueda por razón social (todas coinciden)",
      "/withholding-receipts/suppliers?search=benchmark",
    ],
    ["Resolución de los catálogos (opciones del borrador)", "/withholding-receipts/options"],
  ] as const) {
    record(name, path, await measureGet(backend, cookie, path));
  }

  // Borradores del peor caso: creación (con su vista previa) y relectura de la vista previa.
  const heavy: Record<string, unknown> = {};
  // Memoria del backend antes del peor caso: la línea base con la que se compara.
  const memoryBaseline = processUsage(pid);
  for (const [label, limits] of [
    ["límites por defecto", DEFAULT_LIMITS],
    ["máximos absolutos", MAX_LIMITS],
  ] as const) {
    const shape = `${limits.supports} documentos × ${limits.itemsPerSupport} retenciones, ${limits.taxesPerSupport} impuestos y ${limits.paymentsPerSupport} pagos`;
    const supports = worstSupports(limits);
    const createSamples: number[] = [];
    let draft = { id: "", version: 0 };
    const before = processUsage(pid);
    for (let i = 0; i < WARMUP + HEAVY_SAMPLES; i += 1) {
      const started = performance.now();
      draft = await draftFor(backend, cookie, data.pointId, data.longestSupplier, supports);
      if (i >= WARMUP) createSamples.push(performance.now() - started);
    }
    record(
      `Creación del borrador del peor caso (${label}: ${shape})`,
      "POST /withholding-receipts/drafts",
      {
        results: HEAVY_SAMPLES,
        ...summarize(createSamples),
      },
    );
    const preview = await measureGet(
      backend,
      cookie,
      `/withholding-receipts/drafts/${draft.id}`,
      HEAVY_SAMPLES * 2,
    );
    record(
      `Vista previa del borrador del peor caso (${label})`,
      "/withholding-receipts/drafts/{id}",
      preview,
    );
    const afterPreview = processUsage(pid);
    // La emisión del peor caso: etapas, CPU y memoria del backend y tamaño del XML firmado.
    const emissions: Emission[] = [];
    let largest = { id: "", bytes: 0 };
    for (let i = 0; i < 1 + HEAVY_SAMPLES / 2; i += 1) {
      const emission = await emit(
        backend,
        cookie,
        await draftFor(backend, cookie, data.pointId, data.longestSupplier, supports),
      );
      if (i >= 1) emissions.push(emission);
      const bytes = await signedSize(backend, emission.id);
      if (bytes > largest.bytes) largest = { id: emission.id, bytes };
    }
    const afterEmission = processUsage(pid);
    const summary = emissionSummary(emissions);
    record(`Emisión del peor caso (${label}): total del servidor`, "POST /withholding-receipts", {
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
      withholdings: limits.supports * limits.itemsPerSupport,
      signedXmlBytes: largest.bytes,
      signedXmlKiB: round(largest.bytes / 1024),
      largestId: largest.id,
      stages: summary.stages,
      client: summary.client,
      backend: {
        cpuMsPerDraftRequest: round((afterPreview.cpuMs - before.cpuMs) / requests),
        cpuMsPerDraftAndEmission: round(
          (afterEmission.cpuMs - afterPreview.cpuMs) / (1 + HEAVY_SAMPLES / 2),
        ),
        rssBeforeMiB: before.rssMiB,
        rssMiB: afterEmission.rssMiB,
        peakRssMiB: afterEmission.peakMiB,
      },
    };
    console.log(
      `Peor caso (${label}): XML firmado ${round(largest.bytes / 1024)} KiB (medición, sin relación con Q-47); memoria máxima del backend ${afterEmission.peakMiB} MiB`,
    );
  }

  record(
    "Cálculo de 50 retenciones (en proceso)",
    "calculateWithholdingAmounts",
    measureCalculation(DEFAULT_LIMITS.supports * DEFAULT_LIMITS.itemsPerSupport),
  );
  record(
    "Cálculo de 300 retenciones (en proceso)",
    "calculateWithholdingAmounts",
    measureCalculation(MAX_LIMITS.supports * MAX_LIMITS.itemsPerSupport),
  );

  console.log("Emitiendo en serie…");
  const serial = await measureSerialEmissions(backend, data);
  record("Emisión con reserva: total del servidor", "POST /withholding-receipts", {
    results: SAMPLES,
    ...serial.stages.total,
  });
  record("Emisión con reserva: transacción de la reserva", "reservation_tx", {
    results: SAMPLES,
    ...serial.stages.reservation_tx,
  });

  console.log("Reservas simultáneas para un mismo proveedor…");
  const sameSupplier = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) =>
      Array.from({ length: CONTENDERS }, () => `bench-sup-${1 + r}`),
    ),
  );
  console.log("Reservas simultáneas para proveedores distintos…");
  const distinctSuppliers = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) =>
      Array.from({ length: CONTENDERS }, (_, c) => `bench-sup-${1_000 + r * CONTENDERS + c}`),
    ),
  );
  const baseline = serial.stages.reservation_tx.p50;
  const contention = [
    ["El mismo proveedor", sameSupplier],
    ["Proveedores distintos", distinctSuppliers],
  ] as const;
  for (const [name, summary] of contention) {
    record(`${name}, ${CONTENDERS} simultáneas: total del servidor`, "POST /withholding-receipts", {
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
    ["Retenciones: primera página, sin filtro", "/withholding-receipts"],
    ["Retenciones: búsqueda por número", "/withholding-receipts?search=000054321"],
    ["Retenciones: búsqueda por proveedor", "/withholding-receipts?search=BENCHMARK%2005432"],
    ["Retenciones: filtro por período", "/withholding-receipts?fiscalPeriod=09%2F2026"],
    ["Retenciones: filtro por estado", "/withholding-receipts?state=AUTHORIZED"],
  ] as const) {
    record(name, path, await measureGet(backend, cookie, path));
  }

  console.log("Renderizando el RIDE…");
  const largestId = (heavy["máximos absolutos"] as { largestId: string }).largestId;
  const [rideOne, rideMax] = await measureRide(backend, [template.id, largestId]);
  record("Render del RIDE de una retención (worker)", "RideWorkerPool", rideOne!, RIDE_BUDGET_MS);
  record(
    `Render del RIDE del máximo de filas (${MAX_LIMITS.supports * MAX_LIMITS.itemsPerSupport} retenciones, ${rideMax!.pages} páginas)`,
    "RideWorkerPool",
    rideMax!,
    RIDE_BUDGET_MS,
  );

  // Las retenciones no tocan la capacidad acreditable ni el inventario.
  const creditCapacityAfter = await prisma.creditCapacity.count();
  const stockMovementsAfter = await prisma.stockMovement.count();
  const independent =
    creditCapacityAfter === creditCapacityBefore && stockMovementsAfter === stockMovementsBefore;
  const emitted = await prisma.electronicDocument.count({ where: { documentType: "07" } });
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
      suppliers: SUPPLIERS,
      receipts: RECEIPTS,
      seedSeconds,
      before: volumeBefore,
      after: volumeAfter,
    },
    warmup: WARMUP,
    samples: SAMPLES,
    budgetMs: BUDGET_MS,
    rideBudgetMs: RIDE_BUDGET_MS,
    limits: { default: DEFAULT_LIMITS, absolute: MAX_LIMITS },
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
      creditCapacity: { before: creditCapacityBefore, after: creditCapacityAfter },
      stockMovements: { before: stockMovementsBefore, after: stockMovementsAfter },
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    `${OUT_DIR}withholding-receipts-${date}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const passed = results.every((r) => r.withinBudget) && independent;
  const worst = Object.entries(heavy) as [
    string,
    {
      shape: string;
      withholdings: number;
      signedXmlBytes: number;
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
  writeFileSync(
    `${OUT_DIR}withholding-receipts-${date}.md`,
    [
      `# Benchmark de los comprobantes de retención (${date})`,
      "",
      `Volumen: ${SUPPLIERS} proveedores y ${RECEIPTS} retenciones AUTHORIZED de dos retenciones en doce períodos, en una empresa (volumen de Q-26). Siembra por SQL en ${seedSeconds} s. Calentamiento de ${WARMUP} y ${SAMPLES} mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra \`main.ts\`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con ${HEAVY_SAMPLES} muestras; la contención son ${ROUNDS} rondas de ${CONTENDERS} emisiones simultáneas. El cálculo se mide en proceso (${CALC_SAMPLES} veces) y el RIDE en \`RideWorkerPool\` con 2 workers. Objetivos: ERS RNF-005, P95 menor que ${BUDGET_MS} ms, y el P95 del render del RIDE menor que ${RIDE_BUDGET_MS} ms (design D27 de \`add-withholding-receipts\`). Las respuestas del SRI no participan. Generado por \`bench:withholding-receipts\`; datos en \`withholding-receipts-${date}.json\`.`,
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
      "## Peor caso y límites de recursos (design D25)",
      "",
      "| Caso | Forma | Retenciones | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...worst.map(
        ([label, entry]) =>
          `| ${label} | ${entry.shape} | ${entry.withholdings} | ${entry.stages.reservation_tx.p95} | ${entry.stages.xml.p95} | ${entry.stages.xsd.p95} | ${entry.stages.sign.p95} | ${entry.stages.total.p95} | ${entry.backend.cpuMsPerDraftRequest} | ${entry.backend.cpuMsPerDraftAndEmission} | ${entry.backend.rssBeforeMiB} → ${entry.backend.rssMiB} | ${entry.backend.peakRssMiB} | ${entry.signedXmlKiB} |`,
      ),
      "",
      `- El tamaño del XML firmado del peor caso (${maxSigned} bytes como máximo) es **solo una medición de recursos**: no interpreta ni cumple el "320 Kb" de la ficha y no tiene relación con Q-47, que sigue abierta; la transmisión real sigue cerrada hasta resolverla.`,
      `- Los límites son una defensa de recursos del sistema. La memoria es la residente del proceso del backend (incluye sus pools de firma, de validación y del RIDE); antes del peor caso era de ${memoryBaseline.rssMiB} MiB, y la máxima es la de toda la ejecución hasta ese punto.`,
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
      `- La espera por bloqueos es lo que el P95 de \`reservation_tx\` supera a su mediana en serie (${baseline} ms), que no espera a nadie. Una retención no bloquea recursos compartidos: sus documentos sustento son externos (design D16). Las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos; dos retenciones simultáneas al mismo proveedor son válidas.`,
      "- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.",
      "",
      `Independencia al terminar: ${emitted} retenciones; filas de capacidad acreditable ${creditCapacityBefore} → ${creditCapacityAfter} y movimientos de inventario ${stockMovementsBefore} → ${stockMovementsAfter}.`,
      "",
      passed
        ? "Todas las operaciones cumplen su objetivo en este entorno y las retenciones no tocan la capacidad acreditable ni el inventario."
        : "Al menos una operación supera su objetivo o las retenciones tocaron la capacidad o el inventario: analizar antes de cambiar índices, límites o estrategia (`/opsx:update`).",
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
