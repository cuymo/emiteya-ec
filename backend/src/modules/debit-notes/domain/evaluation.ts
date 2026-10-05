// Evaluación de una nota de débito antes de reservar (add-debit-notes, design D4 a D10): una función
// pura de los datos ya leídos. Devuelve todos los problemas en el orden de D4 (estado, integridad,
// ambiente, consumidor final, conceptos, forma de pago, declaración, preparación de la empresa y
// cálculo) y el resultado de `calculateDebitNoteAmounts`. La vista previa del borrador muestra
// todos; la emisión rechaza con el primero. No lee base de datos, catálogos ni reloj: la forma de
// pago llega ya resuelta por el resolver de `catalogs`.
import {
  DEBIT_NOTE_CAUSES,
  DEBIT_NOTE_CONCEPTS_MAX,
  DEBIT_NOTE_DECLARATION_STATEMENTS,
  DEBIT_NOTE_DESCRIPTION_MAX,
  DEBIT_NOTE_ELIGIBILITY_DECLARATION,
  compareDecimalStrings,
  type DebitNoteCause,
  type DebitNoteErrorCode,
  type DebitNoteIssue,
} from "@facturador/contracts";
import {
  DebitNoteAmountError,
  calculateDebitNoteAmounts,
  isConceptAmount,
  type DebitNoteAmounts,
} from "./amounts.ts";
import type { DebitNoteDraftConcept } from "./draft.ts";
import type { InvoiceTaxTreatment } from "./treatments.ts";

type Environment = "TEST" | "PRODUCTION";

/** Factura modificada: su estado, su integridad, su ambiente y sus tratamientos de IVA (D3, D6). */
export type DebitInvoice = Readonly<{
  state: string;
  /** El snapshot y los artefactos fiscales coinciden con lo guardado (design D3). */
  intact: boolean;
  consumerFinal: boolean;
  environment: Environment;
  treatments: readonly InvoiceTaxTreatment[];
}>;

/**
 * La forma de pago elegida tal como la resolvió el catálogo en la fecha de la reserva (design D8):
 * `null` si el borrador no tiene forma de pago; `usable` false si la entrada no existe, no tiene
 * versión vigente o está deshabilitada para la empresa.
 */
export type ResolvedPaymentMethod = Readonly<{
  entryKey: string;
  usable: boolean;
  /** Solo si es utilizable: el código, la versión y la denominación vigentes. */
  version: Readonly<{
    code: string;
    versionId: string;
    datasetVersion: number;
    officialLabel: string;
  }> | null;
}>;

/** La única forma de pago de la nota, con su total igual al valor total (design D8). */
export type DebitNotePayment = Readonly<{
  entryKey: string;
  code: string;
  catalogType: "payment-method";
  versionId: string;
  datasetVersion: number;
  officialLabel: string;
  amount: string;
}>;

export type DebitNoteRequest = Readonly<{
  concepts: readonly DebitNoteDraftConcept[];
  payment: ResolvedPaymentMethod | null;
  /** Solo en la emisión; `undefined` en la vista previa. */
  declarations?: Readonly<{ version: number; statements: readonly string[] }>;
}>;

export type DebitNoteEvaluationInput = Readonly<{
  invoice: DebitInvoice;
  /** El ambiente en que la empresa emite, o null sin configuración (la preparación lo informa). */
  companyEnvironment: Environment | null;
  request: DebitNoteRequest;
  /** Problemas de la preparación de la empresa, del punto, de la firma y del esquema (D4). */
  readiness?: readonly DebitNoteIssue[];
}>;

/** Concepto completo y válido, con su posición en la nota desde 1. */
export type ResolvedConcept = Readonly<{
  position: number;
  cause: DebitNoteCause;
  description: string;
  amount: string;
  taxTreatment: string;
}>;

export type DebitNoteEvaluation = Readonly<{
  issues: readonly DebitNoteIssue[];
  /** Los conceptos completos y válidos; si alguno no lo es, el cálculo no se hace. */
  concepts: readonly ResolvedConcept[];
  /** El resultado del cálculo único, o `null` si la nota no llega a calcularse. */
  amounts: DebitNoteAmounts | null;
  /** La forma de pago con su total, o `null` si falta, no es utilizable o no hay cálculo. */
  payment: DebitNotePayment | null;
}>;

const ENVIRONMENT_LABELS = { TEST: "pruebas", PRODUCTION: "producción" } as const;

