// Consulta y exportación de los reportes (add-reports-export, design D2, D4, D10, D11 y D13). La
// lista y la exportación toman la misma definición, los mismos filtros y la misma fuente; la lista
// la recorre por páginas y la exportación por lotes, en este orden:
//   1. el semáforo de la instancia, sin cola (503 si no hay lugar);
//   2. en una transacción `REPEATABLE READ` de solo lectura: el ambiente efectivo, el conteo, el
//      rechazo si supera el máximo de filas (409, sin archivo) y el XLSX por lotes con un cursor;
//   3. después de confirmar la lectura, la auditoría `report.exported`, en su propia escritura;
//   4. la entrega, que hace la ruta, borrando el temporal al terminar, al fallar o si el cliente se
//      desconecta. Si algo falla antes de entregar, se borra el temporal y no queda ningún evento.
import { REPORT_CONTRACTS, type ReportId, type ReportListMeta } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { ReportPage } from "../../../platform/db/report-source.ts";
import { ConflictError, ServiceUnavailableError } from "../../../platform/http/errors.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  REPORT_DEFINITIONS,
  type ReportCellValue,
  type ReportColumn,
  type ReportRows,
} from "../domain/definitions.ts";
import {
  exportAuditChanges,
  exportFileName,
  filterSheetRows,
  type FilterNames,
} from "../domain/export.ts";
import type {
  ReportSources,
  ReportsDatabase,
  ReportsObserver,
  TemporaryFile,
  TemporaryFiles,
  XlsxWriter,
} from "./ports.ts";
import { createSemaphore } from "./semaphore.ts";

/** Filas por `FETCH` del cursor de la exportación. */
export const EXPORT_BATCH_SIZE = 1_000;
/** Espera sugerida en `Retry-After` cuando la instancia no tiene lugar. */
export const EXPORT_RETRY_AFTER_SECONDS = 15;

export type ReportsLimits = Readonly<{ maxRows: number; maxConcurrent: number }>;

export type ReportsDependencies = Readonly<{
  database: ReportsDatabase;
  sources: ReportSources;
  authorizer: Authorizer;
  audit: AuditLog;
  writer: XlsxWriter;
  temporaryFiles: TemporaryFiles;
  limits: ReportsLimits;
  observer: ReportsObserver;
  now?: () => Date;
}>;

/** Un XLSX generado y auditado, listo para entregarse; `dispose` borra su temporal. */
export type ReportExport = Readonly<{
  path: string;
  fileName: string;
  rows: number;
  dispose: () => Promise<void>;
}>;

type Filters = Record<string, unknown>;
type Runner = Readonly<{
  count(db: DbClient, companyId: string, filters: Filters): Promise<number>;
  page(db: DbClient, companyId: string, filters: Filters, page: ReportPage): Promise<unknown[]>;
  batches(
    db: DbClient,
    companyId: string,
    filters: Filters,
    size: number,
  ): AsyncIterable<unknown[]>;
}>;

