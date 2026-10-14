// Contratos de los comprobantes de retención (add-withholding-receipts, design D3 a D6, D9, D10, D21
// y D25). Los cuerpos son estrictos: un `companyId`, un porcentaje, una denominación, un valor
// retenido, un campo del exterior, de reembolso o de dividendos, o cualquier campo desconocido se
// rechaza. El usuario elige el proveedor, el período, la parte relacionada, los documentos sustento
// (con sus impuestos y pagos declarados) y, por documento, cada retención con su impuesto, su entrada
// del catálogo y su base. El servidor resuelve el código, la denominación y el porcentaje, y calcula
// el valor retenido. Los importes son decimales exactos en texto.
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
 * Máximos absolutos de los límites de recursos (design D25): el contrato nunca admite más. El
 * límite efectivo es configurable por entorno, con estos valores por defecto. Son defensas de
 * recursos del sistema, no límites del SRI.
 */
export const WITHHOLDING_LIMITS_MAX = {
  supports: 30,
  itemsPerSupport: 10,
  taxesPerSupport: 10,
  paymentsPerSupport: 10,
} as const;
export const WITHHOLDING_LIMITS_DEFAULT = {
  supports: 10,
  itemsPerSupport: 5,
  taxesPerSupport: 5,
  paymentsPerSupport: 5,
} as const;
export type WithholdingLimits = { [K in keyof typeof WITHHOLDING_LIMITS_MAX]: number };

/** Fuente de la exclusión del consumidor final como sujeto retenido (design D3). */
export const WITHHOLDING_SUBJECT_RULE_SOURCE =
  "Ficha técnica de comprobantes electrónicos v2.34, página 13, notas de la tabla 6";

/** Tipos de documento sustento del MVP (design D10): códigos fiscales de dos caracteres. */
export const SUPPORT_DOCUMENT_TYPES = ["01", "02", "03"] as const;
export const supportDocumentTypeSchema = z.enum(SUPPORT_DOCUMENT_TYPES, {
  error:
    "El tipo de documento sustento debe ser 01 factura, 02 nota de venta o 03 liquidación de compra.",
});
export type SupportDocumentType = z.infer<typeof supportDocumentTypeSchema>;

/** Impuestos declarados del documento sustento (design D6): IVA 2, ICE 3 e IRBPNR 5. */
export const SUPPORT_TAX_CODES = ["2", "3", "5"] as const;
export const supportTaxCodeSchema = z.enum(SUPPORT_TAX_CODES, {
  error: "El impuesto del documento sustento debe ser 2 IVA, 3 ICE o 5 IRBPNR.",
});
export type SupportTaxCode = z.infer<typeof supportTaxCodeSchema>;

/** Impuestos que se retienen en el MVP (design D9): renta 1 e IVA 2. */
export const WITHHOLDING_TAX_CODES = ["1", "2"] as const;
export const withholdingTaxCodeSchema = z.enum(WITHHOLDING_TAX_CODES, {
  error:
    "El impuesto de la retención debe ser 1 renta o 2 IVA: el ISD y los demás impuestos están fuera del alcance actual.",
});
export type WithholdingTaxCode = z.infer<typeof withholdingTaxCodeSchema>;

/** Declaración de parte relacionada (design D4): del usuario, nunca inferida ni verificada. */
export const RELATED_PARTY_VALUES = ["SI", "NO"] as const;
export const relatedPartySchema = z.enum(RELATED_PARTY_VALUES, {
  error: "Indica si el proveedor es parte relacionada: SI o NO.",
});
export type RelatedParty = z.infer<typeof relatedPartySchema>;

/** Período fiscal `MM/AAAA` (patrón del XSD 2.0.0). */
export const FISCAL_PERIOD_PATTERN = /^(0[1-9]|1[012])\/20[0-9]{2}$/;
export const fiscalPeriodSchema = z
  .string({ error: "El período fiscal debe tener la forma MM/AAAA." })
  .regex(FISCAL_PERIOD_PATTERN, "El período fiscal debe tener la forma MM/AAAA.");

