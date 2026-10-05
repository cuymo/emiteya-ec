// Aritmética decimal exacta del producto (add-fiscal-catalogs, design D10). Ningún importe ni
// tarifa pasa por `number`: se reciben como `DecimalString`, se validan con la especificación de
// su tipo XSD y viven como `decimal.js`, la misma biblioteca que Prisma usa para `Decimal`.
import { Decimal } from "decimal.js";
import {
  DECIMAL_SPECS,
  decimalSpecViolation,
  type DecimalSpec,
  type DecimalSpecName,
} from "@facturador/contracts";

// Dígitos significativos de las operaciones: cubren el producto de dos valores de 18 dígitos.
const PRECISION = 40;

/** Instancia propia: no depende de la configuración global de `decimal.js`. */
const Exact = Decimal.clone({
  precision: PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});
type ExactDecimal = InstanceType<typeof Exact>;

export class DecimalValueError extends Error {
  readonly spec: DecimalSpecName;

  constructor(spec: DecimalSpecName, message: string) {
    super(message);
    this.name = "DecimalValueError";
    this.spec = spec;
  }
}

/** Valor decimal validado contra la especificación de su campo; inmutable. */
export class FiscalDecimal {
  readonly specName: DecimalSpecName;
  private readonly value: ExactDecimal;

  private constructor(specName: DecimalSpecName, value: ExactDecimal) {
    this.specName = specName;
    this.value = value;
  }

  /** Desde un `DecimalString`: valida formato, decimales, total y mínimo, sin redondear. */
  static parse(specName: DecimalSpecName, text: string): FiscalDecimal {
    const spec: DecimalSpec = DECIMAL_SPECS[specName];
    const violation = decimalSpecViolation(text, spec);
    if (violation) throw new DecimalValueError(specName, violation);
    return new FiscalDecimal(specName, new Exact(text));
  }

  /** Desde el `Decimal` de Prisma (o su texto), siempre a través de su texto sin exponente. */
  static fromDatabase(specName: DecimalSpecName, stored: { toFixed(): string } | string) {
    return FiscalDecimal.parse(
      specName,
      typeof stored === "string" ? stored : new Exact(stored.toFixed()).toFixed(),
    );
  }

  /** Forma canónica más corta y exacta, sin exponente: el texto que viaja en JSON. */
  toString(): string {
    return this.value.toFixed();
  }

  /**
   * Valor para Prisma: texto, que Prisma convierte a `NUMERIC` sin pasar por `number`. Forma
   * canónica: las columnas no tienen escala fija y su `CHECK` de dominio cuenta la escala guardada.
   */
  toDatabase(): string {
    return this.value.toFixed();
  }

  equals(other: FiscalDecimal): boolean {
    return this.value.equals(other.value);
  }

  compare(other: FiscalDecimal): number {
    return this.value.comparedTo(other.value);
  }
}

/**
 * Materializa un valor a una escala con HALF_UP (Q-14): el único redondeo de la aritmética fiscal
 * (add-invoice-emission, design D5), y solo al materializar. Devuelve exactamente `scale`
 * decimales.
 */
export function roundHalfUp(text: string, scale: number): string {
  return new Exact(text).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}

// Aritmética exacta sobre `DecimalString`, sin `number` ni redondeo (design D5). El resultado es la
// forma canónica más corta. Una operación que necesitara más dígitos que la precisión falla en vez
// de redondear en silencio.

export class InexactOperationError extends Error {
  constructor() {
    super("La operación necesita más dígitos que la precisión exacta.");
    this.name = "InexactOperationError";
  }
}

const integerDigits = (value: ExactDecimal) => Math.max(value.e + 1, 1);

function plus(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  const digits =
    Math.max(integerDigits(a), integerDigits(b)) +
    1 +
    Math.max(a.decimalPlaces(), b.decimalPlaces());
  if (digits > PRECISION) throw new InexactOperationError();
  return a.plus(b);
}

function times(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  if (a.sd() + b.sd() > PRECISION) throw new InexactOperationError();
  return a.times(b);
}

/** Suma exacta; la de una lista vacía es `0`. */
export function sumExact(values: readonly string[]): string {
  return values.reduce((sum, value) => plus(sum, new Exact(value)), new Exact(0)).toFixed();
}

/** Diferencia exacta `a - b`. */
export function subtractExact(a: string, b: string): string {
  return plus(new Exact(a), new Exact(b).negated()).toFixed();
}

/** Producto exacto. */
export function multiplyExact(a: string, b: string): string {
  return times(new Exact(a), new Exact(b)).toFixed();
}

/** Porcentaje exacto de una base, `base × porcentaje / 100`: dividir por 100 solo mueve la coma. */
export function percentageOfExact(base: string, percentage: string): string {
  return times(new Exact(base), new Exact(percentage)).dividedBy(100).toFixed();
}

/** Entero escalado de un `DecimalString` no negativo: `12.345` es `12345n` con escala 3. */
function scaled(text: string): { units: bigint; scale: number } {
  const value = new Exact(text);
  if (value.isNegative() && !value.isZero())
    throw new RangeError("Se esperaba un valor no negativo.");
  const fixed = value.abs().toFixed();
  const [integer = "0", fraction = ""] = fixed.split(".");
  return { units: BigInt(integer + fraction), scale: fraction.length };
}

/**
 * Cociente `numerador / denominador` materializado a `scale` decimales con HALF_UP, exacto con
 * enteros: un cociente periódico (por ejemplo, un tercio) nunca se redondea dos veces. Solo para
 * valores no negativos y un denominador positivo (add-credit-notes, design D6).
 */
export function divideRoundHalfUp(numerator: string, denominator: string, scale: number): string {
  const n = scaled(numerator);
  const d = scaled(denominator);
  if (d.units === 0n) throw new RangeError("El denominador debe ser positivo.");
  const top = n.units * 10n ** BigInt(d.scale + scale);
  const bottom = d.units * 10n ** BigInt(n.scale);
  const quotient = (2n * top + bottom) / (2n * bottom);
  if (scale === 0) return quotient.toString();
  const digits = quotient.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

const typed = (specName: DecimalSpecName) => ({
  parse: (text: string) => FiscalDecimal.parse(specName, text),
  fromDatabase: (stored: { toFixed(): string } | string) =>
    FiscalDecimal.fromDatabase(specName, stored),
});

/** Porcentaje no negativo (`tarifa`, 4/2); los límites de cada impuesto son de su catálogo. */
export const Percentage = typed("tarifa");
/** Importe monetario no negativo (`importeTotal`, 14/2). */
export const Money = typed("importe");
/** Precio unitario no negativo (`precioUnitario`, 18/6). */
export const UnitPrice = typed("precioUnitario");
/** Cantidad no negativa (`cantidad`, 18/6). */
export const Quantity = typed("cantidad");
/** Variación o saldo de existencias, con signo (`existencia`, 30/6; add-minimal-inventory). */
export const StockQuantity = typed("existencia");
