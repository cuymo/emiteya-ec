// Contratos de los reportes (add-reports-export, design D2, D3, D4 y D12). Los cinco reportes del ERS
// (§11, RF-501 a RF-505) en seis vistas, con el inventario en Existencias y Movimientos. Los filtros
// son estrictos por reporte: un filtro de otro reporte, un `companyId` o un parámetro desconocido se
// rechazan. El estado del comprobante y el del tercero tienen aquí su valor por defecto; el ambiente,
// que depende de la empresa, lo resuelve el servidor cuando falta. Los importes viajan como texto
// decimal y la exportación usa los mismos filtros, sin página.
import { z } from "zod";
import { calendarDateSchema, DOCUMENT_STATES, documentStateSchema } from "./archive.ts";
import { decimalStringSchema } from "./decimal.ts";
import { documentTypeSchema } from "./fiscal-numbering.ts";
import { stockMovementTypeSchema } from "./inventory.ts";
import {
  listMetaSchema,
  pageParams,
  recordStatusFilterSchema,
  recordStatusSchema,
} from "./pagination.ts";
import { partyRoleSchema } from "./parties.ts";
import { ENVIRONMENTS, environmentSchema } from "./taxpayer.ts";
import { withholdingTaxCodeSchema } from "./withholding-receipts.ts";

export const REPORT_IDS = [
  "issued-documents",
  "invoices",
  "withholdings",
  "inventory-balances",
  "inventory-movements",
  "parties",
] as const;
export const reportIdSchema = z.enum(REPORT_IDS, { error: "El reporte no existe." });
export type ReportId = z.infer<typeof reportIdSchema>;
export const REPORT_LABELS: Record<ReportId, string> = {
  "issued-documents": "Documentos emitidos",
  invoices: "Facturas",
  withholdings: "Retenciones",
  "inventory-balances": "Existencias",
  "inventory-movements": "Movimientos",
  parties: "Clientes y proveedores",
};

/** Aviso de ERS RF-505, en la pantalla y en la hoja "Filtros" del XLSX. */
export const REPORT_NOTICE =
  "Los reportes no reemplazan obligaciones contables ni anexos tributarios.";

/** Ambiente de los reportes de comprobantes (design D4): los dos solo por elección explícita. */
export const REPORT_ENVIRONMENTS = [...ENVIRONMENTS, "ALL"] as const;
export const reportEnvironmentSchema = z.enum(REPORT_ENVIRONMENTS, {
  error: "El ambiente no es válido.",
});
export type ReportEnvironment = z.infer<typeof reportEnvironmentSchema>;
export const REPORT_ENVIRONMENT_LABELS: Record<ReportEnvironment, string> = {
  TEST: "Pruebas",
  PRODUCTION: "Producción",
  ALL: "Pruebas y Producción",
};

/** Estado del comprobante en un filtro: uno o todos (`ALL`). */
export const REPORT_STATES = [...DOCUMENT_STATES, "ALL"] as const;
export type ReportState = (typeof REPORT_STATES)[number];
/** Estados por defecto (design D3): todos en Documentos emitidos, autorizados en los demás. */
export const REPORT_DEFAULT_STATES = {
  "issued-documents": "ALL",
  invoices: "AUTHORIZED",
  withholdings: "AUTHORIZED",
} as const satisfies Partial<Record<ReportId, ReportState>>;
const stateFilter = (fallback: ReportState) =>
  z.enum(REPORT_STATES, { error: "El estado no es válido." }).default(fallback);

export const RECORD_STATUS_LABELS = { ACTIVE: "Activo", INACTIVE: "Inactivo" } as const;

const idFilter = (message: string) =>
  z.string({ error: message }).trim().min(1, message).max(64, message);
const identificationFilter = (message: string) =>
  z
    .string({ error: message })
    .trim()
    .regex(/^[A-Za-z0-9]{1,20}$/, message);
/** Período fiscal `AAAA-MM` en el filtro; la fila lo muestra como lo guardó la retención. */
export const REPORT_FISCAL_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const fiscalPeriodFilter = z
  .string({ error: "El período fiscal no es válido." })
  .regex(REPORT_FISCAL_PERIOD_PATTERN, "El período fiscal debe tener la forma AAAA-MM.");

const UNKNOWN_FILTER = "La consulta contiene filtros que este reporte no tiene.";
type Range = { from?: string | undefined; to?: string | undefined };
const validRange = (query: Range) => !query.from || !query.to || query.from <= query.to;
const RANGE_ISSUE = { path: ["to"], message: "La fecha final no puede ser anterior a la inicial." };