/** Número del documento sustento: 15 dígitos (`001001000000123`), sin guiones. */
export const SUPPORT_NUMBER_PATTERN = /^[0-9]{15}$/;
/** Autorización del documento sustento: 10, 37 o 49 dígitos (ficha v2.34, anexo 10). */
export const SUPPORT_AUTHORIZATION_PATTERN = /^(?:[0-9]{10}|[0-9]{37}|[0-9]{49})$/;
/** Código de sustento: los dos dígitos literales de la tabla 5 del Catálogo ATS. */
export const SUPPORT_CODE_PATTERN = /^[0-9]{2}$/;

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const entryKeySchema = (message: string) =>
  z.string({ error: message }).regex(ENTRY_KEY_PATTERN, message);
const money = invoiceAmountSchema;
const withholdingPercentage = decimalString(DECIMAL_SPECS.porcentajeRetener);
const isoDate = z.iso.date();
const idSchema = (message: string) => z.string({ error: message }).min(1, message);

/** Base de una retención: dominio `importe` y mayor que cero (política del proyecto, design D13). */
export const withholdingBaseSchema = money.refine(
  (value) => compareDecimalStrings(value, "0") > 0,
  "La base de la retención debe ser mayor que cero.",
);

/**
 * Impuesto declarado del documento sustento (design D6): su código de porcentaje es una entrada de
 * `iva-rate`, `ice-rate` o `irbpnr-rate`. La tarifa del IVA sale del catálogo, así que no se acepta;
 * la de ICE e IRBPNR la declara el usuario. Base y valor se transcriben y nunca se recalculan.
 */
export const withholdingSupportTaxSchema = strictBody({
  tax: nullable(supportTaxCodeSchema),
  rateEntryKey: nullable(entryKeySchema("El código de porcentaje no es válido.")),
  rate: nullable(withholdingPercentage),
  base: nullable(money),
  amount: nullable(money),
}).refine((value) => value.tax !== "2" || value.rate === null, {
  message: "La tarifa del IVA sale del catálogo: no se envía.",
  path: ["rate"],
});
export type WithholdingSupportTaxInput = z.input<typeof withholdingSupportTaxSchema>;

/** Forma de pago del documento sustento: una entrada de `payment-method` y su total (design D6). */
export const withholdingSupportPaymentSchema = strictBody({
  paymentMethod: nullable(entryKeySchema("La forma de pago no es válida.")),
  total: nullable(money),
});

/**
 * Retención de un documento sustento: el impuesto (renta o IVA), la entrada de su catálogo y la base.
 * El código, la denominación, el porcentaje y el valor los resuelve y calcula el servidor.
 */
export const withholdingItemSchema = strictBody({
  tax: nullable(withholdingTaxCodeSchema),
  entryKey: nullable(entryKeySchema("El concepto de la retención no es válido.")),
  base: nullable(withholdingBaseSchema),
});
export type WithholdingItemInput = z.input<typeof withholdingItemSchema>;

/** Documento sustento: una referencia estructurada externa que el usuario declara (design D6). */
export const withholdingSupportSchema = strictBody({
  documentType: nullable(supportDocumentTypeSchema),
  supportCode: nullable(
    z
      .string({ error: "El código de sustento no es válido." })
      .regex(SUPPORT_CODE_PATTERN, "El código de sustento debe tener dos dígitos."),
  ),
  number: nullable(
    z
      .string({ error: "El número del documento sustento no es válido." })
      .regex(SUPPORT_NUMBER_PATTERN, "El número del documento sustento debe tener 15 dígitos."),
  ),
  issueDate: nullable(isoDate),
  authorizationNumber: nullable(
    z
      .string({ error: "La autorización del documento sustento no es válida." })
      .regex(
        SUPPORT_AUTHORIZATION_PATTERN,
        "La autorización del documento sustento debe tener 10, 37 o 49 dígitos.",
      ),
  ),
  totalWithoutTaxes: nullable(money),
  importTotal: nullable(money),
  taxes: z
    .array(withholdingSupportTaxSchema, { error: "Los impuestos del documento no son válidos." })
    .max(
      WITHHOLDING_LIMITS_MAX.taxesPerSupport,
      `Un documento sustento admite como máximo ${WITHHOLDING_LIMITS_MAX.taxesPerSupport} impuestos. Es una defensa de recursos del sistema, no un límite del SRI.`,
    )
    .default([]),
  payments: z
    .array(withholdingSupportPaymentSchema, { error: "Las formas de pago no son válidas." })
    .max(
      WITHHOLDING_LIMITS_MAX.paymentsPerSupport,
      `Un documento sustento admite como máximo ${WITHHOLDING_LIMITS_MAX.paymentsPerSupport} formas de pago. Es una defensa de recursos del sistema, no un límite del SRI.`,
    )
    .default([]),
  withholdings: z
    .array(withholdingItemSchema, { error: "Las retenciones no son válidas." })
    .max(
      WITHHOLDING_LIMITS_MAX.itemsPerSupport,
      `Un documento sustento admite como máximo ${WITHHOLDING_LIMITS_MAX.itemsPerSupport} retenciones. Es una defensa de recursos del sistema, no un límite del SRI.`,
    )
    .default([]),
});
export type WithholdingSupportInput = z.input<typeof withholdingSupportSchema>;
export type WithholdingSupportData = z.output<typeof withholdingSupportSchema>;

