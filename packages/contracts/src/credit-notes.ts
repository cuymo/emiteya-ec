// Contratos de las notas de crédito (add-credit-notes, design D5, D9 y D16). Los cuerpos son
// estrictos: un `companyId`, un número, una clave o una fecha de un comprobante externo, o cualquier
// campo desconocido se rechaza; la factura se refiere solo por su identificador. Cantidades e
// importes son decimales exactos en texto. La vista previa y los importes los calcula el servidor:
// el cliente nunca envía un importe.
import { z } from "zod";
import { DECIMAL_SPECS, compareDecimalStrings, decimalString } from "./decimal.ts";
import { documentTypeSchema } from "./fiscal-numbering.ts";
import {
  invoiceAmountSchema,
  invoiceQuantitySchema,
  invoiceStateSchema,
  invoiceTaxViewSchema,
  invoiceTransmissionSummarySchema,
  signingDiagnosticViewSchema,
  SIGNING_ATTEMPT_CODE_LIST,
  transmissionEventViewSchema,
  type SigningAttemptCode,
} from "./invoices.ts";
import { listMetaSchema, pageParams, searchParam } from "./pagination.ts";
import { environmentSchema, fiscalText, rimpeCategorySchema, strictBody } from "./taxpayer.ts";

/** Causas cerradas del MVP (Q-10): los descuentos y bonificaciones son una capacidad futura. */
export const CREDIT_NOTE_CAUSES = ["TOTAL_ANNULMENT", "RETURN"] as const;
export const creditNoteCauseSchema = z.enum(CREDIT_NOTE_CAUSES, {
  error: "La causa debe ser anulación total o devolución.",
});
export type CreditNoteCause = z.infer<typeof creditNoteCauseSchema>;
export const CREDIT_NOTE_CAUSE_LABELS: Record<CreditNoteCause, string> = {
  TOTAL_ANNULMENT: "Anulación total",
  RETURN: "Devolución",
};

/** Motivo del comprobante: una sola línea de 1 a 300 caracteres (`motivo` del XSD, `[^\n]*`), en NFC. */
export const CREDIT_NOTE_REASON_MAX = 300;
export const creditNoteReasonSchema = fiscalText(
  "El motivo",
  "Indica el motivo de la nota de crédito.",
  CREDIT_NOTE_REASON_MAX,
);

/** Cantidad del dominio `cantidad` (18/6), sin redondear. */
const quantitySchema = invoiceQuantitySchema;
const positiveQuantitySchema = quantitySchema.refine(
  (value) => compareDecimalStrings(value, "0") > 0,
  "La cantidad acreditada debe ser mayor que cero.",
);

const idSchema = (message: string) => z.string({ error: message }).min(1, message);

const expectedVersionSchema = z
  .number({ error: "La versión esperada es obligatoria." })
  .int("La versión esperada no es válida.")
  .min(1, "La versión esperada no es válida.");

/**
 * Línea del borrador por la posición de la línea de la factura (design D5). En una devolución lleva
 * la cantidad acreditada, mayor que cero; en una anulación total la cantidad es la original y no se
 * envía. El retorno físico va de 0 a la cantidad acreditada.
 */
export const creditNoteDraftLineSchema = strictBody({
  position: z
    .number({ error: "La línea de la factura es obligatoria." })
    .int("La línea de la factura no es válida.")
    .min(1, "La línea de la factura no es válida."),
  quantity: positiveQuantitySchema.optional(),
  physicalReturn: quantitySchema.default("0"),
});
export type CreditNoteDraftLineInput = z.input<typeof creditNoteDraftLineSchema>;

/** Máximo de líneas: el de la factura, porque cada línea se liga a una línea de la factura. */
export const CREDIT_NOTE_LINES_MAX = 1000;

type DraftLines = z.output<typeof creditNoteDraftLineSchema>[];

