// Contratos de las liquidaciones de compra (add-purchase-settlements, design D3 a D9, D12, D21 y D22).
// Los cuerpos son estrictos: un `companyId`, un total, un impuesto distinto del IVA, un reembolso, un
// precio sin subsidio, detalles adicionales, información adicional, una declaración desconocida o
// cualquier campo desconocido se rechaza. El usuario elige el punto, el proveedor con su dirección,
// las líneas (producto opcional o libre, con el precio de esta compra) y los pagos con su plazo y su
// unidad de tiempo; el servidor resuelve el IVA del catálogo y calcula todos los importes. Los
// decimales viajan como texto exacto.
import { z } from "zod";
import { DECIMAL_SPECS, compareDecimalStrings, decimalString } from "./decimal.ts";
import { ENTRY_KEY_PATTERN, rateKindSchema } from "./fiscal-catalogs.ts";
import { documentTypeSchema } from "./fiscal-numbering.ts";
import {
  emitInvoiceHeadersSchema,
  invoiceAmountSchema,
  invoiceStateSchema,
  invoiceTransmissionSummarySchema,
  signingDiagnosticViewSchema,
  SIGNING_ATTEMPT_CODE_LIST,
  transmissionEventViewSchema,
  type SigningAttemptCode,
} from "./invoices.ts";
import { listMetaSchema, pageParams, searchParam } from "./pagination.ts";
import { environmentSchema, rimpeCategorySchema, strictBody } from "./taxpayer.ts";

/**
 * Máximos absolutos de los límites de recursos (design D22): el contrato nunca admite más. El límite
 * efectivo es configurable por entorno, con estos valores por defecto. Son defensas de recursos del
 * producto, nunca límites del SRI ni del XSD, ni una interpretación de Q-47.
 */
export const PURCHASE_SETTLEMENT_LIMITS_MAX = { lines: 500, payments: 20 } as const;
export const PURCHASE_SETTLEMENT_LIMITS_DEFAULT = { lines: 100, payments: 10 } as const;
export type PurchaseSettlementLimits = {
  [K in keyof typeof PURCHASE_SETTLEMENT_LIMITS_MAX]: number;
};

const DEFENSE = "Es una defensa de recursos del sistema, no un límite del SRI.";

/**
 * Política de procedencia vigente (design D3, Q-12): el MVP emite la liquidación solo en el caso c)
 * del art. 13 del Reglamento de Comprobantes de Venta vigente. Las declaraciones son del usuario:
 * el sistema no puede comprobarlas y nunca las presenta como verificadas.
 */
export const PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY = {
  id: "PURCHASE_SETTLEMENT_ELIGIBILITY_V1",
  rule: "ART_13_C_RUSTICITY_NO_ACTIVE_RUC",
  case: "ART_13_C",
  version: 1,
  source:
    "Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios, art. 13, letra c)",
} as const;
export const PURCHASE_SETTLEMENT_POLICY_VERSION = PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.version;

/** Las cuatro declaraciones de la política, en el orden en que se presentan. */
export const PURCHASE_SETTLEMENT_STATEMENTS = [
  "NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING",
  "NO_RUC_OR_SUSPENDED_RUC",
  "UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY",
  "MOVABLE_GOODS_OR_SERVICES_TRANSACTION",
] as const;
export const purchaseSettlementStatementSchema = z.enum(PURCHASE_SETTLEMENT_STATEMENTS, {
  error: "La declaración no pertenece a la política de procedencia de la liquidación de compra.",
});
export type PurchaseSettlementStatement = z.infer<typeof purchaseSettlementStatementSchema>;

