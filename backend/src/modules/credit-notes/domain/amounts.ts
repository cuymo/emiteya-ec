// Cálculo único de los importes de una nota de crédito (add-credit-notes, design D6): la única
// primitiva fiscal de la nota, versionada. La vista previa, la emisión (que congela su resultado en
// el snapshot), la comprobación de la capacidad y la pantalla usan su resultado; el builder del XML
// solo lo transcribe y el frontend solo lo muestra.
//
// Método de objetivos acumulados: para una cantidad acumulada C de una línea (lo acreditado vigente
// más lo pedido), los objetivos son
//   sub(C)   = C × p                                   (exacto)
//   disc(C)  = min(D, round(D × C / Q))
//   base(C)  = min(B, round(sub(C) − disc(C)))
//   tax_i(C) = min(T_i, round(base(C) × pct_i / 100))
// con round = HALF_UP a 2 decimales, y en C = Q cada objetivo es exactamente el original. Cada
// importe de la nota es su objetivo menos la suma de las notas vigentes de la línea (reservadas y
// aplicadas): la suma de las notas vigentes es siempre el objetivo acumulado y la nota que completa
// la línea toma exactamente el remanente, aunque una nota anterior se haya liberado. No hay
// ajustes de centavos ni líneas de redondeo. Sin `number`: todo es `DecimalString` exacto.
import { DECIMAL_SPECS, compareDecimalStrings, decimalSpecViolation } from "@facturador/contracts";
import {
  divideRoundHalfUp,
  multiplyExact,
  percentageOfExact,
  roundHalfUp,
  subtractExact,
  sumExact,
} from "../../../platform/decimal/fiscal-decimal.ts";

/** Versión del cálculo: cambia con cualquier cambio de sus resultados para la misma entrada. */
export const CREDIT_NOTE_CALCULATION_VERSION = 1;

const MONEY_SCALE = DECIMAL_SPECS.importe.fractionDigits;

/** Impuesto original de una línea de la factura. */
export type CreditableTax = Readonly<{
  taxCode: string;
  rateCode: string;
  percentage: string;
  /** `T_i`: el impuesto materializado de la línea en la factura. */
  amount: string;
}>;

/** Estado fiscal inmutable de una línea de la factura, tal como lo guarda su snapshot. */
export type CreditableLine = Readonly<{
  position: number;
  /** `Q`, `p`, `S` (exacto), `D` y `B`. */
  quantity: string;
  unitPrice: string;
  subtotal: string;
  discount: string;
  taxableBase: string;
  taxes: readonly CreditableTax[];
}>;

/** Una línea de una nota vigente (reservada o aplicada) sobre la factura. */
export type CreditedLine = Readonly<{
  position: number;
  quantity: string;
  subtotal: string;
  discount: string;
  taxableBase: string;
  taxes: readonly Readonly<{ taxCode: string; rateCode: string; amount: string }>[];
}>;

export type CreditRequestLine = Readonly<{ position: number; quantity: string }>;

export type CreditNoteAmountsInput = Readonly<{
  /** Todas las líneas de la factura. */
  invoiceLines: readonly CreditableLine[];
  /** Las líneas de las notas vigentes de la factura; las liberadas no cuentan. */
  credited: readonly CreditedLine[];
  /** Cantidades pedidas por la nota, una por línea de la factura como mucho. */
  requested: readonly CreditRequestLine[];
  /** Capacidad de la factura: su total y lo reservado y aplicado por las notas vigentes. */
  invoice: Readonly<{ total: string; reserved: string; applied: string }>;
}>;

export type CreditNoteLineTax = Readonly<{
  taxCode: string;
  rateCode: string;
  percentage: string;
  /** La base del impuesto es la base de la línea de la nota. */
  base: string;
  amount: string;
}>;

export type CreditNoteLineAmounts = Readonly<{
  position: number;
  quantity: string;
  unitPrice: string;
  /** Subtotal exacto acreditado; no es un campo del XML. */
  subtotal: string;
  discount: string;
  taxableBase: string;
  taxes: readonly CreditNoteLineTax[];
}>;

export type CreditNoteTotals = Readonly<{
  withoutTaxes: string;
  discount: string;
  taxes: readonly Readonly<{
    taxCode: string;
    rateCode: string;
    percentage: string;
    base: string;
    amount: string;
  }>[];
  /** `valorModificacion`. */
  total: string;
}>;

