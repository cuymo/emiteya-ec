// Benchmark de la emisión de facturas (add-invoice-emission, design D16; Q-26). Es un gate dedicado:
// no forma parte de `verify` ni de la suite de pruebas, para que el tiempo de un runner compartido no
// la vuelva inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:emission
//
// Arranca main.ts con EMISSION_STAGE_TIMINGS=1 y la custodia habilitada sobre un esquema aislado de
// la base de pruebas (DATABASE_URL_TEST o la de compose.yaml). Prepara por la API una empresa con su
// configuración, su punto, la firma sintética, 100 terceros, 100 productos y 10 operadores; emite
// una factura real de plantilla y siembra por SQL 100 000 facturas previas SIGNED con sus
// transiciones, registros de idempotencia y artefactos sintéticos de 64 bytes; después, ANALYZE.
// Diez operadores concurrentes crean un borrador de 1 a 5 líneas y lo emiten: 30 emisiones de
// calentamiento y 300 medidas, con las etapas de `Server-Timing`. Escribe el entorno y los
// resultados en docs/quality/benchmarks/ y termina con error si el P95 del total supera 2 s. El
// objetivo no se sube para hacerlo pasar: un fallo se analiza y se propone con /opsx:update.
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem, type } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";
import {
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  generateP12Fixtures,
  readFixture,
} from "../test/support/p12-fixtures.ts";

const PRIOR = 100_000;
const PRODUCTS = 100;
const PARTIES = 100;
const USERS = 10;
const WARMUP = 30;
const SAMPLES = 300;
const BUDGET_MS = 2000;
const BATCH = 10_000;
const ADMIN = { email: "admin@benchmark.ec", password: "contrasena-benchmark-1" };
const OPERATOR_PASSWORD = "contrasena-operador-1";
const STAGES = [
  "validation_snapshot",
  "arithmetic",
  "reservation_tx",
  "xml",
  "xsd",
  "sign",
  "persist",
  "total",
] as const;
type Stage = (typeof STAGES)[number];
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));

/** Generador determinista (mulberry32): los mismos datos y borradores en cada ejecución. */
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

const GOODS = ["Cemento", "Tornillo", "Pintura", "Cable", "Tubería", "Válvula", "Café", "Cuaderno"];
const SURNAMES = ["García", "Pérez", "Núñez", "Muñoz", "Álvarez", "Gómez", "Andrade", "Chávez"];

