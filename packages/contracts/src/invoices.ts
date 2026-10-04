// Contratos de borradores y facturas (add-invoice-emission, design D2, D6, D8, D10 y D13). Los
// cuerpos son estrictos: un `companyId`, un precio en la línea o cualquier campo desconocido se
// rechaza. Cantidades e importes son decimales exactos en texto. El precio unitario de cada línea
// es el del producto al emitir (Q-45 registra su modificación por línea como decisión futura).
import { z } from "zod";
import { DECIMAL_SPECS, decimalString } from "./decimal.ts";
import { ENTRY_KEY_PATTERN } from "./fiscal-catalogs.ts";
import { documentTypeSchema } from "./fiscal-numbering.ts";
import { listMetaSchema, pageParams, recordStatusSchema, searchParam } from "./pagination.ts";
import { systemRecordSchema } from "./parties.ts";
import { environmentSchema, rimpeCategorySchema, strictBody } from "./taxpayer.ts";

/**
 * Máximo absoluto de líneas que admite el contrato. El límite efectivo es `INVOICE_MAX_LINES`, 100
 * por defecto: una defensa de recursos de la aplicación, no una regla del SRI ni del XSD.
 */
export const INVOICE_LINES_MAX = 1000;

/** `Idempotency-Key`: de 1 a 100 caracteres ASCII visibles (design D8). */
export const IDEMPOTENCY_KEY_PATTERN = /^[!-~]{1,100}$/;
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const idSchema = (message: string) => z.string({ error: message }).min(1, message);