/** Capacidad acreditable de una línea antes y después de la nota. */
export type LineCapacity = Readonly<{
  position: number;
  original: string;
  /** Acreditado vigente antes de la nota. */
  credited: string;
  /** Acreditado vigente si se emite la nota. */
  after: string;
  /** Cantidad acreditable que queda si se emite la nota. */
  remaining: string;
}>;

export type CreditNoteAmountIssueCode =
  | "CREDIT_NOTE_LINE_INVALID"
  | "CREDIT_NOTE_QUANTITY_EXCEEDED"
  | "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE"
  | "CREDIT_NOTE_AMOUNT_EXCEEDED";

export type CreditNoteAmountIssue = Readonly<{
  code: CreditNoteAmountIssueCode;
  /** Posición de la línea de la factura, o null para la factura entera. */
  line: number | null;
  /** Para un exceso de cantidad: lo que queda acreditable en la línea. */
  remaining?: string;
}>;

export type CreditNoteAmounts = Readonly<{
  calculationVersion: typeof CREDIT_NOTE_CALCULATION_VERSION;
  /** Las líneas calculables, por posición de la factura. */
  lines: readonly CreditNoteLineAmounts[];
  /** `null` si hay algún problema: la nota no se puede emitir. */
  totals: CreditNoteTotals | null;
  capacity: Readonly<{
    lines: readonly LineCapacity[];
    /** Crédito vigente de la factura antes y después de la nota, y lo disponible después. */
    total: Readonly<{ original: string; credited: string; after: string; remaining: string }>;
  }>;
  issues: readonly CreditNoteAmountIssue[];
}>;

/** Materializa un importe a 2 decimales con HALF_UP, sin un cero negativo. */
function money(value: string): string {
  const rounded = roundHalfUp(value, MONEY_SCALE);
  return compareDecimalStrings(rounded, "0") === 0 ? roundHalfUp("0", MONEY_SCALE) : rounded;
}

const minOf = (a: string, b: string) => (compareDecimalStrings(a, b) <= 0 ? a : b);
const isNegative = (value: string) => compareDecimalStrings(value, "0") < 0;
const taxKey = (tax: { taxCode: string; rateCode: string }) => `${tax.taxCode}:${tax.rateCode}`;

/** Objetivos acumulados de una línea para la cantidad acumulada `cumulative` (design D6). */
function targets(line: CreditableLine, cumulative: string) {
  if (compareDecimalStrings(cumulative, line.quantity) === 0) {
    return {
      subtotal: line.subtotal,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes.map((tax) => tax.amount),
    };
  }
  const subtotal = multiplyExact(cumulative, line.unitPrice);
  const discount = minOf(
    line.discount,
    divideRoundHalfUp(multiplyExact(line.discount, cumulative), line.quantity, MONEY_SCALE),
  );
  const taxableBase = minOf(line.taxableBase, money(subtractExact(subtotal, discount)));
  return {
    subtotal,
    discount,
    taxableBase,
    taxes: line.taxes.map((tax) =>
      minOf(tax.amount, money(percentageOfExact(taxableBase, tax.percentage))),
    ),
  };
}

/** Suma de lo acreditado vigente de una línea: cantidad, importes e impuestos por clave. */
function creditedSums(lines: readonly CreditedLine[]) {
  return {
    quantity: sumExact(lines.map((line) => line.quantity)),
    subtotal: sumExact(lines.map((line) => line.subtotal)),
    discount: sumExact(lines.map((line) => line.discount)),
    taxableBase: sumExact(lines.map((line) => line.taxableBase)),
    tax: (key: string) =>
      sumExact(
        lines
          .flatMap((line) => line.taxes.filter((tax) => taxKey(tax) === key))
          .map((t) => t.amount),
      ),
  };
}

const byCode = (
  a: { taxCode: string; rateCode: string },
  b: { taxCode: string; rateCode: string },
) =>
  a.taxCode.localeCompare(b.taxCode, "en", { numeric: true }) ||
  a.rateCode.localeCompare(b.rateCode, "en", { numeric: true });

