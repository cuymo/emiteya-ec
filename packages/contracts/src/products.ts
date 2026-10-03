// Contratos de productos y servicios (add-parties-and-products, design D6 a D11). El precio unitario
// es un decimal exacto en texto, sin impuestos; los impuestos refieren entradas del catálogo fiscal
// por su identidad y nunca copian una tarifa. Las invariantes entre el tipo, el control de stock y
// el IRBPNR las valida el backend sobre el estado final, con un código de error estable.
import { z } from "zod";
import { DECIMAL_SPECS, decimalString } from "./decimal.ts";
import { catalogRateViewSchema, ENTRY_KEY_PATTERN } from "./fiscal-catalogs.ts";
import {
  listMetaSchema,
  pageParams,
  recordStatusFilterSchema,
  recordStatusSchema,
  searchParam,
  sortDirectionSchema,
} from "./pagination.ts";
import { FISCAL_TEXT_MAX_LENGTH, fiscalText, optionalText, strictBody } from "./taxpayer.ts";

export const PRODUCT_KINDS = ["GOOD", "SERVICE"] as const;
export const productKindSchema = z.enum(PRODUCT_KINDS, { error: "El tipo no es válido." });
export type ProductKind = z.infer<typeof productKindSchema>;
export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  GOOD: "Bien",
  SERVICE: "Servicio",
};

/** Estado derivado de las referencias fiscales en una fecha (design D8). Nunca se guarda. */
export const TAX_CONFIGURATION_STATUSES = ["READY", "REVIEW_REQUIRED", "INCOMPLETE"] as const;
export const taxConfigurationStatusSchema = z.enum(TAX_CONFIGURATION_STATUSES, {
  error: "El estado tributario no es válido.",
});
export type TaxConfigurationStatus = z.infer<typeof taxConfigurationStatusSchema>;

export const TAX_REVIEW_REASONS = [
  "NOT_IN_FORCE",
  "WITHDRAWN",
  "DISABLED",
  "NO_CALCULATION_DATA",
] as const;
export const taxReviewReasonSchema = z.enum(TAX_REVIEW_REASONS);
export type TaxReviewReason = z.infer<typeof taxReviewReasonSchema>;

/** Posiciones de impuesto del producto y el catálogo fiscal de cada una (design D7). */
export const PRODUCT_TAX_SLOTS = {
  iva: "iva-rate",
  ice: "ice-rate",
  irbpnr: "irbpnr-rate",
} as const;
export type ProductTaxSlot = keyof typeof PRODUCT_TAX_SLOTS;
export const productTaxSlotSchema = z.enum(["iva", "ice", "irbpnr"]);
export const productTaxCatalogTypeSchema = z.enum(["iva-rate", "ice-rate", "irbpnr-rate"]);
export type ProductTaxCatalogType = z.infer<typeof productTaxCatalogTypeSchema>;

export const PRODUCT_CODE_MAX_LENGTH = 25;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 1000;
const SINGLE_LINE = /^[^\r\n]*$/;

const codeSchema = (label: string) =>
  z
    .string()
    .max(
      PRODUCT_CODE_MAX_LENGTH,
      `${label} debe tener como máximo ${PRODUCT_CODE_MAX_LENGTH} caracteres.`,
    )
    .regex(SINGLE_LINE, `${label} no puede tener saltos de línea.`);

const descriptionSchema = z
  .string()
  .max(
    PRODUCT_DESCRIPTION_MAX_LENGTH,
    `La descripción debe tener como máximo ${PRODUCT_DESCRIPTION_MAX_LENGTH} caracteres.`,
  );

const entryKeySchema = z
  .string({ error: "La entrada del catálogo fiscal no es válida." })
  .regex(ENTRY_KEY_PATTERN, "La entrada del catálogo fiscal no es válida.");

/** La forma fija las cantidades: un IVA obligatorio y como mucho un ICE y un IRBPNR. */
export const productTaxesSchema = strictBody({
  iva: z.string({ error: "La tarifa de IVA es obligatoria." }).pipe(entryKeySchema),
  ice: entryKeySchema.nullable().default(null),
  irbpnr: entryKeySchema.nullable().default(null),
});
export type ProductTaxes = z.output<typeof productTaxesSchema>;

