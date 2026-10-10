// Diagnóstico de la política conservadora de tamaño (adopt-conservative-sri-transmission-size-policy-v1,
// design D4): lo que observa cada comprobación de un envío, para la readiness y la métrica. Nunca
// identifica el comprobante: ni clave, ni RUC, ni número, ni terceros, ni contenido.
import type { TransmissionSizes } from "../domain/transmission-size-policy.ts";

export type TransmissionSizeBlockReason = "TRANSMISSION_SIZE_POLICY_EXCEEDED";

/** Una comprobación de la política: las tres medidas, si se permitió y el motivo del bloqueo. */
export type TransmissionSizeCheck = TransmissionSizes &
  Readonly<{
    allowed: boolean;
    blockReason: TransmissionSizeBlockReason | null;
  }>;

export type TransmissionSizeObserver = Readonly<{ observe(check: TransmissionSizeCheck): void }>;

export const TRANSMISSION_SIZE_OBSERVER_OFF: TransmissionSizeObserver = { observe: () => {} };