/** Líneas coherentes con la causa: sin repetidas, cantidad solo en devoluciones y retorno acotado. */
function checkLines(
  value: { cause: CreditNoteCause; lines: DraftLines },
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<number>();
  value.lines.forEach((line, index) => {
    if (seen.has(line.position)) {
      ctx.addIssue({
        code: "custom",
        message: "La misma línea de la factura aparece dos veces.",
        path: ["lines", index, "position"],
      });
    }
    seen.add(line.position);
    if (value.cause === "TOTAL_ANNULMENT" && line.quantity !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Una anulación total acredita las cantidades completas: no se eligen.",
        path: ["lines", index, "quantity"],
      });
    }
    if (value.cause === "RETURN" && line.quantity === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Indica la cantidad acreditada de la línea.",
        path: ["lines", index, "quantity"],
      });
    }
    if (
      line.quantity !== undefined &&
      compareDecimalStrings(line.physicalReturn, line.quantity) > 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "El retorno físico no puede superar la cantidad acreditada.",
        path: ["lines", index, "physicalReturn"],
      });
    }
  });
}

/** Un borrador puede guardarse sin motivo ni líneas; la emisión los exige. */
const draftShape = {
  emissionPointId: idSchema("El punto de emisión no es válido.")
    .nullish()
    .transform((value) => value ?? null),
  cause: creditNoteCauseSchema,
  reason: creditNoteReasonSchema.nullish().transform((value) => value ?? null),
  lines: z
    .array(creditNoteDraftLineSchema, { error: "Las líneas no son válidas." })
    .max(CREDIT_NOTE_LINES_MAX, `La nota admite como máximo ${CREDIT_NOTE_LINES_MAX} líneas.`)
    .default([]),
};

export const createCreditNoteDraftSchema = strictBody({
  invoiceId: idSchema("La factura es obligatoria."),
  ...draftShape,
}).superRefine(checkLines);
export type CreateCreditNoteDraftInput = z.input<typeof createCreditNoteDraftSchema>;
export type CreditNoteDraftData = z.output<typeof createCreditNoteDraftSchema>;

/** La factura del borrador no cambia: otra factura es otro borrador. */
export const updateCreditNoteDraftSchema = strictBody({
  ...draftShape,
  expectedVersion: expectedVersionSchema,
}).superRefine(checkLines);
export type UpdateCreditNoteDraftInput = z.input<typeof updateCreditNoteDraftSchema>;

export const creditNoteDraftIdParamsSchema = z.strictObject({ draftId: z.string().min(1) });
export const creditNoteIdParamsSchema = z.strictObject({ creditNoteId: z.string().min(1) });
export const creditInvoiceIdParamsSchema = z.strictObject({ invoiceId: z.string().min(1) });

/**
 * Declaraciones de elegibilidad (design D9): exclusiones oficiales que el sistema no puede
 * comprobar. La semántica son los identificadores y la versión; un cambio del texto es una versión
 * nueva. Son declaraciones del usuario, nunca una verificación del sistema.
 */
export const CREDIT_NOTE_DECLARATION_STATEMENTS = [
  "NOT_NEGOTIATED_COMMERCIAL_INVOICE",
  "NOT_TAX_REFUND_SUPPORT",
] as const;
export type CreditNoteDeclarationStatement = (typeof CREDIT_NOTE_DECLARATION_STATEMENTS)[number];

export const CREDIT_NOTE_ELIGIBILITY_DECLARATION = {
  version: 1,
  basis: "USER_DECLARED",
  notice:
    "Son declaraciones tuyas: el sistema no puede comprobarlas. Si alguna no es cierta, la norma no admite esta nota de crédito.",
  statements: [
    {
      id: "NOT_NEGOTIATED_COMMERCIAL_INVOICE",
      text: "Declaro que esta factura no es una factura comercial negociable que haya sido negociada.",
      context:
        "Una factura comercial negociable puede transferirse a un tercero como título valor. Si se negoció, la norma no admite una nota de crédito sobre ella.",
      source: "Res. NAC-DGERCGC25-00000014, disposición general segunda",
    },
    {
      id: "NOT_TAX_REFUND_SUPPORT",
      text: "Declaro que esta factura no sustentó una solicitud de devolución de impuestos.",
      context:
        "Si la factura se presentó al SRI como sustento de una devolución de impuestos, la norma no admite una nota de crédito sobre ella.",
      source: "Res. NAC-DGERCGC25-00000014, disposición general tercera",
    },
  ],
} as const satisfies {
  version: number;
  basis: "USER_DECLARED";
  notice: string;
  statements: readonly {
    id: CreditNoteDeclarationStatement;
    text: string;
    context: string;
    source: string;
  }[];
};

