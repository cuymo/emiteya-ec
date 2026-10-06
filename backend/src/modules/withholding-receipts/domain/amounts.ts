// Cálculo único de los valores retenidos (add-withholding-receipts, design D13): la única primitiva
// fiscal del comprobante de retención, versionada. La vista previa, la emisión (que congela su
// resultado en el snapshot), el XML y el RIDE usan su resultado; el builder solo lo transcribe y el
// frontend solo lo muestra.
//
// Para cada retención r, con su base exacta b_r (un `importe` mayor que cero) y el porcentaje p_r de
// su entrada del catálogo (un `porcentajeRetener`):
//   valor retenido v_r = round(b_r × p_r / 100)
//   total retenido     = Σ v_r                     (suma exacta)
// con round = HALF_UP a 2 decimales, una sola vez por retención. El XML 2.0.0 no tiene un total
// retenido: lo muestran la vista previa, la consulta y la bandeja. Sin `number`: todo es
// `DecimalString` exacto.
import {
  DECIMAL_SPECS,
  canonicalDecimal,
  compareDecimalStrings,
  decimalSpecViolation,
} from "@facturador/contracts";
import {
  percentageOfExact,
  roundHalfUp,
  sumExact,
} from "../../../platform/decimal/fiscal-decimal.ts";

/** Versión del cálculo: cambia con cualquier cambio de sus resultados para la misma entrada. */
export const WITHHOLDING_CALCULATION_VERSION = 1;

const MONEY_SCALE = DECIMAL_SPECS.importe.fractionDigits;

export type WithholdingAmountInput = Readonly<{
  /** Posición del documento sustento, desde 1. */
  support: number;
  /** Posición de la retención dentro de su documento, desde 1. */
  position: number;
  /** Base exacta, mayor que cero, con hasta 2 decimales. */
  base: string;
  /** Porcentaje de la entrada del catálogo, con hasta 3 dígitos y 2 decimales. */
  percentage: string;
}>;

export type WithholdingAmount = Readonly<{
  support: number;
  position: number;
  /** La base a 2 decimales: el `baseImponible` de la retención. */
  base: string;
  /** El porcentaje en su forma canónica sin ceros finales (`1.75`, `10`, `100`). */
  percentage: string;
  /** El valor retenido a 2 decimales: el `valorRetenido`. */
  amount: string;
}>;

export type WithholdingAmounts = Readonly<{
  calculationVersion: typeof WITHHOLDING_CALCULATION_VERSION;
  items: readonly WithholdingAmount[];
  /** Total retenido del comprobante. */
  withheld: string;
}>;

export type WithholdingAmountErrorCode =
  "BASE_INVALID" | "PERCENTAGE_INVALID" | "AMOUNT_OUT_OF_RANGE";

/** Una entrada que el cálculo no admite, con la posición del documento y de la retención. */
export class WithholdingAmountError extends Error {
  readonly code: WithholdingAmountErrorCode;
  readonly support: number | null;
  readonly position: number | null;
  constructor(code: WithholdingAmountErrorCode, support: number | null, position: number | null) {
    super(`${code}${support === null ? "" : `: documento ${support}, retención ${position}`}`);
    this.name = "WithholdingAmountError";
    this.code = code;
    this.support = support;
    this.position = position;
  }
}

/** Base de una retención: dominio `importe` del XSD y mayor que cero (política del proyecto). */
export const isWithholdingBase = (value: string) =>
  decimalSpecViolation(value, DECIMAL_SPECS.importe) === null &&
  compareDecimalStrings(value, "0") > 0;

/** Porcentaje de una retención: dominio `porcentajeRetener` (3 dígitos, 2 decimales, desde 0). */
export const isWithholdingPercentage = (value: string) =>
  decimalSpecViolation(value, DECIMAL_SPECS.porcentajeRetener) === null;

/** Materializa a 2 decimales con HALF_UP y comprueba que cabe en el `importe` del XSD. */
function money(value: string, support: number | null, position: number | null): string {
  const materialized = roundHalfUp(value, MONEY_SCALE);
  if (decimalSpecViolation(materialized, DECIMAL_SPECS.importe) !== null) {
    throw new WithholdingAmountError("AMOUNT_OUT_OF_RANGE", support, position);
  }
  return materialized;
}

export function calculateWithholdingAmounts(input: {
  items: readonly WithholdingAmountInput[];
}): WithholdingAmounts {
  const items = input.items.map((item) => {
    if (!isWithholdingBase(item.base)) {
      throw new WithholdingAmountError("BASE_INVALID", item.support, item.position);
    }
    // Un porcentaje con más dígitos de los que admite el XSD nunca se redondea: se rechaza.
    const percentage = canonicalDecimal(item.percentage);
    if (!isWithholdingPercentage(percentage)) {
      throw new WithholdingAmountError("PERCENTAGE_INVALID", item.support, item.position);
    }
    // Una base de hasta 2 decimales no se redondea: solo toma la forma de 2 decimales.
    const base = money(item.base, item.support, item.position);
    return {
      support: item.support,
      position: item.position,
      base,
      percentage,
      amount: money(percentageOfExact(base, percentage), item.support, item.position),
    };
  });
  return {
    calculationVersion: WITHHOLDING_CALCULATION_VERSION,
    items,
    withheld: money(sumExact(items.map((item) => item.amount)), null, null),
  };
}
