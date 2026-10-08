// Lo que acompaña a cada XLSX (add-reports-export, design D6 y D13): el nombre ASCII del archivo,
// las filas de la hoja "Filtros" y los datos del evento de auditoría, que nunca lleva un dato
// personal de un filtro, solo que estuvo presente.
import {
  DOCUMENT_TYPE_LABELS,
  INVOICE_STATE_LABELS,
  PARTY_ROLE_LABELS,
  RECORD_STATUS_LABELS,
  REPORT_ENVIRONMENT_LABELS,
  REPORT_NOTICE,
  STOCK_MOVEMENT_TYPE_LABELS,
  type DocumentType,
  type InvoiceState,
  type PartyRole,
  type RecordStatus,
  type ReportEnvironment,
  type ReportId,
  type StockMovementType,
} from "@facturador/contracts";
import type { ReportDefinition } from "./definitions.ts";

/** Lo que el archivo y la hoja "Filtros" toman de la definición. */
type Described = Pick<ReportDefinition<ReportId>, "label" | "fileSlug">;

/** Filtros sin datos personales: el evento los registra con su valor (design D13). */
export const NON_PERSONAL_FILTERS = [
  "from",
  "to",
  "documentType",
  "state",
  "environment",
  "establishmentId",
  "emissionPointId",
  "fiscalPeriod",
  "productId",
  "movementType",
  "role",
  "status",
] as const;
/** Filtros con un dato personal: el evento solo registra que estuvieron presentes. */
export const PERSONAL_FILTERS = [
  "customerIdentification",
  "supplierIdentification",
  "identification",
] as const;

type FilterKey = (typeof NON_PERSONAL_FILTERS)[number] | (typeof PERSONAL_FILTERS)[number];
/** Filtros efectivos de cualquier reporte, con el ambiente ya resuelto. */
export type EffectiveFilters = Readonly<Partial<Record<FilterKey, string>>>;
/** Nombres legibles de los filtros por identificador, para la hoja "Filtros". */
export type FilterNames = Readonly<{
  establishment?: string | null;
  emissionPoint?: string | null;
  product?: string | null;
}>;

/** Datos del evento `report.exported`: el reporte, las filas y los filtros sin datos personales. */
export function exportAuditChanges(
  report: ReportId,
  rows: number,
  filters: EffectiveFilters,
): Record<string, string | number | boolean> {
  const changes: Record<string, string | number | boolean> = { report, rows };
  for (const key of NON_PERSONAL_FILTERS) {
    const value = filters[key];
    if (value !== undefined) changes[key] = value;
  }
  for (const key of PERSONAL_FILTERS) {
    if (filters[key] !== undefined) changes[`${key}Present`] = true;
  }
  return changes;
}

const WALL_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Guayaquil",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** El momento en la hora de Ecuador: la fecha ISO y el texto `dd/mm/aaaa hh:mm:ss`. */
function ecuador(moment: Date): { isoDate: string; display: string } {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of WALL_CLOCK.formatToParts(moment)) parts[part.type] = part.value;
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    display: `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

const displayDate = (isoDate: string) => isoDate.split("-").reverse().join("/");

/** `<reporte>-<desde>-<hasta>.xlsx`, o con la fecha de generación en Ecuador si falta el rango. */
export function exportFileName(
  definition: Described,
  filters: EffectiveFilters,
  generatedAt: Date,
): string {
  const range =
    filters.from && filters.to ? `${filters.from}-${filters.to}` : ecuador(generatedAt).isoDate;
  return `${definition.fileSlug}-${range}.xlsx`;
}

/** Filas `[filtro, valor]` de la hoja "Filtros": el reporte, el momento, los filtros y los avisos. */
export function filterSheetRows(
  definition: Described,
  filters: EffectiveFilters,
  names: FilterNames,
  generatedAt: Date,
  rows: number,
): [string, string][] {
  const state = (value: string) =>
    value === "ALL" ? "Todos" : INVOICE_STATE_LABELS[value as InvoiceState];
  const status = (value: string) =>
    value === "ALL" ? "Todos" : RECORD_STATUS_LABELS[value as RecordStatus];
  const shown: [FilterKey, string, (value: string) => string][] = [
    ["from", "Desde", displayDate],
    ["to", "Hasta", displayDate],
    ["documentType", "Tipo de comprobante", (value) => DOCUMENT_TYPE_LABELS[value as DocumentType]],
    ["state", "Estado", state],
    ["establishmentId", "Establecimiento", (value) => names.establishment ?? value],
    ["emissionPointId", "Punto de emisión", (value) => names.emissionPoint ?? value],
    ["customerIdentification", "Identificación del cliente", (value) => value],
    ["supplierIdentification", "Identificación del sujeto retenido", (value) => value],
    ["fiscalPeriod", "Período fiscal", (value) => `${value.slice(5, 7)}/${value.slice(0, 4)}`],
    ["productId", "Producto", (value) => names.product ?? value],
    [
      "movementType",
      "Tipo de movimiento",
      (value) => STOCK_MOVEMENT_TYPE_LABELS[value as StockMovementType],
    ],
    ["role", "Rol", (value) => PARTY_ROLE_LABELS[value as PartyRole]],
    ["identification", "Identificación", (value) => value],
    ["status", "Estado", status],
    ["environment", "Ambiente", (value) => REPORT_ENVIRONMENT_LABELS[value as ReportEnvironment]],
  ];
  return [
    ["Reporte", definition.label],
    ["Generado", `${ecuador(generatedAt).display} (hora de Ecuador)`],
    ...shown.flatMap(([key, label, display]): [string, string][] => {
      const value = filters[key];
      return value === undefined ? [] : [[label, display(value)]];
    }),
    ["Filas", String(rows)],
    ["Aviso", REPORT_NOTICE],
    [
      "Precisión",
      "Los importes y las cantidades con más de 15 dígitos significativos van como texto exacto.",
    ],
  ];
}