/** Precio unitario sin impuestos: 18 dígitos en total y 6 decimales como máximo (design D9). */
export const unitPriceSchema = decimalString(DECIMAL_SPECS.precioUnitario);

export const productShape = {
  kind: productKindSchema,
  mainCode: optionalText(codeSchema("El código principal"), "El código principal no es válido."),
  auxiliaryCode: optionalText(codeSchema("El código auxiliar"), "El código auxiliar no es válido."),
  name: fiscalText("El nombre", "El nombre es obligatorio.", FISCAL_TEXT_MAX_LENGTH),
  description: optionalText(descriptionSchema, "La descripción no es válida."),
  unitPrice: unitPriceSchema,
  stockTracked: z.boolean({ error: "El control de stock no es válido." }).default(false),
  taxes: productTaxesSchema,
};

export const createProductSchema = strictBody(productShape);
export type CreateProductInput = z.input<typeof createProductSchema>;
export type ProductData = z.output<typeof createProductSchema>;

const expectedVersionSchema = z
  .number({ error: "La versión esperada es obligatoria." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

export const updateProductSchema = strictBody({
  ...productShape,
  expectedVersion: expectedVersionSchema,
});
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export const changeProductStatusSchema = strictBody({ status: recordStatusSchema });

export const PRODUCT_SORTS = ["name", "mainCode"] as const;

/** Consulta de la lista: no es estricta, de modo que un `companyId` se ignora. */
export const listProductsQuerySchema = z.object({
  search: searchParam,
  status: recordStatusFilterSchema,
  kind: productKindSchema.optional(),
  taxStatus: taxConfigurationStatusSchema.optional(),
  sort: z.enum(PRODUCT_SORTS, { error: "El orden no es válido." }).default("name"),
  direction: sortDirectionSchema,
  ...pageParams,
});
export type ListProductsQuery = z.output<typeof listProductsQuerySchema>;

export const productIdParamsSchema = z.strictObject({ productId: z.string().min(1) });

const isoDate = z.iso.date();

/** Una referencia del producto con lo que el catálogo publica hoy sobre ella. */
export const productTaxViewSchema = z.strictObject({
  slot: productTaxSlotSchema,
  catalogType: productTaxCatalogTypeSchema,
  entryKey: z.string(),
  code: z.string(),
  /** De la versión aplicable en la fecha de evaluación o, si no hay, de la última. */
  officialLabel: z.string().nullable(),
  rate: catalogRateViewSchema.nullable(),
  usable: z.boolean(),
  reason: taxReviewReasonSchema.nullable(),
});
export type ProductTaxView = z.infer<typeof productTaxViewSchema>;

export const taxConfigurationViewSchema = z.strictObject({
  status: taxConfigurationStatusSchema,
  reasons: z.array(
    z.strictObject({
      slot: productTaxSlotSchema,
      catalogType: productTaxCatalogTypeSchema,
      entryKey: z.string(),
      code: z.string(),
      reason: taxReviewReasonSchema,
    }),
  ),
  /** Fecha de Ecuador en que se evaluó. */
  evaluatedOn: isoDate,
});
export type TaxConfigurationView = z.infer<typeof taxConfigurationViewSchema>;

export const productViewSchema = z.strictObject({
  id: z.string(),
  kind: productKindSchema,
  mainCode: z.string().nullable(),
  auxiliaryCode: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  unitPrice: unitPriceSchema,
  stockTracked: z.boolean(),
  status: recordStatusSchema,
  version: z.number().int(),
  taxes: z.array(productTaxViewSchema),
  taxConfiguration: taxConfigurationViewSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProductView = z.infer<typeof productViewSchema>;

export const productListSchema = z.array(productViewSchema);
export const productListMetaSchema = listMetaSchema;

/** Recuentos de productos activos para `Productos` y `Catálogos fiscales` (design D8 y D17). */
export const productTaxSummaryViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  byStatus: z.strictObject({
    READY: z.number().int(),
    REVIEW_REQUIRED: z.number().int(),
    INCOMPLETE: z.number().int(),
  }),
  byEntry: z.array(
    z.strictObject({
      catalogType: productTaxCatalogTypeSchema,
      entryKey: z.string(),
      activeProducts: z.number().int(),
    }),
  ),
});
export type ProductTaxSummaryView = z.infer<typeof productTaxSummaryViewSchema>;