/** La consulta de la lista (con página) y la de la exportación (sin página) de un reporte. */
function reportQueries<T extends z.core.$ZodLooseShape>(filters: T) {
  const strict = <S extends z.core.$ZodLooseShape>(shape: S) =>
    z
      .strictObject(shape, {
        error: (issue) =>
          issue.code === "unrecognized_keys" ? UNKNOWN_FILTER : "La consulta no es válida.",
      })
      .refine((query) => validRange(query as Range), RANGE_ISSUE);
  return { list: strict({ ...filters, ...pageParams }), export: strict(filters) };
}

const dateRange = { from: calendarDateSchema.optional(), to: calendarDateSchema.optional() };

export const issuedDocumentsQueries = reportQueries({
  ...dateRange,
  documentType: documentTypeSchema.optional(),
  state: stateFilter(REPORT_DEFAULT_STATES["issued-documents"]),
  establishmentId: idFilter("El establecimiento no es válido.").optional(),
  emissionPointId: idFilter("El punto de emisión no es válido.").optional(),
  environment: reportEnvironmentSchema.optional(),
});
export const invoicesQueries = reportQueries({
  ...dateRange,
  customerIdentification: identificationFilter(
    "La identificación del cliente no es válida.",
  ).optional(),
  state: stateFilter(REPORT_DEFAULT_STATES.invoices),
  environment: reportEnvironmentSchema.optional(),
});
export const withholdingsQueries = reportQueries({
  ...dateRange,
  supplierIdentification: identificationFilter(
    "La identificación del sujeto retenido no es válida.",
  ).optional(),
  fiscalPeriod: fiscalPeriodFilter.optional(),
  state: stateFilter(REPORT_DEFAULT_STATES.withholdings),
  environment: reportEnvironmentSchema.optional(),
});
export const inventoryBalancesQueries = reportQueries({
  productId: idFilter("El producto no es válido.").optional(),
});
export const inventoryMovementsQueries = reportQueries({
  productId: idFilter("El producto no es válido.").optional(),
  ...dateRange,
  movementType: stockMovementTypeSchema.optional(),
});
export const partiesQueries = reportQueries({
  role: partyRoleSchema.optional(),
  identification: identificationFilter("La identificación no es válida.").optional(),
  status: recordStatusFilterSchema,
});

export type IssuedDocumentsFilters = z.output<typeof issuedDocumentsQueries.export>;
export type InvoicesFilters = z.output<typeof invoicesQueries.export>;
export type WithholdingsFilters = z.output<typeof withholdingsQueries.export>;
export type InventoryBalancesFilters = z.output<typeof inventoryBalancesQueries.export>;
export type InventoryMovementsFilters = z.output<typeof inventoryMovementsQueries.export>;
export type PartiesFilters = z.output<typeof partiesQueries.export>;

/** Importe sin el tope del XSD: una suma de impuestos puede tener más dígitos que un importe. */
const amount = decimalStringSchema;
const counterpartSchema = z.strictObject({ identification: z.string(), name: z.string() });

/**
 * Documentos emitidos (design D5): la guía no tiene importes y sí destinatarios; con varios, no tiene
 * un tercero sino su cantidad. La retención solo tiene su total retenido.
 */
export const issuedDocumentRowSchema = z
  .strictObject({
    id: z.string(),
    issueDate: calendarDateSchema,
    documentType: documentTypeSchema,
    number: z.string(),
    /** Nulo solo en la guía con varios destinatarios. */
    counterpart: counterpartSchema.nullable(),
    /** Solo en la guía. */
    recipientCount: z.number().int().min(1).nullable(),
    subtotal: amount.nullable(),
    taxes: amount.nullable(),
    total: amount.nullable(),
    state: documentStateSchema,
    environment: environmentSchema,
  })
  .superRefine((row, ctx) => {
    const guide = row.documentType === "06";
    const withholding = row.documentType === "07";
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (guide !== (row.recipientCount !== null)) {
      issue("recipientCount", "Solo la guía tiene destinatarios.");
    }
    if ((row.counterpart === null) !== (guide && (row.recipientCount ?? 0) > 1)) {
      issue("counterpart", "Solo la guía con varios destinatarios no tiene un tercero.");
    }
    const amounts = guide || withholding;
    if (amounts !== (row.subtotal === null) || amounts !== (row.taxes === null)) {
      issue("subtotal", "El subtotal y los impuestos no corresponden al tipo.");
    }
    if (guide !== (row.total === null)) issue("total", "El total no corresponde al tipo.");
  });
