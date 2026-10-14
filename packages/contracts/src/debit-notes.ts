// Contratos de las notas de débito (add-debit-notes, design D5, D8, D9 y D20). Los cuerpos son
// estrictos: un `companyId`, un número, una clave o una fecha de un comprobante externo, o cualquier
// campo desconocido se rechaza; la factura se refiere solo por su identificador. La forma de pago es
// una sola clave del catálogo, sin etiqueta ni importe. Los importes son decimales exactos en texto;
// los impuestos, los totales y el total del pago los calcula el servidor.
import { z } from "zod";
import { DECIMAL_SPECS, compareDecimalStrings, decimalString } from "./decimal.ts";
import { ENTRY_KEY_PATTERN } from "./fiscal-catalogs.ts";
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
import { environmentSchema, fiscalText, rimpeCategorySchema, strictBody } from "./taxpayer.ts";

/** Fuente de las causas y de la exclusión de la factura comercial negociable negociada. */
export const DEBIT_NOTE_RULE_SOURCE =
  "Reglamento de Comprobantes de Venta, Retención y Documentos Complementarios, art. 16";

/** Causas cerradas del artículo 16 (Q-49): no hay otras causas ni atajos. */
export const DEBIT_NOTE_CAUSES = ["LATE_PAYMENT_INTEREST", "POST_INVOICE_COST_EXPENSE"] as const;
export const debitNoteCauseSchema = z.enum(DEBIT_NOTE_CAUSES, {
  error: "La causa debe ser intereses de mora o costos o gastos posteriores a la factura.",
});
export type DebitNoteCause = z.infer<typeof debitNoteCauseSchema>;
export const DEBIT_NOTE_CAUSE_LABELS: Record<DebitNoteCause, string> = {
  LATE_PAYMENT_INTEREST: "Intereses de mora",
  POST_INVOICE_COST_EXPENSE: "Costos o gastos posteriores a la factura",
};

/** Descripción del concepto: la `razon` del XSD, una sola línea de 1 a 300 caracteres, en NFC. */
export const DEBIT_NOTE_DESCRIPTION_MAX = 300;
export const debitNoteDescriptionSchema = fiscalText(
  "La descripción",
  "Describe el concepto.",
  DEBIT_NOTE_DESCRIPTION_MAX,
);

/** Importe del concepto: dominio `importe` (14/2), mayor que cero, como texto exacto. */
export const debitNoteAmountSchema = invoiceAmountSchema.refine(
  (value) => compareDecimalStrings(value, "0") > 0,
  "El importe del concepto debe ser mayor que cero.",
);

/** Clave de un tratamiento de IVA de la factura: `taxCode:rateCode`. */
export const TAX_TREATMENT_PATTERN = /^[0-9]{1,4}:[0-9]{1,4}$/;
export const taxTreatmentKeySchema = z
  .string({ error: "El tratamiento de IVA no es válido." })
  .regex(TAX_TREATMENT_PATTERN, "El tratamiento de IVA no es válido.");

/** Máximo de conceptos por nota: un límite del producto, no del SRI (design D5). */
export const DEBIT_NOTE_CONCEPTS_MAX = 100;

const idSchema = (message: string) => z.string({ error: message }).min(1, message);

