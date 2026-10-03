// Presentación de decimales (add-fiscal-catalogs, design D10): un `DecimalString` se formatea con los
// separadores de es-EC sin pasar por `number`, que perdería precisión.
import { canonicalDecimal, decimalParts, isDecimalString } from "@facturador/contracts";

const parts = new Intl.NumberFormat("es-EC").formatToParts(12345.5);
const GROUP = parts.find((part) => part.type === "group")?.value ?? ".";
const DECIMAL = parts.find((part) => part.type === "decimal")?.value ?? ",";

/** "1234567.5" → "1.234.567,5" (es-EC); `minFractionDigits` completa con ceros: "50" → "50,00". */
export function formatDecimal(text: string, { minFractionDigits = 0 } = {}): string {
  if (!isDecimalString(text)) return text;
  const { negative, integer, fraction } = decimalParts(canonicalDecimal(text));
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  const digits = fraction.padEnd(minFractionDigits, "0");
  return `${negative ? "-" : ""}${grouped}${digits ? `${DECIMAL}${digits}` : ""}`;
}

/** Porcentaje con el espacio que pide la norma del español: "15 %". */
export const formatPercentage = (text: string) => `${formatDecimal(text)} %`;

/** Importe en dólares con dos decimales: "USD 50,00". */
export const formatUsd = (text: string) => `USD ${formatDecimal(text, { minFractionDigits: 2 })}`;