const issue = (
  code: DebitNoteErrorCode,
  message: string,
  concept: number | null = null,
): DebitNoteIssue => ({ code, message, concept });

const isCause = (value: string): value is DebitNoteCause =>
  (DEBIT_NOTE_CAUSES as readonly string[]).includes(value);

const isDescription = (value: string) =>
  value.trim().length > 0 && value.length <= DEBIT_NOTE_DESCRIPTION_MAX && !/[\r\n]/.test(value);

/** La forma de pago cubre exactamente el valor total, con decimal exacto y sin tolerancia (D8). */
export const paymentCoversTotal = (payment: Readonly<{ amount: string }>, total: string) =>
  compareDecimalStrings(payment.amount, total) === 0;

function conceptIssues(
  concepts: readonly DebitNoteDraftConcept[],
  treatments: ReadonlySet<string>,
): { issues: DebitNoteIssue[]; resolved: ResolvedConcept[] } {
  const issues: DebitNoteIssue[] = [];
  const resolved: ResolvedConcept[] = [];
  if (concepts.length === 0) {
    issues.push(
      issue(
        "DEBIT_NOTE_CONCEPTS_REQUIRED",
        "Agrega al menos un concepto: su causa, su descripción, su importe y su tratamiento de IVA.",
      ),
    );
  }
  if (concepts.length > DEBIT_NOTE_CONCEPTS_MAX) {
    issues.push(
      issue(
        "DEBIT_NOTE_CONCEPTS_TOO_MANY",
        `La nota admite como máximo ${DEBIT_NOTE_CONCEPTS_MAX} conceptos.`,
      ),
    );
  }
  concepts.forEach((concept, index) => {
    const position = index + 1;
    const before = issues.length;
    if (concept.cause === null) {
      issues.push(issue("DEBIT_NOTE_DRAFT_INCOMPLETE", "Elige la causa del concepto.", position));
    } else if (!isCause(concept.cause)) {
      issues.push(
        issue(
          "DEBIT_NOTE_CONCEPT_INVALID",
          "La causa debe ser intereses de mora o costos o gastos posteriores a la factura.",
          position,
        ),
      );
    }
    if (concept.description === null) {
      issues.push(issue("DEBIT_NOTE_DRAFT_INCOMPLETE", "Describe el concepto.", position));
    } else if (!isDescription(concept.description)) {
      issues.push(
        issue(
          "DEBIT_NOTE_CONCEPT_INVALID",
          `La descripción debe tener una línea de hasta ${DEBIT_NOTE_DESCRIPTION_MAX} caracteres.`,
          position,
        ),
      );
    }
    if (concept.amount === null) {
      issues.push(
        issue("DEBIT_NOTE_DRAFT_INCOMPLETE", "Indica el importe del concepto.", position),
      );
    } else if (!isConceptAmount(concept.amount)) {
      issues.push(
        issue(
          "DEBIT_NOTE_CONCEPT_INVALID",
          "El importe del concepto debe ser mayor que cero, con hasta dos decimales.",
          position,
        ),
      );
    }
    if (concept.taxTreatment === null) {
      issues.push(
        issue("DEBIT_NOTE_DRAFT_INCOMPLETE", "Elige el tratamiento de IVA del concepto.", position),
      );
    } else if (!treatments.has(concept.taxTreatment)) {
      issues.push(
        issue(
          "DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE",
          "El tratamiento de IVA no está en la factura: elige uno de los tratamientos de la factura.",
          position,
        ),
      );
    }
    if (issues.length === before) {
      resolved.push({
        position,
        cause: concept.cause as DebitNoteCause,
        description: concept.description!,
        amount: concept.amount!,
        taxTreatment: concept.taxTreatment!,
      });
    }
  });
  return { issues, resolved };
}

function paymentIssue(payment: ResolvedPaymentMethod | null): DebitNoteIssue | null {
  if (payment === null) {
    return issue("DEBIT_NOTE_DRAFT_INCOMPLETE", "Elige la forma de pago de la nota de débito.");
  }
  if (!payment.usable || payment.version === null) {
    return issue(
      "DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE",
      `La forma de pago ${payment.entryKey} no está vigente o no está habilitada para tu empresa en la fecha de emisión.`,
    );
  }
  return null;
}

