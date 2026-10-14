// Casos especiales que activa la configuración declarada del emisor (ADR 0014; add-invoice-emission,
// design D6; block-unsupported-special-cases-before-emission, design D1 y D5). Una sola regla para
// los seis comprobantes: qué anexos activa la configuración, a qué tipos alcanza cada uno y cuáles
// escribe de verdad el motor. Un anexo activo, aplicable y no soportado se rechaza antes de reservar.
import type { DocumentType } from "@facturador/contracts";

/** Lo que la regla lee de la configuración tributaria vigente. */
export type IssuerSpecialCaseProfile = Readonly<{
  ruc: string;
  withholdingAgentResolution: string | null;
  rimpeCategory: string | null;
  largeTaxpayer: boolean;
  providerRuc: string | null;
}>;

/**
 * Anexos que el motor escribe de verdad: `agenteRetencion` (21) y `contribuyenteRimpe` (22), en el
 * `infoTributaria` común. El 24 y el 26 se conocen y no se soportan: se bloquean.
 */
export const SUPPORTED_SPECIAL_CASES: ReadonlySet<number> = new Set([21, 22]);

const ALL_TYPES: readonly DocumentType[] = ["01", "03", "04", "05", "06", "07"];

/** Tipos de comprobante a los que alcanza cada anexo de una condición del emisor (design D5). */
export const SPECIAL_CASE_DOCUMENT_TYPES: Readonly<Record<number, readonly DocumentType[]>> = {
  21: ALL_TYPES,
  22: ALL_TYPES,
  // Ficha v2.34, anexo 24: «comprobantes de venta» (la factura y la liquidación de compra, por el
  // art. 1 del Reglamento de Comprobantes), notas de crédito y notas de débito.
  24: ["01", "03", "04", "05"],
  // Ficha v2.34, anexo 26: «los comprobantes emitidos».
  26: ALL_TYPES,
};

/** Tema y motivo del rechazo de cada anexo que se conoce y no se soporta, en palabras del usuario. */
const UNSUPPORTED: Readonly<Record<number, Readonly<{ topic: string; reason: string }>>> = {
  24: {
    topic: "grandes contribuyentes",
    reason: "esta versión no soporta la emisión de una empresa declarada gran contribuyente",
  },
  26: {
    topic: "RUC del proveedor del sistema o servicio",
    reason: "esta versión no soporta la emisión con un sistema provisto por un tercero",
  },
};

/** Anexos que activa la configuración declarada; la aplicación nunca los infiere. */
export function issuerSpecialCases(
  profile: IssuerSpecialCaseProfile,
): readonly Readonly<{ annex: number; active: boolean }>[] {
  return [
    { annex: 21, active: profile.withholdingAgentResolution !== null },
    { annex: 22, active: profile.rimpeCategory !== null },
    { annex: 24, active: profile.largeTaxpayer },
    // Anexo 26: un RUC proveedor distinto del propio indica el sistema de un tercero (CTX §37).
    { annex: 26, active: profile.providerRuc !== null && profile.providerRuc !== profile.ruc },
  ];
}

/** true si el anexo alcanza al tipo de comprobante. */
export function specialCaseApplies(annex: number, documentType: DocumentType): boolean {
  return SPECIAL_CASE_DOCUMENT_TYPES[annex]?.includes(documentType) ?? false;
}

/** Mensaje del rechazo, sin datos de la empresa; `topic` es el tema de la matriz, si no hay otro. */
export function unsupportedSpecialCaseMessage(annex: number, topic?: string): string {
  const known = UNSUPPORTED[annex];
  if (known)
    return `El anexo ${annex} (${known.topic}) aplica a este comprobante: ${known.reason}.`;
  return `El anexo ${annex}${topic ? ` (${topic})` : ""} aplica a este comprobante y su emisión todavía no está soportada.`;
}

/** Primer anexo activo, aplicable al tipo y que el motor no soporta, con su mensaje; o `null`. */
export function unsupportedSpecialCase(
  profile: IssuerSpecialCaseProfile,
  documentType: DocumentType,
): Readonly<{ annex: number; message: string }> | null {
  for (const { annex, active } of issuerSpecialCases(profile)) {
    if (!active || SUPPORTED_SPECIAL_CASES.has(annex) || !specialCaseApplies(annex, documentType))
      continue;
    return { annex, message: unsupportedSpecialCaseMessage(annex) };
  }
  return null;
}