const expectedVersionSchema = z
  .number({ error: "La versión esperada es obligatoria." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

/** Un borrador puede guardarse incompleto: cada campo puede faltar y la vista previa lo informa. */
const draftShape = {
  partyId: nullable(idSchema("El proveedor no es válido.")),
  relatedParty: nullable(relatedPartySchema),
  fiscalPeriod: nullable(fiscalPeriodSchema),
  emissionPointId: nullable(idSchema("El punto de emisión no es válido.")),
  supports: z
    .array(withholdingSupportSchema, { error: "Los documentos sustento no son válidos." })
    .max(
      WITHHOLDING_LIMITS_MAX.supports,
      `La retención admite como máximo ${WITHHOLDING_LIMITS_MAX.supports} documentos sustento. Es una defensa de recursos del sistema, no un límite del SRI.`,
    )
    .default([]),
};

/** Alta de un borrador: sin período, el servidor propone el mes de hoy (design D5). */
export const createWithholdingDraftSchema = strictBody(draftShape);
export type CreateWithholdingDraftInput = z.input<typeof createWithholdingDraftSchema>;
export type WithholdingDraftData = z.output<typeof createWithholdingDraftSchema>;

export const updateWithholdingDraftSchema = strictBody({
  ...draftShape,
  expectedVersion: expectedVersionSchema,
});
export type UpdateWithholdingDraftInput = z.input<typeof updateWithholdingDraftSchema>;

export const withholdingDraftIdParamsSchema = z.strictObject({ draftId: z.string().min(1) });
export const withholdingReceiptIdParamsSchema = z.strictObject({
  withholdingReceiptId: z.string().min(1),
});

/** Cabecera obligatoria de la emisión, la misma de la factura: `Idempotency-Key`. */
export const emitWithholdingHeadersSchema = emitInvoiceHeadersSchema;

/** Emisión (design D16): la huella cubre el borrador, su versión y sus datos funcionales. */
export const emitWithholdingReceiptSchema = strictBody({
  draftId: idSchema("El borrador es obligatorio."),
  expectedVersion: expectedVersionSchema,
});
export type EmitWithholdingReceiptInput = z.input<typeof emitWithholdingReceiptSchema>;

/** Consultas: no son estrictas, de modo que un `companyId` se ignora. */
export const listWithholdingDraftsQuerySchema = z.object({ ...pageParams });
export type ListWithholdingDraftsQuery = z.output<typeof listWithholdingDraftsQuerySchema>;

export const listWithholdingReceiptsQuerySchema = z.object({
  search: searchParam,
  state: invoiceStateSchema.optional(),
  fiscalPeriod: fiscalPeriodSchema.optional(),
  ...pageParams,
});
export type ListWithholdingReceiptsQuery = z.output<typeof listWithholdingReceiptsQuerySchema>;

/** Proveedores que pueden ser sujeto retenido, por identificación o razón social (design D3). */
export const listWithholdingSuppliersQuerySchema = z.object({ search: searchParam, ...pageParams });
export type ListWithholdingSuppliersQuery = z.output<typeof listWithholdingSuppliersQuerySchema>;

/**
 * Rechazos de los comprobantes de retención (design D21). Cada uno es un `409`, salvo los de
 * recurso inexistente (`404`). La emisión informa el primero; la vista previa muestra todos.
 */
export const WITHHOLDING_ERROR_CODES = [
  "WITHHOLDING_RECEIPT_NOT_FOUND",
  "WITHHOLDING_DRAFT_NOT_FOUND",
  "WITHHOLDING_SUBJECT_NOT_FOUND",
  "WITHHOLDING_SUBJECT_INACTIVE",
  "WITHHOLDING_SUBJECT_CONSUMER_FINAL",
  "WITHHOLDING_SUBJECT_FOREIGN_OUT_OF_SCOPE",
  "WITHHOLDING_SUBJECT_NOT_SUPPLIER",
  "WITHHOLDING_RELATED_PARTY_REQUIRED",
  "WITHHOLDING_FISCAL_PERIOD_INVALID",
  "WITHHOLDING_FISCAL_PERIOD_IN_FUTURE",
  "WITHHOLDING_SUPPORTS_REQUIRED",
  "WITHHOLDING_SUPPORT_TYPE_NOT_SUPPORTED",
  "WITHHOLDING_SUPPORT_CODE_INCOMPATIBLE",
  "WITHHOLDING_SUPPORT_INVALID",
  "WITHHOLDING_SUPPORT_DATE_AFTER_ISSUE",
  "WITHHOLDING_SUPPORT_TAX_INVALID",
  "WITHHOLDING_SUPPORT_PAYMENT_NOT_USABLE",
  "WITHHOLDING_ITEMS_REQUIRED",
  "WITHHOLDING_TAX_NOT_SUPPORTED",
  "WITHHOLDING_CONCEPT_NOT_SUPPORTED",
  "WITHHOLDING_IVA_CODE_NOT_SUPPORTED",
  "WITHHOLDING_ENTRY_NOT_USABLE",
  "WITHHOLDING_BASE_INVALID",
  "WITHHOLDING_AMOUNT_OUT_OF_RANGE",
  "WITHHOLDING_RESOURCE_LIMIT",
  "WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE",
  "WITHHOLDING_DRAFT_INCOMPLETE",
  "WITHHOLDING_DRAFT_CHANGED",
  "WITHHOLDING_DRAFT_ALREADY_EMITTED",
  "WITHHOLDING_NOT_RECONCILABLE",
  // Los de la emisión compartidos con la factura.
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "TAXPAYER_NOT_CONFIGURED",
  "EMISSION_POINT_NOT_FOUND",
  "EMISSION_POINT_UNAVAILABLE",
  // block-unsupported-special-cases-before-emission (design D4): el mismo código que la factura.
  "SPECIAL_CASE_UNSUPPORTED",
  "SIGNING_CERTIFICATE_NOT_USABLE",
  "SCHEMA_NOT_AVAILABLE",
  "SEQUENCE_EXHAUSTED",
  "SRI_INTERACTION_IN_PROGRESS",
] as const;
export type WithholdingErrorCode = (typeof WITHHOLDING_ERROR_CODES)[number];

/**
 * Problema del borrador o de la emisión, con la posición del documento sustento y, dentro de él, la
 * del impuesto, la forma de pago o la retención (desde 1), o null.
 */
export const withholdingIssueSchema = z.strictObject({
  code: z.enum(WITHHOLDING_ERROR_CODES),
  message: z.string(),
  support: z.number().int().nullable(),
  tax: z.number().int().nullable(),
  payment: z.number().int().nullable(),
  withholding: z.number().int().nullable(),
});
export type WithholdingIssue = z.infer<typeof withholdingIssueSchema>;

/** Retención calculada por el servidor (design D13): el porcentaje y el valor nunca son del cliente. */
export const withholdingAmountViewSchema = z.strictObject({
  position: z.number().int(),
  tax: withholdingTaxCodeSchema,
  entryKey: z.string(),
  code: z.string(),
  label: z.string(),
  base: money,
  percentage: withholdingPercentage,
  amount: money,
});
export type WithholdingAmountView = z.infer<typeof withholdingAmountViewSchema>;

export const withholdingTotalsViewSchema = z.strictObject({ withheld: money });

/** Vista previa del servidor (design D13 y D21); no reserva nada. */
export const withholdingPreviewViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  /** Mes de la fecha de evaluación (`MM/AAAA`), contra el que se compara el período. */
  issueMonth: z.string(),
  /** Aviso que no bloquea: el período elegido no es el mes de emisión (design D5). */
  periodDiffersFromIssueMonth: z.boolean(),
  /** Las retenciones calculadas de cada documento, en su orden; vacías si no se pueden calcular. */
  supports: z.array(
    z.strictObject({
      position: z.number().int(),
      withholdings: z.array(withholdingAmountViewSchema),
    }),
  ),
  /** `null` mientras alguna retención no pueda calcularse. */
  totals: withholdingTotalsViewSchema.nullable(),
  issues: z.array(withholdingIssueSchema),
});
export type WithholdingPreviewView = z.infer<typeof withholdingPreviewViewSchema>;

