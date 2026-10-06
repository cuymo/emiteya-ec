// Presentación de los comprobantes de retención (add-withholding-receipts, design D24): el número del
// documento sustento con su máscara, el período fiscal, la parte relacionada y las retenciones. Es
// presentación: el borrador guarda los 15 dígitos y el `MM/AAAA`, y los importes son del servidor.
import type { RelatedParty } from "@facturador/contracts";
import { formatPercentage } from "@/lib/decimal";

/** Dígitos del número del documento sustento: a lo más 15, sin guiones. */
export const supportNumberDigits = (text: string) => text.replace(/\D/g, "").slice(0, 15);

/** "001001000000123" → "001-001-000000123"; también mientras se escribe. */
export function formatSupportNumber(text: string | null): string {
  const digits = supportNumberDigits(text ?? "");
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)].filter(Boolean).join("-");
}

export const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** "10/2026" → { month: "10", year: "2026" }; un texto que no es `MM/AAAA` da campos vacíos. */
export function periodParts(period: string | null): { month: string; year: string } {
  const match = /^(\d{2})\/(\d{4})$/.exec(period ?? "");
  return match ? { month: match[1]!, year: match[2]! } : { month: "", year: "" };
}

/** "10/2026" → "Octubre de 2026". */
export function formatPeriod(period: string | null): string {
  const { month, year } = periodParts(period);
  const name = MONTH_NAMES[Number(month) - 1];
  return name ? `${name} de ${year}` : (period ?? "Sin período");
}

export const RELATED_PARTY_LABELS: Record<RelatedParty, string> = { SI: "Sí", NO: "No" };

/** Retención en una línea: código, denominación y porcentaje del servidor. */
export const conceptLabel = (entry: { code: string; label: string; percentage: string }) =>
  `${entry.code} · ${entry.label} · ${formatPercentage(entry.percentage)}`;

/** "1 documento", "3 documentos". */
export const supportCountLabel = (count: number) =>
  count === 1 ? "1 documento" : `${count} documentos`;

/** "1 retención", "3 retenciones". */
export const withholdingCountLabel = (count: number) =>
  count === 1 ? "1 retención" : `${count} retenciones`;