/** Cómo recorre cada reporte sus fuentes; el inventario completa los productos en lote. */
function runners(sources: ReportSources): Record<ReportId, Runner> {
  const direct = (source: Runner): Runner => source;
  type MovementRow = { productId: string };
  const withProducts = async (db: DbClient, companyId: string, rows: MovementRow[]) => {
    const labels = await sources.productLabels(
      db,
      companyId,
      rows.map((row) => row.productId),
    );
    return rows.map((row) => ({
      ...row,
      code: labels.get(row.productId)?.code ?? "",
      name: labels.get(row.productId)?.name ?? "",
    }));
  };
  const withBalances = async (
    db: DbClient,
    companyId: string,
    products: readonly { productId: string; code: string; name: string }[],
  ) => {
    const balances = await sources.balances(
      db,
      companyId,
      products.map((product) => product.productId),
    );
    return products.map((product) => {
      const balance = balances.get(product.productId);
      if (balance === undefined) throw new Error("Un producto inicializado no tiene saldo.");
      return { ...product, balance };
    });
  };
  const initialized = (db: DbClient, companyId: string, filters: Filters) =>
    sources.initializedProductIds(db, companyId, filters.productId as string | undefined);
  return {
    "issued-documents": direct(sources.issuedDocuments),
    invoices: direct(sources.invoices),
    withholdings: direct(sources.withholdings),
    parties: direct(sources.parties),
    "inventory-movements": {
      count: (db, companyId, filters) => sources.inventoryMovements.count(db, companyId, filters),
      async page(db, companyId, filters, page) {
        return withProducts(
          db,
          companyId,
          await sources.inventoryMovements.page(db, companyId, filters, page),
        );
      },
      async *batches(db, companyId, filters, size) {
        for await (const batch of sources.inventoryMovements.batches(
          db,
          companyId,
          filters,
          size,
        )) {
          yield await withProducts(db, companyId, batch);
        }
      },
    },
    "inventory-balances": {
      async count(db, companyId, filters) {
        const productIds = await initialized(db, companyId, filters);
        return sources.products.count(db, companyId, { productIds });
      },
      async page(db, companyId, filters, page) {
        const productIds = await initialized(db, companyId, filters);
        const products = await sources.products.page(db, companyId, { productIds }, page);
        return withBalances(db, companyId, products);
      },
      async *batches(db, companyId, filters, size) {
        const productIds = await initialized(db, companyId, filters);
        for await (const batch of sources.products.batches(db, companyId, { productIds }, size)) {
          yield await withBalances(db, companyId, batch);
        }
      },
    },
  };
}

const FILTER_COLUMNS = [
  { header: "Filtro", kind: "text", width: 34 },
  { header: "Valor", kind: "text", width: 80 },
] as const;