export const creditNoteDeclarationsSchema = z
  .strictObject(
    {
      version: z.literal(CREDIT_NOTE_ELIGIBILITY_DECLARATION.version, {
        error: "La declaración no es la vigente: vuelve a confirmarla.",
      }),
      statements: z.array(
        z.enum(CREDIT_NOTE_DECLARATION_STATEMENTS, { error: "La declaración no es válida." }),
        { error: "Las declaraciones no son válidas." },
      ),
    },
    { error: "Confirma las declaraciones de la nota de crédito." },
  )
  .refine(
    (value) =>
      value.statements.length === CREDIT_NOTE_DECLARATION_STATEMENTS.length &&
      CREDIT_NOTE_DECLARATION_STATEMENTS.every((id) => value.statements.includes(id)),
    { message: "Confirma por separado las dos declaraciones.", path: ["statements"] },
  );
export type CreditNoteDeclarationsInput = z.input<typeof creditNoteDeclarationsSchema>;

/** Emisión (design D5 y D11): la huella cubre el borrador, su versión y las declaraciones. */
export const emitCreditNoteSchema = strictBody({
  draftId: idSchema("El borrador es obligatorio."),
  expectedVersion: expectedVersionSchema,
  declarations: creditNoteDeclarationsSchema,
});
export type EmitCreditNoteInput = z.input<typeof emitCreditNoteSchema>;

/** Consultas: no son estrictas, de modo que un `companyId` se ignora. */
export const listCreditNoteDraftsQuerySchema = z.object({ ...pageParams });
export type ListCreditNoteDraftsQuery = z.output<typeof listCreditNoteDraftsQuerySchema>;

export const listCreditNotesQuerySchema = z.object({
  search: searchParam,
  state: invoiceStateSchema.optional(),
  cause: creditNoteCauseSchema.optional(),
  ...pageParams,
});
export type ListCreditNotesQuery = z.output<typeof listCreditNotesQuerySchema>;

/** Facturas elegibles: autorizadas, sin consumidor final y con capacidad, por número o comprador. */
export const listEligibleInvoicesQuerySchema = z.object({ search: searchParam, ...pageParams });
export type ListEligibleInvoicesQuery = z.output<typeof listEligibleInvoicesQuerySchema>;

/**
 * Rechazos de las notas de crédito (design D16). Cada uno es un `409`, salvo los de recurso
 * inexistente (`404`). La emisión informa el primero; la vista previa muestra todos.
 */