function declarationIssue(declarations: DebitNoteRequest["declarations"]): DebitNoteIssue | null {
  if (declarations === undefined) return null;
  const complete =
    declarations.version === DEBIT_NOTE_ELIGIBILITY_DECLARATION.version &&
    declarations.statements.length === DEBIT_NOTE_DECLARATION_STATEMENTS.length &&
    DEBIT_NOTE_DECLARATION_STATEMENTS.every((id) => declarations.statements.includes(id));
  return complete
    ? null
    : issue(
        "DEBIT_NOTE_DECLARATION_REQUIRED",
        "Confirma la declaración vigente sobre la factura comercial negociable.",
      );
}

export function evaluateDebitNote(input: DebitNoteEvaluationInput): DebitNoteEvaluation {
  const { invoice, request } = input;
  const none = { concepts: [], amounts: null, payment: null } as const;
  // 1 y 2. Estado e integridad: sin ellos, nada más se evalúa.
  if (invoice.state !== "AUTHORIZED") {
    return {
      ...none,
      issues: [
        issue(
          "DEBIT_NOTE_INVOICE_NOT_ELIGIBLE",
          "Solo una factura autorizada admite nota de débito.",
        ),
      ],
    };
  }
  if (!invoice.intact) {
    return {
      ...none,
      issues: [
        issue(
          "DEBIT_NOTE_INVOICE_INTEGRITY",
          "El snapshot o los XML guardados de la factura no son íntegros: no se puede emitir una nota de débito.",
        ),
      ],
    };
  }
  const issues: DebitNoteIssue[] = [];
  // 3. Mismo ambiente que la configuración vigente.
  if (input.companyEnvironment !== null && input.companyEnvironment !== invoice.environment) {
    issues.push(
      issue(
        "DEBIT_NOTE_INVOICE_NOT_ELIGIBLE",
        `La factura es del ambiente de ${ENVIRONMENT_LABELS[invoice.environment]} y la empresa emite en ${ENVIRONMENT_LABELS[input.companyEnvironment]}: la nota de débito debe ser del mismo ambiente.`,
      ),
    );
  }
  // 4. Consumidor final: política del proyecto (BR-32), que ninguna declaración evita.
  if (invoice.consumerFinal) {
    issues.push(
      issue(
        "DEBIT_NOTE_CONSUMER_FINAL",
        "Por política del sistema, una nota de débito exige un comprador identificado: una factura emitida a consumidor final no la admite.",
      ),
    );
    return { ...none, issues };
  }
  // 5. Conceptos: causa, descripción, importe y tratamiento de la factura.
  const treatments = new Set(invoice.treatments.map((treatment) => treatment.key));
  const concepts = conceptIssues(request.concepts, treatments);
  issues.push(...concepts.issues);
  // 6. Exactamente una forma de pago, vigente y habilitada.
  const payment = paymentIssue(request.payment);
  if (payment) issues.push(payment);
  // 7. Declaración (solo en la emisión).
  const declaration = declarationIssue(request.declarations);
  if (declaration) issues.push(declaration);
  // 8. Preparación de la empresa, del punto, de la firma y del esquema.
  issues.push(...(input.readiness ?? []));
  // 9. Cálculo único, si todos los conceptos son válidos, y el total de la forma de pago.
  let amounts: DebitNoteAmounts | null = null;
  if (concepts.issues.length === 0 && concepts.resolved.length > 0) {
    try {
      amounts = calculateDebitNoteAmounts({
        concepts: concepts.resolved,
        treatments: invoice.treatments,
      });
    } catch (error) {
      if (!(error instanceof DebitNoteAmountError)) throw error;
      issues.push(
        issue(
          "DEBIT_NOTE_AMOUNT_OUT_OF_RANGE",
          "Los importes de la nota exceden los dígitos que admite el comprobante.",
          error.concept,
        ),
      );
    }
  }
  let resolvedPayment: DebitNotePayment | null = null;
  const version = request.payment?.usable ? request.payment.version : null;
  if (amounts && request.payment && version) {
    resolvedPayment = {
      entryKey: request.payment.entryKey,
      code: version.code,
      catalogType: "payment-method",
      versionId: version.versionId,
      datasetVersion: version.datasetVersion,
      officialLabel: version.officialLabel,
      amount: amounts.total,
    };
    if (!paymentCoversTotal(resolvedPayment, amounts.total)) {
      issues.push(
        issue(
          "DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH",
          "El total de la forma de pago no es el valor total de la nota.",
        ),
      );
      resolvedPayment = null;
    }
  }
  return { issues, concepts: concepts.resolved, amounts, payment: resolvedPayment };
}
