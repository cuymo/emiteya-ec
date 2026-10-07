// Primitivas de los importes de un comprobante con líneas e impuestos (add-purchase-settlements,
// design D8): nacieron en la factura (add-invoice-emission, design D5; Q-14) y se comparten sin
// cambiar sus resultados. Un concepto por función, sobre las primitivas exactas de platform/decimal.
// Los valores intermedios son exactos y hay tres puntos de materialización HALF_UP: la base de la
// línea, su impuesto y los totales, que solo fijan la escala de sumas ya exactas. Cada importe
// materializado se comprueba con la especificación `importe` (14/2). Los builders XML no calculan:
// escriben lo que devuelven estas funciones. No conocen ningún tipo de comprobante.
import {
  DECIMAL_SPECS,
  compareDecimalStrings,
  decimalSpecViolation,
  type DecimalSpecName,
} from "@facturador/contracts";
import {
  multiplyExact,
  percentageOfExact,
  roundHalfUp,
  subtractExact,
  sumExact,
} from "../../../platform/decimal/fiscal-decimal.ts";

/** Campo del cálculo al que se refiere un fallo; la validación le añade la línea. */
export type AmountField =
  | "quantity"
  | "unitPrice"
  | "discount"
  | "rate"
  | "taxableBase"
  | "taxAmount"
  | "totalWithoutTaxes"
  | "totalDiscount"
  | "taxTotalBase"
  | "taxTotalAmount"
  | "total";

export type DocumentAmountErrorCode =
  /** Un dato de entrada no cumple su especificación decimal; lo impiden contratos y catálogos. */
  | "AMOUNT_INVALID"
  | "DISCOUNT_EXCEEDS_SUBTOTAL"
  /** Un importe materializado no cabe en el XSD (`importe`, 14 dígitos y 2 decimales). */
  | "AMOUNT_OUT_OF_RANGE";

export class DocumentAmountError extends Error {
  readonly code: DocumentAmountErrorCode;
  readonly field: AmountField;

  constructor(code: DocumentAmountErrorCode, field: AmountField) {
    super(`${code}: ${field}`);
    this.name = "DocumentAmountError";
    this.code = code;
    this.field = field;
  }
}

/** Tarifa resuelta del catálogo para la fecha del documento. */
export type LineTaxRate = Readonly<{
  /** Código del impuesto (`2` IVA). */
  taxCode: string;
  /** Código de la tarifa en el catálogo (`4` para el 15 %). */
  rateCode: string;
  /** Porcentaje tal como lo publica el catálogo. */
  percentage: string;
}>;

export type LineInput = Readonly<{
  quantity: string;
  unitPrice: string;
  discount: string;
  taxes: readonly LineTaxRate[];
}>;

export type LineTax = LineTaxRate & Readonly<{ base: string; amount: string }>;

export type LineAmounts = Readonly<{
  /** Cantidad por precio unitario, exacto: no es un campo del XML. */
  subtotal: string;
  discount: string;
  /** `precioTotalSinImpuesto` de la línea y base de sus impuestos. */
  taxableBase: string;
  taxes: readonly LineTax[];
}>;

export type TaxTotal = LineTaxRate & Readonly<{ base: string; amount: string }>;

export type DocumentTotals = Readonly<{
  withoutTaxes: string;
  discount: string;
  taxes: readonly TaxTotal[];
  total: string;
}>;

const MONEY: DecimalSpecName = "importe";

function checked(spec: DecimalSpecName, value: string, field: AmountField): string {
  if (decimalSpecViolation(value, DECIMAL_SPECS[spec]) !== null) {
    throw new DocumentAmountError("AMOUNT_INVALID", field);
  }
  return value;
}

