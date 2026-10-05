// Evaluación de una nota de crédito antes de reservar (add-credit-notes, design D4, D5, D9 y D10):
// una función pura de los datos ya leídos. Devuelve todos los problemas en el orden de D4 (estado,
// integridad, consumidor final, causa, motivo, líneas, retorno físico, declaraciones, preparación
// de la empresa y capacidades) y los importes de `calculateCreditNoteAmounts`. La vista previa del
// borrador muestra todos; la emisión rechaza con el primero. No lee base de datos ni reloj.
import {
  CREDIT_NOTE_CAUSES,
  CREDIT_NOTE_DECLARATION_STATEMENTS,
  CREDIT_NOTE_ELIGIBILITY_DECLARATION,
  CREDIT_NOTE_REASON_MAX,
  DECIMAL_SPECS,
  compareDecimalStrings,
  decimalSpecViolation,
  type CreditNoteCause,
  type CreditNoteErrorCode,
  type CreditNoteIssue,
} from "@facturador/contracts";
import { subtractExact, sumExact } from "../../../platform/decimal/fiscal-decimal.ts";
import {
  calculateCreditNoteAmounts,
  type CreditableLine,
  type CreditedLine,
  type CreditNoteAmountIssue,
  type CreditNoteAmounts,
} from "./amounts.ts";

/** Línea de la factura modificada tal como la lee la nota desde su snapshot (design D3). */
export type CreditInvoiceLine = CreditableLine &
  Readonly<{
    productId: string;
    mainCode: string | null;
    auxiliaryCode: string | null;
    description: string;
    /** La decisión de inventario de la línea al reservar la factura; nunca la vigente. */
    inventoryAffectsStock: boolean;
  }>;

/** Factura modificada: su estado, su integridad y lo que la nota necesita de su snapshot. */
export type CreditInvoice = Readonly<{
  state: string;
  /** El snapshot y los artefactos fiscales coinciden con lo guardado (design D3). */
  intact: boolean;
  consumerFinal: boolean;
  total: string;
  lines: readonly CreditInvoiceLine[];
}>;

/** Capacidad acreditable vigente: lo reservado y aplicado por las notas vigentes y sus líneas. */
export type CreditState = Readonly<{
  reserved: string;
  applied: string;
  credited: readonly CreditedLine[];
}>;

/** Retorno físico disponible por producto: salida original menos lo aplicado y reservado. */
export type ReturnableByProduct = ReadonlyMap<string, string>;

export type CreditNoteRequest = Readonly<{
  cause: string;
  reason: string | null;
  /** En una devolución, cantidad acreditada; en una anulación total, solo el retorno físico. */
  lines: readonly Readonly<{ position: number; quantity?: string; physicalReturn: string }>[];
  /** Solo en la emisión; `undefined` en la vista previa. */
  declarations?: Readonly<{ version: number; statements: readonly string[] }>;
}>;

export type CreditNoteEvaluationInput = Readonly<{
  invoice: CreditInvoice;
  credit: CreditState;
  returnable: ReturnableByProduct;
  request: CreditNoteRequest;
  /** Problemas de la preparación de la empresa, del punto, de la firma y del esquema (D4). */
  readiness?: readonly CreditNoteIssue[];
}>;

/** Línea pedida y resuelta: la cantidad acreditada y el retorno físico declarado. */
export type ResolvedLine = Readonly<{ position: number; quantity: string; physicalReturn: string }>;

export type CreditNoteEvaluation = Readonly<{
  issues: readonly CreditNoteIssue[];
  /** Las líneas pedidas con su cantidad acreditada (en una anulación total, la original). */
  lines: readonly ResolvedLine[];
  /** El resultado del cálculo único, o `null` si la nota no llega a calcularse. */
  amounts: CreditNoteAmounts | null;
}>;

const issue = (
  code: CreditNoteErrorCode,
  message: string,
  line: number | null = null,
): CreditNoteIssue => ({ code, message, line });

const isCause = (value: string): value is CreditNoteCause =>
  (CREDIT_NOTE_CAUSES as readonly string[]).includes(value);

const isQuantity = (value: string) => decimalSpecViolation(value, DECIMAL_SPECS.cantidad) === null;

