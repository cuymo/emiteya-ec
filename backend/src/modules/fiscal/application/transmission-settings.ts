// Configuración operativa de la transmisión (add-sri-transmission, design D6 y D22): límites del
// envío, espera y backoff de las consultas, ventana de conclusión y espera del error 70. No son
// reglas normativas: salen del entorno.
import type { BackoffPolicy } from "../../../platform/jobs/jobs.ts";

export type TransmissionSettings = Readonly<{
  transmit: Readonly<{ maxAttempts: number; deadlineMs: number; backoff: BackoffPolicy }>;
  poll: Readonly<{
    /** Espera tras `RECIBIDA` antes de la primera consulta (CTX §23.1). */
    firstDelayMs: number;
    backoff: BackoffPolicy;
    /** Ventana de conclusión desde la primera evidencia de recepción (design D4). */
    windowMs: number;
    /** Espera tras el error 70 antes de reconciliar (design D13). */
    error70DelayMs: number;
  }>;
}>;

const SECOND = 1_000;
const HOUR = 3_600 * SECOND;

/** Valores por defecto de `deployment.md`, para las pruebas y los módulos sin entorno. */
export const DEFAULT_TRANSMISSION_SETTINGS: TransmissionSettings = {
  transmit: {
    maxAttempts: 10,
    deadlineMs: 24 * HOUR,
    backoff: { baseMs: 10 * SECOND, capMs: 1_800 * SECOND, minMs: SECOND },
  },
  poll: {
    firstDelayMs: 5 * SECOND,
    backoff: { baseMs: 10 * SECOND, capMs: 1_800 * SECOND, minMs: SECOND },
    windowMs: 24 * HOUR,
    error70DelayMs: 120 * SECOND,
  },
};
