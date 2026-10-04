// Contratos del inventario (add-minimal-inventory, design D7 a D10): stock contabilizado por hechos
// fiscales autorizados, nunca una reserva de disponibilidad. Las consultas no son estrictas (un
// `companyId` se ignora); los cuerpos sí: un `companyId` se rechaza. Cantidades y saldos viajan
// como texto decimal, nunca como número JSON.
import { z } from "zod";
import { calendarDateSchema } from "./archive.ts";
import {
  DECIMAL_SPECS,
  canonicalDecimal,
  decimalSpecViolation,
  decimalString,
  isDecimalString,
} from "./decimal.ts";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_PATTERN } from "./invoices.ts";
import { listMetaSchema, pageParams, recordStatusSchema, searchParam } from "./pagination.ts";
import { optionalText, strictBody } from "./taxpayer.ts";

/**
 * Estado del control de stock de un producto, derivado y nunca guardado (design D8): la marca del
 * producto y la existencia de su inventario. Sin inicializar no hay saldo; nunca se muestra cero.
 */
export const STOCK_TRACKING_STATES = [
  "NOT_TRACKED",
  "TRACKED_NOT_INITIALIZED",
  "TRACKED_INITIALIZED",
  "DISABLED_INITIALIZED",
] as const;
export const stockTrackingStateSchema = z.enum(STOCK_TRACKING_STATES);
export type StockTrackingState = z.infer<typeof stockTrackingStateSchema>;
export const STOCK_TRACKING_STATE_LABELS: Record<StockTrackingState, string> = {
  NOT_TRACKED: "Sin control de stock",
  TRACKED_NOT_INITIALIZED: "Sin inicializar",
  TRACKED_INITIALIZED: "Activo",
  DISABLED_INITIALIZED: "Control desactivado",
};

/** Filtros de la lista: los tres estados con marca o inventario, y el saldo negativo. */
export const STOCK_LIST_FILTERS = [
  "TRACKED_NOT_INITIALIZED",
  "TRACKED_INITIALIZED",
  "DISABLED_INITIALIZED",
  "NEGATIVE",
] as const;
export type StockListFilter = (typeof STOCK_LIST_FILTERS)[number];

/** Tipos de movimiento (ERS RF-311). `DEVOLUCION_NC` la produce el cambio de notas de crédito. */
export const STOCK_MOVEMENT_TYPES = [
  "INICIAL",
  "ENTRADA_MANUAL",
  "SALIDA_FACTURA",
  "DEVOLUCION_NC",
  "AJUSTE",
] as const;
export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);
export type StockMovementType = z.infer<typeof stockMovementTypeSchema>;
export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  INICIAL: "Saldo inicial",
  ENTRADA_MANUAL: "Entrada",
  SALIDA_FACTURA: "Salida por factura",
  DEVOLUCION_NC: "Devolución por nota de crédito",
  AJUSTE: "Ajuste",
};

export const STOCK_MOVEMENT_ORIGINS = ["USER", "SYSTEM"] as const;
export const stockMovementOriginSchema = z.enum(STOCK_MOVEMENT_ORIGINS);
export type StockMovementOrigin = z.infer<typeof stockMovementOriginSchema>;

/** Variación o saldo, con signo (dominio `existencia`). */
const stockQuantity = decimalString(DECIMAL_SPECS.existencia);
/** Cantidad de una solicitud: el dominio de las cantidades de la emisión, sin signo. */
const requestQuantity = decimalString(DECIMAL_SPECS.cantidad);

export const STOCK_TEXT_MAX_LENGTH = 500;
const noteSchema = optionalText(
  z
    .string()
    .max(
      STOCK_TEXT_MAX_LENGTH,
      `La nota debe tener como máximo ${STOCK_TEXT_MAX_LENGTH} caracteres.`,
    ),
  "La nota no es válida.",
);

export const listStockItemsQuerySchema = z.object({
  /** Código o nombre del producto. */
  search: searchParam,
  state: z.enum(STOCK_LIST_FILTERS, { error: "El estado no es válido." }).optional(),
  ...pageParams,
});
export type ListStockItemsQuery = z.output<typeof listStockItemsQuerySchema>;

export const stockItemParamsSchema = z.strictObject({ productId: z.string().min(1) });

export const stockItemViewSchema = z.strictObject({
  productId: z.string(),
  mainCode: z.string().nullable(),
  auxiliaryCode: z.string().nullable(),
  name: z.string(),
  productStatus: recordStatusSchema,
  state: stockTrackingStateSchema,
  /** `null` sin inicializar: nunca cero. */
  balance: stockQuantity.nullable(),
  negative: z.boolean(),
  lastMovementAt: z.string().nullable(),
});
export type StockItemView = z.infer<typeof stockItemViewSchema>;