/** Texto visible de cada declaración, versión 1 de la política. */
export const PURCHASE_SETTLEMENT_STATEMENT_TEXTS: Record<PurchaseSettlementStatement, string> = {
  NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING:
    "El proveedor es una persona natural no obligada a llevar contabilidad.",
  NO_RUC_OR_SUSPENDED_RUC:
    "El proveedor no está inscrito en el RUC o tiene su RUC suspendido a la fecha de la transacción.",
  UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY:
    "Por su nivel cultural o rusticidad, el proveedor no puede emitir comprobantes de venta.",
  MOVABLE_GOODS_OR_SERVICES_TRANSACTION:
    "La operación corresponde a la adquisición de bienes muebles o servicios.",
};

/** Aviso de la retención (design D10): no es evidencia de que la retención exista. */
export const PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE =
  "Esta operación requiere la retención correspondiente conforme a la normativa aplicable.";

/** Moneda del XML: la política monetaria del proyecto, sin multimoneda (design D9). */
export const PURCHASE_SETTLEMENT_CURRENCY = "DOLAR";

/**
 * Tipos de identificación del proveedor en el MVP (design D4): cédula y pasaporte. El RUC, el
 * consumidor final y la identificación del exterior quedan fuera, como restricción del MVP que
 * materializa el caso c), no como prohibición de la norma para toda liquidación.
 */
export const PURCHASE_SETTLEMENT_IDENTIFICATION_TYPES = ["05", "06"] as const;

/** Longitudes de los textos del XSD 1.1.0. */
export const PURCHASE_SETTLEMENT_TEXT_MAX = {
  address: 300,
  code: 25,
  description: 300,
  unit: 50,
  timeUnit: 10,
} as const;

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const idSchema = (message: string) => z.string({ error: message }).min(1, message);
const isoDate = z.iso.date();
const NO_LINE_BREAK = /^[^\r\n]*$/;

/**
 * Texto fiscal de hasta `max` caracteres sin saltos de línea. Los extremos se recortan antes de medir
 * la longitud, y un texto que queda vacío se guarda como ausente.
 */
const fiscalText = (max: number, label: string) =>
  nullable(
    z
      .string({ error: `${label} no es válido.` })
      .trim()
      .max(max, `${label} admite como máximo ${max} caracteres.`)
      .regex(NO_LINE_BREAK, `${label} no admite saltos de línea.`)
      .transform((value) => (value === "" ? null : value)),
  );

const entryKeySchema = (message: string) =>
  z.string({ error: message }).regex(ENTRY_KEY_PATTERN, message);
const money = invoiceAmountSchema;
const quantity = decimalString(DECIMAL_SPECS.cantidad);
const unitPrice = decimalString(DECIMAL_SPECS.precioUnitario);
const term = decimalString(DECIMAL_SPECS.plazo);

/** Cantidad emitida: dominio `cantidad` (18/6) y mayor que cero (política del proyecto). */
export const purchaseSettlementQuantitySchema = quantity.refine(
  (value) => compareDecimalStrings(value, "0") > 0,
  "La cantidad debe ser mayor que cero: es una política del sistema, aunque el XSD admita cero.",
);

/**
 * Línea del borrador (design D6): producto opcional, solo para sugerir su código y su nombre, o línea
 * libre. El precio es siempre el de esta compra; el descuento siempre existe (0 si no se envía). Sin
 * precio sin subsidio, detalles adicionales ni impuestos distintos del IVA. En el borrador basta el
 * formato: una cantidad cero se guarda y la vista previa la informa junto a su línea.
 */
export const purchaseSettlementLineSchema = strictBody({
  productId: nullable(idSchema("El producto no es válido.")),
  mainCode: fiscalText(PURCHASE_SETTLEMENT_TEXT_MAX.code, "El código principal"),
  auxiliaryCode: fiscalText(PURCHASE_SETTLEMENT_TEXT_MAX.code, "El código auxiliar"),
  description: fiscalText(PURCHASE_SETTLEMENT_TEXT_MAX.description, "La descripción"),
  unit: fiscalText(PURCHASE_SETTLEMENT_TEXT_MAX.unit, "La unidad de medida"),
  quantity: nullable(quantity),
  unitPrice: nullable(unitPrice),
  discount: money.nullish().transform((value) => value ?? "0"),
  ivaRate: nullable(entryKeySchema("La tarifa de IVA no es válida.")),
});
export type PurchaseSettlementLineInput = z.input<typeof purchaseSettlementLineSchema>;
export type PurchaseSettlementLineData = z.output<typeof purchaseSettlementLineSchema>;