const expectedVersionSchema = z
  .number({ error: "La versión esperada es obligatoria." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

/** Cantidad: 18 dígitos en total y 6 decimales como máximo, sin redondear. */
export const invoiceQuantitySchema = decimalString(DECIMAL_SPECS.cantidad);
/** Descuento e importe de pago: 14 dígitos en total y 2 decimales como máximo. */
export const invoiceAmountSchema = decimalString(DECIMAL_SPECS.importe);

export const draftLineSchema = strictBody({
  productId: idSchema("El producto de la línea es obligatorio."),
  quantity: invoiceQuantitySchema,
  discount: invoiceAmountSchema.default("0"),
});
export type DraftLineInput = z.input<typeof draftLineSchema>;

export const draftPaymentSchema = strictBody({
  /** Entrada del catálogo `payment-method`. */
  paymentMethod: z
    .string({ error: "La forma de pago es obligatoria." })
    .regex(ENTRY_KEY_PATTERN, "La forma de pago no es válida."),
  /** Sin importe, una única forma de pago cubre el importe total. */
  amount: invoiceAmountSchema.nullish().transform((value) => value ?? null),
});
export type DraftPaymentInput = z.input<typeof draftPaymentSchema>;

/** Un borrador puede guardarse incompleto; la emisión exige punto, comprador, líneas y pagos. */
const draftShape = {
  emissionPointId: idSchema("El punto de emisión no es válido.")
    .nullish()
    .transform((value) => value ?? null),
  buyerPartyId: idSchema("El comprador no es válido.")
    .nullish()
    .transform((value) => value ?? null),
  lines: z
    .array(draftLineSchema, { error: "Las líneas no son válidas." })
    .max(INVOICE_LINES_MAX, `El borrador admite como máximo ${INVOICE_LINES_MAX} líneas.`)
    .default([]),
  payments: z
    .array(draftPaymentSchema, { error: "Las formas de pago no son válidas." })
    .default([]),
};

export const createDraftSchema = strictBody(draftShape);
export type CreateDraftInput = z.input<typeof createDraftSchema>;
export type DraftData = z.output<typeof createDraftSchema>;

export const updateDraftSchema = strictBody({
  ...draftShape,
  expectedVersion: expectedVersionSchema,
});
export type UpdateDraftInput = z.input<typeof updateDraftSchema>;

export const draftIdParamsSchema = z.strictObject({ draftId: z.string().min(1) });

/** Consulta de borradores: no es estricta, de modo que un `companyId` se ignora. */
export const listDraftsQuerySchema = z.object({ ...pageParams });
export type ListDraftsQuery = z.output<typeof listDraftsQuerySchema>;

export const emitInvoiceSchema = strictBody({
  draftId: idSchema("El borrador es obligatorio."),
  expectedVersion: expectedVersionSchema,
});
export type EmitInvoiceInput = z.input<typeof emitInvoiceSchema>;

/** Cabecera obligatoria de la emisión; sin ella, `400 IDEMPOTENCY_KEY_REQUIRED`. */
export const emitInvoiceHeadersSchema = z.object({
  [IDEMPOTENCY_KEY_HEADER]: z
    .string({ error: "La cabecera Idempotency-Key es obligatoria." })
    .regex(IDEMPOTENCY_KEY_PATTERN, "La cabecera Idempotency-Key no es válida."),
});

/**
 * Estados fiscales de la factura: los locales (`RESERVED`, `SIGNED`) y los de la transmisión al SRI
 * (add-sri-transmission, design D3). El envío en curso es un estado del job, no fiscal.
 */
export const INVOICE_STATES = [
  "RESERVED",
  "SIGNED",
  "SEND_UNKNOWN",
  "RECEIVED",
  "RETURNED",
  "AUTHORIZED",
  "NOT_AUTHORIZED",
  "MANUAL_REVIEW",
] as const;
export const invoiceStateSchema = z.enum(INVOICE_STATES, { error: "El estado no es válido." });
export type InvoiceState = z.infer<typeof invoiceStateSchema>;
/** Etiquetas del glosario (`docs/product/glossary.md`); la interfaz nunca muestra el código. */
export const INVOICE_STATE_LABELS: Record<InvoiceState, string> = {
  RESERVED: "Procesando",
  SIGNED: "Pendiente de envío",
  SEND_UNKNOWN: "Verificando con el SRI",
  RECEIVED: "Pendiente de autorización",
  RETURNED: "Devuelto",
  AUTHORIZED: "Autorizado",
  NOT_AUTHORIZED: "No autorizado",
  MANUAL_REVIEW: "Requiere revisión",
};
/** Estados que piden atención (design D20), además de una transmisión detenida. */
export const INVOICE_ATTENTION_STATES = ["SEND_UNKNOWN", "MANUAL_REVIEW"] as const;
/**
 * Estados en que se admite una reconciliación manual (design D15): `SIGNED` y `RECEIVED` solo con
 * su transmisión detenida, es decir, sin una interacción activa con el SRI.
 */
export const RECONCILABLE_STATES = ["SIGNED", "SEND_UNKNOWN", "RECEIVED", "MANUAL_REVIEW"] as const;

export const invoiceIdParamsSchema = z.strictObject({ invoiceId: z.string().min(1) });

/** Búsqueda por número o comprador, filtro de estado y orden por creación descendente. */
export const listInvoicesQuerySchema = z.object({
  search: searchParam,
  state: invoiceStateSchema.optional(),
  /** "Requiere atención": `SEND_UNKNOWN`, `MANUAL_REVIEW` o transmisión detenida (design D20). */
  attention: z.enum(["true"], { error: "El filtro no es válido." }).optional(),
  ...pageParams,
});
export type ListInvoicesQuery = z.output<typeof listInvoicesQuerySchema>;

/**
 * Rechazos de la emisión antes de reservar (design D6) y del borrador (D2, D8). Cada uno es un
 * `409`, salvo los de referencias del borrador y del límite de líneas (`400`) y los de recurso
 * inexistente (`404`). La emisión informa el primero; la vista previa muestra todos.
 */
export const INVOICE_ERROR_CODES = [
  "INVOICE_DRAFT_NOT_FOUND",
  "INVOICE_NOT_FOUND",
  "INVOICE_DRAFT_CHANGED",
  "INVOICE_DRAFT_ALREADY_EMITTED",
  "INVOICE_DRAFT_INCOMPLETE",
  "INVOICE_TOO_MANY_LINES",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "TAXPAYER_NOT_CONFIGURED",
  "EMISSION_POINT_NOT_FOUND",
  "EMISSION_POINT_UNAVAILABLE",
  "SIGNING_CERTIFICATE_NOT_USABLE",
  "BUYER_NOT_FOUND",
  "BUYER_NOT_CUSTOMER",
  "BUYER_INACTIVE",
  "BUYER_IDENTIFICATION_TYPE_NOT_USABLE",
  "PRODUCT_NOT_FOUND",
  "PRODUCT_INACTIVE",
  "DISCOUNT_EXCEEDS_SUBTOTAL",
  "TAX_REFERENCE_NOT_USABLE",
  "TAX_CALCULATION_DATA_MISSING",
  "AMOUNT_OUT_OF_RANGE",
  "PAYMENT_METHOD_NOT_FOUND",
  "PAYMENT_METHOD_NOT_USABLE",
  "PAYMENTS_DO_NOT_MATCH_TOTAL",
  "CONSUMER_FINAL_POLICY_MISSING",
  "CONSUMER_FINAL_LIMIT_EXCEEDED",
  "SPECIAL_CASE_UNSUPPORTED",
  "SCHEMA_NOT_AVAILABLE",
  "SEQUENCE_EXHAUSTED",
  // Reconciliación manual (add-sri-transmission, design D15): `409`.
  "SRI_INTERACTION_IN_PROGRESS",
  "INVOICE_NOT_RECONCILABLE",
] as const;
export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[number];

/** Clases del diagnóstico de un intento de firma (design D10). */
export const SIGNING_ATTEMPT_CLASSES = [
  "RETRYABLE_OPERATIONAL",
  "DETERMINISTIC_CONFIGURATION",
  "DETERMINISTIC_VALIDATION",
] as const;
export type SigningAttemptClass = (typeof SIGNING_ATTEMPT_CLASSES)[number];

/** Código de cada fallo después de `RESERVED` y su clase. El estado sigue `RESERVED`. */
export const SIGNING_ATTEMPT_CODES = {
  VALIDATOR_BUSY: "RETRYABLE_OPERATIONAL",
  VALIDATOR_TIMEOUT: "RETRYABLE_OPERATIONAL",
  CRYPTO_BUSY: "RETRYABLE_OPERATIONAL",
  CRYPTO_TIMEOUT: "RETRYABLE_OPERATIONAL",
  CRYPTO_UNAVAILABLE: "RETRYABLE_OPERATIONAL",
  PERSIST_FAILED: "RETRYABLE_OPERATIONAL",
  SIGNING_CERTIFICATE_NOT_USABLE: "DETERMINISTIC_CONFIGURATION",
  CUSTODY_UNAVAILABLE: "DETERMINISTIC_CONFIGURATION",
  CERTIFICATE_MISMATCH: "DETERMINISTIC_CONFIGURATION",
  SIGNER_FAILED: "DETERMINISTIC_CONFIGURATION",
  SCHEMA_UNAVAILABLE: "DETERMINISTIC_CONFIGURATION",
  SCHEMA_HASH_MISMATCH: "DETERMINISTIC_CONFIGURATION",
  XSD_INVALID: "DETERMINISTIC_VALIDATION",
  SIGNED_XML_INVALID: "DETERMINISTIC_VALIDATION",
  INVALID_SNAPSHOT_TEXT: "DETERMINISTIC_VALIDATION",
  INVALID_SNAPSHOT_AMOUNT: "DETERMINISTIC_VALIDATION",
} as const satisfies Record<string, SigningAttemptClass>;
export type SigningAttemptCode = keyof typeof SIGNING_ATTEMPT_CODES;
export const SIGNING_ATTEMPT_CODE_LIST = Object.keys(SIGNING_ATTEMPT_CODES) as SigningAttemptCode[];

/** Etapas del procedimiento del snapshot al artefacto firmado (design D9). */
export const SIGNING_ATTEMPT_STAGES = [
  "BUILD_XML",
  "VALIDATE_XSD",
  "SIGN",
  "VALIDATE_SIGNED_XSD",
  "PERSIST",
] as const;
export type SigningAttemptStage = (typeof SIGNING_ATTEMPT_STAGES)[number];

const isoDate = z.iso.date();
const money = invoiceAmountSchema;

/** Problema de un borrador o de la emisión, con la línea o la forma de pago (posición desde 1). */
export const invoiceIssueSchema = z.strictObject({
  code: z.enum(INVOICE_ERROR_CODES),
  message: z.string(),
  line: z.number().int().nullable(),
  payment: z.number().int().nullable(),
});
export type InvoiceIssue = z.infer<typeof invoiceIssueSchema>;

export const invoiceTaxViewSchema = z.strictObject({
  /** Código del impuesto (`2` IVA) y de la tarifa del catálogo. */
  taxCode: z.string(),
  rateCode: z.string(),
  percentage: decimalString(DECIMAL_SPECS.tarifa),
  base: money,
  amount: money,
});
export type InvoiceTaxView = z.infer<typeof invoiceTaxViewSchema>;

export const invoiceTotalsViewSchema = z.strictObject({
  withoutTaxes: money,
  discount: money,
  taxes: z.array(invoiceTaxViewSchema),
  total: money,
});
export type InvoiceTotalsView = z.infer<typeof invoiceTotalsViewSchema>;

/**
 * Vista previa calculada por el servidor con la fecha de hoy en Ecuador y los precios vigentes de
 * los productos. Es informativa, no fiscal: los importes de la factura salen de la emisión.
 */
export const draftPreviewViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  lines: z.array(
    z.strictObject({
      position: z.number().int(),
      unitPrice: decimalString(DECIMAL_SPECS.precioUnitario),
      taxableBase: money,
      taxes: z.array(invoiceTaxViewSchema),
    }),
  ),
  /** `null` mientras alguna línea no pueda calcularse. */
  totals: invoiceTotalsViewSchema.nullable(),
  issues: z.array(invoiceIssueSchema),
});
export type DraftPreviewView = z.infer<typeof draftPreviewViewSchema>;