/** Proveedor que puede ser sujeto retenido: activo, con RUC, cédula o pasaporte (design D3). */
export const withholdingSupplierViewSchema = z.strictObject({
  id: z.string(),
  identificationType: z.string(),
  identification: z.string(),
  legalName: z.string(),
});
export type WithholdingSupplierView = z.infer<typeof withholdingSupplierViewSchema>;

/** Opciones del borrador (design D21): solo entradas utilizables, con su fecha de resolución. */
export const withholdingOptionsViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  /** Límites efectivos de recursos: defensas del sistema, no límites del SRI (design D25). */
  limits: z.strictObject({
    supports: z.number().int(),
    itemsPerSupport: z.number().int(),
    taxesPerSupport: z.number().int(),
    paymentsPerSupport: z.number().int(),
  }),
  withholdingTaxes: z.array(z.strictObject({ code: withholdingTaxCodeSchema, label: z.string() })),
  incomeConcepts: z.array(
    z.strictObject({
      entryKey: z.string(),
      code: z.string(),
      label: z.string(),
      percentage: withholdingPercentage,
    }),
  ),
  ivaCodes: z.array(
    z.strictObject({
      entryKey: z.string(),
      code: z.string(),
      label: z.string(),
      percentage: withholdingPercentage,
      /** Referencia oficial de la entrada, con la nota de la fuente cuando la tiene (código 7). */
      sourceRef: z.string(),
    }),
  ),
  documentTypes: z.array(
    z.strictObject({
      code: supportDocumentTypeSchema,
      label: z.string(),
      supportCodes: z.array(z.strictObject({ code: z.string(), label: z.string() })),
    }),
  ),
  /**
   * Códigos de porcentaje de los impuestos del documento sustento, con todas sus vigencias: se
   * resuelven con la fecha del documento, no con la de emisión (design D6 y D12).
   */
  supportTaxes: z.array(
    z.strictObject({
      tax: supportTaxCodeSchema,
      label: z.string(),
      rates: z.array(
        z.strictObject({
          entryKey: z.string(),
          code: z.string(),
          label: z.string(),
          rateKind: rateKindSchema,
          percentage: decimalString(DECIMAL_SPECS.tarifa).nullable(),
          effectiveFrom: isoDate,
          effectiveTo: isoDate.nullable(),
        }),
      ),
    }),
  ),
  paymentMethods: z.array(
    z.strictObject({ entryKey: z.string(), code: z.string(), label: z.string() }),
  ),
});
export type WithholdingOptionsView = z.infer<typeof withholdingOptionsViewSchema>;

