// Cálculo único de los importes de una nota de débito (add-debit-notes, design D7): la única
// primitiva fiscal de la nota, versionada. La vista previa, la emisión (que congela su resultado en
// el snapshot), el XML y el RIDE usan su resultado; el builder solo lo transcribe y el frontend solo
// lo muestra.
//
// Para los conceptos c, con su importe exacto a_c (hasta 2 decimales) y su tratamiento t(c):
//   base del concepto     = a_c                          (el `valor` de su `motivo`)
//   base del tratamiento  B_t = Σ a_c con t(c) = t        (suma exacta)
//   impuesto del tratamiento T_t = round(B_t × pct_t / 100)
//   subtotal              = Σ a_c = Σ B_t
//   valor total           = subtotal + Σ T_t             (el `total` de la forma de pago)
// con round = HALF_UP a 2 decimales, aplicado una sola vez por tratamiento, nunca por concepto:
// cada `impuesto` del XML cumple valor = round(base × tarifa / 100) y el resultado no depende de
// cómo se parta una misma base en conceptos. Sin `number`: todo es `DecimalString` exacto.
import { DECIMAL_SPECS, compareDecimalStrings, decimalSpecViolation } from "@facturador/contracts";
import {
  percentageOfExact,
  roundHalfUp,
  sumExact,
} from "../../../platform/decimal/fiscal-decimal.ts";
import type { InvoiceTaxTreatment } from "./treatments.ts";

/** Versión del cálculo: cambia con cualquier cambio de sus resultados para la misma entrada. */
export const DEBIT_NOTE_CALCULATION_VERSION = 1;

const MONEY_SCALE = DECIMAL_SPECS.importe.fractionDigits;

export type DebitConceptAmountInput = Readonly<{
  position: number;
  /** Importe exacto del concepto, mayor que cero, con hasta 2 decimales. */
  amount: string;
  /** Clave `taxCode:rateCode` de un tratamiento de la factura. */
  taxTreatment: string;
}>;

export type DebitNoteConceptAmount = Readonly<{
  position: number;
  /** La base del concepto, a 2 decimales: el `valor` de su `motivo`. */
  base: string;
  taxTreatment: string;
}>;

export type DebitNoteTaxAmount = Readonly<{
  key: string;
  taxCode: string;
  rateCode: string;
  percentage: string;
  /** `B_t`: la suma de las bases de sus conceptos. */
  base: string;
  /** `T_t`: el impuesto materializado una vez sobre `B_t`. */
  amount: string;
}>;

export type DebitNoteAmounts = Readonly<{
  calculationVersion: typeof DEBIT_NOTE_CALCULATION_VERSION;
  concepts: readonly DebitNoteConceptAmount[];
  /** Un impuesto por tratamiento usado, por código y código de porcentaje. */
  taxes: readonly DebitNoteTaxAmount[];
  /** `totalSinImpuestos`. */
  withoutTaxes: string;
  /** `valorTotal`. */
  total: string;
}>;

export type DebitNoteAmountErrorCode =
  "AMOUNT_INVALID" | "TAX_TREATMENT_NOT_IN_INVOICE" | "AMOUNT_OUT_OF_RANGE";

/** Una entrada que el cálculo no admite, con la posición del concepto si la tiene. */
export class DebitNoteAmountError extends Error {
  readonly code: DebitNoteAmountErrorCode;
  readonly concept: number | null;
  constructor(code: DebitNoteAmountErrorCode, concept: number | null = null) {
    super(`${code}${concept === null ? "" : `: concepto ${concept}`}`);
    this.name = "DebitNoteAmountError";
    this.code = code;
    this.concept = concept;
  }
}

/** Importe del concepto: dominio `importe` del XSD y mayor que cero. */
export const isConceptAmount = (value: string) =>
  decimalSpecViolation(value, DECIMAL_SPECS.importe) === null &&
  compareDecimalStrings(value, "0") > 0;

/** Materializa a 2 decimales con HALF_UP y comprueba que cabe en el `importe` del XSD. */
function money(value: string, concept: number | null = null): string {
  const materialized = roundHalfUp(value, MONEY_SCALE);
  if (decimalSpecViolation(materialized, DECIMAL_SPECS.importe) !== null) {
    throw new DebitNoteAmountError("AMOUNT_OUT_OF_RANGE", concept);
  }
  return materialized;
}

const byCode = (a: DebitNoteTaxAmount, b: DebitNoteTaxAmount) =>
  a.taxCode.localeCompare(b.taxCode, "en", { numeric: true }) ||
  a.rateCode.localeCompare(b.rateCode, "en", { numeric: true });

export function calculateDebitNoteAmounts(input: {
  concepts: readonly DebitConceptAmountInput[];
  treatments: readonly InvoiceTaxTreatment[];
}): DebitNoteAmounts {
  const treatments = new Map(input.treatments.map((treatment) => [treatment.key, treatment]));
  const concepts = input.concepts.map((concept) => {
    if (!isConceptAmount(concept.amount)) {
      throw new DebitNoteAmountError("AMOUNT_INVALID", concept.position);
    }
    if (!treatments.has(concept.taxTreatment)) {
      throw new DebitNoteAmountError("TAX_TREATMENT_NOT_IN_INVOICE", concept.position);
    }
    // Un importe de hasta 2 decimales no se redondea: solo toma la forma de 2 decimales.
    return {
      position: concept.position,
      base: money(concept.amount, concept.position),
      taxTreatment: concept.taxTreatment,
    };
  });
  const bases = new Map<string, string[]>();
  for (const concept of concepts) {
    bases.set(concept.taxTreatment, [...(bases.get(concept.taxTreatment) ?? []), concept.base]);
  }
  const taxes = [...bases]
    .map(([key, values]) => {
      const treatment = treatments.get(key)!;
      const base = money(sumExact(values));
      return {
        key,
        taxCode: treatment.taxCode,
        rateCode: treatment.rateCode,
        percentage: treatment.percentage,
        base,
        amount: money(percentageOfExact(base, treatment.percentage)),
      };
    })
    .sort(byCode);
  const withoutTaxes = money(sumExact(concepts.map((concept) => concept.base)));
  return {
    calculationVersion: DEBIT_NOTE_CALCULATION_VERSION,
    concepts,
    taxes,
    withoutTaxes,
    total: money(sumExact([withoutTaxes, ...taxes.map((tax) => tax.amount)])),
  };
}