/**
 * Pago del borrador (design D9): forma de pago del catálogo, total (desde 0.00), plazo (desde 0,
 * 14/2) y unidad de tiempo (1 a 10 caracteres). El usuario los escribe todos; ningún valor fiscal
 * tiene un valor por defecto.
 */
export const purchaseSettlementPaymentSchema = strictBody({
  paymentMethod: nullable(entryKeySchema("La forma de pago no es válida.")),
  total: nullable(money),
  term: nullable(term),
  timeUnit: fiscalText(PURCHASE_SETTLEMENT_TEXT_MAX.timeUnit, "La unidad de tiempo"),
});
export type PurchaseSettlementPaymentInput = z.input<typeof purchaseSettlementPaymentSchema>;
export type PurchaseSettlementPaymentData = z.output<typeof purchaseSettlementPaymentSchema>;

const expectedVersionSchema = z
  .number({ error: "La versión esperada es obligatoria." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

/** Un borrador puede guardarse incompleto: cada campo puede faltar y la vista previa lo informa. */
const draftShape = {
  emissionPointId: nullable(idSchema("El punto de emisión no es válido.")),
  supplierPartyId: nullable(idSchema("El proveedor no es válido.")),
  supplierAddress: fiscalText(PURCHASE_SETTLEMENT_TEXT_MAX.address, "La dirección del proveedor"),
  lines: z
    .array(purchaseSettlementLineSchema, { error: "Las líneas no son válidas." })
    .max(
      PURCHASE_SETTLEMENT_LIMITS_MAX.lines,
      `La liquidación admite como máximo ${PURCHASE_SETTLEMENT_LIMITS_MAX.lines} líneas. ${DEFENSE}`,
    )
    .default([]),
  payments: z
    .array(purchaseSettlementPaymentSchema, { error: "Los pagos no son válidos." })
    .max(
      PURCHASE_SETTLEMENT_LIMITS_MAX.payments,
      `La liquidación admite como máximo ${PURCHASE_SETTLEMENT_LIMITS_MAX.payments} pagos. ${DEFENSE}`,
    )
    .default([]),
};

export const createPurchaseSettlementDraftSchema = strictBody(draftShape);
export type CreatePurchaseSettlementDraftInput = z.input<
  typeof createPurchaseSettlementDraftSchema
>;
export type PurchaseSettlementDraftData = z.output<typeof createPurchaseSettlementDraftSchema>;

export const updatePurchaseSettlementDraftSchema = strictBody({
  ...draftShape,
  expectedVersion: expectedVersionSchema,
});
export type UpdatePurchaseSettlementDraftInput = z.input<
  typeof updatePurchaseSettlementDraftSchema
>;

export const purchaseSettlementDraftIdParamsSchema = z.strictObject({
  draftId: z.string().min(1),
});
export const purchaseSettlementIdParamsSchema = z.strictObject({
  purchaseSettlementId: z.string().min(1),
});

/** Cabecera obligatoria de la emisión, la misma de la factura: `Idempotency-Key`. */
export const emitPurchaseSettlementHeadersSchema = emitInvoiceHeadersSchema;

/**
 * Emisión (design D3 y D14): las declaraciones citan la versión vigente de la política y forman
 * parte de la huella, porque cambian la evidencia de la emisión. El servidor exige las cuatro.
 */
export const emitPurchaseSettlementSchema = strictBody({
  draftId: idSchema("El borrador es obligatorio."),
  expectedVersion: expectedVersionSchema,
  declarations: strictBody({
    policyVersion: z
      .number({ error: "La versión de la política es obligatoria." })
      .int("La versión de la política no es válida."),
    statements: z
      .array(purchaseSettlementStatementSchema, {
        error: "Las declaraciones de procedencia no son válidas.",
      })
      .max(
        PURCHASE_SETTLEMENT_STATEMENTS.length,
        "La política de procedencia tiene cuatro declaraciones.",
      ),
  }),
});
export type EmitPurchaseSettlementInput = z.input<typeof emitPurchaseSettlementSchema>;

/** Consultas: no son estrictas, de modo que un `companyId` se ignora. */
export const listPurchaseSettlementDraftsQuerySchema = z.object({ ...pageParams });
export type ListPurchaseSettlementDraftsQuery = z.output<
  typeof listPurchaseSettlementDraftsQuerySchema
>;

export const listPurchaseSettlementsQuerySchema = z.object({
  search: searchParam,
  state: invoiceStateSchema.optional(),
  ...pageParams,
});
export type ListPurchaseSettlementsQuery = z.output<typeof listPurchaseSettlementsQuerySchema>;

/** Proveedores de la empresa, por identificación o razón social (design D4 y D21). */
export const listPurchaseSettlementSuppliersQuerySchema = z.object({
  search: searchParam,
  ...pageParams,
});
export type ListPurchaseSettlementSuppliersQuery = z.output<
  typeof listPurchaseSettlementSuppliersQuerySchema
>;

/**
 * Rechazos de las liquidaciones de compra (design D21). Cada uno es un `409`, salvo los de recurso
 * inexistente (`404`). La emisión informa el primero; la vista previa muestra todos.
 */
export const PURCHASE_SETTLEMENT_ERROR_CODES = [
  "PURCHASE_SETTLEMENT_NOT_FOUND",
  "PURCHASE_SETTLEMENT_DRAFT_NOT_FOUND",
  "PURCHASE_SETTLEMENT_SUPPLIER_REQUIRED",
  "PURCHASE_SETTLEMENT_SUPPLIER_NOT_FOUND",
  "PURCHASE_SETTLEMENT_SUPPLIER_INACTIVE",
  "PURCHASE_SETTLEMENT_SUPPLIER_ROLE_REQUIRED",
  "PURCHASE_SETTLEMENT_SUPPLIER_IDENTIFICATION_NOT_ALLOWED",
  "PURCHASE_SETTLEMENT_SUPPLIER_CONSUMER_FINAL",
  "PURCHASE_SETTLEMENT_ADDRESS_REQUIRED",
  "PURCHASE_SETTLEMENT_LINES_REQUIRED",
  "PURCHASE_SETTLEMENT_DESCRIPTION_INVALID",
  "PURCHASE_SETTLEMENT_CODE_INVALID",
  "PURCHASE_SETTLEMENT_PRODUCT_NOT_FOUND",
  "PURCHASE_SETTLEMENT_PRODUCT_INACTIVE",
  "PURCHASE_SETTLEMENT_QUANTITY_INVALID",
  "PURCHASE_SETTLEMENT_PRICE_INVALID",
  "PURCHASE_SETTLEMENT_DISCOUNT_EXCEEDS_SUBTOTAL",
  "PURCHASE_SETTLEMENT_IVA_RATE_REQUIRED",
  "PURCHASE_SETTLEMENT_IVA_RATE_NOT_EFFECTIVE",
  "PURCHASE_SETTLEMENT_AMOUNT_OUT_OF_RANGE",
  "PURCHASE_SETTLEMENT_PAYMENTS_REQUIRED",
  "PURCHASE_SETTLEMENT_PAYMENT_METHOD_INVALID",
  "PURCHASE_SETTLEMENT_PAYMENT_TOTAL_REQUIRED",
  "PURCHASE_SETTLEMENT_PAYMENT_TERM_REQUIRED",
  "PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH",
  "PURCHASE_SETTLEMENT_DECLARATION_REQUIRED",
  "PURCHASE_SETTLEMENT_DECLARATION_VERSION_MISMATCH",
  "PURCHASE_SETTLEMENT_RESOURCE_LIMIT",
  "PURCHASE_SETTLEMENT_DRAFT_INCOMPLETE",
  "PURCHASE_SETTLEMENT_DRAFT_CHANGED",
  "PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED",
  "PURCHASE_SETTLEMENT_NOT_RECONCILABLE",
  // Los de la emisión compartidos con la factura.
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "TAXPAYER_NOT_CONFIGURED",
  "EMISSION_POINT_NOT_FOUND",
  "EMISSION_POINT_UNAVAILABLE",
  "SIGNING_CERTIFICATE_NOT_USABLE",
  "SCHEMA_NOT_AVAILABLE",
  "SEQUENCE_EXHAUSTED",
  "SRI_INTERACTION_IN_PROGRESS",
] as const;
export type PurchaseSettlementErrorCode = (typeof PURCHASE_SETTLEMENT_ERROR_CODES)[number];

/**
 * Problema del borrador o de la emisión, con el campo de la liquidación y la posición de la línea o
 * del pago (desde 1), o null.
 */
export const purchaseSettlementIssueSchema = z.strictObject({
  code: z.enum(PURCHASE_SETTLEMENT_ERROR_CODES),
  message: z.string(),
  field: z.string().nullable(),
  line: z.number().int().nullable(),
  payment: z.number().int().nullable(),
});
export type PurchaseSettlementIssue = z.infer<typeof purchaseSettlementIssueSchema>;

const tariff = decimalString(DECIMAL_SPECS.tarifa);

/** IVA calculado de una línea o de una tarifa: código, código de porcentaje, tarifa, base y valor. */
export const purchaseSettlementTaxViewSchema = z.strictObject({
  taxCode: z.literal("2"),
  rateCode: z.string(),
  rateKind: rateKindSchema,
  percentage: tariff,
  label: z.string(),
  base: money,
  amount: money,
});
export type PurchaseSettlementTaxView = z.infer<typeof purchaseSettlementTaxViewSchema>;

/** Importes calculados por el servidor (design D8): nunca son del cliente. */
export const purchaseSettlementTotalsViewSchema = z.strictObject({
  withoutTaxes: money,
  discount: money,
  taxes: z.array(purchaseSettlementTaxViewSchema),
  total: money,
});
export type PurchaseSettlementTotalsView = z.infer<typeof purchaseSettlementTotalsViewSchema>;

/** Una declaración de la política con su texto y su versión, para el diálogo de emisión. */
export const purchaseSettlementStatementViewSchema = z.strictObject({
  id: purchaseSettlementStatementSchema,
  text: z.string(),
});

export const purchaseSettlementPolicyViewSchema = z.strictObject({
  id: z.literal(PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.id),
  rule: z.literal(PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.rule),
  case: z.literal(PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.case),
  version: z.number().int(),
  source: z.string(),
  statements: z.array(purchaseSettlementStatementViewSchema),
});
export type PurchaseSettlementPolicyView = z.infer<typeof purchaseSettlementPolicyViewSchema>;

/** Vista previa del servidor (design D12); no reserva nada. */
export const purchaseSettlementPreviewViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  /** La versión del cálculo con que se obtuvieron los importes. */
  calculationVersion: z.string(),
  supplier: z
    .strictObject({
      identificationType: z.string(),
      identification: z.string(),
      legalName: z.string(),
    })
    .nullable(),
  lines: z.array(
    z.strictObject({
      position: z.number().int(),
      subtotal: z.string(),
      discount: money,
      taxableBase: money,
      tax: purchaseSettlementTaxViewSchema.nullable(),
    }),
  ),
  /** `null` mientras alguna línea no pueda calcularse. */
  totals: purchaseSettlementTotalsViewSchema.nullable(),
  /** La suma exacta de los pagos que ya tienen total, para mostrar la diferencia. */
  paymentsTotal: money.nullable(),
  policy: purchaseSettlementPolicyViewSchema,
  withholdingNotice: z.literal(PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE),
  issues: z.array(purchaseSettlementIssueSchema),
});
export type PurchaseSettlementPreviewView = z.infer<typeof purchaseSettlementPreviewViewSchema>;

