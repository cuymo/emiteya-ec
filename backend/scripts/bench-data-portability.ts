// Benchmark de la portabilidad (add-data-portability, design D20 y D22). Es un gate dedicado: no forma
// parte de `verify` ni de la suite de pruebas. Ejecútalo sobre una PostgreSQL 17 sin carga ajena, con
// el frontend compilado (`corepack pnpm --filter @facturador/frontend build`):
//
//   corepack pnpm --filter @facturador/backend bench:data-portability
//
// Arranca main.ts sobre un esquema aislado de la base de pruebas y un directorio de paquetes propio
// (`BENCH_PORTABILITY_DIRECTORY`, por defecto `~/.cache/facturador-bench-portability`, fuera de un
// `tmpfs`), sin firma ni transmisión. Siembra el volumen de Q-26 (`support/q26-volume.ts`) y, por SQL,
// lo que solo exporta la portabilidad: el XML firmado de cada comprobante, y de cada autorizado su XML
// autorizado, su RIDE y dos respuestas del SRI. Los bytes son los de una factura real de tres líneas
// (builder, XSD y firma sintética; nunca una firma real) y de su RIDE renderizado, con la clave de
// acceso de cada comprobante. Suma transiciones, entregas, 300 000 eventos de auditoría, 10 usuarios
// y los datos de `seedPortabilityExtras` (firmas con sus secretos marcados, logo y versiones).
//
// Mide, sobre la generación real del job en main.ts:
//   - el reloj de cada fase y el total, la CPU y la memoria residente de main.ts, el disco del
//     directorio, el tamaño del ZIP y sus entradas;
//   - la duración de la transacción de la fase 1 y su presión MVCC (las tuplas muertas que VACUUM no
//     puede quitar de una tabla con escrituras mientras dura);
//   - el P95 de dos listas de la API, en reposo y durante la generación (ERS RNF-005, menos de 2 s);
//   - el costo de la sentencia de renovación del lease sobre el job real;
//   - el `409` de la misma empresa y la cola entre empresas;
//   - la verificación previa a la descarga y la descarga, directa y por la ruta de Next, con la
//     memoria residente de los dos procesos;
//   - la recuperación tras matar main.ts a mitad de la generación, el worker obsoleto con dos
//     instancias y la caducidad con el barrido.
// Valida el paquete con `unzip -t`, Python `zipfile`, `sha256sum -c`, openpyxl, un parser JSON y el XSD
// sobre una muestra de XML. Escribe el entorno y los resultados en docs/quality/benchmarks/. Sale con
// error si una lista supera ERS RNF-005 o falla una validación o una garantía.
//
// Con `BENCH_PORTABILITY_SMOKE=1` recorre las mismas etapas con una empresa pequeña, en minutos, para
// probar el propio benchmark; sus resultados van al temporal del sistema, no a docs/. Para openpyxl,
// `BENCH_PYTHON` apunta a un intérprete que lo tenga.
import { execFileSync, execSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, homedir, release, tmpdir, totalmem, type } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Registry } from "@prometheus-io/client";
import type { DataExportView } from "@facturador/contracts";
import { AUDIT_ACTIONS } from "../src/modules/audit/domain/audit-event.ts";
import { createAuditLog } from "../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createDataExports } from "../src/modules/data-portability/application/service.ts";
import { registerPortabilityMetrics } from "../src/modules/data-portability/infrastructure/metrics.ts";
import { createPackageFiles } from "../src/modules/data-portability/infrastructure/package-files.ts";
import { createDataExportStore } from "../src/modules/data-portability/infrastructure/prisma-data-exports.ts";
import { createPortabilityDatabase } from "../src/modules/data-portability/infrastructure/prisma-portability-database.ts";
import type { Authorizer } from "../src/modules/identity/application/authorization.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { createInProcessRideRenderer } from "../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { createXmllintXsdValidator } from "../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { createPrismaJobStore } from "../src/platform/jobs/prisma-job-store.ts";
import { startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";
import { insertFiscalCompany, type FiscalCompany } from "../test/integration/fiscal-harness.ts";
import { insertMember } from "../test/integration/fixtures.ts";
import {
  PORTABILITY_ADMIN,
  portabilityEnv,
  provisionPortability,
} from "../test/integration/portability-e2e-harness.ts";
import {
  completeAuthorizedArtifacts,
  seedPortabilityExtras,
} from "../test/integration/portability-harness.ts";
import { seedReportData } from "../test/integration/reports-api-harness.ts";
import { generateP12Fixtures } from "../test/support/p12-fixtures.ts";
import {
  COMPANY_BUYER,
  authorizedInvoice,
  invoiceSchema,
  line,
} from "../test/support/ride-invoices.ts";
import {
  renderPortabilityReport,
  type PortabilityBenchResults,
} from "./support/portability-report.ts";
import { DOCUMENTS, FIRST_DAY, TEST_INVOICES, seedQ26Volume } from "./support/q26-volume.ts";

const LABEL = "bench_data_portability";
/**
 * Prueba de humo del propio benchmark: una empresa pequeña en lugar del volumen de Q-26, para
 * recorrer todas las etapas en minutos. Sus resultados no se guardan en docs/.
 */
const SMOKE = process.env.BENCH_PORTABILITY_SMOKE === "1";
const AUDIT_EVENTS = 300_000;
const USERS = 10;
/** ERS RNF-005: P95 menor que 2 s. */
const BUDGET_MS = 2_000;
const LIST_SAMPLES = 60;
const SWEEP_SECONDS = 10;
const DIRECTORY =
  process.env.BENCH_PORTABILITY_DIRECTORY ??
  join(homedir(), ".cache", "facturador-bench-portability");
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));
const FRONTEND_DIR = fileURLToPath(new URL("../../frontend/", import.meta.url));
const DOCS_DIR = fileURLToPath(new URL("../../docs/product/", import.meta.url));
const PLACEHOLDER = "@@CLAVE@@";
const SPARE_DIRECTORY = join(DIRECTORY, "..", "facturador-bench-portability-extraido");
/** Un intérprete con openpyxl (por ejemplo, el de un entorno virtual); el del sistema por defecto. */
const PYTHON = process.env.BENCH_PYTHON ?? "python3";