const expectedVersionSchema = z
  .number({ error: "La versión esperada es obligatoria." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

/**
 * Concepto del borrador (design D5): cada campo puede faltar mientras se prepara y la vista previa
 * lo informa; si viene, se valida. La descripción nunca selecciona comportamiento.
 */
export const debitNoteDraftConceptSchema = strictBody({
  cause: nullable(debitNoteCauseSchema),
  description: nullable(debitNoteDescriptionSchema),
  amount: nullable(debitNoteAmountSchema),
  taxTreatment: nullable(taxTreatmentKeySchema),
});
export type DebitNoteDraftConceptInput = z.input<typeof debitNoteDraftConceptSchema>;

/**
 * Forma de pago (design D8): una sola, obligatoria al emitir, como la clave de una entrada del
 * catálogo `payment-method`. Exactamente una es una política del MVP del proyecto.
 */
export const debitNotePaymentMethodSchema = z
  .string({ error: "La forma de pago no es válida." })
  .regex(ENTRY_KEY_PATTERN, "La forma de pago no es válida.");

/** Un borrador puede guardarse incompleto; la emisión exige punto, forma de pago y conceptos. */
const draftShape = {
  emissionPointId: nullable(idSchema("El punto de emisión no es válido.")),
  paymentMethod: nullable(debitNotePaymentMethodSchema),
  concepts: z
    .array(debitNoteDraftConceptSchema, { error: "Los conceptos no son válidos." })
    .max(
      DEBIT_NOTE_CONCEPTS_MAX,
      `La nota admite como máximo ${DEBIT_NOTE_CONCEPTS_MAX} conceptos.`,
    )
    .default([]),
};

export const createDebitNoteDraftSchema = strictBody({
  invoiceId: idSchema("La factura es obligatoria."),
  ...draftShape,
});
export type CreateDebitNoteDraftInput = z.input<typeof createDebitNoteDraftSchema>;
export type DebitNoteDraftData = z.output<typeof createDebitNoteDraftSchema>;

/** La factura del borrador no cambia: otra factura es otro borrador. */
export const updateDebitNoteDraftSchema = strictBody({
  ...draftShape,
  expectedVersion: expectedVersionSchema,
});
export type UpdateDebitNoteDraftInput = z.input<typeof updateDebitNoteDraftSchema>;

export const debitNoteDraftIdParamsSchema = z.strictObject({ draftId: z.string().min(1) });
export const debitNoteIdParamsSchema = z.strictObject({ debitNoteId: z.string().min(1) });

/**
 * Declaración de elegibilidad (design D9): una exclusión oficial que el sistema no puede comprobar.
 * La semántica son el identificador y la versión; un cambio del texto es una versión nueva. Es una
 * declaración del usuario, nunca una verificación del sistema.
 */
export const DEBIT_NOTE_DECLARATION_STATEMENTS = [
  "NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE",
] as const;
export type DebitNoteDeclarationStatement = (typeof DEBIT_NOTE_DECLARATION_STATEMENTS)[number];

export const DEBIT_NOTE_ELIGIBILITY_DECLARATION = {
  version: 1,
  basis: "USER_DECLARED",
  notice:
    "Es una declaración tuya: el sistema no puede comprobarla. Si no es cierta, la norma no admite esta nota de débito.",
  statements: [
    {
      id: "NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE",
      text: "Declaro que esta factura no es una factura comercial negociable que haya sido efectivamente negociada.",
      context:
        "Una factura comercial negociable puede transferirse a un tercero como título valor. Si se negoció, la norma no admite una nota de débito sobre ella.",
      source: DEBIT_NOTE_RULE_SOURCE,
    },
  ],
} as const satisfies {
  version: number;
  basis: "USER_DECLARED";
  notice: string;
  statements: readonly {
    id: DebitNoteDeclarationStatement;
    text: string;
    context: string;
    source: string;
  }[];
};

export const debitNoteDeclarationsSchema = z
  .strictObject(
    {
      version: z.literal(DEBIT_NOTE_ELIGIBILITY_DECLARATION.version, {
        error: "La declaración no es la vigente: vuelve a confirmarla.",
      }),
      statements: z.array(
        z.enum(DEBIT_NOTE_DECLARATION_STATEMENTS, { error: "La declaración no es válida." }),
        { error: "La declaración no es válida." },
      ),
    },
    { error: "Confirma la declaración de la nota de débito." },
  )
  .refine(
    (value) =>
      value.statements.length === DEBIT_NOTE_DECLARATION_STATEMENTS.length &&
      DEBIT_NOTE_DECLARATION_STATEMENTS.every((id) => value.statements.includes(id)),
    { message: "Confirma la declaración de la nota de débito.", path: ["statements"] },
  );
export type DebitNoteDeclarationsInput = z.input<typeof debitNoteDeclarationsSchema>;

/** Cabecera obligatoria de la emisión, la misma de la factura: `Idempotency-Key`. */
export const emitDebitNoteHeadersSchema = emitInvoiceHeadersSchema;

/** Emisión (design D15): la huella cubre el borrador, su versión, la declaración y sus datos. */
export const emitDebitNoteSchema = strictBody({
  draftId: idSchema("El borrador es obligatorio."),
  expectedVersion: expectedVersionSchema,
  declarations: debitNoteDeclarationsSchema,
});
export type EmitDebitNoteInput = z.input<typeof emitDebitNoteSchema>;

/** Consultas: no son estrictas, de modo que un `companyId` se ignora. */
export const listDebitNoteDraftsQuerySchema = z.object({ ...pageParams });
export type ListDebitNoteDraftsQuery = z.output<typeof listDebitNoteDraftsQuerySchema>;

export const listDebitNotesQuerySchema = z.object({
  search: searchParam,
  state: invoiceStateSchema.optional(),
  cause: debitNoteCauseSchema.optional(),
  ...pageParams,
});
export type ListDebitNotesQuery = z.output<typeof listDebitNotesQuerySchema>;

/** Facturas elegibles: autorizadas, sin consumidor final y del ambiente vigente, por número o comprador. */
export const listDebitEligibleInvoicesQuerySchema = z.object({
  search: searchParam,
  ...pageParams,
});
export type ListDebitEligibleInvoicesQuery = z.output<typeof listDebitEligibleInvoicesQuerySchema>;

/**
 * Rechazos de las notas de débito (design D20). Cada uno es un `409`, salvo los de recurso
 * inexistente (`404`). La emisión informa el primero; la vista previa muestra todos.
 */
export const DEBIT_NOTE_ERROR_CODES = [
  "DEBIT_NOTE_NOT_FOUND",
  "DEBIT_NOTE_DRAFT_NOT_FOUND",
  "DEBIT_NOTE_INVOICE_NOT_FOUND",
  "DEBIT_NOTE_DRAFT_CHANGED",
  "DEBIT_NOTE_DRAFT_ALREADY_EMITTED",
  "DEBIT_NOTE_DRAFT_INCOMPLETE",
  "DEBIT_NOTE_INVOICE_NOT_ELIGIBLE",
  "DEBIT_NOTE_CONSUMER_FINAL",
  "DEBIT_NOTE_INVOICE_INTEGRITY",
  "DEBIT_NOTE_CONCEPTS_REQUIRED",
  "DEBIT_NOTE_CONCEPTS_TOO_MANY",
  "DEBIT_NOTE_CONCEPT_INVALID",
  "DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE",
  "DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE",
  "DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH",
  "DEBIT_NOTE_AMOUNT_OUT_OF_RANGE",
  "DEBIT_NOTE_DECLARATION_REQUIRED",
  "DEBIT_NOTE_NOT_RECONCILABLE",
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
export type DebitNoteErrorCode = (typeof DEBIT_NOTE_ERROR_CODES)[number];

const isoDate = z.iso.date();
const money = invoiceAmountSchema;
const percentage = decimalString(DECIMAL_SPECS.tarifa);

/** Problema del borrador o de la emisión, con la posición del concepto o null. */
export const debitNoteIssueSchema = z.strictObject({
  code: z.enum(DEBIT_NOTE_ERROR_CODES),
  message: z.string(),
  concept: z.number().int().nullable(),
});
export type DebitNoteIssue = z.infer<typeof debitNoteIssueSchema>;

/** Tratamiento de IVA de la factura, tal como lo congeló su snapshot (design D6). */
export const debitNoteTaxTreatmentViewSchema = z.strictObject({
  key: z.string(),
  taxCode: z.string(),
  rateCode: z.string(),
  percentage,
  /** Denominación oficial del catálogo en la fecha de la factura. */
  label: z.string(),
});
export type DebitNoteTaxTreatmentView = z.infer<typeof debitNoteTaxTreatmentViewSchema>;

/** Impuesto de un tratamiento: la base total de sus conceptos y el impuesto sobre ella (design D7). */
export const debitNoteTaxViewSchema = z.strictObject({
  key: z.string(),
  taxCode: z.string(),
  rateCode: z.string(),
  percentage,
  label: z.string(),
  base: money,
  amount: money,
});
export type DebitNoteTaxView = z.infer<typeof debitNoteTaxViewSchema>;

/** La única forma de pago, con su denominación y su total (el valor total de la nota). */
export const debitNotePaymentViewSchema = z.strictObject({
  entryKey: z.string(),
  code: z.string(),
  label: z.string(),
  amount: money,
});
export type DebitNotePaymentView = z.infer<typeof debitNotePaymentViewSchema>;

export const debitNoteTotalsViewSchema = z.strictObject({
  withoutTaxes: money,
  taxes: z.array(debitNoteTaxViewSchema),
  total: money,
});
export type DebitNoteTotalsView = z.infer<typeof debitNoteTotalsViewSchema>;

export const debitEligibleInvoiceViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  issueDate: isoDate,
  buyerIdentification: z.string(),
  buyerName: z.string(),
  total: money,
});
export type DebitEligibleInvoiceView = z.infer<typeof debitEligibleInvoiceViewSchema>;

/** Vista previa del servidor (design D7 y D20); no reserva nada. */
export const debitNotePreviewViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  /** Los tratamientos de la factura: las únicas opciones de un concepto. */
  taxTreatments: z.array(debitNoteTaxTreatmentViewSchema),
  /** `null` mientras la nota no pueda calcularse. */
  totals: debitNoteTotalsViewSchema.nullable(),
  payment: debitNotePaymentViewSchema.nullable(),
  issues: z.array(debitNoteIssueSchema),
});
export type DebitNotePreviewView = z.infer<typeof debitNotePreviewViewSchema>;

