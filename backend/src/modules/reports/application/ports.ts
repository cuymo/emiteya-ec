// Puertos de los reportes (add-reports-export, design D1, D10 y D11). Las fuentes las exportan los
// módulos dueños y las compone main.ts: `reports` nunca lee tablas. Los filtros que reciben llevan
// el ambiente ya resuelto por el servidor.
import type {
  Environment,
  InventoryMovementRow,
  InventoryMovementsFilters,
  InvoiceRow,
  InvoicesFilters,
  IssuedDocumentRow,
  IssuedDocumentsFilters,
  PartiesFilters,
  PartyRow,
  ReportEnvironment,
  ReportId,
  WithholdingRow,
  WithholdingsFilters,
} from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { ReportSource } from "../../../platform/db/report-source.ts";
import type { ReportCellKind, ReportCellValue } from "../domain/definitions.ts";

type WithEnvironment<F> = Omit<F, "environment"> & { environment: ReportEnvironment };

export type ReportProductLabel = Readonly<{ productId: string; code: string; name: string }>;

export type ReportSources = Readonly<{
  issuedDocuments: ReportSource<WithEnvironment<IssuedDocumentsFilters>, IssuedDocumentRow>;
  invoices: ReportSource<WithEnvironment<InvoicesFilters>, InvoiceRow>;
  withholdings: ReportSource<WithEnvironment<WithholdingsFilters>, WithholdingRow>;
  inventoryMovements: ReportSource<
    InventoryMovementsFilters,
    Omit<InventoryMovementRow, "code" | "name">
  >;
  /** Los productos pedidos, por nombre normalizado e identificador (Existencias). */
  products: ReportSource<{ productIds: readonly string[] }, ReportProductLabel>;
  productLabels(
    db: DbClient,
    companyId: string,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReportProductLabel>>;
  initializedProductIds(db: DbClient, companyId: string, productId?: string): Promise<string[]>;
  balances(
    db: DbClient,
    companyId: string,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  parties: ReportSource<PartiesFilters, PartyRow>;
  currentEnvironment(db: DbClient, companyId: string): Promise<Environment>;
  /** Códigos legibles del establecimiento y del punto, para la hoja "Filtros". */
  pointCodes(
    db: DbClient,
    companyId: string,
    ids: Readonly<{ establishmentId?: string; emissionPointId?: string }>,
  ): Promise<Readonly<{ establishment: string | null; emissionPoint: string | null }>>;
}>;

/** Lecturas de la base: sueltas para la lista; en una instantánea de solo lectura para exportar. */
export interface ReportsDatabase {
  readonly db: DbClient;
  /** Una transacción `REPEATABLE READ` de solo lectura: el conteo y los lotes ven un solo momento. */
  readOnlySnapshot<T>(work: (db: DbClient) => Promise<T>): Promise<T>;
}

export type XlsxSheetInput = Readonly<{
  name: string;
  columns: readonly Readonly<{ header: string; kind: ReportCellKind; width: number }>[];
  rows: AsyncIterable<readonly ReportCellValue[]> | Iterable<readonly ReportCellValue[]>;
}>;

/** Escritor del XLSX (ADR 0023): escribe un archivo nuevo y devuelve las filas de cada hoja. */
export type XlsxWriter = (path: string, sheets: readonly XlsxSheetInput[]) => Promise<number[]>;

/** Archivo temporal privado de una exportación: nunca durable, nunca expuesto. */
export type TemporaryFile = Readonly<{ path: string; dispose: () => Promise<void> }>;
export interface TemporaryFiles {
  create(): Promise<TemporaryFile>;
}

export type ExportResult = "generated" | "row_limit" | "busy" | "failed";

export interface ReportsObserver {
  exported(report: ReportId, result: ExportResult): void;
  generated(report: ReportId, seconds: number, rows: number): void;
}