export const draftBuyerViewSchema = z.strictObject({
  id: z.string(),
  identificationType: z.string(),
  identification: z.string(),
  legalName: z.string(),
  status: recordStatusSchema,
  systemRecord: systemRecordSchema.nullable(),
});

export const draftEmissionPointViewSchema = z.strictObject({
  id: z.string(),
  establishmentCode: z.string(),
  code: z.string(),
  available: z.boolean(),
});

export const draftViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  emissionPoint: draftEmissionPointViewSchema.nullable(),
  buyer: draftBuyerViewSchema.nullable(),
  lines: z.array(
    z.strictObject({
      position: z.number().int(),
      product: z.strictObject({
        id: z.string(),
        mainCode: z.string().nullable(),
        name: z.string(),
        /** Precio vigente del producto, solo de lectura. */
        unitPrice: decimalString(DECIMAL_SPECS.precioUnitario),
        status: recordStatusSchema,
      }),
      quantity: invoiceQuantitySchema,
      discount: money,
    }),
  ),
  payments: z.array(
    z.strictObject({
      position: z.number().int(),
      paymentMethod: z.string(),
      code: z.string(),
      officialLabel: z.string().nullable(),
      amount: money.nullable(),
    }),
  ),
  preview: draftPreviewViewSchema,
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
});
export type DraftView = z.infer<typeof draftViewSchema>;