const emissionPointViewSchema = z.strictObject({
  id: z.string(),
  establishmentCode: z.string(),
  code: z.string(),
  available: z.boolean(),
});

const modifiedInvoiceSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  issueDate: isoDate,
});

const draftConceptViewSchema = z.strictObject({
  position: z.number().int(),
  cause: debitNoteCauseSchema.nullable(),
  description: z.string().nullable(),
  amount: money.nullable(),
  taxTreatment: z.string().nullable(),
});

export const debitNoteDraftViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  invoice: modifiedInvoiceSchema.extend({
    buyerIdentification: z.string(),
    buyerName: z.string(),
    total: money,
  }),
  emissionPoint: emissionPointViewSchema.nullable(),
  paymentMethod: z.string().nullable(),
  concepts: z.array(draftConceptViewSchema),
  preview: debitNotePreviewViewSchema,
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
});
export type DebitNoteDraftView = z.infer<typeof debitNoteDraftViewSchema>;

export const debitNoteDraftSummaryViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  invoice: modifiedInvoiceSchema,
  buyerName: z.string(),
  conceptCount: z.number().int(),
  /** Valor total de la vista previa, o `null` si todavía no puede calcularse. */
  previewTotal: money.nullable(),
  updatedAt: z.iso.datetime(),
});
export type DebitNoteDraftSummaryView = z.infer<typeof debitNoteDraftSummaryViewSchema>;