export const CREDIT_NOTE_ERROR_CODES = [
  "CREDIT_NOTE_NOT_FOUND",
  "CREDIT_NOTE_DRAFT_NOT_FOUND",
  "CREDIT_NOTE_INVOICE_NOT_FOUND",
  "CREDIT_NOTE_DRAFT_CHANGED",
  "CREDIT_NOTE_DRAFT_ALREADY_EMITTED",
  "CREDIT_NOTE_DRAFT_INCOMPLETE",
  "CREDIT_NOTE_INVOICE_NOT_ELIGIBLE",
  "CREDIT_NOTE_CONSUMER_FINAL",
  "CREDIT_NOTE_INVOICE_INTEGRITY",
  "CREDIT_NOTE_CAUSE_INVALID",
  "CREDIT_NOTE_REASON_REQUIRED",
  "CREDIT_NOTE_LINE_INVALID",
  "CREDIT_NOTE_QUANTITY_EXCEEDED",
  "CREDIT_NOTE_AMOUNT_EXCEEDED",
  "CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE",
  "CREDIT_NOTE_PHYSICAL_RETURN_INVALID",
  "CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED",
  "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE",
  "CREDIT_NOTE_DECLARATIONS_REQUIRED",
  "CREDIT_NOTE_NOT_RECONCILABLE",
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
export type CreditNoteErrorCode = (typeof CREDIT_NOTE_ERROR_CODES)[number];

const isoDate = z.iso.date();
const money = invoiceAmountSchema;
const stock = decimalString(DECIMAL_SPECS.existencia);

/** Problema del borrador o de la emisión, con la posición de la línea de la factura o null. */
export const creditNoteIssueSchema = z.strictObject({
  code: z.enum(CREDIT_NOTE_ERROR_CODES),
  message: z.string(),
  line: z.number().int().nullable(),
});
export type CreditNoteIssue = z.infer<typeof creditNoteIssueSchema>;

/** Totales de la nota: sin impuestos, impuestos por código y tarifa, y valor de la modificación. */
export const creditNoteTotalsViewSchema = z.strictObject({
  withoutTaxes: money,
  taxes: z.array(invoiceTaxViewSchema),
  total: money,
});
export type CreditNoteTotalsView = z.infer<typeof creditNoteTotalsViewSchema>;

/** Línea de la factura con sus importes originales, su capacidad acreditable y la devolvible. */
export const creditInvoiceLineViewSchema = z.strictObject({
  position: z.number().int(),
  productId: z.string(),
  mainCode: z.string().nullable(),
  description: z.string(),
  quantity: quantitySchema,
  unitPrice: decimalString(DECIMAL_SPECS.precioUnitario),
  discount: money,
  taxableBase: money,
  taxes: z.array(invoiceTaxViewSchema),
  /** En el snapshot de la factura; solo entonces admite retorno físico. */
  inventoryAffectsStock: z.boolean(),
  credited: z.strictObject({
    applied: quantitySchema,
    reserved: quantitySchema,
    available: quantitySchema,
  }),
  /** Por producto: lo que la salida de la factura sacó del inventario. `null` sin retorno posible. */
  returnable: z
    .strictObject({ original: stock, applied: stock, reserved: stock, available: stock })
    .nullable(),
});
export type CreditInvoiceLineView = z.infer<typeof creditInvoiceLineViewSchema>;

/** Crédito de una factura (design D16): aplicado, reservado, disponible y por línea. */
export const invoiceCreditViewSchema = z.strictObject({
  invoiceId: z.string(),
  documentNumber: z.string(),
  issueDate: isoDate,
  buyerIdentification: z.string(),
  buyerName: z.string(),
  consumerFinal: z.boolean(),
  total: money,
  applied: money,
  reserved: money,
  available: money,
  /** Sin ningún crédito reservado ni aplicado. */
  totalAnnulmentAvailable: z.boolean(),
  lines: z.array(creditInvoiceLineViewSchema),
});
export type InvoiceCreditView = z.infer<typeof invoiceCreditViewSchema>;

export const eligibleInvoiceViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  issueDate: isoDate,
  buyerIdentification: z.string(),
  buyerName: z.string(),
  total: money,
  available: money,
});
export type EligibleInvoiceView = z.infer<typeof eligibleInvoiceViewSchema>;

/** Línea calculada de la nota, con lo que queda de la línea después de ella. */
export const creditNotePreviewLineSchema = z.strictObject({
  position: z.number().int(),
  mainCode: z.string().nullable(),
  description: z.string(),
  quantity: quantitySchema,
  unitPrice: decimalString(DECIMAL_SPECS.precioUnitario),
  discount: money,
  taxableBase: money,
  taxes: z.array(invoiceTaxViewSchema),
  physicalReturn: quantitySchema,
  physicalReturnAllowed: z.boolean(),
  /** Cantidad acreditable de la línea que queda si se emite esta nota. */
  remainingQuantity: quantitySchema,
});
export type CreditNotePreviewLine = z.infer<typeof creditNotePreviewLineSchema>;

/** Vista previa del servidor con la capacidad vigente; no reserva nada (design D5). */
export const creditNotePreviewViewSchema = z.strictObject({
  evaluatedOn: isoDate,
  lines: z.array(creditNotePreviewLineSchema),
  /** `null` mientras la nota no pueda calcularse. */
  totals: creditNoteTotalsViewSchema.nullable(),
  issues: z.array(creditNoteIssueSchema),
});
export type CreditNotePreviewView = z.infer<typeof creditNotePreviewViewSchema>;

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

