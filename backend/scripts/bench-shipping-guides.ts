// Benchmark de las guías de remisión (add-shipping-guides, design D23 y D28). Es un gate dedicado: no
// forma parte de `verify` ni de la suite de pruebas, para que el tiempo de un runner compartido no la
// vuelva inestable. Ejecútalo sobre una PostgreSQL 17 sin carga ajena:
//
//   corepack pnpm --filter @facturador/backend bench:shipping-guides
//
// Arranca main.ts con EMISSION_STAGE_TIMINGS=1, la custodia habilitada y los límites de recursos en
// sus máximos absolutos (50/100/300) sobre un esquema aislado de la base de pruebas, con la
// transmisión apagada (las guías quedan SIGNED) y el barrido del RIDE apagado. Prepara por la API la
// empresa, dos establecimientos, su punto, la firma sintética, un transportista y 10 operadores.
// Siembra por SQL 10 000 terceros (uno de cada cinco con el rol CARRIER), 10 000 productos y 20 000
// facturas AUTHORIZED de 5 líneas con su snapshot real, su clave y sus XML sintéticos (con su huella),
// emite una guía de plantilla y siembra 100 000 guías AUTHORIZED de uno a tres destinatarios con el
// snapshot real de la plantilla, su registro, sus destinatarios en la tabla común y su sustento (la
// factura en el primero, la consignación declarada en los demás); después, VACUUM (ANALYZE) y un
// CHECKPOINT, para que las escrituras diferidas de la siembra masiva (cientos de MB de WAL, que
// PostgreSQL vuelca en checkpoints de varios minutos) no caigan sobre las mediciones: la operación
// normal no carga medio GB de una vez. Mide por separado, desde el cliente HTTP:
//
// - la búsqueda de transportistas, de destinatarios y de facturas elegibles, y las mercancías
//   sugeridas de una factura de 5 y de 100 líneas;
// - la creación y la vista previa de un borrador con el peor caso de los límites por defecto
//   (10 destinatarios, 100 detalles) y con los máximos absolutos (50 destinatarios, 300 detalles);
// - la emisión con su reserva en serie, con las etapas de `Server-Timing` (`reservation_tx` aparte
//   del XML, el XSD y la firma), y la del peor caso por defecto y la del máximo absoluto;
// - 10 rondas de 10 emisiones simultáneas sobre la misma factura y sobre facturas distintas;
// - la lista y la búsqueda de guías (por número, por destinatario, por transportista y por estado) y
//   la bandeja filtrada por la identificación de un destinatario;
// - el render del RIDE de una guía y el del máximo de filas en `RideWorkerPool`;
// - el CPU y la memoria del proceso del backend en el peor caso.
//
// Registra el tamaño del XML firmado del peor caso SOLO como medición de recursos: no se relaciona
// con Q-47 ni con ningún límite del SRI. Termina comprobando que las guías no crearon movimientos de
// inventario ni cambiaron una factura o los roles de un tercero, escribe el entorno y los resultados en
// docs/quality/benchmarks/ y sale con error si algún P95 supera ERS RNF-005 (2 s), si el P95 del
// render del RIDE supera 1 s o si las guías tocaron el inventario, una factura o un tercero. Los
// objetivos no se suben para hacerlo pasar: un fallo se analiza y se propone con /opsx:update.
import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem, type } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Prisma } from "../src/generated/prisma/client.ts";
import {
  createPooledRideRenderer,
  rideTasksEntry,
} from "../src/modules/sri-engine/infrastructure/ride/pooled-ride-renderer.ts";
import { defaultRideFontsDirectory } from "../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { searchKey } from "../src/platform/search/search-key.ts";
import { createRideWorkerPool } from "../src/platform/workers/ride-worker-pool.ts";
import { invoiceSnapshot, type InvoiceLineSpec } from "../test/integration/credit-notes-harness.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "../test/integration/e2e-backend.ts";
import {
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  generateP12Fixtures,
  readFixture,
} from "../test/support/p12-fixtures.ts";

const PARTIES = 10_000;
/** Uno de cada cinco terceros sembrados es transportista. */
const CARRIER_EVERY = 5;
/** Terceros con una razón social de 300 caracteres para los destinatarios del peor caso. */
const LONG_PARTIES = 50;
const PRODUCTS = 10_000;
/** Uno de cada veinte productos es un servicio: la sugerencia lo ofrece como línea libre. */
const SERVICE_EVERY = 20;
const INVOICES = 20_000;
const GUIDES = 100_000;
const USERS = 10;
const LINES = 5;
const MANY_LINES = 100;
const WARMUP = 10;
const SAMPLES = 100;
const HEAVY_SAMPLES = 20;
/** Emisiones simultáneas por ronda y rondas, sobre la misma factura y sobre facturas distintas. */
const CONTENDERS = 10;
const ROUNDS = 10;
const RIDE_WARMUP = 5;
const RIDE_SAMPLES = 30;
/** ERS RNF-005: P95 menor que 2 s. */
const BUDGET_MS = 2_000;
/** Como el RIDE de la factura: P95 del render menor que 1 s. */
const RIDE_BUDGET_MS = 1_000;
const BATCH = 10_000;
/** Los límites por defecto de design D23 y los máximos absolutos del contrato. */
const DEFAULT_LIMITS = { recipients: 10, detailsPerRecipient: 50, details: 100 };
const MAX_LIMITS = { recipients: 50, detailsPerRecipient: 100, details: 300 };
/** La guía de plantilla tiene el secuencial 1 de su contador: lo sembrado sigue. */
const FIRST = 2;
const LAST_GUIDE = GUIDES + FIRST - 1;
/** La factura de 100 líneas va después de las sembradas. */
const BIG_INVOICE = "bench-inv-big";
const ADMIN = { email: "admin@benchmark-gr.ec", password: "contrasena-benchmark-1" };
const OPERATOR_PASSWORD = "contrasena-operador-1";
const LEGAL_NAME = "COMERCIAL ANDINA S.A.";
const STAGES = ["reservation_tx", "xml", "xsd", "sign", "persist", "total"] as const;
type Stage = (typeof STAGES)[number];
const OUT_DIR = fileURLToPath(new URL("../../docs/quality/benchmarks/", import.meta.url));
/** La fecha de hoy en Ecuador: la guía se emite con ella y el transporte no empieza antes. */
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(
  new Date(),
);
const DECLARATION = { policyVersion: 1 };
/** Textos de longitud máxima del contrato para el peor caso. */
const TEXT = (prefix: string, length = 300) => `${prefix} ${"A".repeat(length)}`.slice(0, length);
const TEXT_300 = (prefix: string) => TEXT(prefix);
const CODE_25 = (prefix: string) => `${prefix}${"9".repeat(25)}`.slice(0, 25);
const QUANTITY_MAX = "999999999999.999999";
/**
 * Tope del cuerpo del borrador con que se registró el benchmark del 2026-10-06: el límite global de
 * 100 KB de `app.ts`, que entonces regía también para el borrador. Hoy crear y actualizar un borrador
 * admiten 2 MiB (design D23, segunda capa); el script conserva este tope para que sus resultados
 * sigan siendo comparables. Si el peor caso con textos de 300 caracteres no cabe, se mide con el
 * texto más largo que cabe y se registra.
 */