export const draftSummaryViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  emissionPoint: draftEmissionPointViewSchema.nullable(),
  buyer: draftBuyerViewSchema.nullable(),
  lineCount: z.number().int(),
  /** Total de la vista previa, o `null` si todavía no puede calcularse. */
  previewTotal: money.nullable(),
  updatedAt: z.iso.datetime(),
});
export type DraftSummaryView = z.infer<typeof draftSummaryViewSchema>;

export const draftListMetaSchema = listMetaSchema;

export const signingDiagnosticViewSchema = z.strictObject({
  stage: z.enum(SIGNING_ATTEMPT_STAGES),
  code: z.enum(SIGNING_ATTEMPT_CODE_LIST as [SigningAttemptCode, ...SigningAttemptCode[]]),
  class: z.enum(SIGNING_ATTEMPT_CLASSES),
  message: z.string(),
  at: z.iso.datetime(),
  attemptCount: z.number().int(),
});
export type SigningDiagnosticView = z.infer<typeof signingDiagnosticViewSchema>;

/** Operaciones con el SRI de un intento (design D7). */
export const SRI_OPERATIONS = ["RECEPTION", "AUTHORIZATION", "VALIDITY"] as const;
export type SriOperation = (typeof SRI_OPERATIONS)[number];

/** Resultados de la clasificación de un intento (design D11, D12 y D15). */
export const SRI_RESULT_OUTCOMES = [
  "RECEIVED",
  "RETURNED",
  "KEY_IN_PROCESS",
  "KEY_REGISTERED",
  "SEQUENTIAL_REGISTERED",
  "UNKNOWN",
  "INCONSISTENT",
  "AUTHORIZED",
  "NOT_AUTHORIZED",
  "NO_CONCLUSION",
  "KEY_UNKNOWN",
  "KEY_KNOWN",
  "NO_EVIDENCE",
  "NOT_SENT",
  "UNPARSEABLE",
] as const;
export type SriResultOutcome = (typeof SRI_RESULT_OUTCOMES)[number];