/**
 * Proveedor elegible (design D4 y D21): un tercero activo con el rol de proveedor; solo la cédula y
 * el pasaporte son seleccionables, los demás llevan el motivo.
 */
export const purchaseSettlementSupplierViewSchema = z.strictObject({
  id: z.string(),
  identificationType: z.string(),
  identification: z.string(),
  legalName: z.string(),
  address: z.string().nullable(),
  selectable: z.boolean(),
  reason: z.string().nullable(),
});
export type PurchaseSettlementSupplierView = z.infer<typeof purchaseSettlementSupplierViewSchema>;

/** Opciones del borrador (design D21): solo entradas utilizables, con su fecha de resolución. */
export const purchaseSettlementOptionsViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  /** Límites efectivos de recursos: defensas del sistema, no límites del SRI (design D22). */
  limits: z.strictObject({ lines: z.number().int(), payments: z.number().int() }),
  policy: purchaseSettlementPolicyViewSchema,
  withholdingNotice: z.literal(PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE),
  currency: z.literal(PURCHASE_SETTLEMENT_CURRENCY),
  ivaRates: z.array(
    z.strictObject({
      entryKey: z.string(),
      code: z.string(),
      label: z.string(),
      rateKind: rateKindSchema,
      percentage: tariff,
    }),
  ),
  paymentMethods: z.array(
    z.strictObject({ entryKey: z.string(), code: z.string(), label: z.string() }),
  ),
});
export type PurchaseSettlementOptionsView = z.infer<typeof purchaseSettlementOptionsViewSchema>;

