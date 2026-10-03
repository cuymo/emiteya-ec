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

/** Instancia propia: no depende de la configuración global de `decimal.js`. */
const Exact = Decimal.clone({
  precision: 40,
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

  /** Desde un `DecimalString`: valida formato, dígitos, escala y rango, sin redondear. */
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

  /** Valor para Prisma: texto, que Prisma convierte a `NUMERIC` sin pasar por `number`. */
  toDatabase(): string {
    return this.value.toFixed(DECIMAL_SPECS[this.specName].fractionDigits);
  }

  equals(other: FiscalDecimal): boolean {
    return this.value.equals(other.value);
  }

  compare(other: FiscalDecimal): number {
    return this.value.comparedTo(other.value);
  }
}

/** Redondeo half-up a una escala. Lo usará la emisión (Q-14); este cambio no redondea nada. */
export function roundHalfUp(text: string, scale: number): string {
  return new Exact(text).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}

const typed = (specName: DecimalSpecName) => ({
  parse: (text: string) => FiscalDecimal.parse(specName, text),
  fromDatabase: (stored: { toFixed(): string } | string) =>
    FiscalDecimal.fromDatabase(specName, stored),
});

/** Porcentaje de IVA (`tarifa`, 4/2, de 0 a 100). */
export const Percentage = typed("tarifa");
/** Importe monetario no negativo (`importeTotal`, 14/2). */
export const Money = typed("importe");
/** Precio unitario no negativo (`precioUnitario`, 18/6). */
export const UnitPrice = typed("precioUnitario");
/** Cantidad no negativa (`cantidad`, 18/6). */
export const Quantity = typed("cantidad");
