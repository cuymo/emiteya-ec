// Benchmark de las notas de crédito (add-credit-notes, design D21). Es un gate dedicado: no forma
// parte de `verify` ni de la suite de pruebas, para que el tiempo de un runner compartido no la
// vuelva inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:credit-notes
//
// Arranca main.ts con EMISSION_STAGE_TIMINGS=1 y la custodia habilitada sobre un esquema aislado de
// la base de pruebas, con la transmisión apagada (las notas quedan SIGNED y su capacidad reservada).
// Prepara por la API la empresa, su punto, la firma sintética, 100 productos y 10 operadores. Siembra
// por SQL 100 000 facturas AUTHORIZED de 5 líneas con su snapshot real, su clave y sus XML firmado y
// autorizado sintéticos (con su huella), y 10 000 de ellas con un crédito previo de 2 líneas (tres de
// cada cuatro aplicado por una nota AUTHORIZED, una reservado por una nota SIGNED) que respeta los
// triggers de la capacidad; después, ANALYZE. Mide por separado, desde el cliente HTTP:
//
// - la búsqueda de facturas elegibles (sin filtro, por número y por comprador);
// - la vista previa del borrador (sin créditos previos, con créditos previos y de 100 líneas);
// - la emisión con su reserva sin créditos previos y con créditos previos, con las etapas de
//   `Server-Timing` (`reservation_tx` aparte del XML, el XSD y la firma);
// - el cálculo de una devolución parcial de 100 líneas, en proceso con el algoritmo único;
// - reservas que compiten por la misma factura (con retorno físico) y reservas simultáneas de
//   facturas distintas, con el rendimiento (reservas por segundo) y la espera por bloqueos;
// - el render del RIDE de la nota en `RideWorkerPool`.
//
// Termina con la reconciliación de las capacidades acreditable y devolvible sin diferencias, escribe
// el entorno y los resultados en docs/quality/benchmarks/ y sale con error si algún P95 supera ERS
// RNF-005 (2 s), si el P95 del render del RIDE supera 1 s o si la reconciliación encuentra
// diferencias. Los objetivos no se suben para hacerlo pasar: un fallo se analiza y se propone con
// /opsx:update.
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem, type } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { calculateCreditNoteAmounts } from "../src/modules/credit-notes/domain/amounts.ts";
import { reconcileCreditCapacity } from "../src/modules/credit-notes/infrastructure/index.ts";
import { reconcileStockReturnCapacity } from "../src/modules/inventory/infrastructure/index.ts";
import {
  createPooledRideRenderer,
  rideTasksEntry,
} from "../src/modules/sri-engine/infrastructure/ride/pooled-ride-renderer.ts";
import { defaultRideFontsDirectory } from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { createRideWorkerPool } from "../src/platform/workers/ride-worker-pool.ts";
import {
  insertAuthorizedInvoice,
  invoiceSnapshot,
  recordOutflow,
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
const WITH_CREDITS = 10_000;
const PRODUCTS = 100;
const USERS = 10;
const LINES = 5;
const MANY_LINES = 100;
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
/** La factura y la nota de plantilla tienen el secuencial 1 de su contador: lo sembrado sigue. */
const FIRST = 2;
const LAST_INVOICE = INVOICES + FIRST - 1;
const LAST_CREDITED = WITH_CREDITS + FIRST - 1;
const seededInvoice = (sequential: number) => `bench-inv-${sequential}`;
const ADMIN = { email: "admin@benchmark.ec", password: "contrasena-benchmark-1" };
const OPERATOR_PASSWORD = "contrasena-operador-1";
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};
const STAGES = ["reservation_tx", "xml", "xsd", "sign", "persist", "total"] as const;
type Stage = (typeof STAGES)[number];
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));

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

const fiveLines = (products: readonly string[]): InvoiceLineSpec[] =>
  Array.from({ length: LINES }, (_, k) => ({
    productId: products[k]!,
    quantity: "10",
    unitPrice: `${12 + k}.35`,
    discount: k === 1 ? "1.10" : "0",
    rate: k === 4 ? { taxCode: "2", rateCode: "0", percentage: "0" } : undefined,
  }));

/**
 * 100 000 facturas AUTHORIZED por SQL con el snapshot real de 5 líneas, y 10 000 con un crédito
 * previo de 2 líneas: notas de crédito con su reserva, sus líneas con los importes del cálculo único
 * y la capacidad que los triggers diferidos exigen al confirmar cada lote.
 */
