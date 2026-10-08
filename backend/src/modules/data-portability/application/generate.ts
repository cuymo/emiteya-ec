// Generación del paquete (add-data-portability, design D2 a D9, D12, D13 y D20).
//
// Fase 1, en una transacción `REPEATABLE READ, READ ONLY` con su momento (`snapshotAt`):
//   - cuenta cada conjunto y lo escribe por lotes en su libro, dividido en hojas si supera el
//     máximo de filas, con la misma consulta para el conteo y los lotes;
//   - fija el inventario del paquete: por comprobante, su carpeta y los identificadores, tamaños y
//     SHA-256 de sus artefactos y de las respuestas de sus intentos; los logos; los ausentes.
// Fase 2, fuera de la transacción: comprueba la reserva de disco, lee solo lo inventariado (los
// artefactos son de solo agregado: sus bytes son los de `snapshotAt`), recalcula el tamaño y el
// SHA-256 de cada uno antes de escribirlo, y cierra el ZIP con `SHA256SUMS` al final.
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { DataExportCounts, DataExportPhase } from "@facturador/contracts";
import type { CompanyBatches } from "../../../platform/db/report-source.ts";
import type { XlsxSheet, XlsxValue } from "../../../platform/xlsx/xlsx-writer.ts";
import {
  ARTIFACT_FILES,
  MissingArtifactError,
  artifactPlan,
  checksumLine,
  createPathGuard,
  documentFolder,
  logoFile,
  responseFile,
  type AbsentArtifact,
} from "../domain/format.ts";
import {
  manifestBytes,
  readmeBytes,
  type DatasetEntry,
  type PackageCounts,
} from "../domain/manifest.ts";
import {
  ATTEMPTS,
  AUDIT_EVENTS,
  CATALOG_SETTINGS,
  CERTIFICATES,
  CONFIG_VERSIONS,
  DELIVERIES,
  DOCUMENTS,
  EMISSION_POINTS,
  ESTABLISHMENTS,
  MAX_DATA_ROWS,
  PARTIES,
  PRODUCTS,
  PRODUCT_TAXES,
  RECIPIENTS,
  SEQUENCES,
  STOCK_BALANCES,
  STOCK_MOVEMENTS,
  TRANSITIONS,
  USERS,
  WITHHOLDING_LINES,
  sheetNames,
  type Lookups,
  type SheetDefinition,
  type UserWithDefault,
} from "../domain/sheets.ts";
import { ExportFailure } from "./errors.ts";
import type {
  DocumentRow,
  LogoRow,
  PortabilityDatabase,
  PortabilitySources,
  StoredBytes,
  XlsxWriter,
  ZipOpener,
} from "./ports.ts";

export type GenerationFiles = Readonly<{
  /** Bytes libres para un proceso sin privilegios en el disco de `path`. */
  freeBytes(path: string): Promise<number>;
  sha256OfFile(path: string): Promise<string>;
  size(path: string): Promise<number>;
  /** Un archivo nuevo y privado escrito por líneas, con la contrapresión del disco. */
  lineWriter(
    path: string,
  ): Promise<Readonly<{ write(line: string): Promise<void>; close(): Promise<void> }>>;
  readLines(path: string): AsyncIterable<string>;
}>;

export type GeneratorLimits = Readonly<{
  headroomPercent: number;
  reserveBytes: number;
  snapshotTimeoutMs: number;
}>;

export type GeneratorDeps = Readonly<{
  sources: PortabilitySources;
  database: PortabilityDatabase;
  writeXlsx: XlsxWriter;
  openZip: ZipOpener;
  files: GenerationFiles;
  limits: GeneratorLimits;
  applicationVersion: string;
  now: () => Date;
  /** Para las pruebas: el tamaño de los lotes y el máximo de filas de una hoja. */
  batchSize?: number;
  maxSheetRows?: number;
}>;

export type GenerationRequest = Readonly<{
  companyId: string;
  workDir: string;
  packagePath: string;
  signal: AbortSignal;
  progress(phase: DataExportPhase, done?: number, total?: number): Promise<void>;
}>;

export type GenerationResult = Readonly<{
  snapshotAt: Date;
  sizeBytes: number;
  sha256: string;
  counts: DataExportCounts;
}>;

const WORKBOOKS = ["empresa", "terceros", "productos", "comprobantes", "inventario", "auditoria"];
const PROGRESS_EVERY = 500;