const round = (n: number) => Math.round(n * 10) / 10;
const mib = (bytes: number) => round(bytes / 2 ** 20);
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
const summarize = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1)!),
  };
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const failures: string[] = [];
function ensure(condition: unknown, message: string) {
  if (!condition) {
    failures.push(message);
    console.error(`FALLA: ${message}`);
  }
}

const status = (pid: number, field: "VmRSS" | "VmHWM") =>
  Number(new RegExp(`${field}:\\s+(\\d+)`).exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1]) *
  1024;
function cpuMs(pid: number): number {
  const fields = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]!.split(" ");
  return ((Number(fields[11]) + Number(fields[12])) * 1000) / 100;
}
const diskBytes = (path: string) =>
  existsSync(path)
    ? Number(execFileSync("du", ["-sb", path], { encoding: "utf8" }).split("\t")[0])
    : 0;

/** Repite `work` cada `ms` hasta que se detiene; devuelve la función que lo detiene. */
function every(ms: number, work: () => Promise<void> | void) {
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        await work();
      } catch (error) {
        console.error("muestreo:", error instanceof Error ? error.message : error);
      }
      await sleep(ms);
    }
  })();
  return async () => {
    running = false;
    await loop;
  };
}

async function environment(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const setting = async (name: string) =>
    (await prisma.$queryRawUnsafe<Record<string, string>[]>(`SHOW ${name}`))[0]![name]!;
  const version = (await prisma.$queryRaw<{ version: string }[]>`SELECT version()`)[0]!.version;
  const device = execFileSync("df", ["--output=source,fstype", DIRECTORY], { encoding: "utf8" })
    .trim()
    .split("\n")[1]!
    .trim();
  return {
    postgres: version,
    shared_buffers: await setting("shared_buffers"),
    work_mem: await setting("work_mem"),
    jit: await setting("jit"),
    node: process.version,
    os: `${type()} ${release()}`,
    cpu: `${cpus()[0]?.model ?? "?"} (${cpus().length} núcleos)`,
    memory: `${Math.round(totalmem() / 2 ** 30)} GiB`,
    directory: device,
    commit: execSync("git rev-parse --short HEAD").toString().trim(),
  };
}