function amountIssue(found: CreditNoteAmountIssue): CreditNoteIssue {
  switch (found.code) {
    case "CREDIT_NOTE_QUANTITY_EXCEEDED":
      return issue(
        found.code,
        `La cantidad supera lo acreditable de la línea: quedan ${found.remaining ?? "0"}.`,
        found.line,
      );
    case "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE":
      return issue(
        found.code,
        "Con esa cantidad, un importe de la línea sería negativo: acredita una cantidad mayor.",
        found.line,
      );
    case "CREDIT_NOTE_AMOUNT_EXCEEDED":
      return issue(found.code, "El crédito acumulado superaría el total de la factura.");
    case "CREDIT_NOTE_LINE_INVALID":
      return issue(
        found.code,
        "La línea no es una línea de la factura o su cantidad no es válida.",
        found.line,
      );
  }
}

/** Las condiciones de la factura que la nota no puede pasar por alto (design D4). */
function invoiceIssues(invoice: CreditInvoice): CreditNoteIssue[] {
  if (invoice.state !== "AUTHORIZED") {
    return [
      issue(
        "CREDIT_NOTE_INVOICE_NOT_ELIGIBLE",
        "Solo una factura autorizada admite nota de crédito.",
      ),
    ];
  }
  if (!invoice.intact) {
    return [
      issue(
        "CREDIT_NOTE_INVOICE_INTEGRITY",
        "El snapshot o los XML guardados de la factura no son íntegros: no se puede emitir una nota de crédito.",
      ),
    ];
  }
  if (invoice.consumerFinal) {
    return [
      issue(
        "CREDIT_NOTE_CONSUMER_FINAL",
        "Una factura emitida a consumidor final no admite nota de crédito (Res. NAC-DGERCGC25-00000014, art. 3).",
      ),
    ];
  }
  return [];
}

function reasonIssue(reason: string | null): CreditNoteIssue | null {
  const valid =
    reason !== null &&
    reason.trim().length > 0 &&
    reason.length <= CREDIT_NOTE_REASON_MAX &&
    !/[\r\n]/.test(reason);
  return valid
    ? null
    : issue(
        "CREDIT_NOTE_REASON_REQUIRED",
        `Indica el motivo de la nota de crédito, en una línea de hasta ${CREDIT_NOTE_REASON_MAX} caracteres.`,
      );
}

function declarationsIssue(
  declarations: CreditNoteRequest["declarations"],
): CreditNoteIssue | null {
  if (declarations === undefined) return null;
  const complete =
    declarations.version === CREDIT_NOTE_ELIGIBILITY_DECLARATION.version &&
    declarations.statements.length === CREDIT_NOTE_DECLARATION_STATEMENTS.length &&
    CREDIT_NOTE_DECLARATION_STATEMENTS.every((id) => declarations.statements.includes(id));
  return complete
    ? null
    : issue(
        "CREDIT_NOTE_DECLARATIONS_REQUIRED",
        "Confirma por separado las dos declaraciones de la versión vigente.",
      );
}