const emissionPointViewSchema = z.strictObject({
  id: z.string(),
  establishmentCode: z.string(),
  code: z.string(),
  available: z.boolean(),
});

const draftSupportViewSchema = z.strictObject({
  documentType: supportDocumentTypeSchema.nullable(),
  supportCode: z.string().nullable(),
  number: z.string().nullable(),
  issueDate: isoDate.nullable(),
  authorizationNumber: z.string().nullable(),
  totalWithoutTaxes: money.nullable(),
  importTotal: money.nullable(),
  taxes: z.array(
    z.strictObject({
      tax: supportTaxCodeSchema.nullable(),
      rateEntryKey: z.string().nullable(),
      rate: withholdingPercentage.nullable(),
      base: money.nullable(),
      amount: money.nullable(),
    }),
  ),
  payments: z.array(
    z.strictObject({ paymentMethod: z.string().nullable(), total: money.nullable() }),
  ),
  withholdings: z.array(
    z.strictObject({
      tax: withholdingTaxCodeSchema.nullable(),
      entryKey: z.string().nullable(),
      base: money.nullable(),
    }),
  ),
});

export const withholdingDraftViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  party: withholdingSupplierViewSchema.nullable(),
  relatedParty: relatedPartySchema.nullable(),
  fiscalPeriod: z.string().nullable(),
  emissionPoint: emissionPointViewSchema.nullable(),
  supports: z.array(draftSupportViewSchema),
  preview: withholdingPreviewViewSchema,
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
});
export type WithholdingDraftView = z.infer<typeof withholdingDraftViewSchema>;