const BODY_LIMIT_BYTES = 100 * 1024;

type Json = Record<string, unknown>;
type Limits = typeof DEFAULT_LIMITS;
const party = (n: number) => `bench-party-${n}`;
const longParty = (n: number) => `bench-long-${n}`;
const invoice = (n: number) => `bench-inv-${n}`;
/** Un producto sembrado que es un bien activo. */
const good = (n: number) => `bench-prod-${n % SERVICE_EVERY === 0 ? n + 1 : n}`;
const identificationOf = (n: number) => `17${String(n).padStart(8, "0")}001`;

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
  // El destino de los traslados entre establecimientos propios.
  const destination = await call(backend, cookie, "POST", "/establishments", {
    code: "002",
    address: "Panamericana Norte km 12, Cayambe",
  });
  await call(backend, cookie, "PUT", "/signing-certificate", {
    file: readFixture(p12Dir, "sd-utf8.modern.p12").toString("base64"),
    password: FIXTURE_PASSWORD,
    expectedCurrentId: null,
  });
  // El transportista del peor caso, con una razón social de 300 caracteres.
  const longestCarrier = await call(backend, cookie, "POST", "/parties", {
    identificationType: "04",
    identification: "0992877878001",
    legalName: TEXT_300("TRANSPORTES DE NOMBRE MUY LARGO"),
    roles: ["CARRIER"],
  });
  const operators: string[] = [];
  for (let i = 1; i <= USERS; i += 1) {
    const email = `operador${i}@benchmark-gr.ec`;
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
    destinationId: String(destination.id),
    pointId: String(point.id),
    longestCarrier: String(longestCarrier.id),
    operators,
  };
}

type Prepared = Awaited<ReturnType<typeof prepare>>;

const invoiceLines = (count: number): InvoiceLineSpec[] =>
  Array.from({ length: count }, (_, k) => ({
    productId: `bench-prod-${k + 1}`,
    mainCode: `P${String(k + 1).padStart(6, "0")}`,
    description: `Producto del benchmark ${k + 1}`,
    quantity: "10",
    unitPrice: `${12 + (k % 7)}.35`,
  }));

/**
 * Terceros, productos y 20 000 facturas AUTHORIZED por SQL: el snapshot real de 5 líneas con el
 * comprador de cada factura y su clave propia, y los XML firmado y autorizado sintéticos con su
 * huella, de modo que la integridad de `invoiceCreditSource` se cumple. Más una de 100 líneas.
 */