export type IssuedDocumentRow = z.infer<typeof issuedDocumentRowSchema>;

/** Facturas: el IVA (código 2) y los otros impuestos por separado (design D5). */
export const invoiceRowSchema = z.strictObject({
  id: z.string(),
  issueDate: calendarDateSchema,
  number: z.string(),
  customer: counterpartSchema,
  subtotal: amount,
  vat: amount,
  otherTaxes: amount,
  total: amount,
  state: documentStateSchema,
  environment: environmentSchema,
});
export type InvoiceRow = z.infer<typeof invoiceRowSchema>;

/** Retenciones: una fila por línea, con lo que la retención congeló al reservar su número. */
export const withholdingRowSchema = z.strictObject({
  documentId: z.string(),
  /** Posición del documento sustento y, dentro de él, de la línea (desde 1). */
  supportPosition: z.number().int().min(1),
  position: z.number().int().min(1),
  issueDate: calendarDateSchema,
  number: z.string(),
  supplier: counterpartSchema,
  /** `MM/AAAA`, como lo guarda la retención. */
  fiscalPeriod: z.string(),
  tax: withholdingTaxCodeSchema,
  taxLabel: z.string(),
  code: z.string(),
  base: amount,
  percentage: amount,
  amount,
  state: documentStateSchema,
  environment: environmentSchema,
});
export type WithholdingRow = z.infer<typeof withholdingRowSchema>;

/** Existencias: el saldo registrado del inventario, sin recalcular. */
export const inventoryBalanceRowSchema = z.strictObject({
  productId: z.string(),
  code: z.string(),
  name: z.string(),
  balance: amount,
});
export type InventoryBalanceRow = z.infer<typeof inventoryBalanceRowSchema>;

export const inventoryMovementRowSchema = z.strictObject({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  productId: z.string(),
  code: z.string(),
  name: z.string(),
  movementType: stockMovementTypeSchema,
  quantity: amount,
  balanceAfter: amount,
  /** El comprobante que originó el movimiento, si existe. */
  documentNumber: z.string().nullable(),
});
export type InventoryMovementRow = z.infer<typeof inventoryMovementRowSchema>;

/** Terceros: los datos vigentes. */
export const partyRowSchema = z.strictObject({
  id: z.string(),
  identification: z.string(),
  legalName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  roles: z.array(partyRoleSchema),
  status: recordStatusSchema,
});
export type PartyRow = z.infer<typeof partyRowSchema>;

/** Página de un reporte, con el ambiente efectivo; nulo en el inventario y los terceros. */
export const reportListMetaSchema = listMetaSchema.extend({
  environment: reportEnvironmentSchema.nullable(),
});
export type ReportListMeta = z.infer<typeof reportListMetaSchema>;

const listView = <T extends z.ZodType>(row: T) =>
  z.strictObject({ data: z.array(row), meta: reportListMetaSchema });

/** Cada reporte: su etiqueta, sus consultas y su fila. */
export const REPORT_CONTRACTS = {
  "issued-documents": { queries: issuedDocumentsQueries, row: issuedDocumentRowSchema },
  invoices: { queries: invoicesQueries, row: invoiceRowSchema },
  withholdings: { queries: withholdingsQueries, row: withholdingRowSchema },
  "inventory-balances": { queries: inventoryBalancesQueries, row: inventoryBalanceRowSchema },
  "inventory-movements": { queries: inventoryMovementsQueries, row: inventoryMovementRowSchema },
  parties: { queries: partiesQueries, row: partyRowSchema },
} as const;

export const reportListViewSchemas = {
  "issued-documents": listView(issuedDocumentRowSchema),
  invoices: listView(invoiceRowSchema),
  withholdings: listView(withholdingRowSchema),
  "inventory-balances": listView(inventoryBalanceRowSchema),
  "inventory-movements": listView(inventoryMovementRowSchema),
  parties: listView(partyRowSchema),
} as const;

/** Rechazos de la exportación (design D11). */
export const REPORT_ERROR_CODES = [
  // `409`: el reporte tiene más filas que el máximo de la exportación; hay que acotar los filtros.
  "REPORT_EXPORT_ROW_LIMIT",
  // `503` con `Retry-After`: la instancia ya tiene el máximo de exportaciones en curso.
  "REPORT_EXPORT_BUSY",
] as const;
export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[number];

export const REPORT_EXPORT_CONTENT_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