export const creditNoteDraftViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  invoice: modifiedInvoiceSchema.extend({
    buyerIdentification: z.string(),
    buyerName: z.string(),
    total: money,
  }),
  emissionPoint: emissionPointViewSchema.nullable(),
  cause: creditNoteCauseSchema,
  reason: z.string().nullable(),
  lines: z.array(
    z.strictObject({
      position: z.number().int(),
      quantity: quantitySchema,
      physicalReturn: quantitySchema,
    }),
  ),
  preview: creditNotePreviewViewSchema,
  createdAt: z.iso.datetime(),
  createdBy: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string(),
});
export type CreditNoteDraftView = z.infer<typeof creditNoteDraftViewSchema>;

export const creditNoteDraftSummaryViewSchema = z.strictObject({
  id: z.string(),
  version: z.number().int(),
  invoice: modifiedInvoiceSchema,
  cause: creditNoteCauseSchema,
  buyerName: z.string(),
  lineCount: z.number().int(),
  /** Valor de la vista previa, o `null` si todavía no puede calcularse. */
  previewTotal: money.nullable(),
  updatedAt: z.iso.datetime(),
});
export type CreditNoteDraftSummaryView = z.infer<typeof creditNoteDraftSummaryViewSchema>;

/** Declaraciones tal como las guarda la nota: declaradas por el usuario, nunca verificadas. */
export const creditNoteDeclarationsViewSchema = z.strictObject({
  version: z.number().int(),
  statements: z.array(
    z.strictObject({
      id: z.enum(CREDIT_NOTE_DECLARATION_STATEMENTS),
      text: z.string(),
      source: z.string(),
    }),
  ),
  basis: z.literal("USER_DECLARED"),
  declaredBy: z.string(),
  declaredByName: z.string().nullable(),
  declaredAt: z.iso.datetime(),
});
export type CreditNoteDeclarationsView = z.infer<typeof creditNoteDeclarationsViewSchema>;

/** Nota de crédito desde su snapshot: lo que se emitió, sin releer la factura ni los catálogos. */
export const creditNoteViewSchema = z.strictObject({
  id: z.string(),
  documentType: documentTypeSchema,
  environment: environmentSchema,
  documentNumber: z.string(),
  accessKey: z.string(),
  issueDate: isoDate,
  state: invoiceStateSchema,
  cause: creditNoteCauseSchema,
  reason: z.string(),
  invoice: modifiedInvoiceSchema.extend({ accessKey: z.string() }),
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
  lines: z.array(
    z.strictObject({
      /** Posición de la línea en la factura. */
      position: z.number().int(),
      mainCode: z.string().nullable(),
      auxiliaryCode: z.string().nullable(),
      description: z.string(),
      quantity: quantitySchema,
      unitPrice: decimalString(DECIMAL_SPECS.precioUnitario),
      discount: money,
      taxableBase: money,
      taxes: z.array(invoiceTaxViewSchema),
      physicalReturn: quantitySchema,
    }),
  ),
  totals: creditNoteTotalsViewSchema,
  declarations: creditNoteDeclarationsViewSchema,
  diagnostic: signingDiagnosticViewSchema.nullable(),
  artifact: z.strictObject({ sha256: z.string(), sizeBytes: z.number().int() }).nullable(),
  authorizedArtifact: z
    .strictObject({ sha256: z.string(), sizeBytes: z.number().int() })
    .nullable(),
  transmission: invoiceTransmissionSummarySchema,
  createdAt: z.iso.datetime(),
  signedAt: z.iso.datetime().nullable(),
});
export type CreditNoteView = z.infer<typeof creditNoteViewSchema>;

export const creditNoteSummaryViewSchema = z.strictObject({
  id: z.string(),
  documentNumber: z.string(),
  environment: environmentSchema,
  issueDate: isoDate,
  invoice: z.strictObject({ id: z.string(), documentNumber: z.string() }),
  cause: creditNoteCauseSchema,
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
export type CreditNoteSummaryView = z.infer<typeof creditNoteSummaryViewSchema>;

export const creditNoteTransmissionViewSchema = z.strictObject({
  creditNoteId: z.string(),
  state: invoiceStateSchema,
  events: z.array(transmissionEventViewSchema),
  total: z.number().int().nonnegative(),
});
export type CreditNoteTransmissionView = z.infer<typeof creditNoteTransmissionViewSchema>;

export const creditNoteListMetaSchema = listMetaSchema;