export const withholdingDraftSummaryViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  partyName: z.string().nullable(),
  fiscalPeriod: z.string().nullable(),
  supportCount: z.number().int(),
  withholdingCount: z.number().int(),
  /** Total retenido de la vista previa, o `null` si todavía no puede calcularse. */
  previewTotal: money.nullable(),
  updatedAt: z.iso.datetime(),
});
export type WithholdingDraftSummaryView = z.infer<typeof withholdingDraftSummaryViewSchema>;

/** Declaración de parte relacionada tal como la guarda el comprobante (design D4). */
export const withholdingRelatedPartyViewSchema = z.strictObject({
  value: relatedPartySchema,
  basis: z.literal("USER_DECLARED"),
  declaredBy: z.string(),
  declaredByName: z.string().nullable(),
  declaredAt: z.iso.datetime(),
});

/** Comprobante de retención desde su snapshot: lo que se emitió, sin releer el tercero ni catálogos. */
export const withholdingReceiptViewSchema = z.strictObject({
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
  subject: z.strictObject({
    partyId: z.string(),
    identificationType: z.string(),
    identification: z.string(),
    legalName: z.string(),
  }),
  relatedParty: withholdingRelatedPartyViewSchema,
  fiscalPeriod: z.string(),
  supports: z.array(
    z.strictObject({
      position: z.number().int(),
      documentType: supportDocumentTypeSchema,
      documentTypeLabel: z.string(),
      supportCode: z.string(),
      supportCodeLabel: z.string(),
      number: z.string(),
      issueDate: isoDate,
      authorizationNumber: z.string().nullable(),
      totalWithoutTaxes: money,
      importTotal: money,
      taxes: z.array(
        z.strictObject({
          position: z.number().int(),
          tax: supportTaxCodeSchema,
          taxLabel: z.string(),
          rateCode: z.string(),
          rateLabel: z.string(),
          rate: withholdingPercentage,
          /** La tarifa del IVA sale del catálogo; la de ICE e IRBPNR la declaró el usuario. */
          rateBasis: z.enum(["CATALOG", "USER_DECLARED"]),
          base: money,
          amount: money,
        }),
      ),
      payments: z.array(
        z.strictObject({
          position: z.number().int(),
          code: z.string(),
          label: z.string(),
          total: money,
        }),
      ),
      withholdings: z.array(withholdingAmountViewSchema.extend({ taxLabel: z.string() })),
    }),
  ),
  totals: withholdingTotalsViewSchema,
  diagnostic: signingDiagnosticViewSchema.nullable(),
  artifact: z.strictObject({ sha256: z.string(), sizeBytes: z.number().int() }).nullable(),
  authorizedArtifact: z
    .strictObject({ sha256: z.string(), sizeBytes: z.number().int() })
    .nullable(),
  transmission: invoiceTransmissionSummarySchema,
  createdAt: z.iso.datetime(),
  signedAt: z.iso.datetime().nullable(),
});
export type WithholdingReceiptView = z.infer<typeof withholdingReceiptViewSchema>;

export const withholdingReceiptSummaryViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  environment: environmentSchema,
  issueDate: isoDate,
  fiscalPeriod: z.string(),
  subjectIdentification: z.string(),
  subjectName: z.string(),
  supportCount: z.number().int(),
  /** Total retenido: la suma de los valores retenidos del snapshot. */
  total: money,
  state: invoiceStateSchema,
  diagnosticCode: z
    .enum(SIGNING_ATTEMPT_CODE_LIST as [SigningAttemptCode, ...SigningAttemptCode[]])
    .nullable(),
  transmissionStopped: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type WithholdingReceiptSummaryView = z.infer<typeof withholdingReceiptSummaryViewSchema>;

/** Historial de la transmisión de una retención: las 100 entradas más recientes y el total. */
export const WITHHOLDING_TRANSMISSION_HISTORY_LIMIT = 100;
export const withholdingTransmissionViewSchema = z.strictObject({
  withholdingReceiptId: z.string(),
  state: invoiceStateSchema,
  events: z.array(transmissionEventViewSchema),
  total: z.number().int().nonnegative(),
});
export type WithholdingTransmissionView = z.infer<typeof withholdingTransmissionViewSchema>;

export const withholdingListMetaSchema = listMetaSchema;