/** Bytes reales de una factura de tres líneas y su RIDE, con la clave de acceso como marcador. */
async function templates() {
  const p12Dir = mkdtempSync(join(tmpdir(), "bench-portability-p12-"));
  try {
    generateP12Fixtures(p12Dir);
    const invoice = await authorizedInvoice(
      {
        name: "bench-portabilidad",
        issueDate: "2026-10-04",
        sequential: "000000001",
        environment: "2",
        buyer: COMPANY_BUYER,
        lines: [line(1), line(2), line(3)],
      },
      p12Dir,
    );
    const assets = loadRideAssets(defaultRideFontsDirectory());
    if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
    const ride = await createInProcessRideRenderer(assets.fonts).render(invoice.input);
    if (ride.status !== "RENDERED") throw new Error(`RIDE: ${JSON.stringify(ride)}`);
    const key = invoice.snapshot.accessKey;
    const signed = invoice.xml.toString("utf8").split(key).join(PLACEHOLDER);
    const authorization = `<autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${PLACEHOLDER}</numeroAutorizacion><fechaAutorizacion>2026-10-04T15:20:11-05:00</fechaAutorizacion><ambiente>PRODUCCIÓN</ambiente><comprobante><![CDATA[${signed}]]></comprobante><mensajes/></autorizacion>`;
    const soap = (body: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
    return {
      signed,
      authorized: `<?xml version="1.0" encoding="UTF-8"?>${authorization}`,
      ride: Buffer.from(ride.pdf),
      reception: soap(
        `<ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>RECIBIDA</estado><comprobantes/></RespuestaRecepcionComprobante></ns2:validarComprobanteResponse>`,
      ),
      authorizationResponse: soap(
        `<ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>${PLACEHOLDER}</claveAccesoConsultada><numeroComprobantes>1</numeroComprobantes><autorizaciones>${authorization}</autorizaciones></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse>`,
      ),
      sizes: { signed: invoice.xml.length, ride: ride.pdf.length },
    };
  } finally {
    rmSync(p12Dir, { recursive: true, force: true });
  }
}

/**
 * Lo que solo exporta la portabilidad, por SQL y con los triggers de la sesión apagados, por grupo
 * de comprobantes. `skip` es el comprobante cuya evidencia siembra `seedPortabilityExtras`.
 */
async function seedEvidence(
  backend: E2eBackend,
  company: FiscalCompany,
  bytes: Awaited<ReturnType<typeof templates>>,
  skip: string,
) {
  const prisma = backend.db.database.prisma;
  const t = (table: string) => `"${backend.db.name}"."${table}"`;
  const groups = [
    ...Object.keys(DOCUMENTS).map((documentType) => `bench-doc-${documentType}-P-%`),
    "bench-doc-01-T-%",
  ];
  for (const group of groups) {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_artifact")} (id, company_id, document_id, kind, media_type, content, size_bytes, sha256, metadata, created_at)
           SELECT d.id || '-firmado', d.company_id, d.id, 'SIGNED_XML', 'application/xml', c.content, length(c.content), encode(sha256(c.content), 'hex'), '{}', d.created_at
           FROM ${t("electronic_document")} d
           CROSS JOIN LATERAL (SELECT convert_to(replace($1, '${PLACEHOLDER}', d.access_key), 'UTF8') AS content) c
           WHERE d.company_id = $2 AND d.id LIKE $3`,
          bytes.signed,
          company.companyId,
          group,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_artifact")} (id, company_id, document_id, kind, media_type, content, size_bytes, sha256, metadata, created_at)
           SELECT d.id || '-' || a.kind, d.company_id, d.id, a.kind, a.media_type, a.content, length(a.content), encode(sha256(a.content), 'hex'), '{}', d.created_at
           FROM ${t("electronic_document")} d
           CROSS JOIN LATERAL (VALUES
             ('AUTHORIZED_XML', 'application/xml', convert_to(replace($1, '${PLACEHOLDER}', d.access_key), 'UTF8')),
             ('RIDE_PDF', 'application/pdf', $2::bytea || convert_to('%' || d.access_key || E'\\n', 'UTF8'))
           ) a(kind, media_type, content)
           WHERE d.company_id = $3 AND d.id LIKE $4 AND d.state = 'AUTHORIZED' AND d.id <> $5`,
          bytes.authorized,
          bytes.ride,
          company.companyId,
          group,
          skip,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("sri_attempt")} (id, company_id, document_id, attempt_number, operation, environment, endpoint, origin, started_at, completed_at, transport_outcome, http_status, envelope_sha256, envelope_size, created_at)
           SELECT d.id || '-intento-' || n, d.company_id, d.id, n, CASE n WHEN 1 THEN 'RECEPTION' ELSE 'AUTHORIZATION' END,
                  d.environment, 'https://sri-simulado.invalid/servicio', 'AUTOMATIC',
                  d.created_at + n * interval '1 second', d.created_at + n * interval '1 second' + interval '300 milliseconds',
                  'RESPONSE', 200, repeat('e', 64), 12000, d.created_at
           FROM ${t("electronic_document")} d
           CROSS JOIN LATERAL generate_series(1, CASE WHEN d.state = 'RETURNED' THEN 1 ELSE 2 END) n
           WHERE d.company_id = $1 AND d.id LIKE $2 AND d.id <> $3`,
          company.companyId,
          group,
          skip,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("sri_response")} (attempt_id, company_id, body, size_bytes, sha256, content_type, truncated, created_at)
           SELECT a.id, a.company_id, c.body, length(c.body), encode(sha256(c.body), 'hex'), 'text/xml', false, a.completed_at
           FROM ${t("sri_attempt")} a
           JOIN ${t("electronic_document")} d ON d.id = a.document_id
           CROSS JOIN LATERAL (SELECT convert_to(replace(CASE a.operation WHEN 'RECEPTION' THEN $1 ELSE $2 END,
             '${PLACEHOLDER}', d.access_key), 'UTF8') AS body) c
           WHERE a.company_id = $3 AND a.document_id LIKE $4 AND a.id LIKE '%-intento-%'`,
          bytes.reception,
          bytes.authorizationResponse,
          company.companyId,
          group,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_state_transition")} (id, company_id, document_id, from_state, to_state, cause, actor_type, actor_user_id, occurred_at)
           SELECT d.id || '-transicion-' || s.n, d.company_id, d.id, s.from_state, s.to_state, s.cause, s.actor_type,
                  CASE WHEN s.n = 1 THEN $1 END, d.created_at + s.n * interval '1 second'
           FROM ${t("electronic_document")} d
           CROSS JOIN LATERAL (VALUES (1, NULL, 'RESERVED', 'reservation', 'USER'),
                                      (2, 'RESERVED', 'SIGNED', 'signed', 'SYSTEM'),
                                      (3, 'SIGNED', d.state, 'sri', 'SYSTEM')) s(n, from_state, to_state, cause, actor_type)
           WHERE d.company_id = $2 AND d.id LIKE $3 AND d.id <> $4`,
          company.adminId,
          company.companyId,
          group,
          skip,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_delivery_event")} (id, company_id, document_id, event, artifact_kind, artifact_sha256, actor_user_id, request_id, occurred_at)
           SELECT d.id || '-entrega', d.company_id, d.id, 'DOWNLOAD', 'RIDE_PDF', a.sha256, $1, 'bench-' || d.id, d.created_at + interval '1 day'
           FROM ${t("electronic_document")} d
           JOIN ${t("document_artifact")} a ON a.document_id = d.id AND a.kind = 'RIDE_PDF'
           WHERE d.company_id = $2 AND d.id LIKE $3 AND abs(hashtext(d.id)) % 10 = 0`,
          company.adminId,
          company.companyId,
          group,
        );
      },
      { timeout: 1_800_000, maxWait: 10_000 },
    );
    console.log(`  evidencia de ${group}`);
  }
  const actions = AUDIT_ACTIONS.filter((action) => !action.startsWith("data_export.")).slice(0, 12);
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(
        `INSERT INTO ${t("audit_event")} (id, company_id, actor_type, actor_user_id, action, changes, correlation_id, occurred_at)
         SELECT 'bench-auditoria-' || g, $1, 'USER', $2, ($3::text[])[1 + g % ${actions.length}],
                jsonb_build_object('n', g), 'bench-' || g, timestamptz '${FIRST_DAY} 08:00:00-05' + g * interval '100 seconds'
         FROM generate_series(1, ${AUDIT_EVENTS}) g`,
        company.companyId,
        company.adminId,
        actions,
      );
    },
    { timeout: 600_000, maxWait: 10_000 },
  );
  for (let index = 1; index <= USERS; index += 1) {
    await insertMember(prisma, company.companyId, {
      name: `Operador del benchmark ${index}`,
      role: "OPERATOR",
    });
  }
}

async function volume(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const result: Record<string, { rows: number; totalSize: string }> = {};
  for (const table of [
    "electronic_document",
    "document_artifact",
    "sri_attempt",
    "sri_response",
    "document_state_transition",
    "document_delivery_event",
    "audit_event",
    "party",
    "product",
    "stock_movement",
  ]) {
    const [row] = await prisma.$queryRawUnsafe<{ rows: bigint; size: string }[]>(
      `SELECT count(*) AS rows, pg_size_pretty(pg_total_relation_size('"${backend.db.name}"."${table}"')) AS size FROM "${backend.db.name}"."${table}"`,
    );
    result[table] = { rows: Number(row!.rows), totalSize: row!.size };
  }
  return result;
}