type InventoryItem = Readonly<{
  id: string;
  folder: string;
  artifacts: readonly Readonly<{
    id: string;
    kind: keyof typeof ARTIFACT_FILES;
    sizeBytes: number;
    sha256: string;
  }>[];
  responses: readonly Readonly<{
    attemptId: string;
    file: string;
    sizeBytes: number;
    sha256: string;
  }>[];
}>;

type Part = Readonly<{
  definition: Pick<SheetDefinition<never>, "name" | "columns">;
  dataset: string;
  count: number;
  rows: AsyncIterable<readonly XlsxValue[]>;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Las primeras `limit` filas de un iterador compartido, sin cerrarlo: la hoja siguiente sigue. */
async function* take<T>(iterator: AsyncIterator<T>, limit: number): AsyncGenerator<T> {
  for (let taken = 0; taken < limit; taken++) {
    const next = await iterator.next();
    if (next.done) return;
    yield next.value;
  }
}

function part<R>(
  definition: SheetDefinition<R>,
  dataset: string,
  count: number,
  rows: AsyncIterable<R> | Iterable<R>,
  lookups: Lookups,
): Part {
  async function* mapped() {
    for await (const row of rows) yield definition.row(row, lookups);
  }
  return { definition, dataset, count, rows: mapped() };
}

/** Comprueba que los bytes conservados coinciden con lo inventariado y con lo que guardan. */
function verified(
  stored: StoredBytes | null,
  expected: Readonly<{ sizeBytes: number; sha256: string }>,
): Uint8Array {
  if (
    !stored ||
    stored.content.length !== expected.sizeBytes ||
    stored.sizeBytes !== expected.sizeBytes ||
    stored.sha256 !== expected.sha256 ||
    sha256(stored.content) !== expected.sha256
  ) {
    throw new ExportFailure("DATA_EXPORT_ARTIFACT_INTEGRITY");
  }
  return stored.content;
}

export async function generatePackage(
  deps: GeneratorDeps,
  request: GenerationRequest,
): Promise<GenerationResult> {
  const { sources, files, limits } = deps;
  const size = deps.batchSize ?? 1000;
  const maxRows = deps.maxSheetRows ?? MAX_DATA_ROWS;
  const { companyId, workDir } = request;
  const workbookPath = (name: string) => join(workDir, `${name}.xlsx`);
  const inventoryPath = join(workDir, "inventario.ndjson");

  if ((await files.freeBytes(workDir)) < limits.reserveBytes) {
    throw new ExportFailure("DATA_EXPORT_INSUFFICIENT_SPACE");
  }
  await request.progress("SNAPSHOT");

  // Fase 1: la base de datos, en un solo momento.
  const phase1 = await deps.database.readOnlySnapshot(async (db, snapshotAt) => {
    const all = async <R>(source: CompanyBatches<R>) => {
      const rows: R[] = [];
      for await (const batch of source.batches(db, companyId, size)) {
        request.signal.throwIfAborted();
        rows.push(...batch);
      }
      return rows;
    };
    const stream = <R>(source: CompanyBatches<R>) =>
      (async function* () {
        for await (const batch of source.batches(db, companyId, size)) {
          request.signal.throwIfAborted();
          yield* batch;
        }
      })();
    const counted = async <R>(source: CompanyBatches<R>) => ({
      count: await source.count(db, companyId),
      rows: stream(source),
    });

    const users = await all(sources.users);
    const establishments = await all(sources.establishments);
    const points = await all(sources.emissionPoints);
    const defaults = await all(sources.defaultEmissionPoints);
    const logos = await all(sources.logos);
    const products = await all(sources.products);
    const versions = await all(sources.configVersions);
    const userEmail = new Map(users.map((user) => [user.userId, user.email]));
    const establishmentCode = new Map(establishments.map((e) => [e.id, e.code]));
    const pointById = new Map(points.map((p) => [p.id, p]));
    const productById = new Map(products.map((p) => [p.id, { code: p.mainCode, name: p.name }]));
    const logoById = new Map(logos.map((logo) => [logo.assetId, logo]));
    const lookups: Lookups = {
      userEmail: (id) => (id === null ? null : (userEmail.get(id) ?? null)),
      establishmentCode: (id) => establishmentCode.get(id) ?? null,
      pointCode: (id) => pointById.get(id)?.code ?? null,
      product: (id) => productById.get(id) ?? null,
      logoSha256: (id) => (id === null ? null : (logoById.get(id)?.sha256 ?? null)),
    };
    const pointLabel = (id: string) => {
      const point = pointById.get(id);
      return point ? `${establishmentCode.get(point.establishmentId) ?? "?"}-${point.code}` : null;
    };
    const defaultOf = new Map(defaults.map((d) => [d.userId, d.emissionPointId]));
    const usersWithDefault: UserWithDefault[] = users.map((user) => {
      const point = defaultOf.get(user.userId);
      return { ...user, defaultPoint: point ? pointLabel(point) : null };
    });
    const byCodes = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");
    const sortedPoints = [...points].sort(
      (a, b) =>
        byCodes(
          establishmentCode.get(a.establishmentId) ?? null,
          establishmentCode.get(b.establishmentId) ?? null,
        ) || byCodes(a.code, b.code),
    );
    const sequences = (await all(sources.sequences)).sort(
      (a, b) =>
        a.environment.localeCompare(b.environment) ||
        byCodes(
          establishmentCode.get(a.establishmentId) ?? null,
          establishmentCode.get(b.establishmentId) ?? null,
        ) ||
        byCodes(
          pointById.get(a.emissionPointId)?.code ?? null,
          pointById.get(b.emissionPointId)?.code ?? null,
        ) ||
        a.documentType.localeCompare(b.documentType),
    );
    const certificates = await all(sources.certificates);
    const catalogSettings = await all(sources.catalogSettings);

    const datasets: DatasetEntry[] = [];
    async function workbook(name: string, parts: readonly Part[]) {
      const path = `data/${name}.xlsx`;
      const plan = parts.map((p) => {
        const iterator = p.rows[Symbol.asyncIterator]();
        const names = sheetNames(p.definition.name, p.count, maxRows);
        return { p, iterator, names };
      });
      const sheets: XlsxSheet[] = plan.flatMap(({ p, iterator, names }) =>
        names.map((sheet) => ({
          name: sheet,
          columns: p.definition.columns,
          rows: take(iterator, maxRows),
        })),
      );
      const written = await deps.writeXlsx(workbookPath(name), sheets);
      let index = 0;
      for (const { p, iterator, names } of plan) {
        const rows = written.slice(index, index + names.length).reduce((sum, n) => sum + n, 0);
        index += names.length;
        // El conteo y los lotes son la misma consulta en el mismo momento: deben coincidir.
        if (rows !== p.count || !(await iterator.next()).done) {
          throw new Error(`el conjunto ${p.dataset} cambió durante la lectura`);
        }
        datasets.push({ dataset: p.dataset, workbook: path, sheets: names, rows });
      }
    }

    await workbook("empresa", [
      part(CONFIG_VERSIONS, "Configuración", versions.length, versions, lookups),
      part(ESTABLISHMENTS, "Establecimientos", establishments.length, establishments, lookups),
      part(EMISSION_POINTS, "Puntos de emisión", sortedPoints.length, sortedPoints, lookups),
      part(SEQUENCES, "Secuenciales", sequences.length, sequences, lookups),
      part(
        CATALOG_SETTINGS,
        "Catálogos habilitados",
        catalogSettings.length,
        catalogSettings,
        lookups,
      ),
      part(CERTIFICATES, "Firmas", certificates.length, certificates, lookups),
      part(USERS, "Usuarios", usersWithDefault.length, usersWithDefault, lookups),
    ]);
    const parties = await counted(sources.parties);
    await workbook("terceros", [part(PARTIES, "Terceros", parties.count, parties.rows, lookups)]);
    const taxes = await counted(sources.productTaxes);
    await workbook("productos", [
      part(PRODUCTS, "Productos", products.length, products, lookups),
      part(PRODUCT_TAXES, "Impuestos", taxes.count, taxes.rows, lookups),
    ]);

    // Los comprobantes: su hoja y, a la vez, el inventario del paquete.
    const documentCounts = {
      TEST: 0,
      PRODUCTION: 0,
      byType: {} as Record<string, number>,
      byState: {} as Record<string, number>,
    };
    const artifactCounts = {
      signedXml: 0,
      authorizedXml: 0,
      ride: 0,
      sriResponses: 0,
      logos: logos.length,
    };
    const absent: AbsentArtifact[] = [];
    const snapshotVersions = new Map<string, Set<number>>();
    const xmlSchemas = new Map<string, Set<string>>();
    let estimatedBytes = logos.reduce((sum, logo) => sum + logo.sizeBytes, 0);
    let plannedFiles = 2 + WORKBOOKS.length + logos.length + 1;
    const inventory = await files.lineWriter(inventoryPath);
    const documents = await counted(sources.documents);
    async function* inventoried(): AsyncGenerator<DocumentRow> {
      for await (const document of documents.rows) {
        let plan: ReturnType<typeof artifactPlan>;
        try {
          plan = artifactPlan(document);
        } catch (error) {
          if (error instanceof MissingArtifactError)
            throw new ExportFailure("DATA_EXPORT_ARTIFACT_MISSING");
          throw error;
        }
        absent.push(...plan.absent);
        documentCounts[document.environment] += 1;
        documentCounts.byType[document.documentType] =
          (documentCounts.byType[document.documentType] ?? 0) + 1;
        documentCounts.byState[document.state] = (documentCounts.byState[document.state] ?? 0) + 1;
        if (document.snapshotVersion !== null) {
          const set = snapshotVersions.get(document.documentType) ?? new Set();
          snapshotVersions.set(document.documentType, set.add(document.snapshotVersion));
        }
        const schemas = xmlSchemas.get(document.documentType) ?? new Set();
        xmlSchemas.set(document.documentType, schemas.add(document.schemaVersion));
        for (const artifact of plan.artifacts) {
          if (artifact.kind === "SIGNED_XML") artifactCounts.signedXml += 1;
          if (artifact.kind === "AUTHORIZED_XML") artifactCounts.authorizedXml += 1;
          if (artifact.kind === "RIDE_PDF") artifactCounts.ride += 1;
        }
        artifactCounts.sriResponses += document.responses.length;
        estimatedBytes +=
          document.snapshotBytes +
          plan.artifacts.reduce((sum, x) => sum + x.sizeBytes, 0) +
          document.responses.reduce((sum, x) => sum + x.sizeBytes, 0);
        plannedFiles += 1 + plan.artifacts.length + document.responses.length;
        const item: InventoryItem = {
          id: document.id,
          folder: documentFolder(document),
          artifacts: plan.artifacts.map(({ id, kind, sizeBytes, sha256: hash }) => ({
            id,
            kind,
            sizeBytes,
            sha256: hash,
          })),
          responses: document.responses.map((response) => ({
            attemptId: response.attemptId,
            file: responseFile(response),
            sizeBytes: response.sizeBytes,
            sha256: response.sha256,
          })),
        };
        await inventory.write(`${JSON.stringify(item)}\n`);
        yield document;
      }
    }
    const transitions = await counted(sources.transitions);
    const attempts = await counted(sources.attempts);
    const lines = await counted(sources.withholdingLines);
    const recipients = await counted(sources.recipients);
    const deliveries = await counted(sources.deliveries);
    try {
      await workbook("comprobantes", [
        part(DOCUMENTS, "Comprobantes", documents.count, inventoried(), lookups),
        part(TRANSITIONS, "Transiciones", transitions.count, transitions.rows, lookups),
        part(ATTEMPTS, "Intentos SRI", attempts.count, attempts.rows, lookups),
        part(WITHHOLDING_LINES, "Retenciones", lines.count, lines.rows, lookups),
        part(RECIPIENTS, "Destinatarios", recipients.count, recipients.rows, lookups),
        part(DELIVERIES, "Entregas", deliveries.count, deliveries.rows, lookups),
      ]);
    } finally {
      await inventory.close();
    }
    const balances = await counted(sources.stockBalances);
    const movements = await counted(sources.stockMovements);
    await workbook("inventario", [
      part(STOCK_BALANCES, "Existencias", balances.count, balances.rows, lookups),
      part(STOCK_MOVEMENTS, "Movimientos", movements.count, movements.rows, lookups),
    ]);
    const events = await counted(sources.auditEvents);
    await workbook("auditoria", [
      part(AUDIT_EVENTS, "Eventos", events.count, events.rows, lookups),
    ]);

    const current = versions.find((v) => v.current) ?? versions.at(-1) ?? null;
    const countOf = (dataset: string) => datasets.find((d) => d.dataset === dataset)?.rows ?? 0;
    return {
      snapshotAt,
      company: current
        ? { ruc: current.ruc, legalName: current.legalName, tradeName: current.tradeName }
        : null,
      datasets,
      documentCounts,
      artifactCounts,
      absent,
      snapshotVersions: Object.fromEntries(
        [...snapshotVersions].map(([type, set]) => [type, [...set].sort((a, b) => a - b)]),
      ),
      xmlSchemas: Object.fromEntries([...xmlSchemas].map(([type, set]) => [type, [...set].sort()])),
      logos,
      estimatedBytes,
      plannedFiles,
      totals: {
        parties: countOf("Terceros"),
        products: countOf("Productos"),
        stockMovements: countOf("Movimientos"),
        auditEvents: countOf("Eventos"),
        users: countOf("Usuarios"),
      },
    };
  }, limits.snapshotTimeoutMs);

  // Fase 2: los artefactos inventariados, verificados uno a uno.
  const documentsTotal = phase1.documentCounts.TEST + phase1.documentCounts.PRODUCTION;
  await request.progress("ARTIFACTS", 0, documentsTotal);
  let workbookBytes = 0;
  for (const name of WORKBOOKS) workbookBytes += await files.size(workbookPath(name));
  const required =
    Math.ceil(((phase1.estimatedBytes + workbookBytes) * (100 + limits.headroomPercent)) / 100) +
    limits.reserveBytes;
  if ((await files.freeBytes(workDir)) < required) {
    throw new ExportFailure("DATA_EXPORT_INSUFFICIENT_SPACE");
  }

  const counts: PackageCounts = {
    documents: phase1.documentCounts,
    artifacts: phase1.artifactCounts,
    files: phase1.plannedFiles,
  };
  const zip = await deps.openZip(request.packagePath, join(workDir, "zip"));
  const sumsPath = join(workDir, "SHA256SUMS");
  const sums = await files.lineWriter(sumsPath);
  const guard = createPathGuard();
  const add = async (path: string, bytes: Uint8Array, method: "store" | "deflate") => {
    await zip.addBuffer(path, bytes, method);
    await sums.write(checksumLine(sha256(bytes), path));
  };
  try {
    const generatedAt = deps.now();
    await add(
      guard.loose("manifest.json"),
      manifestBytes({
        generatedAt,
        snapshotAt: phase1.snapshotAt,
        applicationVersion: deps.applicationVersion,
        company: phase1.company,
        counts,
        datasets: phase1.datasets,
        snapshotVersions: phase1.snapshotVersions,
        xmlSchemas: phase1.xmlSchemas,
        absent: phase1.absent,
      }),
      "deflate",
    );
    await add(
      guard.loose("LEEME.txt"),
      readmeBytes({ snapshotAt: phase1.snapshotAt, counts }),
      "deflate",
    );
    for (const name of WORKBOOKS) {
      const path = guard.loose(`data/${name}.xlsx`);
      const source = workbookPath(name);
      await zip.addFile(path, source, "store");
      await sums.write(checksumLine(await files.sha256OfFile(source), path));
    }
    const { db } = deps.database;
    let done = 0;
    for await (const line of files.readLines(inventoryPath)) {
      request.signal.throwIfAborted();
      const item = JSON.parse(line) as InventoryItem;
      guard.folder(item.folder);
      const snapshot = await sources.readSnapshot(db, companyId, item.id);
      if (snapshot === null || snapshot === undefined) {
        throw new ExportFailure("DATA_EXPORT_ARTIFACT_INTEGRITY");
      }
      await add(
        guard.file("snapshot.json"),
        Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`),
        "deflate",
      );
      for (const artifact of item.artifacts) {
        const bytes = verified(await sources.readArtifact(db, companyId, artifact.id), artifact);
        await add(
          guard.file(ARTIFACT_FILES[artifact.kind]),
          bytes,
          artifact.kind === "RIDE_PDF" ? "store" : "deflate",
        );
      }
      for (const response of item.responses) {
        const bytes = verified(
          await sources.readSriResponse(db, companyId, response.attemptId),
          response,
        );
        await add(guard.file(response.file), bytes, "deflate");
      }
      done += 1;
      if (done % PROGRESS_EVERY === 0) await request.progress("ARTIFACTS", done, documentsTotal);
    }
    if (done !== documentsTotal) throw new Error("el inventario no coincide con los comprobantes");
    await request.progress("ARTIFACTS", done, documentsTotal);
    for (const logo of phase1.logos as readonly LogoRow[]) {
      const bytes = verified(await sources.readLogo(db, companyId, logo.assetId), logo);
      await add(guard.loose(logoFile(logo)), bytes, "store");
    }
    await sums.close();
    await zip.addFile(guard.loose("SHA256SUMS"), sumsPath, "deflate");
    await request.progress("PUBLISHING");
    const result = await zip.close();
    if (result.entries !== phase1.plannedFiles) {
      throw new Error("el paquete no tiene las entradas inventariadas");
    }
    return {
      snapshotAt: phase1.snapshotAt,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
      counts: {
        documentsTest: phase1.documentCounts.TEST,
        documentsProduction: phase1.documentCounts.PRODUCTION,
        files: result.entries,
        ...phase1.totals,
      },
    };
  } catch (error) {
    await sums.close().catch(() => undefined);
    await zip.abort();
    throw error;
  }
}
