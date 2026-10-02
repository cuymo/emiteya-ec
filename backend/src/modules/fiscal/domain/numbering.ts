// Numeración fiscal (add-fiscal-numbering, design D2, D6 y D9). Un contador por empresa, ambiente,
// establecimiento, punto y tipo (ADR 0003). El siguiente valor siempre supera al mayor reservado, y
// el valor de agotado es interno: nunca es un secuencial ni sale del dominio.
import { DOCUMENT_TYPES, SEQUENTIAL_MAX, SEQUENTIAL_MIN } from "@facturador/contracts";

export { DOCUMENT_TYPES, SEQUENTIAL_MAX, SEQUENTIAL_MIN };
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Valor centinela de `next_number` después de reservar el 999999999 (design D6). */
export const EXHAUSTED_NEXT_NUMBER = SEQUENTIAL_MAX + 1;

export type CounterState = Readonly<{ nextNumber: number; lastReserved: number | null }>;

/** Un contador que todavía no existe parte de este estado (creación perezosa, design D3). */
export const INITIAL_COUNTER: CounterState = { nextNumber: SEQUENTIAL_MIN, lastReserved: null };

export function isExhausted(counter: CounterState): boolean {
  return counter.nextNumber > SEQUENTIAL_MAX;
}

/** Siguiente secuencial visible; null cuando el contador está agotado. */
export function visibleNextNumber(counter: CounterState): number | null {
  return isExhausted(counter) ? null : counter.nextNumber;
}

export type AdjustmentDecision =
  | { kind: "UNCHANGED" }
  | { kind: "ADVANCE" | "DECREASE" }
  | { kind: "REJECTED"; reason: "EXHAUSTED" | "RESERVED" };

/**
 * Clasifica un ajuste del siguiente secuencial sobre el estado vigente: sin cambio, avance,
 * retroceso o rechazo. Nunca se admite un valor igual o menor que el último reservado.
 */
export function classifyAdjustment(counter: CounterState, desired: number): AdjustmentDecision {
  if (isExhausted(counter)) return { kind: "REJECTED", reason: "EXHAUSTED" };
  if (counter.lastReserved !== null && desired <= counter.lastReserved) {
    return { kind: "REJECTED", reason: "RESERVED" };
  }
  if (desired === counter.nextNumber) return { kind: "UNCHANGED" };
  return { kind: desired > counter.nextNumber ? "ADVANCE" : "DECREASE" };
}
