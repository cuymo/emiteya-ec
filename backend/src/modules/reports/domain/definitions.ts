// Definición de cada reporte (add-reports-export, design D2, D3, D4, D6 y D7): su etiqueta, si tiene
// ambiente, sus columnas con el tipo de celda de cada una, el nombre del archivo, los filtros que
// muestra la hoja "Filtros" y lo que registra la auditoría. La lista y la exportación usan la misma
// definición y los mismos filtros de `packages/contracts`; solo difieren en cómo recorren las filas.
import {
  DOCUMENT_TYPE_LABELS,
  INVOICE_STATE_LABELS,
  PARTY_ROLE_LABELS,
  RECORD_STATUS_LABELS,
  REPORT_ENVIRONMENT_LABELS,
  REPORT_LABELS,
  STOCK_MOVEMENT_TYPE_LABELS,
  type InventoryBalanceRow,
  type InventoryBalancesFilters,
  type InventoryMovementRow,
  type InventoryMovementsFilters,
  type InvoiceRow,
  type InvoicesFilters,
  type IssuedDocumentRow,
  type IssuedDocumentsFilters,
  type PartiesFilters,
  type PartyRow,
  type ReportId,
  type WithholdingRow,
  type WithholdingsFilters,
} from "@facturador/contracts";

/** Tipo de celda del XLSX (design D7): el escritor decide la celda y su formato. */
export type ReportCellKind = "text" | "money" | "decimal" | "date" | "dateTime";
/** Texto, texto decimal, fecha ISO o momento; `null` deja la celda vacía. */
export type ReportCellValue = string | Date | null;

export type ReportColumn<R> = Readonly<{
  header: string;
  kind: ReportCellKind;
  /** Ancho en caracteres. */
  width: number;
  value: (row: R) => ReportCellValue;
}>;

export type ReportRows = {
  "issued-documents": IssuedDocumentRow;
  invoices: InvoiceRow;
  withholdings: WithholdingRow;
  "inventory-balances": InventoryBalanceRow;
  "inventory-movements": InventoryMovementRow;
  parties: PartyRow;
};

export type ReportFilters = {
  "issued-documents": IssuedDocumentsFilters;
  invoices: InvoicesFilters;
  withholdings: WithholdingsFilters;
  "inventory-balances": InventoryBalancesFilters;
  "inventory-movements": InventoryMovementsFilters;
  parties: PartiesFilters;
};

export type ReportDefinition<Id extends ReportId> = Readonly<{
  id: Id;
  label: string;
  /** Inicio ASCII del nombre del archivo, sin datos personales. */
  fileSlug: string;
  /** Solo los reportes de comprobantes tienen ambiente (design D4). */
  hasEnvironment: boolean;
  columns: readonly ReportColumn<ReportRows[Id]>[];
}>;

const text = <R>(header: string, width: number, value: (row: R) => string | null) =>
  ({ header, kind: "text", width, value }) as const satisfies ReportColumn<R>;
const money = <R>(header: string, value: (row: R) => string | null) =>
  ({ header, kind: "money", width: 14, value }) as const satisfies ReportColumn<R>;
const decimal = <R>(header: string, width: number, value: (row: R) => string | null) =>
  ({ header, kind: "decimal", width, value }) as const satisfies ReportColumn<R>;
const date = <R>(header: string, value: (row: R) => string) =>
  ({ header, kind: "date", width: 12, value }) as const satisfies ReportColumn<R>;

const stateLabel = (row: { state: keyof typeof INVOICE_STATE_LABELS }) =>
  INVOICE_STATE_LABELS[row.state];
const environmentLabel = (row: { environment: keyof typeof REPORT_ENVIRONMENT_LABELS }) =>
  REPORT_ENVIRONMENT_LABELS[row.environment];