/** Totales de la nota desde sus líneas ya materializadas: sumas exactas de valores de 2 decimales. */
function totalsOf(lines: readonly CreditNoteLineAmounts[]): CreditNoteTotals {
  const groups = new Map<string, CreditNoteLineTax[]>();
  for (const tax of lines.flatMap((line) => line.taxes)) {
    groups.set(taxKey(tax), [...(groups.get(taxKey(tax)) ?? []), tax]);
  }
  const taxes = [...groups.values()]
    .map((group) => ({
      taxCode: group[0]!.taxCode,
      rateCode: group[0]!.rateCode,
      percentage: group[0]!.percentage,
      base: money(sumExact(group.map((tax) => tax.base))),
      amount: money(sumExact(group.map((tax) => tax.amount))),
    }))
    .sort(byCode);
  const withoutTaxes = money(sumExact(lines.map((line) => line.taxableBase)));
  return {
    withoutTaxes,
    discount: money(sumExact(lines.map((line) => line.discount))),
    taxes,
    total: money(sumExact([withoutTaxes, ...taxes.map((tax) => tax.amount)])),
  };
}

/**
 * Importes de la nota, lo acreditable que queda y los problemas que la bloquean, todos a la vez:
 * la vista previa los muestra y la emisión rechaza con el primero.
 */
export function calculateCreditNoteAmounts(input: CreditNoteAmountsInput): CreditNoteAmounts {
  const issues: CreditNoteAmountIssue[] = [];
  const byPosition = new Map(input.invoiceLines.map((line) => [line.position, line]));
  const seen = new Set<number>();
  const lines: CreditNoteLineAmounts[] = [];
  const capacities: LineCapacity[] = [];

  for (const request of [...input.requested].sort((a, b) => a.position - b.position)) {
    const line = byPosition.get(request.position);
    // Una cantidad pedida es positiva; solo una línea original de cantidad cero se acredita con
    // cero, al copiarla en una anulación total.
    const invalidQuantity =
      decimalSpecViolation(request.quantity, DECIMAL_SPECS.cantidad) !== null ||
      (compareDecimalStrings(request.quantity, "0") === 0
        ? !line || compareDecimalStrings(line.quantity, "0") !== 0
        : false);
    if (!line || seen.has(request.position) || invalidQuantity) {
      issues.push({ code: "CREDIT_NOTE_LINE_INVALID", line: request.position });
      seen.add(request.position);
      continue;
    }
    seen.add(request.position);
    const prior = creditedSums(input.credited.filter((c) => c.position === line.position));
    const cumulative = sumExact([prior.quantity, request.quantity]);
    const remainingBefore = subtractExact(line.quantity, prior.quantity);
    if (compareDecimalStrings(cumulative, line.quantity) > 0) {
      issues.push({
        code: "CREDIT_NOTE_QUANTITY_EXCEEDED",
        line: line.position,
        remaining: remainingBefore,
      });
      continue;
    }
    const target = targets(line, cumulative);
    const taxableBase = subtractExact(target.taxableBase, prior.taxableBase);
    const amounts: CreditNoteLineAmounts = {
      position: line.position,
      quantity: request.quantity,
      unitPrice: line.unitPrice,
      subtotal: subtractExact(target.subtotal, prior.subtotal),
      discount: money(subtractExact(target.discount, prior.discount)),
      taxableBase: money(taxableBase),
      taxes: line.taxes.map((tax, index) => ({
        taxCode: tax.taxCode,
        rateCode: tax.rateCode,
        percentage: tax.percentage,
        base: money(taxableBase),
        amount: money(subtractExact(target.taxes[index]!, prior.tax(taxKey(tax)))),
      })),
    };
    const negative =
      isNegative(amounts.subtotal) ||
      isNegative(amounts.discount) ||
      isNegative(amounts.taxableBase) ||
      amounts.taxes.some((tax) => isNegative(tax.amount));
    if (negative) {
      issues.push({ code: "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE", line: line.position });
      continue;
    }
    lines.push(amounts);
    capacities.push({
      position: line.position,
      original: line.quantity,
      credited: prior.quantity,
      after: cumulative,
      remaining: subtractExact(line.quantity, cumulative),
    });
  }

  const totals = lines.length > 0 ? totalsOf(lines) : null;
  const credited = sumExact([input.invoice.reserved, input.invoice.applied]);
  const after = sumExact([credited, totals?.total ?? "0"]);
  if (totals && compareDecimalStrings(after, input.invoice.total) > 0) {
    issues.push({ code: "CREDIT_NOTE_AMOUNT_EXCEEDED", line: null });
  }
  return {
    calculationVersion: CREDIT_NOTE_CALCULATION_VERSION,
    lines,
    totals: issues.length === 0 ? totals : null,
    capacity: {
      lines: capacities,
      total: {
        original: input.invoice.total,
        credited: money(credited),
        after: money(after),
        remaining: money(subtractExact(input.invoice.total, after)),
      },
    },
    issues,
  };
}