/** Declaración tal como la guarda la nota: declarada por el usuario, nunca verificada. */
export const debitNoteDeclarationsViewSchema = z.strictObject({
  version: z.number().int(),
  statements: z.array(
    z.strictObject({
      id: z.enum(DEBIT_NOTE_DECLARATION_STATEMENTS),
      text: z.string(),
      source: z.string(),
    }),
  ),
  basis: z.literal("USER_DECLARED"),
  declaredBy: z.string(),
  declaredByName: z.string().nullable(),
  declaredAt: z.iso.datetime(),
});
export type DebitNoteDeclarationsView = z.infer<typeof debitNoteDeclarationsViewSchema>;

/** Nota de débito desde su snapshot: lo que se emitió, sin releer la factura ni los catálogos. */
export const debitNoteViewSchema = z.strictObject({
  id: z.string(),
  documentType: documentTypeSchema,
  environment: environmentSchema,
  documentNumber: z.string(),
  accessKey: z.string(),
  issueDate: isoDate,
  state: invoiceStateSchema,
  invoice: modifiedInvoiceSchema.extend({
    accessKey: z.string(),
    authorizationNumber: z.string(),
  }),
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
  }),
  concepts: z.array(
    z.strictObject({
      position: z.number().int(),
      cause: debitNoteCauseSchema,
      description: z.string(),
      amount: money,
      taxTreatment: debitNoteTaxTreatmentViewSchema,
    }),
  ),
  totals: debitNoteTotalsViewSchema,
  payment: debitNotePaymentViewSchema,
  declarations: debitNoteDeclarationsViewSchema,
  diagnostic: signingDiagnosticViewSchema.nullable(),
  artifact: z.strictObject({ sha256: z.string(), sizeBytes: z.number().int() }).nullable(),
  authorizedArtifact: z
    .strictObject({ sha256: z.string(), sizeBytes: z.number().int() })
    .nullable(),
  transmission: invoiceTransmissionSummarySchema,
  createdAt: z.iso.datetime(),
  signedAt: z.iso.datetime().nullable(),
});
export type DebitNoteView = z.infer<typeof debitNoteViewSchema>;

export const debitNoteSummaryViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  environment: environmentSchema,
  issueDate: isoDate,
  invoice: z.strictObject({ id: z.string(), documentNumber: z.string() }),
  /** Causas distintas de sus conceptos, en el orden del enum. */
  causes: z.array(debitNoteCauseSchema),
  buyerIdentification: z.string(),
  buyerName: z.string(),
  total: money,
  state: invoiceStateSchema,
  diagnosticCode: z
    .enum(SIGNING_ATTEMPT_CODE_LIST as [SigningAttemptCode, ...SigningAttemptCode[]])
    .nullable(),
  transmissionStopped: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type DebitNoteSummaryView = z.infer<typeof debitNoteSummaryViewSchema>;

/** Historial de la transmisión de una nota: las 100 entradas más recientes y el total. */
export const DEBIT_NOTE_TRANSMISSION_HISTORY_LIMIT = 100;
export const debitNoteTransmissionViewSchema = z.strictObject({
  debitNoteId: z.string(),
  state: invoiceStateSchema,
  events: z.array(transmissionEventViewSchema),
  total: z.number().int().nonnegative(),
});
export type DebitNoteTransmissionView = z.infer<typeof debitNoteTransmissionViewSchema>;

export const debitNoteListMetaSchema = listMetaSchema;