/** Materializa a la escala de los importes del XSD con HALF_UP y comprueba que cabe en él. */
export function materializeMoney(value: string, field: AmountField): string {
  const money = roundHalfUp(value, DECIMAL_SPECS[MONEY].fractionDigits);
  if (decimalSpecViolation(money, DECIMAL_SPECS[MONEY]) !== null) {
    throw new DocumentAmountError("AMOUNT_OUT_OF_RANGE", field);
  }
  return money;
}

/** Subtotal de la línea: cantidad por precio unitario, exacto y sin redondear. */
export function lineSubtotal(quantity: string, unitPrice: string): string {
  return multiplyExact(
    checked("cantidad", quantity, "quantity"),
    checked("precioUnitario", unitPrice, "unitPrice"),
  );
}

/** Descuento de la línea: importe de 2 decimales entre 0 y el subtotal, sin redondear. */
export function lineDiscount(discount: string, subtotal: string): string {
  checked(MONEY, discount, "discount");
  if (compareDecimalStrings(discount, subtotal) > 0) {
    throw new DocumentAmountError("DISCOUNT_EXCEEDS_SUBTOTAL", "discount");
  }
  return materializeMoney(discount, "discount");
}

/** Base imponible de la línea: subtotal exacto menos descuento, materializada HALF_UP. */
export const taxableBase = (subtotal: string, discount: string): string =>
  materializeMoney(subtractExact(subtotal, discount), "taxableBase");

/** Impuesto de la línea: porcentaje de la base ya materializada, materializado HALF_UP. */
export const taxAmount = (base: string, percentage: string): string =>
  materializeMoney(percentageOfExact(base, checked("tarifa", percentage, "rate")), "taxAmount");

export function lineAmounts(line: LineInput): LineAmounts {
  const subtotal = lineSubtotal(line.quantity, line.unitPrice);
  const discount = lineDiscount(line.discount, subtotal);
  const base = taxableBase(subtotal, discount);
  return {
    subtotal,
    discount,
    taxableBase: base,
    taxes: line.taxes.map((rate) => ({ ...rate, base, amount: taxAmount(base, rate.percentage) })),
  };
}

const byCode = (a: TaxTotal, b: TaxTotal) =>
  a.taxCode.localeCompare(b.taxCode, "en", { numeric: true }) ||
  a.rateCode.localeCompare(b.rateCode, "en", { numeric: true });

/**
 * Totales desde los valores ya materializados de las líneas: por impuesto y tarifa, sin impuestos,
 * descuento e importe total. Sumar valores de 2 decimales es exacto; materializar solo fija la
 * escala y comprueba el límite del XSD.
 */
export function documentTotals(lines: readonly LineAmounts[]): DocumentTotals {
  const groups = new Map<string, LineTax[]>();
  for (const tax of lines.flatMap((line) => line.taxes)) {
    const key = `${tax.taxCode}:${tax.rateCode}`;
    const group = groups.get(key) ?? [];
    if (group[0] && compareDecimalStrings(group[0].percentage, tax.percentage) !== 0) {
      throw new Error(`La tarifa ${key} tiene dos porcentajes en el mismo comprobante.`);
    }
    groups.set(key, [...group, tax]);
  }
  const taxes = [...groups.values()]
    .map((group) => ({
      taxCode: group[0]!.taxCode,
      rateCode: group[0]!.rateCode,
      percentage: group[0]!.percentage,
      base: materializeMoney(sumExact(group.map((tax) => tax.base)), "taxTotalBase"),
      amount: materializeMoney(sumExact(group.map((tax) => tax.amount)), "taxTotalAmount"),
    }))
    .sort(byCode);
  const withoutTaxes = materializeMoney(
    sumExact(lines.map((line) => line.taxableBase)),
    "totalWithoutTaxes",
  );
  return {
    withoutTaxes,
    discount: materializeMoney(sumExact(lines.map((line) => line.discount)), "totalDiscount"),
    taxes,
    total: materializeMoney(sumExact([withoutTaxes, ...taxes.map((tax) => tax.amount)]), "total"),
  };
}