const emissionPointViewSchema = z.strictObject({
  id: z.string(),
  establishmentCode: z.string(),
  code: z.string(),
  available: z.boolean(),
});

export const purchaseSettlementDraftViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  emissionPoint: emissionPointViewSchema.nullable(),
  supplier: purchaseSettlementSupplierViewSchema.nullable(),
  supplierAddress: z.string().nullable(),
  lines: z.array(
    z.strictObject({
      productId: z.string().nullable(),
      productName: z.string().nullable(),
      mainCode: z.string().nullable(),
      auxiliaryCode: z.string().nullable(),
      description: z.string().nullable(),
      unit: z.string().nullable(),
      quantity: quantity.nullable(),
      unitPrice: unitPrice.nullable(),
      discount: money,
      ivaRate: z.string().nullable(),
    }),
  ),
  payments: z.array(
    z.strictObject({
      paymentMethod: z.string().nullable(),
      total: money.nullable(),
      term: term.nullable(),
      timeUnit: z.string().nullable(),
    }),
  ),
  preview: purchaseSettlementPreviewViewSchema,
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
});
export type PurchaseSettlementDraftView = z.infer<typeof purchaseSettlementDraftViewSchema>;

export const purchaseSettlementDraftSummaryViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  supplierName: z.string().nullable(),
  lineCount: z.number().int(),
  /** Importe total de la vista previa, o `null` si todavía no puede calcularse. */
  previewTotal: money.nullable(),
  updatedAt: z.iso.datetime(),
});
export type PurchaseSettlementDraftSummaryView = z.infer<
  typeof purchaseSettlementDraftSummaryViewSchema
