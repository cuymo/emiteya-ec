// Política decimal común del producto (add-fiscal-catalogs, design D10). Un decimal viaja siempre
// como texto (`DecimalString`), nunca como número JSON, que ya pasó por coma flotante. Los tipos
// del dominio restringen esa representación universal con la regla de su tipo XSD: dígitos totales,
// decimales y mínimo. La regla del XSD manda, no la semántica de `NUMERIC(p, s)` (Q-43).
import { z } from "zod";

/** Representación textual universal: signo opcional, punto decimal, sin exponente ni separadores. */
export const DECIMAL_STRING_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export type DecimalSpec = {
  /**
   * Dígitos totales del `xsd:decimal` de origen (`totalDigits`). La parte entera usa los que no
   * ocupan los decimales: con 18/6 valen `999999999999999999` y `999999999999.999999`.
   */
  totalDigits: number;
  /** Decimales máximos (`fractionDigits`). */
  fractionDigits: number;
  /** Mínimo inclusivo (`minInclusive`); null si el tipo admite negativos. */
  min: string | null;
  /** Tipos XSD de los que sale la escala y documentos en que es común (`codDoc`). */
  xsd: { types: readonly string[]; documents: readonly string[] };
};

/**
 * Especificaciones de los campos del producto. La escala no es una elección: es la del tipo XSD
 * equivalente en todos los documentos que lo definen, y una prueba lo comprueba contra los seis
 * XSD versionados. Excepción conocida: la retención 2.0.0 define `tarifa` con 3/2.
 *
 * Son primitivos compartidos: los límites normativos de un impuesto o de un código (por ejemplo,
 * el porcentaje de una tarifa de IVA) pertenecen a su catálogo, no a la especificación (Q-43).
 */
export const DECIMAL_SPECS = {
  /**
   * Porcentaje: `tarifa` de factura, liquidación, nota de crédito y nota de débito. Sin máximo de
   * 100: la ficha v2.34 publica tarifas de ICE superiores.
   */
  tarifa: {
    totalDigits: 4,
    fractionDigits: 2,
    min: "0",
    xsd: { types: ["tarifa"], documents: ["01", "03", "04", "05"] },
  },
  /** Importes monetarios no negativos: `importeTotal` y equivalentes, 14/2 en los seis XSD. */
  importe: {
    totalDigits: 14,
    fractionDigits: 2,
    min: "0",
    xsd: { types: ["importeTotal"], documents: ["01", "03", "07"] },
  },
  /** Precio unitario: `precioUnitario` de factura, liquidación y nota de crédito. */
  precioUnitario: {
    totalDigits: 18,
    fractionDigits: 6,
    min: "0",
    xsd: { types: ["precioUnitario"], documents: ["01", "03", "04"] },
  },
  /** Cantidad: `cantidad` de factura, liquidación, nota de crédito y guía de remisión. */
  cantidad: {
    totalDigits: 18,
    fractionDigits: 6,
    min: "0",
    xsd: { types: ["cantidad"], documents: ["01", "03", "04", "06"] },
  },
  /**
   * Existencias del inventario (add-minimal-inventory, design D3): variaciones con signo y saldos.
   * No sale de un XSD: lleva los decimales de `cantidad` y una parte entera que admite la salida de
   * una factura de 1 000 líneas de cantidad máxima y cualquier saldo acumulado realista; con 6
   * decimales, menos de 10²⁴. Un saldo puede ser negativo (Q-19).
   */
  existencia: {
    totalDigits: 30,
    fractionDigits: 6,
    min: null,
    xsd: { types: [], documents: [] },
  },
} as const satisfies Record<string, DecimalSpec>;

export type DecimalSpecName = keyof typeof DECIMAL_SPECS;

const FORMAT_MESSAGE =
  "Debe ser un número decimal escrito como texto, con punto decimal y sin exponente ni separadores.";

/** true si `text` es un `DecimalString` válido (sin "-0"). */
export function isDecimalString(text: string): boolean {
  return DECIMAL_STRING_PATTERN.test(text) && !/^-0(\.0+)?$/.test(text);
}

/** Partes de un `DecimalString` válido: signo, dígitos enteros y decimales. */
export function decimalParts(text: string): {
  negative: boolean;
  integer: string;
  fraction: string;
} {
  const negative = text.startsWith("-");
  const [integer = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  return { negative, integer, fraction };
}

/** Compara dos `DecimalString` válidos sin convertirlos a número: -1, 0 o 1. */
export function compareDecimalStrings(a: string, b: string): number {
  const pa = decimalParts(a);
  const pb = decimalParts(b);
  const sign = (p: typeof pa) => (/^0*$/.test(p.integer + p.fraction) ? 0 : p.negative ? -1 : 1);
  const sa = sign(pa);
  const sb = sign(pb);
  if (sa !== sb) return sa < sb ? -1 : 1;
  // Misma longitud entera y decimales rellenados: la comparación de cadenas de dígitos es numérica.
  const width = Math.max(pa.fraction.length, pb.fraction.length);
  const ia = pa.integer.replace(/^0+(?=\d)/, "");
  const ib = pb.integer.replace(/^0+(?=\d)/, "");
  const da = ia + pa.fraction.padEnd(width, "0");
  const db = ib + pb.fraction.padEnd(width, "0");
  const magnitude =
    ia.length !== ib.length ? (ia.length < ib.length ? -1 : 1) : da === db ? 0 : da < db ? -1 : 1;
  return sa === -1 ? -magnitude : magnitude;
}

/** Forma canónica más corta y exacta: sin ceros finales en los decimales ni punto sobrante. */
export function canonicalDecimal(text: string): string {
  const { negative, integer, fraction } = decimalParts(text);
  const trimmed = fraction.replace(/0+$/, "");
  const body = trimmed ? `${integer}.${trimmed}` : integer;
  return negative && body !== "0" ? `-${body}` : body;
}

/** Mensaje de un valor que no cumple la especificación, o null si la cumple. */
export function decimalSpecViolation(text: string, spec: DecimalSpec): string | null {
  if (!isDecimalString(text)) return FORMAT_MESSAGE;
  const { integer, fraction } = decimalParts(text);
  if (fraction.length > spec.fractionDigits) {
    return `Admite como máximo ${spec.fractionDigits} decimales.`;
  }
  // Dígitos como se escriben; el cero de la parte entera de `0.5` no es significativo.
  if ((integer === "0" ? 0 : integer.length) + fraction.length > spec.totalDigits) {
    return `Admite como máximo ${spec.totalDigits} dígitos en total.`;
  }
  if (spec.min !== null && compareDecimalStrings(text, spec.min) < 0) {
    return `Debe ser mayor o igual que ${spec.min}.`;
  }
  return null;
}

/** Esquema del `DecimalString` universal, que admite negativos. */
export const decimalStringSchema = z
  .string({ error: FORMAT_MESSAGE })
  .refine(isDecimalString, FORMAT_MESSAGE);

/** Esquema de un campo con su especificación: universal y después decimales, total y mínimo. */
export function decimalString(spec: DecimalSpec) {
  return z.string({ error: FORMAT_MESSAGE }).superRefine((text, ctx) => {
    const violation = decimalSpecViolation(text, spec);
    if (violation) ctx.addIssue({ code: "custom", message: violation });
  });
}