/** Mensaje del SRI tal como llegó: todos, en orden, también los códigos desconocidos (CTX §22.2). */
export const sriMessageViewSchema = z.strictObject({
  identifier: z.string().nullable(),
  message: z.string().nullable(),
  additionalInformation: z.string().nullable(),
  type: z.string().nullable(),
});
export type SriMessageView = z.infer<typeof sriMessageViewSchema>;

/** Solicitud de reconciliación manual (design D15): el motivo es obligatorio. */
export const RECONCILIATION_REASON_MAX = 500;
export const requestReconciliationSchema = strictBody({
  reason: z
    .string({ error: "Indica el motivo de la reconciliación." })
    .trim()
    .min(1, "Indica el motivo de la reconciliación.")
    .max(
      RECONCILIATION_REASON_MAX,
      `El motivo admite como máximo ${RECONCILIATION_REASON_MAX} caracteres.`,
    ),
});
export type RequestReconciliationInput = z.input<typeof requestReconciliationSchema>;

/**
 * Resumen de la transmisión en el detalle (design D18): si hay una interacción en curso, si se
 * detuvo y por qué, si admite una reconciliación, la autorización y el último resultado del SRI.
 */
export const invoiceTransmissionSummarySchema = z.strictObject({
  inProgress: z.boolean(),
  stopped: z
    .strictObject({ code: z.string(), message: z.string(), at: z.iso.datetime() })
    .nullable(),
  reconcilable: z.boolean(),
  authorization: z
    .strictObject({
      number: z.string(),
      authorizedAt: z.iso.datetime(),
      environment: environmentSchema,
    })
    .nullable(),
  lastResult: z
    .strictObject({
      operation: z.enum(SRI_OPERATIONS),
      outcome: z.enum(SRI_RESULT_OUTCOMES),
      at: z.iso.datetime(),
      messages: z.array(sriMessageViewSchema),
    })
    .nullable(),
});
export type InvoiceTransmissionSummary = z.infer<typeof invoiceTransmissionSummarySchema>;