type Json = Record<string, unknown>;

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
    address: "Av. Amazonas N24-03, Quito",
  });
  const point = await call(
    backend,
    cookie,
    "POST",
    `/establishments/${String(establishment.id)}/emission-points`,
    { code: "001" },
  );
  const pointId = String(
    (point.emissionPoints as { id: string }[] | undefined)?.[0]?.id ?? point.id,
  );
  await call(backend, cookie, "PUT", "/signing-certificate", {
    file: readFixture(p12Dir, "sd-utf8.modern.p12").toString("base64"),
    password: FIXTURE_PASSWORD,
    expectedCurrentId: null,
  });
  const next = random(20261003);
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const parties: string[] = [];
  for (let i = 1; i <= PARTIES; i += 1) {
    const ruc = i % 2 === 0;
    const party = await call(backend, cookie, "POST", "/parties", {
      identificationType: ruc ? "04" : "05",
      identification: ruc
        ? `17${String(i).padStart(8, "0")}001`
        : `09${String(i).padStart(8, "0")}`,
      legalName: ruc
        ? `${pick(SURNAMES)} Distribuciones ${i} S.A.`
        : `${pick(SURNAMES)} ${pick(SURNAMES)} ${i}`,
      address: "Av. Quito y Guayaquil",
      roles: ["CUSTOMER"],
    });
    parties.push(String(party.id));
  }
  const products: string[] = [];
  for (let i = 1; i <= PRODUCTS; i += 1) {
    const product = await call(backend, cookie, "POST", "/products", {
      kind: next() < 0.85 ? "GOOD" : "SERVICE",
      mainCode: `P${String(i).padStart(4, "0")}`,
      name: `${pick(GOODS)} ${i}`,
      unitPrice: `${Math.floor(next() * 200) + 1}.${String(Math.floor(next() * 1e4)).padStart(4, "0")}`,
      // IVA 15 % (4) o 0 % (0), vigentes en la fecha de emisión.
      taxes: { iva: next() < 0.8 ? "4" : "0" },
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
  return { cookie, pointId, parties, products, operators };
}

type Emission = { status: number; state: string | null; stages: Partial<Record<Stage, number>> };

async function emit(
  backend: E2eBackend,
  cookie: string,
  draft: { id: string; version: number },
): Promise<Emission & { clientMs: number; artifactBytes: number | null }> {
  const started = performance.now();
  const res = await fetch(`${backend.base}/api/v1/invoices`, {
    method: "POST",
    headers: {
      cookie,
      origin: E2E_ORIGIN,
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ draftId: draft.id, expectedVersion: draft.version }),
  });
  const body = (await res.json()) as {
    data?: { state: string; artifact: { sizeBytes: number } | null };
  };
  const clientMs = performance.now() - started;
  const stages: Partial<Record<Stage, number>> = {};
  for (const entry of (res.headers.get("server-timing") ?? "").split(",")) {
    const [stage, duration] = entry.trim().split(";dur=");
    if (stage && duration && (STAGES as readonly string[]).includes(stage))
      stages[stage as Stage] = Number(duration);
  }
  return {
    status: res.status,
    state: body.data?.state ?? null,
    stages,
    clientMs,
    artifactBytes: body.data?.artifact?.sizeBytes ?? null,
  };
}

async function draftFor(
  backend: E2eBackend,
  cookie: string,
  data: { pointId: string; parties: string[]; products: string[] },
  next: () => number,
) {
  const count = 1 + Math.floor(next() * 5);
  const chosen = new Set<string>();
  while (chosen.size < count) chosen.add(data.products[Math.floor(next() * data.products.length)]!);
  const draft = await call(backend, cookie, "POST", "/invoices/drafts", {
    emissionPointId: data.pointId,
    buyerPartyId: data.parties[Math.floor(next() * data.parties.length)]!,
    lines: [...chosen].map((productId) => ({
      productId,
      quantity: next() < 0.7 ? String(1 + Math.floor(next() * 10)) : (next() * 20 + 0.5).toFixed(3),
    })),
    payments: [{ paymentMethod: next() < 0.6 ? "01" : "20" }],
  });
  return { id: String(draft.id), version: Number(draft.version), lines: count };
}

/** 100 000 facturas previas SIGNED, por SQL, con la plantilla real como relleno del snapshot. */
async function seedPrior(backend: E2eBackend, template: string) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const first = 2;
  const last = PRIOR + 1;
  for (let from = first; from <= last; from += BATCH) {
    const to = Math.min(last, from + BATCH - 1);
    // Una transacción por lote: el trigger diferido exige el artefacto de cada SIGNED al confirmar.
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
         SELECT gen_random_uuid()::text, d.company_id, d.environment, d.establishment_id, d.emission_point_id, '01', g,
                now() - ((${last} - g + 1) * interval '5 minutes'), $1, 'bench-seed'
         FROM generate_series(${from}, ${to}) g CROSS JOIN ${t("electronic_document")} d WHERE d.id = $2`,
          user,
          template,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, attempt_count)
         SELECT gen_random_uuid()::text, r.company_id, '01', r.environment, r.establishment_id, r.emission_point_id,
                '001-001-' || lpad(r.sequential::text, 9, '0'), r.sequential, r.id,
                '00' || lpad(r.sequential::text, 47, '0'), '12345678', r.reserved_at::date, 'SIGNED',
                d.snapshot, d.schema_version, p.ids[1 + r.sequential % p.n], p.names[1 + r.sequential % p.n], d.total,
                r.reserved_at, $1, r.reserved_at + interval '1 second', 1
         FROM ${t("fiscal_sequence_reservation")} r
         CROSS JOIN ${t("electronic_document")} d
         CROSS JOIN (SELECT array_agg(identification ORDER BY identification) AS ids,
                            array_agg(legal_name ORDER BY identification) AS names, count(*) AS n
                     FROM ${t("party")} WHERE company_id = $3 AND system_record IS NULL) p
         WHERE d.id = $2 AND r.company_id = $3 AND r.sequential BETWEEN ${from} AND ${to}`,
          user,
          template,
          company,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_artifact")} (id, company_id, document_id, kind, media_type, content, size_bytes, sha256, metadata, created_at)
         SELECT gen_random_uuid()::text, d.company_id, d.id, 'SIGNED_XML', 'application/xml', c.content, 64,
                encode(sha256(c.content), 'hex'), a.metadata, d.signed_at
         FROM ${t("electronic_document")} d
         CROSS JOIN LATERAL (SELECT sha256(convert_to(d.id, 'UTF8')) || sha256(convert_to(d.access_key, 'UTF8')) AS content) c
         CROSS JOIN ${t("document_artifact")} a
         WHERE a.document_id = $1 AND d.company_id = $2 AND d.sequential BETWEEN ${from} AND ${to}`,
          template,
          company,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_state_transition")} (id, company_id, document_id, from_state, to_state, cause, actor_type, actor_user_id, metadata, occurred_at)
         SELECT gen_random_uuid()::text, d.company_id, d.id, NULL, 'RESERVED', 'EMISSION', 'USER', d.created_by,
                jsonb_build_object('reservationId', d.reservation_id, 'correlationId', 'bench-seed'), d.created_at
         FROM ${t("electronic_document")} d WHERE d.company_id = $1 AND d.sequential BETWEEN ${from} AND ${to}
         UNION ALL
         SELECT gen_random_uuid()::text, d.company_id, d.id, 'RESERVED', 'SIGNED', 'SIGNING', 'USER', d.created_by,
                jsonb_build_object('artifactSha256', a.sha256, 'correlationId', 'bench-seed'), d.signed_at
         FROM ${t("electronic_document")} d JOIN ${t("document_artifact")} a ON a.document_id = d.id
         WHERE d.company_id = $1 AND d.sequential BETWEEN ${from} AND ${to}`,
          company,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("idempotency_record")} (company_id, operation, idempotency_key, request_fingerprint, document_id, created_at, created_by)
         SELECT d.company_id, 'invoice.emit', 'bench-seed-' || d.sequential, encode(sha256(convert_to(d.id, 'UTF8')), 'hex'),
                d.id, d.created_at, d.created_by
         FROM ${t("electronic_document")} d WHERE d.company_id = $1 AND d.sequential BETWEEN ${from} AND ${to}`,
          company,
        );
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  }
  // El contador continúa después de las facturas sembradas.
  await prisma.$executeRawUnsafe(
    `UPDATE ${t("fiscal_sequence")} SET next_number = ${last + 1}, last_reserved = ${last}
     WHERE company_id = $1 AND document_type = '01'`,
    company,
  );
  for (const table of [
    "fiscal_sequence",
    "fiscal_sequence_reservation",
    "electronic_document",
    "document_state_transition",
    "document_artifact",
    "idempotency_record",
    "party",
    "product",
    "product_tax",
    "invoice_draft",
    "invoice_draft_line",
    "invoice_draft_payment",
  ]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${t(table)}`);
  }
}