export const REPORT_DEFINITIONS: { readonly [Id in ReportId]: ReportDefinition<Id> } = {
  "issued-documents": {
    id: "issued-documents",
    label: REPORT_LABELS["issued-documents"],
    fileSlug: "documentos-emitidos",
    hasEnvironment: true,
    columns: [
      date("Fecha", (row) => row.issueDate),
      text("Tipo", 24, (row) => DOCUMENT_TYPE_LABELS[row.documentType]),
      text("Número", 18, (row) => row.number),
      text("Identificación", 16, (row) => row.counterpart?.identification ?? null),
      // La guía con varios destinatarios no tiene un tercero sino su cantidad (design D5).
      text("Tercero", 40, (row) => row.counterpart?.name ?? `${row.recipientCount} destinatarios`),
      money("Subtotal", (row) => row.subtotal),
      money("Impuestos", (row) => row.taxes),
      money("Total", (row) => row.total),
      text("Estado", 24, stateLabel),
      text("Ambiente", 12, environmentLabel),
    ],
  },
  invoices: {
    id: "invoices",
    label: REPORT_LABELS.invoices,
    fileSlug: "facturas",
    hasEnvironment: true,
    columns: [
      date("Fecha", (row) => row.issueDate),
      text("Número", 18, (row) => row.number),
      text("Identificación", 16, (row) => row.customer.identification),
      text("Cliente", 40, (row) => row.customer.name),
      money("Subtotal", (row) => row.subtotal),
      money("IVA", (row) => row.vat),
      money("Otros impuestos", (row) => row.otherTaxes),
      money("Total", (row) => row.total),
      text("Estado", 24, stateLabel),
      text("Ambiente", 12, environmentLabel),
    ],
  },
  withholdings: {
    id: "withholdings",
    label: REPORT_LABELS.withholdings,
    fileSlug: "retenciones",
    hasEnvironment: true,
    columns: [
      date("Fecha", (row) => row.issueDate),
      text("Número", 18, (row) => row.number),
      text("Identificación", 16, (row) => row.supplier.identification),
      text("Sujeto retenido", 40, (row) => row.supplier.name),
      text("Período fiscal", 10, (row) => row.fiscalPeriod),
      text("Impuesto", 12, (row) => row.taxLabel),
      text("Código", 10, (row) => row.code),
      money("Base", (row) => row.base),
      decimal("Porcentaje", 11, (row) => row.percentage),
      money("Valor retenido", (row) => row.amount),
      text("Estado", 24, stateLabel),
      text("Ambiente", 12, environmentLabel),
    ],
  },
  "inventory-balances": {
    id: "inventory-balances",
    label: REPORT_LABELS["inventory-balances"],
    fileSlug: "existencias",
    hasEnvironment: false,
    columns: [
      text("Código", 16, (row) => row.code),
      text("Producto", 40, (row) => row.name),
      decimal("Saldo", 18, (row) => row.balance),
    ],
  },
  "inventory-movements": {
    id: "inventory-movements",
    label: REPORT_LABELS["inventory-movements"],
    fileSlug: "movimientos",
    hasEnvironment: false,
    columns: [
      {
        header: "Fecha y hora",
        kind: "dateTime",
        width: 20,
        value: (row) => new Date(row.occurredAt),
      },
      text("Código", 16, (row) => row.code),
      text("Producto", 40, (row) => row.name),
      text("Tipo", 28, (row) => STOCK_MOVEMENT_TYPE_LABELS[row.movementType]),
      decimal("Cantidad", 18, (row) => row.quantity),
      decimal("Saldo resultante", 18, (row) => row.balanceAfter),
      text("Comprobante", 18, (row) => row.documentNumber),
    ],
  },
  parties: {
    id: "parties",
    label: REPORT_LABELS.parties,
    fileSlug: "terceros",
    hasEnvironment: false,
    columns: [
      text("Identificación", 16, (row) => row.identification),
      text("Razón social", 40, (row) => row.legalName),
      text("Correo", 32, (row) => row.email),
      text("Teléfono", 16, (row) => row.phone),
      text("Roles", 28, (row) => row.roles.map((role) => PARTY_ROLE_LABELS[role]).join(", ")),
      text("Estado", 10, (row) => RECORD_STATUS_LABELS[row.status]),
    ],
  },
};