type Api = { backend: E2eBackend; cookie: string };
async function view(api: Api, id: string): Promise<DataExportView> {
  const res = await api.backend.fetchApi("GET", `/data-exports/${id}`, api.cookie);
  return ((await res.json()) as { data: DataExportView }).data;
}
async function request(api: Api) {
  const res = await api.backend.fetchApi("POST", "/data-exports", api.cookie, {});
  return { status: res.status, body: (await res.json()) as { data?: DataExportView } };
}
async function listSamples(api: Api, until: () => boolean, maxSamples = Infinity) {
  const paths = ["/parties?page=1&pageSize=25", "/invoices?page=1&pageSize=25"];
  const samples: number[] = [];
  for (let i = 0; !until() && i < maxSamples; i += 1) {
    const started = performance.now();
    const res = await api.backend.fetchApi("GET", paths[i % paths.length]!, api.cookie);
    await res.arrayBuffer();
    if (res.status !== 200) throw new Error(`${paths[i % paths.length]} respondió ${res.status}`);
    samples.push(performance.now() - started);
  }
  return samples;
}
async function metric(base: string, name: string) {
  const text = await (await fetch(`${base}/metrics`)).text();
  const values: Record<string, number> = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith(name)) continue;
    const [key, value] = line.split(" ");
    values[key!] = Number(value);
  }
  return values;
}

/** Espera a que una condición sobre la exportación se cumpla, consultando cada `ms`. */
async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number, ms = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await sleep(ms);
  }
  throw new Error("se agotó la espera");
}

function coldCache(path: string) {
  execFileSync("python3", [
    "-I",
    "-c",
    "import os,sys; fd=os.open(sys.argv[1],os.O_RDONLY); os.posix_fadvise(fd,0,0,os.POSIX_FADV_DONTNEED); os.close(fd)",
    path,
  ]);
}

async function download(
  url: string,
  cookie: string,
  expected: string,
  pids: Record<string, number>,
) {
  const baseline = Object.fromEntries(
    Object.entries(pids).map(([k, pid]) => [k, status(pid, "VmRSS")]),
  );
  const peak = { ...baseline };
  const stop = every(100, () => {
    for (const [k, pid] of Object.entries(pids)) peak[k] = Math.max(peak[k]!, status(pid, "VmRSS"));
  });
  const started = performance.now();
  const res = await fetch(url, { headers: { cookie } });
  const headersMs = performance.now() - started;
  const hash = createHash("sha256");
  let received = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    received += chunk.length;
  }
  const totalMs = performance.now() - started;
  await stop();
  return {
    status: res.status,
    received,
    sha256Matches: hash.digest("hex") === expected,
    headersMs: Math.round(headersMs),
    totalMs: Math.round(totalMs),
    throughputMiBs: Math.round(received / 2 ** 20 / (totalMs / 1000)),
    rssGrowthMiB: Object.fromEntries(
      Object.keys(pids).map((k) => [k, mib(peak[k]! - baseline[k]!)]),
    ),
  };
}