async function volume(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const result: Record<string, { rows: number; totalSize: string }> = {};
  for (const table of [
    "electronic_document",
    "document_state_transition",
    "document_artifact",
    "idempotency_record",
    "fiscal_sequence_reservation",
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
    synchronous_commit: await setting("synchronous_commit"),
    max_connections: await setting("max_connections"),
    jit: await setting("jit"),
    node: process.version,
    os: `${type()} ${release()}`,
    cpu: `${cpus()[0]?.model ?? "?"} (${cpus().length} núcleos)`,
    memory: `${Math.round(totalmem() / 2 ** 30)} GiB`,
    commit: execSync("git rev-parse --short HEAD").toString().trim(),
    backend:
      "main.ts con Node --conditions=development; XSD_VALIDATION_CONCURRENCY=2, XSD_VALIDATION_QUEUE=16, CRYPTO_WORKERS=2 (valores por defecto)",
  };
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

const p12Dir = mkdtempSync(join(tmpdir(), "bench-emission-p12-"));
generateP12Fixtures(p12Dir);
const backend = await startE2eBackend({
  label: "bench_emission",
  admin: ADMIN,
  env: {
    CERTIFICATE_CUSTODY: "enabled",
    // Clave de custodia efímera de esta ejecución; nunca se imprime ni se guarda.
    CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
    EMISSION_STAGE_TIMINGS: "1",
    LOGIN_IP_MAX_REQUESTS: "100",
  },
});
try {
  console.log("Preparando la empresa por la API…");
  const data = await prepare(backend, p12Dir);
  console.log("Emitiendo la factura de plantilla…");
  const next = random(20261004);
  const template = await draftFor(backend, data.cookie, data, next);
  const templateEmission = await fetch(`${backend.base}/api/v1/invoices`, {
    method: "POST",
    headers: {
      cookie: data.cookie,
      origin: E2E_ORIGIN,
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ draftId: template.id, expectedVersion: template.version }),
  });
  const templateBody = (await templateEmission.json()) as { data: { id: string; state: string } };
  if (templateEmission.status !== 201 || templateBody.data.state !== "SIGNED") {
    throw new Error(`La factura de plantilla no quedó SIGNED: ${templateEmission.status}`);
  }
  console.log(`Sembrando ${PRIOR} facturas previas…`);
  const seedStarted = performance.now();
  await seedPrior(backend, templateBody.data.id);
  console.log(`Siembra en ${Math.round((performance.now() - seedStarted) / 1000)} s.`);
  const tables = await volume(backend);

  console.log(`Emitiendo ${WARMUP} de calentamiento y ${SAMPLES} medidas con ${USERS} usuarios…`);
  const total = WARMUP + SAMPLES;
  let cursor = 0;
  const measured: (Emission & { clientMs: number; artifactBytes: number | null; lines: number })[] =
    [];
  const failures: string[] = [];
  let measuredStart = 0;
  await Promise.all(
    data.operators.map(async (cookie, worker) => {
      const rng = random(1000 + worker);
      for (;;) {
        const index = cursor++;
        if (index >= total) return;
        if (index === WARMUP) measuredStart = performance.now();
        const draft = await draftFor(backend, cookie, data, rng);
        const result = await emit(backend, cookie, draft);
        if (result.status !== 201 || result.state !== "SIGNED") {
          failures.push(`#${index}: ${result.status} ${result.state ?? "sin estado"}`);
        }
        if (index >= WARMUP) measured.push({ ...result, lines: draft.lines });
      }
    }),
  );
  const elapsedS = (performance.now() - measuredStart) / 1000;

  const stages = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      summary(measured.map((sample) => sample.stages[stage] ?? Number.NaN).filter(Number.isFinite)),
    ]),
  ) as Record<Stage, { p50: number; p95: number; max: number }>;
  const client = summary(measured.map((sample) => sample.clientMs));
  const missingStages = measured.filter((sample) =>
    STAGES.some((stage) => sample.stages[stage] === undefined),
  ).length;
  const artifactSizes = measured
    .map((sample) => sample.artifactBytes)
    .filter((size): size is number => size !== null);
  const artifacts = summary(artifactSizes);
  const lines = measured.reduce((sum, sample) => sum + sample.lines, 0) / measured.length;
  const passed =
    failures.length === 0 &&
    missingStages === 0 &&
    stages.total.p95 <= BUDGET_MS &&
    client.p95 <= BUDGET_MS;
  const env = await environment(backend);
  const date = new Date().toISOString().slice(0, 10);
  const report = {
    date,
    volume: { priorInvoices: PRIOR, products: PRODUCTS, parties: PARTIES, tables },
    load: {
      users: USERS,
      warmup: WARMUP,
      samples: SAMPLES,
      averageLines: Math.round(lines * 100) / 100,
      throughputPerSecond: Math.round((SAMPLES / elapsedS) * 10) / 10,
    },
    budgetMs: BUDGET_MS,
    environment: env,
    stages,
    client,
    measuredArtifactBytes: artifacts,
    failures,
    missingStages,
    passed,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}emission-${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const STAGE_LABELS: Record<Stage, string> = {
    validation_snapshot: "Lecturas, validación y snapshot (sin el cálculo)",
    arithmetic: "Cálculo de importes",
    reservation_tx: "Transacción de la reserva completa",
    xml: "XML desde el snapshot",
    xsd: "Validación XSD (antes y después de firmar)",
    sign: "Firma en el pool criptográfico",
    persist: "Artefacto, SIGNED, transición y auditoría",
    total: "Total en el servidor",
  };
  writeFileSync(
    `${OUT_DIR}emission-${date}.md`,
    [
      `# Benchmark de la emisión (${date})`,
      "",
      `Generado por \`bench:emission\` (design D16 de \`add-invoice-emission\`; Q-26); datos en \`emission-${date}.json\`. Objetivo: P95 del total de ${BUDGET_MS} ms o menos en este entorno, no como promesa universal.`,
      "",
      "## Método",
      "",
      `- \`main.ts\` con \`EMISSION_STAGE_TIMINGS=1\` y la custodia habilitada, sobre un esquema migrado de la base de pruebas. La empresa se prepara por la API: configuración tributaria, establecimiento y punto, la firma sintética \`sd-utf8.modern.p12\`, ${PARTIES} terceros, ${PRODUCTS} productos (IVA 15 % u 0 %) y ${USERS} operadores.`,
      `- Una factura real de plantilla y ${PRIOR} facturas previas sembradas por SQL en el mismo punto: documentos \`SIGNED\` con dos transiciones cada uno, su registro de idempotencia y un artefacto sintético de 64 bytes; después, \`ANALYZE\`. El snapshot de las previas copia el de la plantilla, para que la tabla tenga el volumen de un snapshot real.`,
      `- **Los artefactos sintéticos de 64 bytes no simulan el volumen físico real de \`BYTEA\` y TOAST** de ${PRIOR} XML firmados. Cada factura medida produce y guarda su artefacto real (${artifacts.p50} bytes de mediana).`,
      "- No se siembran los borradores ni los eventos de auditoría de las facturas previas.",
      `- ${USERS} operadores concurrentes, cada uno con su sesión: crea un borrador de 1 a 5 líneas (${report.load.averageLines} de media) y lo emite con su \`Idempotency-Key\`. ${WARMUP} emisiones de calentamiento y ${SAMPLES} medidas; ${report.load.throughputPerSecond} emisiones medidas por segundo.`,
      "- Las etapas salen de `Server-Timing`. `total` y `reservation_tx` cuentan su tiempo completo; las demás excluyen las anidadas en ellas (`validation_snapshot` no incluye `arithmetic`); `xsd` suma las dos validaciones. La columna del cliente es la emisión vista desde el cliente HTTP, en la misma máquina. El SRI no participa: nunca se usan sus pruebas para medir rendimiento.",
      "",
      "## Entorno",
      "",
      "| Clave | Valor |",
      "| --- | --- |",
      ...Object.entries(env).map(([key, value]) => `| ${key} | ${value} |`),
      "",
      "## Volumen sembrado",
      "",
      "| Tabla | Filas | Tamaño total |",
      "| --- | --- | --- |",
      ...Object.entries(tables).map(
        ([table, { rows, totalSize }]) => `| \`${table}\` | ${rows} | ${totalSize} |`,
      ),
      "",
      "## Resultados",
      "",
      "| Etapa | Qué mide | P50 (ms) | P95 (ms) | Máx. (ms) |",
      "| --- | --- | --- | --- | --- |",
      ...STAGES.map(
        (stage) =>
          `| \`${stage}\` | ${STAGE_LABELS[stage]} | ${stages[stage].p50} | ${stages[stage].p95} | ${stages[stage].max} |`,
      ),
      `| Cliente | Emisión vista desde el cliente HTTP | ${client.p50} | ${client.p95} | ${client.max} |`,
      "",
      failures.length === 0
        ? `Las ${WARMUP + SAMPLES} emisiones quedaron \`SIGNED\`.`
        : `Emisiones que no quedaron \`SIGNED\`: ${failures.join("; ")}.`,
      "",
      passed
        ? `El P95 del total cumple el objetivo de ${BUDGET_MS} ms en este entorno.`
        : `El benchmark no cumple el objetivo: analizar las etapas antes de proponer un cambio con \`/opsx:update\`; el umbral no se sube.`,
      "",
    ].join("\n"),
  );
  console.log(
    STAGES.map(
      (stage) =>
        `${stage}: P50 ${stages[stage].p50} ms, P95 ${stages[stage].p95} ms, máx. ${stages[stage].max} ms`,
    ).join("\n"),
  );
  console.log(`cliente: P50 ${client.p50} ms, P95 ${client.p95} ms, máx. ${client.max} ms`);
  if (failures.length > 0) console.log(`Fallos: ${failures.join("; ")}`);
  console.log(passed ? "Benchmark dentro del objetivo." : "Benchmark fuera del objetivo.");
  process.exitCode = passed ? 0 : 1;
} finally {
  await backend.stop();
  rmSync(p12Dir, { recursive: true, force: true });
}