>;

/** Una declaración tal como la congela la liquidación (design D3): del usuario, nunca verificada. */
export const purchaseSettlementDeclarationViewSchema = z.strictObject({
  statementId: purchaseSettlementStatementSchema,
  text: z.string(),
  policyVersion: z.number().int(),
  basis: z.literal("USER_DECLARED"),
  declaredBy: z.string(),
  declaredByName: z.string().nullable(),
  declaredAt: z.iso.datetime(),
});

/** Liquidación desde su snapshot: lo que se emitió, sin releer terceros, productos ni catálogos. */
export const purchaseSettlementViewSchema = z.strictObject({
  id: z.string(),
  documentType: documentTypeSchema,
  environment: environmentSchema,
  documentNumber: z.string(),
  accessKey: z.string(),
  issueDate: isoDate,
  state: invoiceStateSchema,
  issuer: z.strictObject({
    ruc: z.string(),
    legalName: z.string(),
    tradeName: z.string().nullable(),
    headOfficeAddress: z.string(),
    establishmentAddress: z.string(),
    accountingRequired: z.boolean(),
    specialTaxpayerNumber: z.string().nullable(),
    withholdingAgentResolution: z.string().nullable(),
    rimpeCategory: rimpeCategorySchema.nullable(),
  }),
  supplier: z.strictObject({
    partyId: z.string(),
    identificationType: z.string(),
    identification: z.string(),
    legalName: z.string(),
    address: z.string(),
  }),
  eligibility: z.strictObject({
    case: z.literal(PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.case),
    policy: z.literal(PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.id),
    rule: z.literal(PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.rule),
    policyVersion: z.number().int(),
    declarations: z.array(purchaseSettlementDeclarationViewSchema),
  }),
  lines: z.array(
    z.strictObject({
      position: z.number().int(),
      productId: z.string().nullable(),
      mainCode: z.string().nullable(),
      auxiliaryCode: z.string().nullable(),
      description: z.string(),
      unit: z.string().nullable(),
      quantity,
      unitPrice,
      discount: money,
      taxableBase: money,
      tax: purchaseSettlementTaxViewSchema,
    }),
  ),
  totals: purchaseSettlementTotalsViewSchema,
  payments: z.array(
    z.strictObject({
      position: z.number().int(),
      code: z.string(),
      label: z.string(),
      total: money,
      term,
      timeUnit: z.string(),
    }),
  ),
  currency: z.literal(PURCHASE_SETTLEMENT_CURRENCY),
  calculationVersion: z.string(),
  withholdingNotice: z.literal(PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE),
  diagnostic: signingDiagnosticViewSchema.nullable(),
  artifact: z.strictObject({ sha256: z.string(), sizeBytes: z.number().int() }).nullable(),
  authorizedArtifact: z
    .strictObject({ sha256: z.string(), sizeBytes: z.number().int() })
    .nullable(),
  transmission: invoiceTransmissionSummarySchema,
  createdAt: z.iso.datetime(),
  signedAt: z.iso.datetime().nullable(),
});
export type PurchaseSettlementView = z.infer<typeof purchaseSettlementViewSchema>;

export const purchaseSettlementSummaryViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  environment: environmentSchema,
  issueDate: isoDate,
  supplierIdentification: z.string(),
  supplierName: z.string(),
  total: money,
  state: invoiceStateSchema,
  diagnosticCode: z
    .enum(SIGNING_ATTEMPT_CODE_LIST as [SigningAttemptCode, ...SigningAttemptCode[]])
    .nullable(),
  transmissionStopped: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type PurchaseSettlementSummaryView = z.infer<typeof purchaseSettlementSummaryViewSchema>;

/** Historial de la transmisión de una liquidación: las 100 entradas más recientes y el total. */
export const PURCHASE_SETTLEMENT_TRANSMISSION_HISTORY_LIMIT = 100;
export const purchaseSettlementTransmissionViewSchema = z.strictObject({
  purchaseSettlementId: z.string(),
  state: invoiceStateSchema,
  events: z.array(transmissionEventViewSchema),
  total: z.number().int().nonnegative(),
});
export type PurchaseSettlementTransmissionView = z.infer<
  typeof purchaseSettlementTransmissionViewSchema
>;

export const purchaseSettlementListMetaSchema = listMetaSchema;