export const stockItemListMetaSchema = listMetaSchema;

export const stockItemDetailViewSchema = stockItemViewSchema.extend({
  initializedAt: z.string().nullable(),
  initializedByName: z.string().nullable(),
});
export type StockItemDetailView = z.infer<typeof stockItemDetailViewSchema>;

/** Kárdex por rango de fechas de Ecuador, inclusivo. */
export const listStockMovementsQuerySchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    ...pageParams,
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ["to"],
    message: "La fecha final no puede ser anterior a la inicial.",
  });
export type ListStockMovementsQuery = z.output<typeof listStockMovementsQuerySchema>;

export const stockMovementViewSchema = z.strictObject({
  id: z.string(),
  position: z.number().int(),
  type: stockMovementTypeSchema,
  delta: stockQuantity,
  balanceAfter: stockQuantity,
  occurredAt: z.string(),
  origin: stockMovementOriginSchema,
  actorName: z.string().nullable(),
  documentId: z.string().nullable(),
  documentNumber: z.string().nullable(),
  /** Motivo del ajuste o nota de la inicialización o de la entrada. */
  reason: z.string().nullable(),
});
export type StockMovementView = z.infer<typeof stockMovementViewSchema>;

export const stockMovementListMetaSchema = listMetaSchema;

/** Cero o más: un saldo de partida medido, que puede ser cero (design D3). */
export const initializeStockSchema = strictBody({
  quantity: requestQuantity,
  note: noteSchema,
});
export type InitializeStockInput = z.input<typeof initializeStockSchema>;

export const stockEntrySchema = strictBody({
  quantity: requestQuantity.refine(
    (value) => !isDecimalString(value) || canonicalDecimal(value) !== "0",
    "La cantidad de una entrada debe ser mayor que cero.",
  ),
  note: noteSchema,
});
export type StockEntryInput = z.input<typeof stockEntrySchema>;

/** Variación con signo, distinta de cero, con el valor absoluto en el dominio de las cantidades. */
const adjustmentDelta = z
  .string({ error: "La variación es obligatoria." })
  .superRefine((text, ctx) => {
    if (!isDecimalString(text)) {
      ctx.addIssue({
        code: "custom",
        message: decimalSpecViolation(text, DECIMAL_SPECS.cantidad) ?? "La variación no es válida.",
      });
      return;
    }
    const magnitude = text.startsWith("-") ? text.slice(1) : text;
    const violation = decimalSpecViolation(magnitude, DECIMAL_SPECS.cantidad);
    if (violation) ctx.addIssue({ code: "custom", message: violation });
    else if (canonicalDecimal(magnitude) === "0") {
      ctx.addIssue({ code: "custom", message: "Un ajuste no puede ser de cero." });
    }
  });

export const stockAdjustmentSchema = strictBody({
  delta: adjustmentDelta,
  reason: z
    .string({ error: "El motivo del ajuste es obligatorio." })
    .normalize("NFC")
    .trim()
    .min(1, "El motivo del ajuste es obligatorio.")
    .max(
      STOCK_TEXT_MAX_LENGTH,
      `El motivo debe tener como máximo ${STOCK_TEXT_MAX_LENGTH} caracteres.`,
    ),
});
export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;

/** Activar o desactivar el control de un producto con inventario inicializado (fijar estado). */
export const stockTrackingSchema = strictBody({
  tracked: z.boolean({ error: "Indica si el control queda activo." }),
});
export type StockTrackingInput = z.input<typeof stockTrackingSchema>;

/** Cabecera obligatoria de las entradas y los ajustes; sin ella, `400 IDEMPOTENCY_KEY_REQUIRED`. */
export const stockMovementHeadersSchema = z.object({
  [IDEMPOTENCY_KEY_HEADER]: z
    .string({ error: "La cabecera Idempotency-Key es obligatoria." })
    .regex(IDEMPOTENCY_KEY_PATTERN, "La cabecera Idempotency-Key no es válida."),
});

/** Rechazos del inventario (design D7). Las claves de idempotencia usan los códigos comunes. */
export const INVENTORY_ERROR_CODES = [
  // `404`: el producto no existe en la empresa de la sesión.
  "PRODUCT_NOT_FOUND",
  // `409`: estado del inventario o del control de stock.
  "INVENTORY_ALREADY_INITIALIZED",
  "INVENTORY_NOT_INITIALIZED",
  "STOCK_TRACKING_REQUIRED",
  "STOCK_TRACKING_DISABLED",
  "STOCK_TRACKING_HAS_BALANCE",
  "STOCK_TRACKING_MANAGED_BY_INVENTORY",
] as const;
export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODES)[number];