export function createReports(deps: ReportsDependencies) {
  const { database, sources, authorizer, audit, writer, temporaryFiles, limits, observer } = deps;
  const now = deps.now ?? (() => new Date());
  const runner = runners(sources);
  const semaphore = createSemaphore(limits.maxConcurrent);

  /** El ambiente efectivo: el elegido, o el vigente de la empresa, leído del servidor (design D4). */
  async function effectiveFilters(
    db: DbClient,
    companyId: string,
    report: ReportId,
    filters: Filters,
  ): Promise<Filters> {
    if (!REPORT_DEFINITIONS[report].hasEnvironment) return filters;
    return {
      ...filters,
      environment: filters.environment ?? (await sources.currentEnvironment(db, companyId)),
    };
  }

  async function filterNames(db: DbClient, companyId: string, filters: Filters) {
    const names: { -readonly [K in keyof FilterNames]: FilterNames[K] } = {};
    const establishmentId = filters.establishmentId as string | undefined;
    const emissionPointId = filters.emissionPointId as string | undefined;
    if (establishmentId || emissionPointId) {
      const codes = await sources.pointCodes(db, companyId, {
        ...(establishmentId ? { establishmentId } : {}),
        ...(emissionPointId ? { emissionPointId } : {}),
      });
      names.establishment = codes.establishment;
      names.emissionPoint = codes.emissionPoint;
    }
    const productId = filters.productId as string | undefined;
    if (productId) {
      names.product = (await sources.productLabels(db, companyId, [productId])).get(
        productId,
      )?.name;
    }
    return names;
  }

  /** Las celdas de cada fila, lote por lote; se detiene si el cliente se desconectó. */
  async function* cells(
    batches: AsyncIterable<unknown[]>,
    columns: readonly ReportColumn<never>[],
    signal: AbortSignal | undefined,
  ): AsyncGenerator<ReportCellValue[]> {
    for await (const batch of batches) {
      signal?.throwIfAborted();
      for (const row of batch) {
        yield columns.map((column) => (column.value as (row: unknown) => ReportCellValue)(row));
      }
    }
    signal?.throwIfAborted();
  }

  return {
    async list(
      ctx: RequestContext,
      report: ReportId,
      rawQuery: unknown,
    ): Promise<{ data: ReportRows[ReportId][]; meta: ReportListMeta }> {
      authorizer.requirePermission(ctx, "reports.read");
      const { page, pageSize, ...parsed } = parseInput(
        REPORT_CONTRACTS[report].queries.list,
        rawQuery,
      ) as Filters & { page: number; pageSize: number };
      const db = database.db;
      const filters = await effectiveFilters(db, ctx.companyId, report, parsed);
      const [total, data] = await Promise.all([
        runner[report].count(db, ctx.companyId, filters),
        runner[report].page(db, ctx.companyId, filters, {
          offset: (page - 1) * pageSize,
          limit: pageSize,
        }),
      ]);
      return {
        data: data as ReportRows[ReportId][],
        meta: {
          page,
          pageSize,
          total,
          environment: REPORT_DEFINITIONS[report].hasEnvironment
            ? (filters.environment as ReportListMeta["environment"])
            : null,
        },
      };
    },

    async export(
      ctx: RequestContext,
      report: ReportId,
      rawQuery: unknown,
      signal?: AbortSignal,
    ): Promise<ReportExport> {
      authorizer.requirePermission(ctx, "reports.export");
      const parsed = parseInput(REPORT_CONTRACTS[report].queries.export, rawQuery) as Filters;
      const release = semaphore.tryAcquire();
      if (!release) {
        observer.exported(report, "busy");
        throw new ServiceUnavailableError(
          "REPORT_EXPORT_BUSY",
          "Ya hay otras exportaciones en curso. Intenta de nuevo en unos segundos.",
          EXPORT_RETRY_AFTER_SECONDS,
        );
      }
      const definition = REPORT_DEFINITIONS[report];
      const started = performance.now();
      const generatedAt = now();
      const created: { file: TemporaryFile | null } = { file: null };
      try {
        const { rows, filters } = await database.readOnlySnapshot(async (db) => {
          const filters = await effectiveFilters(db, ctx.companyId, report, parsed);
          const rows = await runner[report].count(db, ctx.companyId, filters);
          if (rows > limits.maxRows) {
            throw new ConflictError(
              "REPORT_EXPORT_ROW_LIMIT",
              `El reporte tiene ${rows} filas y una exportación admite como máximo ${limits.maxRows}. Acota los filtros, por ejemplo el rango de fechas.`,
            );
          }
          const names = await filterNames(db, ctx.companyId, filters);
          const file = await temporaryFiles.create();
          created.file = file;
          const [written] = await writer(file.path, [
            {
              name: definition.label,
              columns: definition.columns,
              rows: cells(
                runner[report].batches(db, ctx.companyId, filters, EXPORT_BATCH_SIZE),
                definition.columns,
                signal,
              ),
            },
            {
              name: "Filtros",
              columns: FILTER_COLUMNS,
              rows: filterSheetRows(definition, filters, names, generatedAt, rows),
            },
          ]);
          // En la misma instantánea, el recorrido y el conteo nunca difieren; si difieren, no se entrega.
          if (written !== rows) throw new Error("La exportación no generó las filas contadas.");
          return { rows, filters };
        });
        await audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "report.exported",
          changes: exportAuditChanges(report, rows, filters),
          correlationId: ctx.requestId,
        });
        observer.exported(report, "generated");
        observer.generated(report, (performance.now() - started) / 1_000, rows);
        const file = created.file!;
        return {
          path: file.path,
          fileName: exportFileName(definition, filters, generatedAt),
          rows,
          dispose: file.dispose,
        };
      } catch (error) {
        await created.file?.dispose();
        observer.exported(
          report,
          error instanceof ConflictError && error.code === "REPORT_EXPORT_ROW_LIMIT"
            ? "row_limit"
            : "failed",
        );
        throw error;
      } finally {
        release();
      }
    },
  };
}

export type Reports = ReturnType<typeof createReports>;