async function seed(backend: E2eBackend, data: Prepared, noteTemplate: string) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const lines = fiveLines(data.products);
  const draft = invoiceSnapshot(lines);
  const total = draft.totals.total;
  const prior = calculateCreditNoteAmounts({
    invoiceLines: draft.lines,
    credited: [],
    requested: [
      { position: 1, quantity: "1" },
      { position: 2, quantity: "1" },
    ],
    invoice: { total, reserved: "0", applied: "0" },
  });
  if (!prior.totals) throw new Error(`crédito previo inválido: ${JSON.stringify(prior.issues)}`);
  const priorLines = prior.lines;
  const priorAmount = prior.totals.total;

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

  // Créditos previos de las primeras 10 000 facturas sembradas: la nota (con el mismo secuencial),
  // su reserva, sus líneas y la capacidad.
  const lineValues = priorLines
    .map(
      (line) =>
        `(${line.position}, '${line.quantity}'::numeric, '${line.subtotal}'::numeric, '${line.discount}'::numeric, '${line.taxableBase}'::numeric, '${JSON.stringify(line.taxes)}'::jsonb)`,
    )
    .join(", ");
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
         SELECT 'bench-res-04-' || g, $1, 'TEST', $2, $3, '04', g, now() - ((${LAST_CREDITED} - g + 2) * interval '5 minutes'), $4, 'bench-seed'
         FROM generate_series(${FIRST}, ${LAST_CREDITED}) g`,
        company,
        data.establishmentId,
        data.pointId,
        user,
      );
      // Como la emisión real: las notas nacen sin concluir con su capacidad reservada, y tres de
      // cada cuatro concluyen después, en otra transacción (los triggers diferidos comprueban cada
      // evento con sus valores). La cuarta queda SIGNED con su crédito reservado.
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, attempt_count)
         SELECT 'bench-nc-' || r.sequential, r.company_id, '04', 'TEST', r.establishment_id, r.emission_point_id,
                '001-001-' || lpad(r.sequential::text, 9, '0'), r.sequential, r.id,
                '04' || lpad(r.sequential::text, 47, '0'), '12345678', r.reserved_at::date,
                CASE WHEN r.sequential % 4 = 0 THEN 'SIGNED' ELSE 'RECEIVED' END,
                d.snapshot, d.schema_version, $2, $3, $4::numeric, r.reserved_at, $5, r.reserved_at + interval '1 second', 1
         FROM ${t("fiscal_sequence_reservation")} r CROSS JOIN ${t("electronic_document")} d
         WHERE d.id = $6 AND r.company_id = $1 AND r.document_type = '04' AND r.id LIKE 'bench-res-04-%'`,
        company,
        draft.buyer.identification,
        draft.buyer.legalName,
        priorAmount,
        user,
        noteTemplate,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("document_artifact")} (id, company_id, document_id, kind, media_type, content, size_bytes, sha256, metadata, created_at)
         SELECT gen_random_uuid()::text, d.company_id, d.id, 'SIGNED_XML', 'application/xml', c.content, octet_length(c.content),
                encode(sha256(c.content), 'hex'), '{"documentType": "04", "schemaVersion": "1.1.0"}'::jsonb, d.signed_at
         FROM ${t("electronic_document")} d
         CROSS JOIN LATERAL (SELECT convert_to('<notaCredito id="comprobante" version="1.1.0"><infoTributaria><claveAcceso>' || d.access_key || '</claveAcceso></infoTributaria></notaCredito>', 'UTF8') AS content) c
         WHERE d.company_id = $1 AND d.id LIKE 'bench-nc-%'`,
        company,
      );
      // La capacidad primero: las reservas la referencian; los triggers diferidos comparan al confirmar.
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("credit_capacity")} (company_id, invoice_id, original_total, reserved_total, applied_total, created_at)
         SELECT $1, 'bench-inv-' || g, $2::numeric, $3::numeric, 0,
                now() - ((${LAST_CREDITED} - g + 2) * interval '5 minutes')
         FROM generate_series(${FIRST}, ${LAST_CREDITED}) g`,
        company,
        total,
        priorAmount,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("credit_capacity_line")} (company_id, invoice_id, position, product_id, original_quantity, reserved_quantity, applied_quantity)
         SELECT $1, 'bench-inv-' || g, l.position, l.product_id, l.quantity, coalesce(c.quantity, 0), 0
         FROM generate_series(${FIRST}, ${LAST_CREDITED}) g
         CROSS JOIN (SELECT (e ->> 'position')::int AS position, e ->> 'productId' AS product_id, (e ->> 'quantity')::numeric AS quantity
                     FROM jsonb_array_elements($2::jsonb) e) l
         LEFT JOIN (VALUES ${lineValues}) c(position, quantity, subtotal, discount, taxable_base, taxes) ON c.position = l.position`,
        company,
        JSON.stringify(draft.lines),
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("credit_reservation")} (id, company_id, invoice_id, credit_note_id, cause, amount, status, reserved_at)
         SELECT 'bench-cr-' || g, $1, 'bench-inv-' || g, 'bench-nc-' || g, 'RETURN', $2::numeric, 'RESERVED',
                now() - ((${LAST_CREDITED} - g + 2) * interval '5 minutes')
         FROM generate_series(${FIRST}, ${LAST_CREDITED}) g`,
        company,
        priorAmount,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("credit_reservation_line")} (reservation_id, company_id, invoice_id, position, quantity, subtotal, discount, taxable_base, taxes, physical_return)
         SELECT 'bench-cr-' || g, $1, 'bench-inv-' || g, v.position, v.quantity, v.subtotal, v.discount, v.taxable_base, v.taxes, 0
         FROM generate_series(${FIRST}, ${LAST_CREDITED}) g
         CROSS JOIN (VALUES ${lineValues}) v(position, quantity, subtotal, discount, taxable_base, taxes)`,
        company,
      );
    },
    { timeout: 1_800_000, maxWait: 10_000 },
  );
  // La conclusión de tres de cada cuatro notas: autorizada, su reserva aplicada y su capacidad
  // pasada de reservada a aplicada, en una transacción, como el seguidor de la autorización.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE ${t("electronic_document")} SET state = 'AUTHORIZED', authorization_number = access_key,
                authorization_date = created_at + interval '1 minute', authorization_environment = 'TEST'
         WHERE company_id = $1 AND id LIKE 'bench-nc-%' AND state = 'RECEIVED'`,
        company,
      );
      await tx.$executeRawUnsafe(
        `UPDATE ${t("credit_reservation")} SET status = 'APPLIED', concluded_at = reserved_at + interval '2 minutes'
         WHERE company_id = $1 AND id LIKE 'bench-cr-%' AND split_part(id, '-', 3)::int % 4 <> 0`,
        company,
      );
      await tx.$executeRawUnsafe(
        `UPDATE ${t("credit_capacity")} SET applied_total = reserved_total, reserved_total = 0
         WHERE company_id = $1 AND invoice_id LIKE 'bench-inv-%' AND split_part(invoice_id, '-', 3)::int % 4 <> 0`,
        company,
      );
      await tx.$executeRawUnsafe(
        `UPDATE ${t("credit_capacity_line")} SET applied_quantity = reserved_quantity, reserved_quantity = 0
         WHERE company_id = $1 AND invoice_id LIKE 'bench-inv-%' AND split_part(invoice_id, '-', 3)::int % 4 <> 0`,
        company,
      );
    },
    { timeout: 1_800_000, maxWait: 10_000 },
  );
  // Los contadores siguen después de lo sembrado.
  await prisma.$executeRawUnsafe(
    `UPDATE ${t("fiscal_sequence")} SET next_number = CASE document_type WHEN '01' THEN ${LAST_INVOICE + 1} ELSE ${LAST_CREDITED + 1} END,
            last_reserved = CASE document_type WHEN '01' THEN ${LAST_INVOICE} ELSE ${LAST_CREDITED} END
     WHERE company_id = $1 AND document_type IN ('01', '04')`,
    company,
  );
  for (const table of [
    "fiscal_sequence",
    "fiscal_sequence_reservation",
    "electronic_document",
    "document_artifact",
    "credit_capacity",
    "credit_capacity_line",
    "credit_reservation",
    "credit_reservation_line",
    "stock_return_capacity",
    "stock_return_reservation",
  ]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${t(table)}`);
  }
  return { company, user, total, priorAmount };
}

async function volume(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const result: Record<string, { rows: number; totalSize: string }> = {};
  for (const table of [
    "electronic_document",
    "document_artifact",
    "credit_capacity",
    "credit_capacity_line",
    "credit_reservation",
    "credit_reservation_line",
    "stock_return_reservation",
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

async function draftFor(
  backend: E2eBackend,
  cookie: string,
  pointId: string,
  invoiceId: string,
  lines: readonly { position: number; quantity: string; physicalReturn?: string }[],
) {
  const draft = await call(backend, cookie, "POST", "/credit-notes/drafts", {
    invoiceId,
    emissionPointId: pointId,
    cause: "RETURN",
    reason: "Devolución del benchmark",
    lines,
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
  const res = await fetch(`${backend.base}/api/v1/credit-notes`, {
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

/** Emisiones en serie de una nota de 1 línea sobre facturas distintas (`invoices`). */
async function measureSerialEmissions(
  backend: E2eBackend,
  data: Prepared,
  invoices: readonly string[],
) {
  const emissions: Emission[] = [];
  for (const [index, invoiceId] of invoices.entries()) {
    const cookie = data.operators[index % data.operators.length]!;
    const draft = await draftFor(backend, cookie, data.pointId, invoiceId, [
      { position: 3, quantity: "1" },
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
  rounds: readonly (readonly {
    invoiceId: string;
    lines: { position: number; quantity: string; physicalReturn?: string }[];
  }[])[],
) {
  const emissions: Emission[] = [];
  const throughput: number[] = [];
  for (const round of rounds) {
    const drafts = [];
    for (const [index, target] of round.entries()) {
      drafts.push(
        await draftFor(
          backend,
          data.operators[index % data.operators.length]!,
          data.pointId,
          target.invoiceId,
          target.lines,
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

/** El cálculo único de una devolución parcial de 100 líneas, con créditos previos en todas. */
function measureCalculation(products: readonly string[]) {
  const lines: InvoiceLineSpec[] = Array.from({ length: MANY_LINES }, (_, k) => ({
    productId: products[k % products.length]!,
    quantity: `${7 + (k % 5)}.${k % 3}`,
    unitPrice: `${(k % 40) + 1}.${String((k * 37) % 10_000).padStart(4, "0")}`,
    discount: k % 7 === 0 ? "0.35" : "0",
    rate: k % 5 === 0 ? { taxCode: "2", rateCode: "0", percentage: "0" } : undefined,
  }));
  const snapshot = invoiceSnapshot(lines);
  const first = calculateCreditNoteAmounts({
    invoiceLines: snapshot.lines,
    credited: [],
    requested: snapshot.lines.map((line) => ({ position: line.position, quantity: "1" })),
    invoice: { total: snapshot.totals.total, reserved: "0", applied: "0" },
  });
  if (!first.totals) throw new Error("crédito previo de 100 líneas inválido");
  const input = {
    invoiceLines: snapshot.lines,
    credited: first.lines.map((line) => ({
      position: line.position,
      quantity: line.quantity,
      subtotal: line.subtotal,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes,
    })),
    requested: snapshot.lines.map((line) => ({ position: line.position, quantity: "2.5" })),
    invoice: { total: snapshot.totals.total, reserved: "0", applied: first.totals.total },
  };
  for (let i = 0; i < WARMUP * 10; i += 1) calculateCreditNoteAmounts(input);
  const samples: number[] = [];
  for (let i = 0; i < CALC_SAMPLES; i += 1) {
    const started = performance.now();
    const result = calculateCreditNoteAmounts(input);
    samples.push(performance.now() - started);
    if (!result.totals) throw new Error(`cálculo inválido: ${JSON.stringify(result.issues)}`);
  }
  return { results: MANY_LINES, ...summarize(samples) };
}

/** Render del RIDE de una nota firmada en `RideWorkerPool`, con su duración en el worker. */
async function measureRide(backend: E2eBackend, company: string, noteId: string) {
  const prisma = backend.db.database.prisma;
  const note = await prisma.electronicDocument.findUniqueOrThrow({ where: { id: noteId } });
  const signed = await prisma.documentArtifact.findFirstOrThrow({
    where: { companyId: company, documentId: noteId, kind: "SIGNED_XML" },
  });
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
      paymentLabels: {},
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

const p12Dir = mkdtempSync(join(tmpdir(), "bench-credit-notes-p12-"));
generateP12Fixtures(p12Dir);
const backend = await startE2eBackend({
  label: "bench_credit_notes",
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
    { position: 1, quantity: "1" },
  ]);
  const templateNote = await emit(backend, data.cookie, template);

  console.log(
    `Sembrando ${INVOICES} facturas autorizadas, ${WITH_CREDITS} con un crédito previo de 2 líneas…`,
  );
  const seedStarted = performance.now();
  const seeded = await seed(backend, data, templateNote.id!);
  const seedSeconds = Math.round((performance.now() - seedStarted) / 100) / 10;
  const volumeBefore = await volume(backend);

  // Facturas reales del arnés para los escenarios que necesitan más capacidad o más líneas.
  const manyLines = await insertAuthorizedInvoice(
    prisma,
    harnessCompany,
    Array.from({ length: MANY_LINES }, (_, k) => ({
      productId: data.products[k % data.products.length]!,
      quantity: "20",
      unitPrice: `${(k % 40) + 1}.25`,
    })),
  );
  const contended = await insertAuthorizedInvoice(prisma, harnessCompany, [
    {
      productId: data.products[0]!,
      quantity: "1000",
      unitPrice: "3.10",
      inventoryAffectsStock: true,
    },
    { productId: data.products[1]!, quantity: "1000", unitPrice: "4.20" },
  ]);
  await recordOutflow(prisma, harnessCompany, contended, data.products[0]!, "1000", "1000");

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
    ["Facturas elegibles: primera página, sin filtro", "/credit-notes/eligible-invoices"],
    ["Facturas elegibles: búsqueda por número", "/credit-notes/eligible-invoices?search=000054321"],
    [
      "Facturas elegibles: búsqueda por comprador (todas coinciden)",
      "/credit-notes/eligible-invoices?search=perno",
    ],
  ] as const) {
    record(name, path, await measureGet(backend, cookie, path));
  }

  const freshDraft = await draftFor(backend, cookie, data.pointId, seededInvoice(LAST_INVOICE), [
    { position: 3, quantity: "2" },
  ]);
  const creditedDraft = await draftFor(backend, cookie, data.pointId, seededInvoice(FIRST), [
    { position: 1, quantity: "2" },
    { position: 3, quantity: "2" },
  ]);
  const manyDraft = await draftFor(
    backend,
    cookie,
    data.pointId,
    manyLines.id,
    Array.from({ length: MANY_LINES }, (_, k) => ({ position: k + 1, quantity: "7.5" })),
  );
  for (const [name, id] of [
    ["Vista previa del borrador sin créditos previos", freshDraft.id],
    ["Vista previa del borrador con créditos previos", creditedDraft.id],
    [`Vista previa del borrador de ${MANY_LINES} líneas`, manyDraft.id],
  ] as const) {
    record(
      name,
      `/credit-notes/drafts/{id}`,
      await measureGet(backend, cookie, `/credit-notes/drafts/${id}`),
    );
  }

  const calculation = measureCalculation(data.products);
  record(
    `Cálculo de una devolución parcial de ${MANY_LINES} líneas con créditos previos (en proceso)`,
    "calculateCreditNoteAmounts",
    calculation,
  );

  // Emisión en serie: facturas sin créditos (las más recientes) y con créditos previos.
  const freshInvoices = Array.from({ length: WARMUP + SAMPLES }, (_, k) =>
    seededInvoice(LAST_INVOICE - 1 - k),
  );
  const creditedInvoices = Array.from({ length: WARMUP + SAMPLES }, (_, k) =>
    seededInvoice(FIRST + 1 + k),
  );
  console.log("Emitiendo en serie sin créditos previos…");
  const serialFresh = await measureSerialEmissions(backend, data, freshInvoices);
  console.log("Emitiendo en serie con créditos previos…");
  const serialCredited = await measureSerialEmissions(backend, data, creditedInvoices);
  for (const [name, summary] of [
    ["Emisión con reserva sin créditos previos", serialFresh],
    ["Emisión con reserva con créditos previos", serialCredited],
  ] as const) {
    record(`${name}: total del servidor`, "POST /credit-notes", {
      results: SAMPLES,
      ...summary.stages.total,
    });
    record(`${name}: transacción de la reserva`, "reservation_tx", {
      results: SAMPLES,
      ...summary.stages.reservation_tx,
    });
  }

  // Contención: la misma factura (con retorno físico) y facturas distintas, en rondas simultáneas.
  console.log("Reservas que compiten por la misma factura…");
  const sameInvoice = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, () =>
      Array.from({ length: CONTENDERS }, () => ({
        invoiceId: contended.id,
        lines: [{ position: 1, quantity: "1", physicalReturn: "1" }],
      })),
    ),
  );
  console.log("Reservas simultáneas de facturas distintas…");
  const distinctInvoices = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) =>
      Array.from({ length: CONTENDERS }, (_, c) => ({
        invoiceId: seededInvoice(LAST_CREDITED + 10_000 + r * CONTENDERS + c),
        lines: [{ position: 3, quantity: "1" }],
      })),
    ),
  );
  const baseline = serialFresh.stages.reservation_tx.p50;
  const contention = [
    ["La misma factura", sameInvoice],
    ["Facturas distintas", distinctInvoices],
  ] as const;
  for (const [name, summary] of contention) {
    record(`${name}, ${CONTENDERS} simultáneas: total del servidor`, "POST /credit-notes", {
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

  const reconcileStarted = performance.now();
  const credit = await reconcileCreditCapacity(prisma, company);
  const returns = await reconcileStockReturnCapacity(prisma, company);
  const reconcileSeconds = Math.round((performance.now() - reconcileStarted) / 100) / 10;
  console.log(
    `Reconciliación: ${credit.length} diferencias acreditables y ${returns.length} devolvibles en ${reconcileSeconds} s`,
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
      withPriorCredits: WITH_CREDITS,
      linesPerInvoice: LINES,
      invoiceTotal: seeded.total,
      priorCreditAmount: seeded.priorAmount,
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
    serialEmissions: { withoutCredits: serialFresh, withCredits: serialCredited },
    contention: contentionReport,
    reconciliation: {
      creditDifferences: credit.length,
      returnDifferences: returns.length,
      seconds: reconcileSeconds,
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}credit-notes-${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const passed =
    results.every((r) => r.withinBudget) && credit.length === 0 && returns.length === 0;
  writeFileSync(
    `${OUT_DIR}credit-notes-${date}.md`,
    [
      `# Benchmark de las notas de crédito (${date})`,
      "",
      `Volumen: ${INVOICES} facturas AUTHORIZED de ${LINES} líneas, ${WITH_CREDITS} de ellas con un crédito previo de 2 líneas (tres de cada cuatro aplicado por una nota autorizada y una reservado por una nota firmada), en una empresa. Siembra por SQL en ${seedSeconds} s, con los triggers de la capacidad activos. Calentamiento de ${WARMUP} y ${SAMPLES} mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra \`main.ts\`, con la custodia habilitada y la transmisión apagada; la contención son ${ROUNDS} rondas de ${CONTENDERS} emisiones simultáneas. El cálculo se mide en proceso (${CALC_SAMPLES} veces) y el RIDE en \`RideWorkerPool\` con 2 workers. Objetivos: ERS RNF-005, P95 menor que ${BUDGET_MS} ms, y el P95 del render del RIDE menor que ${RIDE_BUDGET_MS} ms (design D21 de \`add-credit-notes\`). Las respuestas del SRI no participan. Generado por \`bench:credit-notes\`; datos en \`credit-notes-${date}.json\`.`,
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
      `| Escenario | ${STAGES.map((stage) => `\`${stage}\``).join(" | ")} | Cliente |`,
      `| --- | ${STAGES.map(() => "---").join(" | ")} | --- |`,
      ...(
        [
          ["Sin créditos previos", serialFresh],
          ["Con créditos previos", serialCredited],
        ] as const
      ).map(
        ([name, summary]) =>
          `| ${name} | ${STAGES.map((stage) => summary.stages[stage].p95).join(" | ")} | ${summary.client.p95} |`,
      ),
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
      `- La espera por bloqueos es lo que el P95 de \`reservation_tx\` supera a su mediana en serie (${baseline} ms), que no espera a nadie. Las reservas de una factura se serializan en su bloqueo de capacidad (design D8); las de una empresa, además, en el de la configuración y en el contador del punto (como la factura, design D7 de \`add-invoice-emission\`).`,
      "- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva (design D4).",
      "",
      `Reconciliación al terminar: ${credit.length} diferencias acreditables y ${returns.length} devolvibles, en ${reconcileSeconds} s.`,
      "",
      passed
        ? "Todas las operaciones cumplen su objetivo en este entorno y la reconciliación no encuentra diferencias."
        : "Al menos una operación supera su objetivo o la reconciliación encontró diferencias: analizar antes de cambiar índices o estrategia (`/opsx:update`).",
      "",
    ].join("\n"),
  );
  console.log(passed ? "Benchmark dentro del objetivo." : "Benchmark fuera del objetivo.");
  process.exitCode = passed ? 0 : 1;
} finally {
  await backend.stop();
  rmSync(p12Dir, { recursive: true, force: true });
}
