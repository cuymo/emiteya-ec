// Tope de seguridad de la certificación (add-sri-certification-safety-cap, design D1 y D3).
//
// CERTIFICATION SAFETY CAP: 40 000 bytes, la lectura convencional más restrictiva del texto oficial
// ambiguo de la ficha v2.34 («320 Kb» leídos como 320 000 bits). NO es el límite oficial del SRI, ni
// el de Producción, ni un límite general de documento, ni una defensa de recursos, ni una regla del
// XSD: Q-47 sigue abierta. Solo rige en una sesión de certificación de Pruebas, y es una constante
// del código a propósito: subirla convertiría la salvaguarda en una pseudo-política del SRI.
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";

export const CERTIFICATION_SAFETY_CAP_BYTES = 40_000;

/**
 * Fuente efectiva del límite de tamaño para un comprobante de Pruebas. El tope de la certificación
 * nunca se presenta como la política oficial del SRI.
 */
export type EffectiveSizePolicySource =
  | "SRI_OFFICIAL_POLICY"
  | "CERTIFICATION_CONSERVATIVE_CAP"
  | "SRI_OFFICIAL_AND_CERTIFICATION_CAP"
  | "MISSING";

/**
 * Resolución del límite efectivo (design D3). `MISSING` es el único resultado sin envío; con la
 * sesión encendida, la falta de una política oficial no es terminal y rige el tope.
 */
export function resolveSizePolicySource(
  input: Readonly<{ officialPolicy: boolean; certificationSession: boolean }>,
): EffectiveSizePolicySource {
  if (input.officialPolicy)
    return input.certificationSession
      ? "SRI_OFFICIAL_AND_CERTIFICATION_CAP"
      : "SRI_OFFICIAL_POLICY";
  return input.certificationSession ? "CERTIFICATION_CONSERVATIVE_CAP" : "MISSING";
}

/** La sesión de certificación solo habla con el SRI sobre comprobantes de Pruebas (design D4). */
export const certificationAllows = (environment: Environment): boolean => environment === "TEST";

/** Las tres medidas del cuerpo final de la recepción, en bytes. */
export type CertificationSizes = Readonly<{
  signedXmlBytes: number;
  base64PayloadBytes: number;
  soapRequestBytes: number;
}>;

/** Las tres medidas deben ser menores que el tope: 39 999 pasa; 40 000 y 40 001, no. */
export const withinCertificationSafetyCap = (sizes: CertificationSizes): boolean =>
  sizes.signedXmlBytes < CERTIFICATION_SAFETY_CAP_BYTES &&
  sizes.base64PayloadBytes < CERTIFICATION_SAFETY_CAP_BYTES &&
  sizes.soapRequestBytes < CERTIFICATION_SAFETY_CAP_BYTES;