/** Una entrada del historial de la transmisión: una transición o un intento resumido. */
export const transmissionEventViewSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("TRANSITION"),
    at: z.iso.datetime(),
    fromState: invoiceStateSchema.nullable(),
    toState: invoiceStateSchema,
    cause: z.string(),
    actor: z.enum(["SYSTEM", "USER"]),
    actorName: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("ATTEMPT"),
    at: z.iso.datetime(),
    operation: z.enum(SRI_OPERATIONS),
    origin: z.enum(["AUTOMATIC", "MANUAL"]),
    /** Null mientras el intento espera su clasificación. */
    outcome: z.enum(SRI_RESULT_OUTCOMES).nullable(),
    messages: z.array(sriMessageViewSchema),
  }),
]);
export type TransmissionEventView = z.infer<typeof transmissionEventViewSchema>;

/**
 * Historial de la transmisión (design D18): las 100 entradas más recientes y el total, sin
 * respuestas originales, XML ni datos técnicos del transporte.
 */
export const INVOICE_TRANSMISSION_HISTORY_LIMIT = 100;
export const invoiceTransmissionViewSchema = z.strictObject({
  invoiceId: z.string(),
  state: invoiceStateSchema,
  events: z.array(transmissionEventViewSchema),
  total: z.number().int().nonnegative(),
});
export type InvoiceTransmissionView = z.infer<typeof invoiceTransmissionViewSchema>;

/** Factura desde su snapshot: lo que se emitió, aunque después cambien productos o configuración. */
export const invoiceViewSchema = z.strictObject({
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
  buyer: z.strictObject({
    identificationType: z.string(),
    identification: z.string(),
    legalName: z.string(),
    address: z.string().nullable(),
    consumerFinal: z.boolean(),
  }),
  lines: z.array(
    z.strictObject({
      position: z.number().int(),
      mainCode: z.string().nullable(),
      auxiliaryCode: z.string().nullable(),
      description: z.string(),
      quantity: invoiceQuantitySchema,
      unitPrice: decimalString(DECIMAL_SPECS.precioUnitario),
      discount: money,
      taxableBase: money,
      taxes: z.array(invoiceTaxViewSchema),
    }),
  ),
  payments: z.array(z.strictObject({ code: z.string(), amount: money })),
  totals: invoiceTotalsViewSchema,
  /** Último intento fallido mientras sigue `RESERVED`; `null` sin fallos o ya firmada. */
  diagnostic: signingDiagnosticViewSchema.nullable(),
  artifact: z.strictObject({ sha256: z.string(), sizeBytes: z.number().int() }).nullable(),
  /** XML autorizado recibido del SRI: solo su hash y su tamaño, distinto del firmado (D16). */
  authorizedArtifact: z
    .strictObject({ sha256: z.string(), sizeBytes: z.number().int() })
    .nullable(),
  transmission: invoiceTransmissionSummarySchema,
  createdAt: z.iso.datetime(),
  signedAt: z.iso.datetime().nullable(),
});
export type InvoiceView = z.infer<typeof invoiceViewSchema>;

export const invoiceSummaryViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  environment: environmentSchema,
  issueDate: isoDate,
  buyerIdentification: z.string(),
  buyerName: z.string(),
  total: money,
  state: invoiceStateSchema,
  /** Código del último fallo mientras sigue `RESERVED`. */
  diagnosticCode: z
    .enum(SIGNING_ATTEMPT_CODE_LIST as [SigningAttemptCode, ...SigningAttemptCode[]])
    .nullable(),
  /** La transmisión se detuvo y espera una decisión humana (design D20). */
  transmissionStopped: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type InvoiceSummaryView = z.infer<typeof invoiceSummaryViewSchema>;

export const invoiceListMetaSchema = listMetaSchema;