async function seedCatalog(backend: E2eBackend) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const establishment = await prisma.establishment.findFirstOrThrow({ where: { code: "001" } });
  const point = await prisma.emissionPoint.findFirstOrThrow();

  await prisma.$executeRawUnsafe(
    `INSERT INTO ${t("party")} (id, company_id, identification_type, identification, legal_name, roles, status, version, search_name, search_identification, created_at, created_by, updated_at, updated_by)
     SELECT 'bench-party-' || g, $1, '04', '17' || lpad(g::text, 8, '0') || '001', n.name,
            CASE WHEN g % ${CARRIER_EVERY} = 0 THEN ARRAY['CARRIER'] ELSE ARRAY['CUSTOMER'] END, 'ACTIVE', 1,
            lower(n.name), '17' || lpad(g::text, 8, '0') || '001', now(), $2, now(), $2
     FROM generate_series(1, ${PARTIES}) g
     CROSS JOIN LATERAL (SELECT CASE WHEN g % ${CARRIER_EVERY} = 0
       THEN 'TRANSPORTES DEL BENCHMARK ' || lpad(g::text, 5, '0') || ' S.A.'
       ELSE 'DESTINATARIO DEL BENCHMARK ' || lpad(g::text, 5, '0') || ' S.A.' END AS name) n`,
    company,
    user,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${t("party")} (id, company_id, identification_type, identification, legal_name, roles, status, version, search_name, search_identification, created_at, created_by, updated_at, updated_by)
     SELECT 'bench-long-' || g, $1, '04', '18' || lpad(g::text, 8, '0') || '001', n.name, ARRAY['CUSTOMER'], 'ACTIVE', 1,
            lower(n.name), '18' || lpad(g::text, 8, '0') || '001', now(), $2, now(), $2
     FROM generate_series(1, ${LONG_PARTIES}) g
     CROSS JOIN LATERAL (SELECT rpad('DESTINATARIO DE NOMBRE MUY LARGO ' || lpad(g::text, 2, '0') || ' ', 300, 'X') AS name) n`,
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

  const insertInvoices = async (
    tx: Prisma.TransactionClient,
    snapshot: Omit<ReturnType<typeof invoiceSnapshot>, "key">,
    from: number,
    to: number,
    idOf: string,
  ) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
       SELECT 'bench-res-01-' || g, $1, 'TEST', $2, $3, '01', g, now() - ((${INVOICES + 2} - g) * interval '5 minutes'), $4, 'bench-seed'
       FROM generate_series(${from}, ${to}) g`,
      company,
      establishment.id,
      point.id,
      user,
    );
    // La clave del snapshot es la del comprobante, y el comprador, un tercero sembrado.
    await tx.$executeRawUnsafe(
      `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, authorization_number, authorization_date, authorization_environment, attempt_count)
       SELECT ${idOf}, r.company_id, '01', 'TEST', r.establishment_id, r.emission_point_id,
              '001-001-' || lpad(r.sequential::text, 9, '0'), r.sequential, r.id,
              '01' || lpad(r.sequential::text, 47, '0'), '12345678', r.reserved_at::date, 'AUTHORIZED',
              $1::jsonb || jsonb_build_object(
                'key', jsonb_build_object(
                  'documentNumber', '001-001-' || lpad(r.sequential::text, 9, '0'),
                  'sequential', lpad(r.sequential::text, 9, '0'), 'numericCode', '12345678',
                  'emissionType', '1', 'accessKey', '01' || lpad(r.sequential::text, 47, '0')),
                'buyer', ($1::jsonb -> 'buyer') || jsonb_build_object(
                  'partyId', p.id, 'identification', p.identification, 'legalName', p.legal_name)),
              '1.1.0', p.identification, p.legal_name, $2::numeric, r.reserved_at, $3, r.reserved_at + interval '1 second',
              '01' || lpad(r.sequential::text, 47, '0'), r.reserved_at + interval '1 minute', 'TEST', 1
       FROM ${t("fiscal_sequence_reservation")} r
       JOIN ${t("party")} p ON p.id = 'bench-party-' || (1 + r.sequential % ${PARTIES})
       WHERE r.company_id = $4 AND r.document_type = '01' AND r.sequential BETWEEN ${from} AND ${to}`,
      JSON.stringify(snapshot),
      snapshot.totals.total,
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
  };

  // El contador de facturas del punto, después de las sembradas: las reservas lo referencian.
  await prisma.fiscalSequence.create({
    data: {
      companyId: company,
      environment: "TEST",
      establishmentId: establishment.id,
      emissionPointId: point.id,
      documentType: "01",
      nextNumber: INVOICES + 2,
      lastReserved: INVOICES + 1,
    },
  });
  const five = invoiceSnapshot(invoiceLines(LINES));
  for (let from = 1; from <= INVOICES; from += BATCH) {
    const to = Math.min(INVOICES, from + BATCH - 1);
    await prisma.$transaction(
      (tx) => insertInvoices(tx, five, from, to, `'bench-inv-' || r.sequential`),
      { timeout: 600_000, maxWait: 10_000 },
    );
  }
  await prisma.$transaction(
    (tx) =>
      insertInvoices(
        tx,
        invoiceSnapshot(invoiceLines(MANY_LINES)),
        INVOICES + 1,
        INVOICES + 1,
        `'${BIG_INVOICE}'`,
      ),
    { timeout: 60_000, maxWait: 10_000 },
  );
  for (const table of [
    "party",
    "product",
    "product_tax",
    "fiscal_sequence_reservation",
    "electronic_document",
    "document_artifact",
  ]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${t(table)}`);
  }
}

/**
 * 100 000 guías AUTHORIZED por SQL con el snapshot real de la plantilla y su clave propia: el
 * registro (transporte propio en las impares y un transportista sembrado en las pares), uno a tres
 * destinatarios en la tabla común y en la de la guía (la factura en el primero, la consignación
 * declarada en los demás, con dos detalles cada uno), en el orden que exigen los triggers.
 */
async function seedGuides(backend: E2eBackend, data: Prepared, templateId: string) {
  const prisma = backend.db.database.prisma;
  const s = backend.db.name;
  const t = (table: string) => `"${s}"."${table}"`;
  const company = (await prisma.organization.findFirstOrThrow()).id;
  const user = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } })).id;
  const template = await prisma.electronicDocument.findUniqueOrThrow({ where: { id: templateId } });
  const carriers = PARTIES / CARRIER_EVERY;
  const recipientOf = (position: string) =>
    `'bench-party-' || (1 + (d.sequential * 3 + ${position}) % ${PARTIES})`;

  for (let from = FIRST; from <= LAST_GUIDE; from += BATCH) {
    const to = Math.min(LAST_GUIDE, from + BATCH - 1);
    const batch = `d.company_id = $1 AND d.document_type = '06' AND d.sequential BETWEEN ${from} AND ${to}`;
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("fiscal_sequence_reservation")} (id, company_id, environment, establishment_id, emission_point_id, document_type, sequential, reserved_at, reserved_by, correlation_id)
           SELECT 'bench-res-06-' || g, $1, 'TEST', $2, $3, '06', g, now() - ((${LAST_GUIDE} - g + 2) * interval '1 minute'), $4, 'bench-seed'
           FROM generate_series(${from}, ${to}) g`,
          company,
          data.establishmentId,
          data.pointId,
          user,
        );
        // Sin total ni comprador: la guía los tiene nulos (design D10).
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("electronic_document")} (id, company_id, document_type, environment, establishment_id, emission_point_id, document_number, sequential, reservation_id, access_key, numeric_code, issue_date, state, snapshot, schema_version, buyer_identification, buyer_name, total, created_at, created_by, signed_at, authorization_number, authorization_date, authorization_environment, attempt_count)
           SELECT 'bench-gr-' || r.sequential, r.company_id, '06', 'TEST', r.establishment_id, r.emission_point_id,
                  '001-001-' || lpad(r.sequential::text, 9, '0'), r.sequential, r.id,
                  '06' || lpad(r.sequential::text, 47, '0'), '12345678', r.reserved_at::date, 'AUTHORIZED',
                  $1::jsonb || jsonb_build_object('key', jsonb_build_object(
                    'documentNumber', '001-001-' || lpad(r.sequential::text, 9, '0'),
                    'sequential', lpad(r.sequential::text, 9, '0'), 'numericCode', '12345678',
                    'emissionType', '1', 'accessKey', '06' || lpad(r.sequential::text, 47, '0'))),
                  $2, NULL, NULL, NULL, r.reserved_at, $3, r.reserved_at + interval '1 second',
                  '06' || lpad(r.sequential::text, 47, '0'), r.reserved_at + interval '1 minute', 'TEST', 1
           FROM ${t("fiscal_sequence_reservation")} r
           WHERE r.company_id = $4 AND r.document_type = '06' AND r.sequential BETWEEN ${from} AND ${to}`,
          JSON.stringify(template.snapshot),
          template.schemaVersion,
          user,
          company,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("document_artifact")} (id, company_id, document_id, kind, media_type, content, size_bytes, sha256, metadata, created_at)
           SELECT gen_random_uuid()::text, d.company_id, d.id, k.kind, 'application/xml', c.content, octet_length(c.content),
                  encode(sha256(c.content), 'hex'), jsonb_build_object('documentType', '06', 'schemaVersion', $2::text), d.signed_at
           FROM ${t("electronic_document")} d
           CROSS JOIN (VALUES ('SIGNED_XML'), ('AUTHORIZED_XML')) k(kind)
           CROSS JOIN LATERAL (SELECT convert_to('<guiaRemision id="comprobante" version="' || $2 || '"><infoTributaria><claveAcceso>' || d.access_key || '</claveAcceso></infoTributaria></guiaRemision>', 'UTF8') AS content) c
           WHERE ${batch}`,
          company,
          template.schemaVersion,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("shipping_guide")} (company_id, document_id, origin_establishment_id, transporter_source, carrier_party_id, carrier_identification_type, carrier_identification, carrier_name, plate, transport_start, transport_end, recipient_count, detail_count, created_at)
           SELECT d.company_id, d.id, $2,
                  CASE WHEN d.sequential % 2 = 0 THEN 'PARTY' ELSE 'SELF' END,
                  CASE WHEN d.sequential % 2 = 0 THEN c.id END, '04',
                  CASE WHEN d.sequential % 2 = 0 THEN c.identification ELSE $3 END,
                  CASE WHEN d.sequential % 2 = 0 THEN c.legal_name ELSE $4 END,
                  'PBA-' || lpad((d.sequential % 10000)::text, 4, '0'), d.issue_date, d.issue_date + 1,
                  1 + d.sequential % 3, 2 * (1 + d.sequential % 3), d.created_at
           FROM ${t("electronic_document")} d
           JOIN ${t("party")} c ON c.id = 'bench-party-' || (${CARRIER_EVERY} * (1 + d.sequential % ${carriers}))
           WHERE ${batch}`,
          company,
          data.establishmentId,
          FIXTURE_RUC,
          LEGAL_NAME,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("electronic_document_recipient")} (company_id, document_id, position, identification, name)
           SELECT d.company_id, d.id, k.position, p.identification, p.legal_name
           FROM ${t("electronic_document")} d
           CROSS JOIN generate_series(1, 3) k(position)
           JOIN ${t("party")} p ON p.id = ${recipientOf("k.position")}
           WHERE ${batch} AND k.position <= 1 + d.sequential % 3`,
          company,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO ${t("shipping_guide_recipient")} (company_id, document_id, position, recipient_kind, party_id, destination_establishment_id, support_kind, invoice_id, exception_case, exception_policy_version, declared_by, declared_at, detail_count)
           SELECT d.company_id, d.id, k.position, 'PARTY', ${recipientOf("k.position")}, NULL,
                  CASE WHEN k.position = 1 THEN 'INTERNAL_INVOICE' ELSE 'DECLARED_EXCEPTION' END,
                  CASE WHEN k.position = 1 THEN 'bench-inv-' || (1 + d.sequential % ${INVOICES}) END,
                  CASE WHEN k.position = 1 THEN NULL ELSE 'CONSIGNMENT' END,
                  CASE WHEN k.position = 1 THEN NULL ELSE 1 END,
                  CASE WHEN k.position = 1 THEN NULL ELSE $2 END,
                  CASE WHEN k.position = 1 THEN NULL ELSE d.created_at END, 2
           FROM ${t("electronic_document")} d
           CROSS JOIN generate_series(1, 3) k(position)
           WHERE ${batch} AND k.position <= 1 + d.sequential % 3`,
          company,
          user,
        );
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
  }
  // El contador de guías sigue después de lo sembrado.
  await prisma.$executeRawUnsafe(
    `UPDATE ${t("fiscal_sequence")} SET next_number = ${LAST_GUIDE + 1}, last_reserved = ${LAST_GUIDE}
     WHERE company_id = $1 AND document_type = '06'`,
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
    "electronic_document_recipient",
    "document_artifact",
    "shipping_guide",
    "shipping_guide_recipient",
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
    "electronic_document_recipient",
    "shipping_guide",
    "shipping_guide_recipient",
    "shipping_guide_draft",
  ]) {
    const [row] = await prisma.$queryRawUnsafe<{ rows: bigint; size: string }[]>(
      `SELECT count(*) AS rows, pg_size_pretty(pg_total_relation_size('"${s}"."${table}"')) AS size FROM "${s}"."${table}"`,
    );
    result[table] = { rows: Number(row!.rows), totalSize: row!.size };
  }
  return result;
}

/** Huellas de lo que una guía nunca toca: el inventario, las facturas y los roles de los terceros. */
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
    invoices: await digest(
      `SELECT md5(string_agg(id || ':' || state || ':' || snapshot::text || ':' || coalesce(total::text, ''), '|' ORDER BY id)) AS digest
       FROM "${s}"."electronic_document" WHERE document_type = '01'`,
    ),
    invoiceArtifacts: await digest(
      `SELECT md5(string_agg(a.document_id || ':' || a.kind || ':' || a.sha256, '|' ORDER BY a.document_id, a.kind)) AS digest
       FROM "${s}"."document_artifact" a JOIN "${s}"."electronic_document" d ON d.id = a.document_id
       WHERE d.document_type = '01'`,
    ),
    partyRoles: await digest(
      `SELECT md5(string_agg(id || ':' || array_to_string(roles, ',') || ':' || status || ':' || version, '|' ORDER BY id)) AS digest FROM "${s}"."party"`,
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

type Recipient = Json & { support: { kind: string } };

/** Un destinatario tercero con la factura sembrada `invoiceNumber` como sustento. */
const invoiceRecipient = (partyId: string, invoiceId: string, details: readonly Json[]) => ({
  recipient: { kind: "PARTY", partyId },
  address: "Av. Simón Bolívar S/N, Quito",
  motive: "Venta",
  route: "Quito - Cayambe",
  destinationEstablishmentCode: null,
  support: { kind: "INTERNAL_INVOICE", invoiceId },
  details,
});

/** Un detalle de producto: los códigos salen del producto y la descripción la escribe el usuario. */
const productDetail = (productId: string, quantity = "10") => ({
  productId,
  mainCode: null,
  auxiliaryCode: null,
  description: `Producto ${productId}, en cajas`,
  quantity,
});

/**
 * El peor caso de unos límites, con textos de `text` caracteres (300 es el máximo del contrato):
 * destinatarios con razón social de 300 caracteres, alternando la factura y la consignación, y el
 * último un traslado al otro establecimiento propio; en cada uno, un producto y líneas libres con
 * códigos de 25, descripción de `text` y la cantidad más larga.
 */
function worstRecipients(limits: Limits, data: Prepared, text = 300): Recipient[] {
  const perRecipient = Math.min(
    limits.detailsPerRecipient,
    Math.floor(limits.details / limits.recipients),
  );
  return Array.from({ length: limits.recipients }, (_, r) => {
    const details = Array.from({ length: perRecipient }, (_, k) =>
      k === 0
        ? { ...productDetail(good(r + 1), QUANTITY_MAX), description: TEXT("Producto", text) }
        : {
            productId: null,
            mainCode: CODE_25(`M${r}-${k}-`),
            auxiliaryCode: CODE_25(`A${r}-${k}-`),
            description: TEXT(`Mercancía ${r + 1}.${k + 1}`, text),
            quantity: QUANTITY_MAX,
          },
    );
    const texts = {
      motive: TEXT("Motivo del traslado", text),
      route: TEXT("Ruta", text),
    };
    if (r === limits.recipients - 1) {
      return {
        recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: data.destinationId },
        address: null,
        ...texts,
        destinationEstablishmentCode: null,
        support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
        details,
      };
    }
    return {
      recipient: { kind: "PARTY", partyId: longParty(r + 1) },
      address: TEXT("Dirección de destino", text),
      ...texts,
      destinationEstablishmentCode: "001",
      support:
        r % 2 === 0
          ? { kind: "INTERNAL_INVOICE", invoiceId: invoice(1_000 + r) }
          : { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
      details,
    };
  });
}

type Draft = { id: string; version: number; declares: boolean };

const draftBody = (
  data: Prepared,
  recipients: readonly Recipient[],
  transporter: Json = { source: "SELF" },
  plate = "PAA-1234",
) => ({
  emissionPointId: data.pointId,
  originEstablishmentId: data.establishmentId,
  transporter,
  plate,
  transportStart: TODAY,
  transportEnd: TODAY,
  recipients,
});
const bodyBytes = (body: unknown) => Buffer.byteLength(JSON.stringify(body));

async function draftFor(
  backend: E2eBackend,
  cookie: string,
  data: Prepared,
  recipients: readonly Recipient[],
  transporter: Json = { source: "SELF" },
  plate = "PAA-1234",
): Promise<Draft> {
  const draft = await call(
    backend,
    cookie,
    "POST",
    "/shipping-guides/drafts",
    draftBody(data, recipients, transporter, plate),
  );
  const issues = (draft.preview as { issues: unknown[] }).issues;
  if (issues.length > 0) throw new Error(`borrador con problemas: ${JSON.stringify(issues)}`);
  return {
    id: String(draft.id),
    version: Number(draft.version),
    declares: recipients.some((recipient) => recipient.support.kind === "DECLARED_EXCEPTION"),
  };
}

type Emission = {
  id: string;
  clientMs: number;
  stages: Partial<Record<Stage, number>>;
};

async function emit(backend: E2eBackend, cookie: string, draft: Draft): Promise<Emission> {
  const started = performance.now();
  const res = await fetch(`${backend.base}/api/v1/shipping-guides`, {
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
      exceptionDeclaration: draft.declares ? DECLARATION : null,
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

/** Una guía de un destinatario con la factura `n` y dos detalles de producto. */
const simpleRecipients = (n: number): Recipient[] => [
  invoiceRecipient(party(1 + (n % PARTIES)), invoice(1 + (n % INVOICES)), [
    productDetail(good(1 + (n % 50))),
    productDetail(good(51 + (n % 50)), "2.5"),
  ]),
];

/** Emisiones en serie de una guía simple, cada una con una factura sembrada distinta. */
async function measureSerialEmissions(backend: E2eBackend, data: Prepared) {
  const emissions: Emission[] = [];
  for (let index = 0; index < WARMUP + SAMPLES; index += 1) {
    const cookie = data.operators[index % data.operators.length]!;
    const draft = await draftFor(backend, cookie, data, simpleRecipients(2_000 + index));
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
  for (const invoices of rounds) {
    const drafts = [];
    for (const [index, n] of invoices.entries()) {
      drafts.push(
        await draftFor(
          backend,
          data.operators[index % data.operators.length]!,
          data,
          simpleRecipients(n),
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

/** Render del RIDE de guías firmadas en `RideWorkerPool`, con su duración en el worker. */
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
      const guide = await prisma.electronicDocument.findUniqueOrThrow({ where: { id } });
      const signed = await prisma.documentArtifact.findFirstOrThrow({
        where: { documentId: id, kind: "SIGNED_XML" },
      });
      const input = {
        xml: new Uint8Array(signed.content),
        accessKey: guide.accessKey,
        authorization: {
          number: guide.accessKey,
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
          throw new Error(`el RIDE de la guía se rechazó: ${outcome.code}`);
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

/** Tamaño del XML firmado de una guía emitida: medición de recursos, sin relación con Q-47. */
async function signedSize(backend: E2eBackend, id: string) {
  const signed = await backend.db.database.prisma.documentArtifact.findFirstOrThrow({
    where: { documentId: id, kind: "SIGNED_XML" },
  });
  return signed.sizeBytes;
}

const p12Dir = mkdtempSync(join(tmpdir(), "bench-shipping-guides-p12-"));
generateP12Fixtures(p12Dir);
const backend = await startE2eBackend({
  label: "bench_shipping_guides",
  admin: ADMIN,
  env: {
    CERTIFICATE_CUSTODY: "enabled",
    // Clave de custodia efímera de esta ejecución; nunca se imprime ni se guarda.
    CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
    EMISSION_STAGE_TIMINGS: "1",
    LOGIN_IP_MAX_REQUESTS: "100",
    // Los máximos absolutos, para medir también el peor caso que admite el contrato.
    SHIPPING_GUIDE_MAX_RECIPIENTS: String(MAX_LIMITS.recipients),
    SHIPPING_GUIDE_MAX_DETAILS_PER_RECIPIENT: String(MAX_LIMITS.detailsPerRecipient),
    SHIPPING_GUIDE_MAX_DETAILS: String(MAX_LIMITS.details),
    // Sin el barrido del RIDE: el RIDE se mide aparte en su pool.
    RIDE_SWEEP_INTERVAL_SECONDS: "86400",
  },
});
try {
  console.log("Preparando la empresa por la API…");
  const data = await prepare(backend, p12Dir);
  const prisma = backend.db.database.prisma;
  const pid = backendPid(backend);

  console.log(
    `Sembrando ${PARTIES} terceros, ${PRODUCTS} productos y ${INVOICES} facturas autorizadas…`,
  );
  const seedStarted = performance.now();
  await seedCatalog(backend);

  console.log("Emitiendo la guía de plantilla…");
  const template = await emit(
    backend,
    data.cookie,
    await draftFor(backend, data.cookie, data, simpleRecipients(0)),
  );

  console.log(`Sembrando ${GUIDES} guías autorizadas de uno a tres destinatarios…`);
  await seedGuides(backend, data, template.id);
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

  const someRecipient = identificationOf(1_234);
  for (const [name, path] of [
    ["Transportistas: primera página, sin filtro", "/shipping-guides/carriers"],
    ["Transportistas: búsqueda por identificación", "/shipping-guides/carriers?search=1700005"],
    [
      "Transportistas: búsqueda por razón social (todos coinciden)",
      "/shipping-guides/carriers?search=transportes",
    ],
    ["Destinatarios: primera página, sin filtro", "/shipping-guides/recipients"],
    ["Destinatarios: búsqueda por identificación", "/shipping-guides/recipients?search=1700005"],
    [
      "Destinatarios: búsqueda por razón social (casi todos coinciden)",
      "/shipping-guides/recipients?search=benchmark",
    ],
    ["Facturas elegibles: primera página, sin filtro", "/shipping-guides/eligible-invoices"],
    [
      "Facturas elegibles: búsqueda por número",
      "/shipping-guides/eligible-invoices?search=000012345",
    ],
    [
      "Facturas elegibles: búsqueda por comprador",
      "/shipping-guides/eligible-invoices?search=BENCHMARK%2001234",
    ],
    [
      `Mercancías sugeridas de una factura de ${LINES} líneas`,
      `/shipping-guides/eligible-invoices/${invoice(12_345)}/goods`,
    ],
    [
      `Mercancías sugeridas de una factura de ${MANY_LINES} líneas`,
      `/shipping-guides/eligible-invoices/${BIG_INVOICE}/goods`,
    ],
    ["Opciones del borrador (puntos y establecimientos)", "/shipping-guides/options"],
  ] as const) {
    record(name, path, await measureGet(backend, cookie, path));
  }

  // Borradores del peor caso: creación (con su vista previa) y relectura de la vista previa.
  const heavy: Record<string, unknown> = {};
  // Memoria del backend antes del peor caso: la línea base con la que se compara.
  const memoryBaseline = processUsage(pid);
  const longTransporter = { source: "PARTY", partyId: data.longestCarrier };
  const longPlate = "PBA-1234567890ABCDEF";
  for (const [label, limits] of [
    ["límites por defecto", DEFAULT_LIMITS],
    ["máximos absolutos", MAX_LIMITS],
  ] as const) {
    // El texto más largo (de 300 hacia abajo) con el que el cuerpo cabe en el límite de la plataforma.
    const fullBody = bodyBytes(
      draftBody(data, worstRecipients(limits, data), longTransporter, longPlate),
    );
    let text = 300;
    while (
      text > 10 &&
      bodyBytes(draftBody(data, worstRecipients(limits, data, text), longTransporter, longPlate)) >
        BODY_LIMIT_BYTES
    ) {
      text -= 10;
    }
    const recipients = worstRecipients(limits, data, text);
    const sentBody = bodyBytes(draftBody(data, recipients, longTransporter, longPlate));
    const details = recipients.reduce(
      (sum, recipient) => sum + (recipient.details as unknown[]).length,
      0,
    );
    const shape = `${limits.recipients} destinatarios × ${details / limits.recipients} detalles, textos de ${text}`;
    const createSamples: number[] = [];
    let draft: Draft = { id: "", version: 0, declares: false };
    const usageBefore = processUsage(pid);
    for (let i = 0; i < WARMUP + HEAVY_SAMPLES; i += 1) {
      const started = performance.now();
      draft = await draftFor(backend, cookie, data, recipients, longTransporter, longPlate);
      if (i >= WARMUP) createSamples.push(performance.now() - started);
    }
    record(
      `Creación del borrador del peor caso (${label}: ${shape})`,
      "POST /shipping-guides/drafts",
      { results: HEAVY_SAMPLES, ...summarize(createSamples) },
    );
    const preview = await measureGet(
      backend,
      cookie,
      `/shipping-guides/drafts/${draft.id}`,
      HEAVY_SAMPLES * 2,
    );
    record(
      `Vista previa del borrador del peor caso (${label})`,
      "/shipping-guides/drafts/{id}",
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
        await draftFor(backend, cookie, data, recipients, longTransporter, longPlate),
      );
      if (i >= 1) emissions.push(emission);
      const bytes = await signedSize(backend, emission.id);
      if (bytes > largest.bytes) largest = { id: emission.id, bytes };
    }
    const afterEmission = processUsage(pid);
    const summary = emissionSummary(emissions);
    record(`Emisión del peor caso (${label}): total del servidor`, "POST /shipping-guides", {
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
      recipients: limits.recipients,
      details,
      textLength: text,
      bodyBytes: sentBody,
      fullTextBodyBytes: fullBody,
      fullTextFitsBody: fullBody <= BODY_LIMIT_BYTES,
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
      `Peor caso (${label}): cuerpo ${round(sentBody / 1024)} KiB con textos de ${text} (con textos de 300: ${round(fullBody / 1024)} KiB); XML firmado ${round(largest.bytes / 1024)} KiB (medición, sin relación con Q-47); memoria máxima del backend ${afterEmission.peakMiB} MiB`,
    );
  }

  console.log("Emitiendo en serie…");
  const serial = await measureSerialEmissions(backend, data);
  record("Emisión con reserva: total del servidor", "POST /shipping-guides", {
    results: SAMPLES,
    ...serial.stages.total,
  });
  record("Emisión con reserva: transacción de la reserva", "reservation_tx", {
    results: SAMPLES,
    ...serial.stages.reservation_tx,
  });

  console.log("Emisiones simultáneas sobre la misma factura…");
  const sameInvoice = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) => Array.from({ length: CONTENDERS }, () => 3_000 + r)),
  );
  console.log("Emisiones simultáneas sobre facturas distintas…");
  const distinctInvoices = await measureConcurrentEmissions(
    backend,
    data,
    Array.from({ length: ROUNDS }, (_, r) =>
      Array.from({ length: CONTENDERS }, (_, c) => 4_000 + r * CONTENDERS + c),
    ),
  );
  const baseline = serial.stages.reservation_tx.p50;
  const contention = [
    ["La misma factura", sameInvoice],
    ["Facturas distintas", distinctInvoices],
  ] as const;
  for (const [name, summary] of contention) {
    record(`${name}, ${CONTENDERS} simultáneas: total del servidor`, "POST /shipping-guides", {
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
    ["Guías: primera página, sin filtro", "/shipping-guides"],
    ["Guías: búsqueda por número", "/shipping-guides?search=000054321"],
    [
      "Guías: búsqueda por identificación de un destinatario",
      `/shipping-guides?search=${someRecipient}`,
    ],
    [
      "Guías: búsqueda por transportista",
      "/shipping-guides?search=TRANSPORTES%20DEL%20BENCHMARK%2000500",
    ],
    ["Guías: filtro por estado", "/shipping-guides?state=AUTHORIZED"],
    [
      "Bandeja: filtro por identificación de un destinatario",
      `/documents?identification=${someRecipient}`,
    ],
    [
      "Bandeja: guías filtradas por identificación de un destinatario",
      `/documents?documentType=06&identification=${someRecipient}`,
    ],
  ] as const) {
    record(name, path, await measureGet(backend, cookie, path));
  }

  console.log("Renderizando el RIDE…");
  const largestId = (heavy["máximos absolutos"] as { largestId: string }).largestId;
  const [rideOne, rideMax] = await measureRide(backend, [template.id, largestId]);
  record("Render del RIDE de una guía (worker)", "RideWorkerPool", rideOne!, RIDE_BUDGET_MS);
  record(
    `Render del RIDE del máximo de filas (${MAX_LIMITS.recipients} destinatarios, ${MAX_LIMITS.details} detalles, ${rideMax!.pages} páginas)`,
    "RideWorkerPool",
    rideMax!,
    RIDE_BUDGET_MS,
  );

  // Las guías no tocan el inventario, las facturas ni los roles de los terceros.
  const after = await untouched(backend);
  const independent = (Object.keys(before) as (keyof typeof before)[]).every(
    (key) => before[key] === after[key],
  );
  const emitted = await prisma.electronicDocument.count({ where: { documentType: "06" } });
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
      carriers: PARTIES / CARRIER_EVERY,
      products: PRODUCTS,
      invoices: INVOICES,
      guides: GUIDES,
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
      stockMovements: { before: before.stockMovements, after: after.stockMovements },
      stockBalancesUnchanged: before.stockBalances === after.stockBalances,
      invoicesUnchanged: before.invoices === after.invoices,
      invoiceArtifactsUnchanged: before.invoiceArtifacts === after.invoiceArtifacts,
      partyRolesUnchanged: before.partyRoles === after.partyRoles,
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}shipping-guides-${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
  const passed = results.every((r) => r.withinBudget) && independent;
  const worst = Object.entries(heavy) as [
    string,
    {
      shape: string;
      details: number;
      textLength: number;
      bodyBytes: number;
      fullTextBodyBytes: number;
      fullTextFitsBody: boolean;
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
  const yes = (value: boolean) => (value ? "sin cambios" : "**cambiaron**");
  writeFileSync(
    `${OUT_DIR}shipping-guides-${date}.md`,
    [
      `# Benchmark de las guías de remisión (${date})`,
      "",
      `Volumen: ${PARTIES} terceros (${PARTIES / CARRIER_EVERY} con el rol CARRIER), ${PRODUCTS} productos, ${INVOICES} facturas AUTHORIZED de ${LINES} líneas y ${GUIDES} guías AUTHORIZED de uno a tres destinatarios, en una empresa (volumen de Q-26). Siembra por SQL en ${seedSeconds} s, seguida de \`VACUUM (ANALYZE)\` y un \`CHECKPOINT\` para que las escrituras diferidas de la carga masiva no caigan sobre las mediciones. Calentamiento de ${WARMUP} y ${SAMPLES} mediciones secuenciales por consulta y por emisión desde el cliente HTTP contra \`main.ts\`, con la custodia habilitada, la transmisión apagada, el barrido del RIDE apagado y los límites de recursos en sus máximos absolutos; el peor caso se mide con ${HEAVY_SAMPLES} muestras; la contención son ${ROUNDS} rondas de ${CONTENDERS} emisiones simultáneas. El RIDE se mide en \`RideWorkerPool\` con 2 workers. Objetivos: ERS RNF-005, P95 menor que ${BUDGET_MS} ms, y el P95 del render del RIDE menor que ${RIDE_BUDGET_MS} ms (design D28 de \`add-shipping-guides\`). Las respuestas del SRI no participan. Generado por \`bench:shipping-guides\`; datos en \`shipping-guides-${date}.json\`.`,
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
      "## Peor caso y límites de recursos (design D23)",
      "",
      "| Caso | Forma | Detalles | Cuerpo del borrador (KiB) | `reservation_tx` P95 | `xml` P95 | `xsd` P95 | `sign` P95 | Total P95 | CPU del backend por petición del borrador (ms) | CPU del backend por borrador y emisión (ms) | Memoria residente del backend antes → después (MiB) | Memoria máxima (MiB) | XML firmado (KiB) |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...worst.map(
        ([label, entry]) =>
          `| ${label} | ${entry.shape} | ${entry.details} | ${round(entry.bodyBytes / 1024)} | ${entry.stages.reservation_tx.p95} | ${entry.stages.xml.p95} | ${entry.stages.xsd.p95} | ${entry.stages.sign.p95} | ${entry.stages.total.p95} | ${entry.backend.cpuMsPerDraftRequest} | ${entry.backend.cpuMsPerDraftAndEmission} | ${entry.backend.rssBeforeMiB} → ${entry.backend.rssMiB} | ${entry.backend.peakRssMiB} | ${entry.signedXmlKiB} |`,
      ),
      "",
      "- El peor caso usa la razón social del transportista y de los destinatarios de 300 caracteres, la placa de 20, códigos de 25 y la cantidad más larga, y la dirección, el motivo, la ruta y la descripción con el texto más largo que cabe en el límite del cuerpo JSON de la plataforma (300, el máximo del contrato, si cabe); los destinatarios alternan la factura y la consignación declarada, y el último es un traslado al otro establecimiento propio.",
      ...worst
        .filter(([, entry]) => !entry.fullTextFitsBody)
        .map(
          ([label, entry]) =>
            `- **Límite del cuerpo (${label}):** con todos los textos en 300 caracteres el cuerpo del borrador mediría ${round(entry.fullTextBodyBytes / 1024)} KiB, más que el tope de ${BODY_LIMIT_BYTES / 1024} KiB con que se registra este benchmark (el límite global de \`JSON_BODY_LIMIT\`, que regía para el borrador cuando se registró por primera vez; hoy crear y actualizar un borrador admiten 2 MiB). Se midió con textos de ${entry.textLength} caracteres (${round(entry.bodyBytes / 1024)} KiB), para que los resultados sigan siendo comparables.`,
        ),
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
      `- La espera por bloqueos es lo que el P95 de \`reservation_tx\` supera a su mediana en serie (${baseline} ms), que no espera a nadie. Una guía no reserva capacidad de la factura que la sustenta: varias guías pueden citar la misma factura (design D8). Las reservas de una empresa se serializan en el bloqueo de la configuración y en el contador del punto, como los demás tipos.`,
      "- Ningún bloqueo se mantiene durante el XML, el XSD ni la firma: son etapas aparte, después de confirmar la reserva, y la transacción de la reserva no incluye red.",
      "",
      `Independencia al terminar: ${emitted} guías; movimientos de inventario ${before.stockMovements} → ${after.stockMovements}; saldos de inventario ${yes(before.stockBalances === after.stockBalances)}; facturas ${yes(before.invoices === after.invoices)} y sus XML ${yes(before.invoiceArtifacts === after.invoiceArtifacts)}; roles de los terceros ${yes(before.partyRoles === after.partyRoles)}.`,
      "",
      passed
        ? "Todas las operaciones cumplen su objetivo en este entorno y las guías no tocan el inventario, las facturas ni los roles de los terceros."
        : "Al menos una operación supera su objetivo o las guías tocaron el inventario, una factura o un tercero: analizar antes de cambiar índices, límites o estrategia (`/opsx:update`).",
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