export function evaluateCreditNote(input: CreditNoteEvaluationInput): CreditNoteEvaluation {
  const { invoice, credit, request } = input;
  // 1 a 3. Estado, integridad y consumidor final: sin ellos, nada más se evalúa.
  const blocking = invoiceIssues(invoice);
  if (blocking.length > 0) return { issues: blocking, lines: [], amounts: null };

  // 4. Causa cerrada.
  if (!isCause(request.cause)) {
    return {
      issues: [
        issue("CREDIT_NOTE_CAUSE_INVALID", "La causa debe ser anulación total o devolución."),
      ],
      lines: [],
      amounts: null,
    };
  }
  const issues: CreditNoteIssue[] = [];
  // 5. Motivo.
  const reason = reasonIssue(request.reason);
  if (reason) issues.push(reason);

  // 6. Líneas y cantidades.
  const byPosition = new Map(invoice.lines.map((line) => [line.position, line]));
  const seen = new Set<number>();
  const lines: ResolvedLine[] = [];
  const annulment = request.cause === "TOTAL_ANNULMENT";
  let annulmentAvailable = true;
  if (annulment) {
    const credited = sumExact([credit.reserved, credit.applied]);
    if (compareDecimalStrings(credited, "0") !== 0 || credit.credited.length > 0) {
      annulmentAvailable = false;
      issues.push(
        issue(
          "CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE",
          "La factura ya tiene créditos reservados o aplicados: la anulación total no procede.",
        ),
      );
    }
    const returns = new Map<number, string>();
    for (const line of request.lines) {
      if (
        !byPosition.has(line.position) ||
        seen.has(line.position) ||
        line.quantity !== undefined
      ) {
        issues.push(
          issue(
            "CREDIT_NOTE_LINE_INVALID",
            "Una anulación total acredita las líneas completas.",
            line.position,
          ),
        );
      }
      seen.add(line.position);
      returns.set(line.position, line.physicalReturn);
    }
    for (const line of invoice.lines) {
      lines.push({
        position: line.position,
        quantity: line.quantity,
        physicalReturn: returns.get(line.position) ?? "0",
      });
    }
  } else {
    if (request.lines.length === 0) {
      issues.push(
        issue("CREDIT_NOTE_LINE_INVALID", "Elige al menos una línea de la factura para devolver."),
      );
    }
    for (const line of request.lines) {
      const valid =
        byPosition.has(line.position) &&
        !seen.has(line.position) &&
        line.quantity !== undefined &&
        isQuantity(line.quantity) &&
        compareDecimalStrings(line.quantity, "0") > 0;
      seen.add(line.position);
      if (!valid) {
        issues.push(
          issue(
            "CREDIT_NOTE_LINE_INVALID",
            "La línea no es una línea de la factura, se repite o su cantidad no es mayor que cero.",
            line.position,
          ),
        );
        continue;
      }
      lines.push({
        position: line.position,
        quantity: line.quantity,
        physicalReturn: line.physicalReturn,
      });
    }
  }

  // 7. Retorno físico por línea, y por producto contra la salida original (independiente de la
  // capacidad acreditable, design D7 y D10).
  const requestedReturns = new Map<string, string>();
  for (const line of lines) {
    const original = byPosition.get(line.position);
    if (!original) continue;
    const positive =
      isQuantity(line.physicalReturn) && compareDecimalStrings(line.physicalReturn, "0") > 0;
    if (
      !isQuantity(line.physicalReturn) ||
      compareDecimalStrings(line.physicalReturn, line.quantity) > 0
    ) {
      issues.push(
        issue(
          "CREDIT_NOTE_PHYSICAL_RETURN_INVALID",
          "El retorno físico debe estar entre cero y la cantidad acreditada.",
          line.position,
        ),
      );
      continue;
    }
    if (positive && !original.inventoryAffectsStock) {
      issues.push(
        issue(
          "CREDIT_NOTE_PHYSICAL_RETURN_INVALID",
          "La línea no afectaba al inventario en la factura: su retorno físico es cero.",
          line.position,
        ),
      );
      continue;
    }
    if (positive) {
      requestedReturns.set(
        original.productId,
        sumExact([requestedReturns.get(original.productId) ?? "0", line.physicalReturn]),
      );
    }
  }
  for (const [productId, requested] of requestedReturns) {
    const available = input.returnable.get(productId) ?? "0";
    if (compareDecimalStrings(requested, available) > 0) {
      const line = lines.find(
        (candidate) =>
          byPosition.get(candidate.position)?.productId === productId &&
          compareDecimalStrings(candidate.physicalReturn, "0") > 0,
      );
      issues.push(
        issue(
          "CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED",
          `El retorno físico supera lo que la factura sacó del inventario: quedan ${available} por devolver.`,
          line?.position ?? null,
        ),
      );
    }
  }

  // 8. Declaraciones (solo en la emisión).
  const declarations = declarationsIssue(request.declarations);
  if (declarations) issues.push(declarations);

  // 9. Preparación de la empresa, del punto, de la firma y del esquema.
  issues.push(...(input.readiness ?? []));

  // 10. Cálculo único y capacidad acreditable; una anulación total que no procede no se calcula.
  const calculable = lines.filter((line) => byPosition.has(line.position));
  const amounts =
    calculable.length > 0 && annulmentAvailable
      ? calculateCreditNoteAmounts({
          invoiceLines: invoice.lines,
          credited: credit.credited,
          requested: calculable.map(({ position, quantity }) => ({ position, quantity })),
          invoice: { total: invoice.total, reserved: credit.reserved, applied: credit.applied },
        })
      : null;
  if (amounts) issues.push(...amounts.issues.map(amountIssue));
  return { issues, lines, amounts };
}

/** Retorno físico disponible de un producto desde su capacidad: original − aplicado − reservado. */
export const availableReturn = (original: string, applied: string, reserved: string): string =>
  subtractExact(subtractExact(original, applied), reserved);
