// Política conservadora de transmisión de EmiteYa, versión 1
// (adopt-conservative-sri-transmission-size-policy-v1, design D1; Q-47 resuelta por política de
// producto). Todo envío individual al SRI, en Pruebas y en Producción, debe medir menos de 40 000 bytes
// en el XML firmado, en su base64 y en el cuerpo SOAP completo.
//
// NO es el límite oficial del SRI. La ficha v2.34 dice «320 Kb» sin definir la unidad ni qué se mide,
// así que EmiteYa elige un tope deliberadamente conservador. Es una constante del código a propósito:
// ninguna configuración la cambia. Solo se revisa con evidencia oficial nueva del SRI, mediante una
// decisión y un change nuevos.

export const TRANSMISSION_SIZE_POLICY = Object.freeze({
  id: "PRODUCT_CONSERVATIVE_POLICY_V1",
  limitBytes: 40_000,
} as const);

export type TransmissionSizePolicyId = typeof TRANSMISSION_SIZE_POLICY.id;

/** Las tres medidas del cuerpo final de la recepción, en bytes. */
export type TransmissionSizes = Readonly<{
  signedXmlBytes: number;
  base64PayloadBytes: number;
  soapRequestBytes: number;
}>;

/** Las tres medidas deben ser menores que el límite: 39 999 pasa; 40 000 y 40 001, no. */
export const withinTransmissionSizePolicy = (sizes: TransmissionSizes): boolean =>
  sizes.signedXmlBytes < TRANSMISSION_SIZE_POLICY.limitBytes &&
  sizes.base64PayloadBytes < TRANSMISSION_SIZE_POLICY.limitBytes &&
  sizes.soapRequestBytes < TRANSMISSION_SIZE_POLICY.limitBytes;
