// Transmisión al SRI (add-sri-transmission, design D2, D6, D7 y D15): tipos de job y su
// deduplicación, operaciones y resultados de los intentos, mensajes del SRI y los estados en que
// se admite una reconciliación manual. Tres modelos separados: el estado fiscal del comprobante, el
// del job y el intento con el SRI; ninguno se deduce de otro.
import type { DocumentState } from "./document.ts";

export const SRI_JOB_TYPES = {
  transmit: "sri.transmit",
  authorize: "sri.authorize",
  reconcile: "sri.reconcile",
} as const;
export type SriJobType = (typeof SRI_JOB_TYPES)[keyof typeof SRI_JOB_TYPES];

/** Clave de deduplicación: un job activo de cada tipo por comprobante (design D6). */
export const sriDedupeKey = (type: SriJobType, documentId: string): string =>
  `${type}:${documentId}`;

export const SRI_OPERATIONS = ["RECEPTION", "AUTHORIZATION", "VALIDITY"] as const;
export type SriOperation = (typeof SRI_OPERATIONS)[number];

/** Resultados de la clasificación de un intento (design D11, D12 y D15). */
export const SRI_OUTCOMES = [
  "RECEIVED",
  "RETURNED",
  "KEY_IN_PROCESS",
  "KEY_REGISTERED",
  "SEQUENTIAL_REGISTERED",
  "UNKNOWN",
  "INCONSISTENT",
  "AUTHORIZED",
  "NOT_AUTHORIZED",
  "NO_CONCLUSION",
  "KEY_UNKNOWN",
  "KEY_KNOWN",
  "NO_EVIDENCE",
  "NOT_SENT",
  "UNPARSEABLE",
] as const;
export type SriOutcome = (typeof SRI_OUTCOMES)[number];

/** Mensaje del SRI tal como llegó, con todos sus campos; ninguno se descarta (CTX §22.2). */
export type SriMessage = Readonly<{
  identifier: string | null;
  message: string | null;
  additionalInformation: string | null;
  type: string | null;
}>;

/**
 * Estados en que se admite una reconciliación manual (design D15). `SIGNED` y `RECEIVED` solo
 * sin una interacción activa con el SRI: es decir, con su transmisión detenida.
 */
export const RECONCILABLE_STATES: ReadonlySet<DocumentState> = new Set([
  "SIGNED",
  "SEND_UNKNOWN",
  "RECEIVED",
  "MANUAL_REVIEW",
]);

/**
 * Motivos con que se detiene un job del SRI (design D5, D9 y D17). El estado fiscal no cambia: el
 * comprobante queda visible, alertado y reconciliable por el administrador.
 */
export const TRANSMISSION_STOP_CODES = [
  "INTEGRITY_FAILED",
  "TOO_LARGE",
  "SIZE_POLICY_MISSING",
  "SRI_UNAVAILABLE",
  "HANDLER_ERROR",
] as const;
export type TransmissionStopCode = (typeof TRANSMISSION_STOP_CODES)[number];