function startNext(apiBase: string, port: number): Promise<ChildProcess> {
  if (!existsSync(join(FRONTEND_DIR, ".next", "BUILD_ID")))
    throw new Error("Compila el frontend antes: corepack pnpm --filter @facturador/frontend build");
  const next = spawn(
    join(FRONTEND_DIR, "node_modules", ".bin", "next"),
    ["start", "--port", String(port)],
    {
      cwd: FRONTEND_DIR,
      env: { PATH: process.env.PATH, API_INTERNAL_URL: apiBase, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  return waitFor(
    async () =>
      (await fetch(`http://127.0.0.1:${port}/iniciar-sesion`).then(
        (r) => r.ok,
        () => false,
      ))
        ? next
        : null,
    60_000,
    300,
  );
}
const listeningPid = (port: number) =>
  Number(
    /pid=(\d+)/.exec(execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" }))?.[1],
  );

function validatePackage(path: string) {
  const started = performance.now();
  const result: Record<string, unknown> = {};
  const unzip = execFileSync("unzip", ["-tq", path], { encoding: "utf8", maxBuffer: 2 ** 26 });
  // Sin la ruta del paquete: el informe no lleva rutas de la máquina.
  result.unzipTest = /No errors detected/.test(unzip) ? "sin errores" : "con errores";
  ensure(/No errors detected/.test(unzip), "unzip -t no aprueba el paquete");
  const zip = execFileSync(
    "python3",
    [
      "-I",
      "-c",
      "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); bad=z.testzip(); print(len(z.namelist()), bad or 'ok')",
      path,
    ],
    { encoding: "utf8" },
  ).trim();
  result.pythonZipfile = zip;
  ensure(zip.endsWith(" ok"), `Python zipfile: ${zip}`);
  rmSync(SPARE_DIRECTORY, { recursive: true, force: true });
  mkdirSync(SPARE_DIRECTORY, { recursive: true });
  execFileSync("unzip", ["-q", path, "-d", SPARE_DIRECTORY]);
  let sums: string;
  try {
    sums = execFileSync("sha256sum", ["-c", "--strict", "--quiet", "SHA256SUMS"], {
      cwd: SPARE_DIRECTORY,
      env: { ...process.env, LC_ALL: "C" },
      encoding: "utf8",
      maxBuffer: 2 ** 26,
    });
  } catch (error) {
    sums = (error as { stdout?: string }).stdout || "sha256sum falló";
  }
  const listed = readFileSync(join(SPARE_DIRECTORY, "SHA256SUMS"), "utf8").trim().split("\n");
  result.sha256sum = `${listed.length} archivos, ${sums.trim() === "" ? "todos OK" : sums.trim().slice(0, 500)}`;
  ensure(sums.trim() === "", "sha256sum -c encontró diferencias");
  const books = execFileSync(
    PYTHON,
    [
      "-I",
      "-c",
      [
        "import sys,os",
        "try:",
        "  import openpyxl",
        "except ImportError:",
        "  print('sin openpyxl'); sys.exit(0)",
        "root=sys.argv[1]; out=[]",
        "for d,_,fs in sorted(os.walk(root)):",
        "  for f in sorted(fs):",
        "    if f.endswith('.xlsx'):",
        "      wb=openpyxl.load_workbook(os.path.join(d,f), read_only=True)",
        "      for ws in wb.worksheets:",
        "        out.append(f'{f}:{ws.title}:{sum(1 for _ in ws.iter_rows(values_only=True))}')",
        "print(';'.join(out))",
      ].join("\n"),
      SPARE_DIRECTORY,
    ],
    { encoding: "utf8", maxBuffer: 2 ** 24 },
  ).trim();
  result.openpyxl = books;
  ensure(
    books !== "sin openpyxl" && books.split(";").length >= 6,
    `openpyxl no leyó los libros: ${books || "ninguno"} (BENCH_PYTHON)`,
  );
  const manifest = JSON.parse(readFileSync(join(SPARE_DIRECTORY, "manifest.json"), "utf8")) as {
    formatVersion: string;
    counts: Record<string, number>;
  };
  result.manifest = { formatVersion: manifest.formatVersion, counts: manifest.counts };
  ensure(manifest.formatVersion === "1", "el manifiesto no declara la versión 1");
  result.validationSeconds = Math.round((performance.now() - started) / 1000);
  return result;
}

async function validateXsdSample() {
  const validator = createXmllintXsdValidator({ root: DOCS_DIR });
  // Las facturas de Producción: su XML firmado es el de una factura real con su clave de acceso.
  const invoices = join(SPARE_DIRECTORY, "documents", "produccion", "01-factura");
  const files = readdirSync(invoices)
    .slice(0, 20)
    .map((folder) => join(invoices, folder, "firmado.xml"));
  let valid = 0;
  for (const file of files) {
    const outcome = await validator.validate(readFileSync(file, "utf8"), invoiceSchema());
    if ("valid" in outcome && outcome.valid === true) valid += 1;
  }
  ensure(files.length > 0 && valid === files.length, `XSD: ${valid} de ${files.length}`);
  return { sample: files.length, valid };
}

// ---------------------------------------------------------------------------------------------
rmSync(DIRECTORY, { recursive: true, force: true });
mkdirSync(DIRECTORY, { recursive: true, mode: 0o700 });
console.log("Preparando los bytes reales de una factura y su RIDE…");
const bytes = await templates();
const env = portabilityEnv(DIRECTORY, {
  DATA_EXPORT_SWEEP_INTERVAL_SECONDS: String(SWEEP_SECONDS),
  DATA_EXPORT_DISK_RESERVE_MIB: "512",
  DATA_EXPORT_DISK_HEADROOM_PERCENT: "10",
});
const installation = await provisionPortability({ label: LABEL, directory: DIRECTORY, env });
const { db, company } = installation;
let backend = installation.backend;
const prisma = db.database.prisma;
const extraBackends: E2eBackend[] = [];
let next: ChildProcess | undefined;
const results: Record<string, unknown> = {};
try {
  const api: Api = { backend, cookie: installation.cookies.admin };
  console.log(SMOKE ? "Sembrando la empresa pequeña de humo…" : "Sembrando el volumen de Q-26…");
  const seedStarted = performance.now();
  const marked = await insertMember(prisma, company.companyId, {
    name: "Usuario Marcado",
    email: "marcado@bench-portabilidad.ec",
    role: "OPERATOR",
  });
  if (SMOKE) {
    const smokeIds = await seedReportData(prisma, company);
    await seedPortabilityExtras(prisma, company, smokeIds.invoice!, {
      configured: true,
      authUserId: marked.userId,
    });
    await completeAuthorizedArtifacts(prisma, company.companyId);
  } else {
    await seedQ26Volume(prisma, db.name, {
      company: company.companyId,
      user: company.adminId,
      points: company.points.map((p) => ({
        establishment: p.establishmentId,
        point: p.emissionPointId,
      })),
    });
    const skip = "bench-doc-01-P-1";
    await seedEvidence(backend, company, bytes, skip);
    // Cada autorizado ya tiene su XML autorizado; `completeAuthorizedArtifacts` es para las pequeñas.
    await seedPortabilityExtras(prisma, company, skip, {
      configured: true,
      authUserId: marked.userId,
    });
  }
  // Otra empresa, pequeña, para la cola entre empresas y el worker obsoleto; otra para la caducidad.
  const other = await insertFiscalCompany(prisma, "Empresa B del benchmark", 2);
  const otherIds = await seedReportData(prisma, other);
  await seedPortabilityExtras(prisma, other, otherIds.invoice!);
  await completeAuthorizedArtifacts(prisma, other.companyId);
  const ttlCompany = await insertFiscalCompany(prisma, "Empresa C del benchmark", 1);
  for (const table of [
    "document_artifact",
    "sri_attempt",
    "sri_response",
    "document_state_transition",
    "document_delivery_event",
    "audit_event",
  ])
    await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) "${db.name}"."${table}"`);
  await prisma.$executeRawUnsafe("CHECKPOINT");
  results.seedSeconds = Math.round((performance.now() - seedStarted) / 1000);
  results.environment = await environment(backend);
  results.volume = await volume(backend);
  results.templateBytes = bytes.sizes;
  console.log(JSON.stringify(results.volume));

  // La segunda empresa pide su exportación desde el servicio real: su administrador no inicia sesión.
  const service = createDataExports({
    database: createPortabilityDatabase(prisma),
    repository: createDataExportStore(),
    jobs: createPrismaJobStore(prisma, db.name),
    packages: createPackageFiles(DIRECTORY),
    authorizer: { requirePermission: () => {} } as unknown as Authorizer,
    audit: createAuditLog,
    observer: registerPortabilityMetrics(new Registry()),
  });
  const requestOther = () =>
    service.request(
      { userId: other.adminId, companyId: other.companyId, role: "ADMIN", requestId: randomUUID() },
      {},
    );

  // 1. Generación medida.
  console.log("Listas en reposo…");
  const idle = summarize(await listSamples(api, () => false, LIST_SAMPLES));
  await prisma.$executeRawUnsafe(
    `CREATE TABLE "${db.name}".bench_churn (id int PRIMARY KEY, v int)`,
  );
  await prisma.$executeRawUnsafe(`INSERT INTO "${db.name}".bench_churn VALUES (1, 0)`);
  const pid = backend.pid;
  const cpuStart = cpuMs(pid);
  const rssStart = status(pid, "VmRSS");
  let rssPeak = rssStart;
  let diskPeak = 0;
  let freeMin = Infinity;
  let xactMax = 0;
  let xminAgeMax = 0;
  let deadMax = 0;
  const leases = new Set<string>();
  const renewMs: number[] = [];
  const phases: { phase: string; at: number; done: number | null; total: number | null }[] = [];
  const requested = await request(api);
  ensure(requested.status === 202, `POST /data-exports respondió ${requested.status}`);
  const exportId = requested.body.data!.id;
  const t0 = performance.now();
  const second = await request(api);
  results.sameCompany409 = second.status;
  ensure(second.status === 409, `la segunda solicitud respondió ${second.status}`);
  const otherFirst = await requestOther();
  const stops = [
    every(200, () => {
      rssPeak = Math.max(rssPeak, status(pid, "VmRSS"));
    }),
    every(1_000, () => {
      diskPeak = Math.max(diskPeak, diskBytes(DIRECTORY));
      const free = Number(
        execFileSync("df", ["-B1", "--output=avail", DIRECTORY], { encoding: "utf8" }).split(
          "\n",
        )[1],
      );
      freeMin = Math.min(freeMin, free);
    }),
    every(250, async () => {
      const [row] = await prisma.$queryRaw<{ seconds: number | null; age: number | null }[]>`
        SELECT max(extract(epoch FROM now() - xact_start))::float8 AS seconds, max(age(backend_xmin))::int AS age
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_xmin IS NOT NULL`;
      xactMax = Math.max(xactMax, row?.seconds ?? 0);
      xminAgeMax = Math.max(xminAgeMax, row?.age ?? 0);
    }),
    every(50, async () => {
      await prisma.$executeRawUnsafe(`UPDATE "${db.name}".bench_churn SET v = v + 1 WHERE id = 1`);
    }),
    every(2_000, async () => {
      await prisma.$executeRawUnsafe(`VACUUM "${db.name}".bench_churn`);
      const [row] = await prisma.$queryRawUnsafe<{ dead: bigint }[]>(
        `SELECT n_dead_tup AS dead FROM pg_stat_user_tables WHERE relid = '"${db.name}".bench_churn'::regclass`,
      );
      deadMax = Math.max(deadMax, Number(row?.dead ?? 0));
    }),
    every(1_000, async () => {
      const [job] = await prisma.$queryRawUnsafe<
        { lease: Date | null; owner: string | null; attempts: number }[]
      >(
        `SELECT lease_expires_at AS lease, lease_owner AS owner, attempt_count AS attempts FROM "${db.name}"."job" WHERE payload->>'exportId' = $1`,
        exportId,
      );
      if (!job?.lease || !job.owner) return;
      leases.add(job.lease.toISOString());
      // La sentencia de renovación sobre el job real, sin cambiar su lease.
      const started = performance.now();
      await prisma.$executeRawUnsafe(
        `UPDATE "${db.name}"."job" SET lease_expires_at = lease_expires_at
         WHERE payload->>'exportId' = $1 AND status = 'LEASED' AND lease_owner = $2 AND attempt_count = $3 AND lease_expires_at > now()`,
        exportId,
        job.owner,
        job.attempts,
      );
      renewMs.push(performance.now() - started);
    }),
    every(500, async () => {
      const current = await view(api, exportId);
      const last = phases.at(-1);
      if (current.phase && current.phase !== last?.phase)
        phases.push({
          phase: current.phase,
          at: Math.round(performance.now() - t0),
          done: current.progress?.done ?? null,
          total: current.progress?.total ?? null,
        });
    }),
  ];
  let finished = false;
  const listDuring = listSamples(api, () => finished);
  const ready = await waitFor(
    async () => {
      const current = await view(api, exportId);
      return current.status === "READY" || current.status === "FAILED" ? current : null;
    },
    3 * 3_600_000,
    1_000,
  );
  finished = true;
  const during = summarize(await listDuring);
  for (const stop of stops) await stop();
  const totalSeconds = round((performance.now() - t0) / 1000);
  ensure(ready.status === "READY", `la exportación terminó ${ready.status} ${ready.errorCode}`);
  const phaseMetric = await metric(backend.base, "data_export_phase_duration_seconds_sum");
  const fileName = (await prisma.dataExport.findUniqueOrThrow({ where: { id: exportId } }))
    .fileName!;
  const packagePath = join(DIRECTORY, fileName);
  const entries = Number(
    execFileSync(
      "python3",
      [
        "-I",
        "-c",
        "import sys,zipfile; print(len(zipfile.ZipFile(sys.argv[1]).namelist()))",
        packagePath,
      ],
      { encoding: "utf8" },
    ),
  );
  results.generation = {
    totalSeconds,
    queuedToReadySeconds: round(
      (Date.parse(ready.generatedAt!) - Date.parse(ready.requestedAt)) / 1000,
    ),
    phases: Object.fromEntries(
      Object.entries(phaseMetric).map(([key, value]) => [
        /phase="(\w+)"/.exec(key)?.[1] ?? key,
        round(value),
      ]),
    ),
    phaseTimeline: phases,
    cpuSeconds: round((cpuMs(pid) - cpuStart) / 1000),
    rssStartMiB: mib(rssStart),
    rssPeakMiB: mib(rssPeak),
    diskPeakMiB: mib(diskPeak),
    freeMinGiB: round(freeMin / 2 ** 30),
    zipBytes: Number(ready.sizeBytes),
    zipMiB: mib(Number(ready.sizeBytes)),
    entries,
    counts: ready.counts,
  };
  results.snapshot = {
    longestTransactionSeconds: round(xactMax),
    maxXminAge: xminAgeMax,
    churnUpdatesPerSecond: 20,
    maxDeadTuplesRetained: deadMax,
  };
  results.lists = { budgetMs: BUDGET_MS, idle, duringGeneration: during };
  ensure(during.p95 < BUDGET_MS, `P95 de las listas durante la generación: ${during.p95} ms`);
  results.lease = {
    renewalsObserved: Math.max(0, leases.size - 1),
    renewStatement: summarize(renewMs),
  };
  console.log(JSON.stringify({ generation: results.generation, snapshot: results.snapshot }));

  // Cola entre empresas: la de la otra empresa espera a que termine la primera.
  const otherReady = await waitFor(async () => {
    const row = await prisma.dataExport.findUniqueOrThrow({ where: { id: otherFirst.id } });
    return row.status === "READY" ? row : null;
  }, 600_000);
  const firstRow = await prisma.dataExport.findUniqueOrThrow({ where: { id: exportId } });
  results.crossCompanyQueue = {
    otherStartedAfterFirstFinishedSeconds: round(
      (otherReady.startedAt!.getTime() - firstRow.generatedAt!.getTime()) / 1000,
    ),
    otherWaitedSeconds: round(
      (otherReady.startedAt!.getTime() - otherReady.requestedAt.getTime()) / 1000,
    ),
  };
  ensure(
    otherReady.startedAt!.getTime() >= firstRow.generatedAt!.getTime() - 1_000,
    "la exportación de la otra empresa empezó antes de que terminara la primera",
  );

  // 2. Verificación previa y descarga, directa y por la ruta de Next.
  console.log("Descargas…");
  const nextPort = 3000 + Math.floor(Math.random() * 500) + 100;
  next = await startNext(backend.base, nextPort);
  const nextPid = listeningPid(nextPort);
  const pids = { backend: backend.pid, next: nextPid };
  const url = (base: string) => `${base}/api/v1/data-exports/${exportId}/download`;
  coldCache(packagePath);
  const directCold = await download(url(backend.base), api.cookie, ready.sha256!, pids);
  const directWarm = await download(url(backend.base), api.cookie, ready.sha256!, pids);
  coldCache(packagePath);
  const nextCold = await download(
    url(`http://127.0.0.1:${nextPort}`),
    api.cookie,
    ready.sha256!,
    pids,
  );
  const nextWarm = await download(
    url(`http://127.0.0.1:${nextPort}`),
    api.cookie,
    ready.sha256!,
    pids,
  );
  results.download = { directCold, directWarm, nextCold, nextWarm };
  for (const [name, outcome] of Object.entries(
    results.download as Record<string, { status: number; sha256Matches: boolean }>,
  ))
    ensure(outcome.status === 200 && outcome.sha256Matches, `descarga ${name}`);
  next.kill("SIGTERM");
  next = undefined;
  console.log(JSON.stringify(results.download));

  // 3. Validación independiente del paquete.
  console.log("Validando el paquete…");
  results.validation = validatePackage(packagePath);
  results.xsd = await validateXsdSample();
  rmSync(SPARE_DIRECTORY, { recursive: true, force: true });

  // 4. Recuperación tras matar main.ts a mitad de la generación.
  console.log("Recuperación tras matar el proceso…");
  // Se mata con un cuarto de los comprobantes agregados; en la prueba de humo, en cuanto se genera.
  let recoveryId = "";
  let killedAt: unknown = null;
  for (let tries = 0; tries < 5 && !recoveryId; tries += 1) {
    const again = await request(api);
    ensure(again.status === 202, `segunda generación: ${again.status}`);
    const candidate = again.body.data!.id;
    const outcome = await waitFor(
      async () => {
        const row = await prisma.dataExport.findUniqueOrThrow({ where: { id: candidate } });
        if (row.status === "READY" || row.status === "FAILED") return "terminada";
        const reached = SMOKE
          ? row.status === "GENERATING"
          : row.phase === "ARTIFACTS" &&
            row.progressTotal !== null &&
            (row.progressDone ?? 0) >= row.progressTotal / 4;
        return reached ? { done: row.progressDone, total: row.progressTotal } : null;
      },
      3_600_000,
      SMOKE ? 5 : 250,
    );
    if (outcome === "terminada") continue;
    process.kill(backend.pid, "SIGSTOP");
    recoveryId = candidate;
    killedAt = outcome;
  }
  ensure(recoveryId, "no se alcanzó a matar una generación en curso");
  await backend.crash();
  const leftAfterCrash = readdirSync(DIRECTORY).filter((name) => name.startsWith(recoveryId));
  const restartStarted = performance.now();
  backend = await startE2eBackend({ label: LABEL, admin: PORTABILITY_ADMIN, db, env });
  api.backend = backend;
  const restartReadySeconds = round((performance.now() - restartStarted) / 1000);
  await waitFor(async () => {
    const row = await prisma.dataExport.findUniqueOrThrow({ where: { id: recoveryId } });
    return row.attempt >= 2 ? row : null;
  }, 600_000);
  const reclaimSeconds = round((performance.now() - restartStarted) / 1000);
  const recovered = await waitFor(
    async () => {
      const current = await view(api, recoveryId);
      return current.status === "READY" || current.status === "FAILED" ? current : null;
    },
    3 * 3_600_000,
    1_000,
  );
  const recoveredSeconds = round((performance.now() - restartStarted) / 1000);
  await sleep((SWEEP_SECONDS + 2) * 1_000);
  const previous = await prisma.dataExport.findUniqueOrThrow({ where: { id: exportId } });
  const recoveredRow = await prisma.dataExport.findUniqueOrThrow({ where: { id: recoveryId } });
  const files = readdirSync(DIRECTORY).filter((name) => name !== "work");
  const work = readdirSync(join(DIRECTORY, "work"));
  const completed = await prisma.auditEvent.count({
    where: { action: "data_export.completed", changes: { path: ["exportId"], equals: recoveryId } },
  });
  results.recovery = {
    killedAtProgress: killedAt,
    filesLeftByCrash: leftAfterCrash.length,
    restartReadySeconds,
    reclaimSeconds,
    readyAfterRestartSeconds: recoveredSeconds,
    finalAttempt: recoveredRow.attempt,
    previousStatus: `${previous.status} ${previous.expiredReason ?? ""}`.trim(),
    directoryAfterSweep: files.length,
    workAfterSweep: work.length,
    completedEvents: completed,
  };
  ensure(recovered.status === "READY", `la recuperación terminó ${recovered.status}`);
  ensure(
    previous.status === "EXPIRED" && previous.expiredReason === "REPLACED",
    "el anterior no caducó por reemplazo",
  );
  ensure(completed === 1, `data_export.completed de la recuperación: ${completed}`);
  ensure(work.length === 0, `quedan ${work.length} directorios de trabajo`);
  ensure(
    !files.some((name) => name.startsWith(exportId) || name.endsWith(".partial")),
    `quedan archivos del intento anterior o parciales: ${files.join(", ")}`,
  );
  console.log(JSON.stringify(results.recovery));

  // 5. Worker obsoleto: main.ts detenido con su lease, otra instancia lo retoma y publica; al
  // reanudarse, el obsoleto no publica ni completa nada.
  console.log("Worker obsoleto con dos instancias…");
  let staleId = "";
  for (let tries = 0; tries < 5 && !staleId; tries += 1) {
    const created = await requestOther();
    const caught = await waitFor(
      async () => {
        const row = await prisma.dataExport.findUniqueOrThrow({ where: { id: created.id } });
        if (row.status === "GENERATING") return "GENERATING";
        return row.status === "READY" || row.status === "FAILED" ? row.status : null;
      },
      600_000,
      10,
    );
    if (caught === "GENERATING") {
      process.kill(backend.pid, "SIGSTOP");
      staleId = created.id;
    }
  }
  ensure(staleId, "no se alcanzó a detener una generación de la otra empresa");
  const stale = backend;
  const stoppedAt = performance.now();
  const second2 = await startE2eBackend({ label: LABEL, admin: PORTABILITY_ADMIN, db, env });
  extraBackends.push(second2);
  const takeover = await waitFor(async () => {
    const row = await prisma.dataExport.findUniqueOrThrow({ where: { id: staleId } });
    return row.status === "READY" ? row : null;
  }, 600_000);
  const takeoverSeconds = round((performance.now() - stoppedAt) / 1000);
  process.kill(stale.pid, "SIGCONT");
  await sleep(30_000);
  const staleRow = await prisma.dataExport.findUniqueOrThrow({ where: { id: staleId } });
  const staleCompleted = await prisma.auditEvent.count({
    where: { action: "data_export.completed", changes: { path: ["exportId"], equals: staleId } },
  });
  const staleFailed = await prisma.auditEvent.count({
    where: { action: "data_export.failed", changes: { path: ["exportId"], equals: staleId } },
  });
  const renewalsFailed = await metric(stale.base, "data_export_lease_renewals_failed_total");
  await sleep((SWEEP_SECONDS + 2) * 1_000);
  const staleFiles = readdirSync(DIRECTORY).filter(
    (name) => name.startsWith(staleId) && name !== `${staleId}-${takeover.attempt}.zip`,
  );
  results.staleWorker = {
    takeoverSeconds,
    finalAttempt: staleRow.attempt,
    status: staleRow.status,
    completedEvents: staleCompleted,
    failedEvents: staleFailed,
    staleRenewalsRejected: Object.values(renewalsFailed)[0] ?? 0,
    staleFilesLeft: staleFiles.length,
  };
  ensure(
    staleRow.status === "READY" && staleRow.attempt === takeover.attempt,
    "el obsoleto cambió la exportación",
  );
  ensure(staleCompleted === 1 && staleFailed === 0, "el obsoleto registró un evento");
  ensure(staleFiles.length === 0, `quedan archivos del obsoleto: ${staleFiles.join(", ")}`);
  await stale.stop();
  backend = second2;
  console.log(JSON.stringify(results.staleWorker));

  // 6. Caducidad con el barrido: un paquete listo ya vencido se caduca y se borra.
  const files2 = createPackageFiles(DIRECTORY);
  const expired = await prisma.dataExport.create({
    data: {
      companyId: ttlCompany.companyId,
      requestedBy: ttlCompany.adminId,
      status: "QUEUED",
      activeCompanyId: ttlCompany.companyId,
    },
  });
  await prisma.dataExport.update({
    where: { id: expired.id },
    data: { status: "GENERATING", attempt: 1, startedAt: new Date(Date.now() - 26 * 3_600_000) },
  });
  const expiredName = files2.fileName(expired.id, 1);
  const content = Buffer.from("paquete vencido del benchmark");
  writeFileSync(join(DIRECTORY, expiredName), content, { mode: 0o400 });
  await prisma.dataExport.update({
    where: { id: expired.id },
    data: {
      status: "READY",
      activeCompanyId: null,
      readyCompanyId: ttlCompany.companyId,
      snapshotAt: new Date(Date.now() - 25 * 3_600_000),
      generatedAt: new Date(Date.now() - 25 * 3_600_000),
      expiresAt: new Date(Date.now() - 3_600_000),
      fileName: expiredName,
      sizeBytes: BigInt(content.length),
      sha256: sha256(content),
      counts: {
        documentsTest: 0,
        documentsProduction: 0,
        files: 0,
        parties: 0,
        products: 0,
        stockMovements: 0,
        auditEvents: 0,
        users: 0,
      },
    },
  });
  const ttlStarted = performance.now();
  await waitFor(
    async () => {
      const row = await prisma.dataExport.findUniqueOrThrow({ where: { id: expired.id } });
      return row.status === "EXPIRED" && !existsSync(join(DIRECTORY, expiredName)) ? row : null;
    },
    (SWEEP_SECONDS + 20) * 1_000,
    250,
  );
  results.ttlSweep = {
    sweepIntervalSeconds: SWEEP_SECONDS,
    expiredAndRemovedSeconds: round((performance.now() - ttlStarted) / 1000),
  };

  // Resultado.
  // La fecha de Ecuador, como las de los demás documentos del proyecto.
  const date =
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date()) +
    (SMOKE ? "-humo" : "");
  const outDir = SMOKE ? tmpdir() : OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  results.failures = failures;
  writeFileSync(
    join(outDir, `data-portability-${date}.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  writeFileSync(
    join(outDir, `data-portability-${date}.md`),
    renderPortabilityReport(results as unknown as PortabilityBenchResults, date),
  );
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nResultados en ${join(outDir, `data-portability-${date}`)}.{json,md}`);
  console.log(
    `Documentos: ${Object.values(DOCUMENTS).reduce((a, b) => a + b, 0)} + ${TEST_INVOICES} de Pruebas`,
  );
} finally {
  next?.kill("SIGTERM");
  for (const extra of extraBackends) await extra.stop().catch(() => undefined);
  await backend.stop().catch(() => undefined);
  await db.drop().catch(() => undefined);
  rmSync(SPARE_DIRECTORY, { recursive: true, force: true });
  rmSync(DIRECTORY, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.error(`\n${failures.length} fallas:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
