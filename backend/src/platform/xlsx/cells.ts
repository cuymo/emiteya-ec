// Valores de las celdas del XLSX de los reportes (ADR 0023; design D7 y D8 de add-reports-export).
// El texto se codifica sin perder nada, un decimal llega a la hoja como su texto canónico y nunca
// pasa por `number`, y las fechas no dependen de la zona horaria ni de la configuración regional
// del proceso.
import { canonicalDecimal, decimalParts, isDecimalString } from "@facturador/contracts";

/** Máximo de caracteres de una celda en Excel; un texto más largo es un error, nunca se corta. */
export const MAX_CELL_TEXT = 32_767;
/** Dígitos significativos que un double conserva siempre al volver a decimal. */
export const MAX_NUMERIC_DIGITS = 15;
/** Decimales con formato propio; un valor con más va como texto exacto. */
export const MAX_FORMAT_DECIMALS = 6;

export class XlsxValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxValueError";
  }
}

// ST_Xstring (ECMA-376 Parte 1, §22.9.2.19): un carácter que XML 1.0 no admite va como `_xHHHH_`.
// El retorno de carro también, porque el parser lo normalizaría a salto de línea, y un `_xHHHH_`
// literal se protege con `_x005F_`, como lo escribe Excel.
const LITERAL_ESCAPE = /_(x[0-9A-Fa-f]{4}_)/g;
const NOT_IN_XML =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Texto de un elemento o atributo del XML de la hoja, con su valor intacto. */
export function xmlText(text: string): string {
  return text
    .replace(LITERAL_ESCAPE, "_x005F_$1")
    .replace(
      NOT_IN_XML,
      (char) => `_x${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`,
    )
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Celda numérica de un decimal: su texto canónico y sus decimales, o null si debe ir como texto. */
export function numericValue(
  value: string,
  minDecimals: number,
): { text: string; decimals: number } | null {
  if (!isDecimalString(value)) throw new XlsxValueError("El valor no es un decimal válido.");
  const canonical = canonicalDecimal(value);
  const { integer, fraction } = decimalParts(canonical);
  // Sin los ceros de los bordes: 0.10 tiene 1 dígito significativo y 100, también 1.
  const digits = (integer + fraction).replace(/^0+/, "").replace(/0+$/, "");
  if (digits.length > MAX_NUMERIC_DIGITS || fraction.length > MAX_FORMAT_DECIMALS) return null;
  return { text: canonical, decimals: Math.max(minDecimals, fraction.length) };
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Serial de Excel de una fecha ISO, con aritmética UTC y sin zona horaria. */
export function dateSerial(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);
  const [year, month, day] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [];
  const time = year === undefined ? Number.NaN : Date.UTC(year, month! - 1, day);
  const date = new Date(time);
  if (
    Number.isNaN(time) ||
    year! < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new XlsxValueError("La fecha no es válida.");
  }
  return String((time - EXCEL_EPOCH) / DAY_MS);
}

/** Zona de los momentos del reporte: la hora de Ecuador, explícita y nunca la del proceso. */
export const REPORT_TIME_ZONE = "America/Guayaquil";

const WALL_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

/** Serial de Excel de un momento, con la hora de Ecuador y sus milisegundos. */
export function dateTimeSerial(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new XlsxValueError("El momento no es válido.");
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of WALL_CLOCK.formatToParts(instant)) parts[part.type] = part.value;
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    Number(parts.fractionalSecond),
  );
  if (wall < Date.UTC(1900, 0, 1)) throw new XlsxValueError("El momento no es válido.");
  return String((wall - EXCEL_EPOCH) / DAY_MS);
}
